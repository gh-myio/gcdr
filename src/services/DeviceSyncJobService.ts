import { Device } from '../domain/entities/Device';
import { DeviceRepository } from '../repositories/DeviceRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import {
  DeviceSyncJobRepository,
  DeviceSyncJob,
  JobLogEntry,
  JobPhase,
  JobPhasesSummary,
  ListJobsParams,
  deviceSyncJobRepository,
} from '../repositories/DeviceSyncJobRepository';
import { NotFoundError, ValidationError } from '../shared/errors/AppError';

// ============================================================
// Types
// ============================================================

export interface CreateJobRequest {
  customerId:     string;
  defaultAssetId?: string;
  dryRun?:        boolean;
  files: Array<{ name: string; content: string }>;
}

interface ParsedRow {
  file:          string;
  tbId:          string;
  deviceName:    string;
  label:         string;
  identifier:    string;
  deviceType:    string;
  deviceProfile: string;
  slaveId:       number | null;
  centralId:     string;
  gcdrCustomerId: string;
  gcdrAssetId:   string;
  gcdrDeviceId:  string;
}

type ActionType = 'CREATE' | 'UPDATE' | 'UPDATE_IDENTIFIER' | 'SKIP';

interface CheckedRow {
  row:            ParsedRow;
  gcdrDevice:     Device | null;
  divergentFields: string[];
  needsCreate:    boolean;
}

interface ActionItem {
  checked:    CheckedRow;
  action:     ActionType;
  targetDeviceId?: string; // set after DETECT_RELOCATIONS
}

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const DEVICE_MAP_HEADER = 'tbId|deviceName|label|identifier|deviceType|deviceProfile|slaveId|centralId|gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt';

// ============================================================
// Service
// ============================================================

export class DeviceSyncJobService {
  private repo:        DeviceSyncJobRepository;
  private deviceRepo:  DeviceRepository;
  private customerRepo: CustomerRepository;

  constructor(
    repo?:        DeviceSyncJobRepository,
    deviceRepo?:  DeviceRepository,
    customerRepo?: CustomerRepository,
  ) {
    this.repo        = repo        ?? deviceSyncJobRepository;
    this.deviceRepo  = deviceRepo  ?? new DeviceRepository();
    this.customerRepo = customerRepo ?? new CustomerRepository();
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  async createJob(tenantId: string, req: CreateJobRequest): Promise<{ jobId: string; status: string }> {
    // Validate customer exists
    const customer = await this.customerRepo.getById(tenantId, req.customerId);
    if (!customer) throw new NotFoundError(`Customer ${req.customerId} not found`);

    // Validate files
    for (const file of req.files) {
      const lines = file.content.split('\n').filter(l => l.trim() && !l.startsWith('['));
      if (lines.length === 0) {
        throw new ValidationError(`File "${file.name}" is empty`);
      }
      const header = lines[0].trim();
      if (!header.startsWith('tbId|deviceName')) {
        throw new ValidationError(`File "${file.name}" has invalid header. Expected: ${DEVICE_MAP_HEADER}`);
      }
    }

    const job = await this.repo.create({
      tenantId,
      customerId:  req.customerId,
      dryRun:      req.dryRun ?? false,
      inputConfig: { defaultAssetId: req.defaultAssetId },
      inputFiles:  req.files,
    });

    // Run pipeline async
    setImmediate(() => this.runJob(job.id, tenantId).catch(err => {
      console.error(`[DeviceSyncJob] Unhandled error in job ${job.id}:`, err);
    }));

    return { jobId: job.id, status: 'QUEUED' };
  }

  async getJobById(tenantId: string, jobId: string): Promise<DeviceSyncJob> {
    const job = await this.repo.findById(tenantId, jobId);
    if (!job) throw new NotFoundError(`Job ${jobId} not found`);
    return job;
  }

  async getJobLog(tenantId: string, jobId: string): Promise<{ jobId: string; status: string; entries: JobLogEntry[] }> {
    const job = await this.getJobById(tenantId, jobId);
    return { jobId: job.id, status: job.status, entries: job.logEntries };
  }

  async listJobs(tenantId: string, params: ListJobsParams): Promise<{
    data: Omit<DeviceSyncJob, 'inputFiles' | 'logEntries'>[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const page     = params.page     ?? 1;
    const pageSize = params.pageSize ?? 20;

    const { items, total } = await this.repo.list(tenantId, params);

    const data = items.map(({ inputFiles: _f, logEntries: _l, ...rest }) => rest);

    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  // ----------------------------------------------------------
  // Pipeline runner
  // ----------------------------------------------------------

  private async runJob(jobId: string, tenantId: string): Promise<void> {
    const job = await this.repo.findById(tenantId, jobId);
    if (!job) return;

    const { customerId, dryRun, inputFiles, inputConfig } = job;
    const defaultAssetId = inputConfig.defaultAssetId;

    const log: JobLogEntry[] = [];
    const summary: JobPhasesSummary = {};

    const addLog = (phase: JobPhase, level: JobLogEntry['level'], message: string) => {
      log.push({ ts: new Date().toISOString(), phase, level, message });
    };

    const save = async (phase: JobPhase) => {
      await this.repo.update(tenantId, jobId, { currentPhase: phase, logEntries: log, phasesSummary: summary });
    };

    try {
      await this.repo.update(tenantId, jobId, { status: 'RUNNING', currentPhase: 'CHECK' });

      // ---- PHASE: CHECK ------------------------------------------------
      const allRows = this.parseAllFiles(inputFiles);
      addLog('CHECK', 'INFO', `Parsed ${allRows.length} device rows from ${inputFiles.length} file(s)`);

      // Fetch all customer devices (up to 10k) and build lookup maps
      const gcdrDevicesResult = await this.deviceRepo.list(tenantId, { customerId, limit: 10000 });
      const gcdrDevices = gcdrDevicesResult.items;

      const byId         = new Map<string, Device>(gcdrDevices.map(d => [d.id, d] as [string, Device]));
      const byExternalId = new Map<string, Device>();
      for (const d of gcdrDevices) {
        if (d.externalId) byExternalId.set(d.externalId, d);
      }
      const byCentralSlave = new Map<string, Device>();
      for (const d of gcdrDevices) {
        if (d.centralId && d.slaveId != null) {
          byCentralSlave.set(`${d.centralId}:${d.slaveId}`, d);
        }
      }

      const checkedRows: CheckedRow[] = [];
      let conformant = 0, divergent = 0, notLinked = 0;

      for (const row of allRows) {
        const gcdrDevice = this.lookupDevice(row, byId, byExternalId, byCentralSlave);
        if (!gcdrDevice) {
          notLinked++;
          checkedRows.push({ row, gcdrDevice: null, divergentFields: [], needsCreate: true });
          continue;
        }

        const divergentFields = this.getDivergentFields(row, gcdrDevice);
        if (divergentFields.length === 0) {
          conformant++;
          checkedRows.push({ row, gcdrDevice, divergentFields: [], needsCreate: false });
        } else {
          divergent++;
          checkedRows.push({ row, gcdrDevice, divergentFields, needsCreate: false });
        }
      }

      summary.check = { conformant, divergent, notLinked };
      for (const file of inputFiles) {
        const fileRows = checkedRows.filter(c => c.row.file === file.name);
        const fc = fileRows.filter(c => !c.needsCreate && c.divergentFields.length === 0).length;
        const fd = fileRows.filter(c => !c.needsCreate && c.divergentFields.length > 0).length;
        const fn = fileRows.filter(c => c.needsCreate).length;
        addLog('CHECK', 'INFO', `${file.name}: ${fc} CONFORMANT, ${fd} DIVERGENT, ${fn} NOT_LINKED`);
      }

      await save('ACTION_PLAN');

      // ---- PHASE: ACTION_PLAN ------------------------------------------
      const actionPlan: ActionItem[] = [];
      let apCreate = 0, apUpdate = 0, apUpdateId = 0, apSkip = 0;

      for (const checked of checkedRows) {
        if (checked.needsCreate) {
          actionPlan.push({ checked, action: 'CREATE' });
          apCreate++;
        } else if (checked.divergentFields.length === 0) {
          actionPlan.push({ checked, action: 'SKIP' });
          apSkip++;
        } else if (checked.divergentFields.includes('identifier') && checked.divergentFields.length === 1) {
          actionPlan.push({ checked, action: 'UPDATE_IDENTIFIER' });
          apUpdateId++;
        } else {
          actionPlan.push({ checked, action: 'UPDATE' });
          if (checked.divergentFields.includes('identifier')) apUpdateId++;
          else apUpdate++;
        }
      }

      // Adjust counts: UPDATE_IDENTIFIER are those where only identifier differs
      // Reset proper counts
      apUpdate = actionPlan.filter(a => a.action === 'UPDATE').length;
      apUpdateId = actionPlan.filter(a => a.action === 'UPDATE_IDENTIFIER').length;

      summary.actionPlan = { create: apCreate, update: apUpdate, updateIdentifier: apUpdateId, skip: apSkip };
      addLog('ACTION_PLAN', 'INFO', `Classified: ${apCreate} CREATE, ${apUpdate} UPDATE, ${apUpdateId} UPDATE_IDENTIFIER, ${apSkip} SKIP`);

      await save('DETECT_RELOCATIONS');

      // ---- PHASE: DETECT_RELOCATIONS -----------------------------------
      const createItems    = actionPlan.filter(a => a.action === 'CREATE');
      let relocateCount    = 0;
      let genuineCreates   = 0;

      for (const item of createItems) {
        const row = item.checked.row;
        let existing: Device | null = null;

        // Search across entire tenant (not just this customer)
        if (row.tbId) {
          existing = await this.deviceRepo.getByExternalId(tenantId, row.tbId);
        }
        if (!existing && row.centralId && row.slaveId !== null) {
          existing = await this.deviceRepo.findBySlaveId(tenantId, row.centralId, row.slaveId);
        }

        if (existing && existing.customerId !== customerId) {
          item.action = 'CREATE'; // will be relocated, not created
          item.targetDeviceId = existing.id;
          relocateCount++;
        } else if (existing && existing.customerId === customerId) {
          // Found in same customer — shouldn't happen (was in CHECK), skip
          item.action = 'SKIP';
        } else {
          genuineCreates++;
        }
      }

      summary.detectRelocations = { relocate: relocateCount, genuineCreates };
      addLog('DETECT_RELOCATIONS', 'INFO', `${relocateCount} device(s) to relocate, ${genuineCreates} genuine create(s)`);

      await save('RELOCATE');

      // ---- PHASE: RELOCATE ---------------------------------------------
      const toRelocate = actionPlan.filter(a => a.action === 'CREATE' && a.targetDeviceId);
      let relocOk = 0, relocFail = 0;

      for (const item of toRelocate) {
        const row = item.checked.row;
        const targetAssetId = row.gcdrAssetId || defaultAssetId;
        const targetCustomerId = row.gcdrCustomerId || customerId;

        if (!targetAssetId) {
          addLog('RELOCATE', 'FAIL', `${row.deviceName} — no assetId available for relocation`);
          relocFail++;
          item.action = 'SKIP'; // skip CREATE too
          continue;
        }

        if (dryRun) {
          addLog('RELOCATE', 'INFO', `[DRY-RUN] Would relocate ${row.deviceName} to customer ${targetCustomerId}`);
          item.action = 'SKIP'; // mark as handled in dry-run
          relocOk++;
          continue;
        }

        try {
          await this.deviceRepo.move(tenantId, item.targetDeviceId!, targetAssetId, targetCustomerId, SYSTEM_USER);
          addLog('RELOCATE', 'OK', `${row.deviceName} → relocated to customer ${targetCustomerId}`);
          item.action = 'SKIP'; // relocated — no need to create
          relocOk++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addLog('RELOCATE', 'FAIL', `${row.deviceName} — ${msg}`);
          item.action = 'SKIP'; // skip to avoid duplicate
          relocFail++;
        }
      }

      summary.relocate = { ok: relocOk, fail: relocFail };

      await save('APPLY_UPDATES');

      // ---- PHASE: APPLY_UPDATES ----------------------------------------
      const toUpdate = actionPlan.filter(a => a.action === 'UPDATE' || a.action === 'UPDATE_IDENTIFIER');
      let updOk = 0, updFail = 0;

      for (const item of toUpdate) {
        const { row, gcdrDevice, divergentFields } = item.checked;
        if (!gcdrDevice) continue;

        const patch: Record<string, unknown> = {};
        if (divergentFields.includes('name'))         patch.name         = row.deviceName;
        if (divergentFields.includes('displayName'))  patch.displayName  = row.deviceName;
        if (divergentFields.includes('label'))        patch.label        = row.label       || undefined;
        if (divergentFields.includes('identifier'))   patch.identifier   = row.identifier  || undefined;
        if (divergentFields.includes('deviceType'))   patch.deviceType   = row.deviceType  || undefined;
        if (divergentFields.includes('deviceProfile')) patch.deviceProfile = row.deviceProfile || undefined;
        if (divergentFields.includes('slaveId'))      patch.slaveId      = row.slaveId     ?? undefined;
        if (divergentFields.includes('externalId'))   patch.externalId   = row.tbId        || undefined;

        if (dryRun) {
          addLog('APPLY_UPDATES', 'INFO', `[DRY-RUN] ${row.deviceName} — would patch: ${divergentFields.join(',')}`);
          updOk++;
          continue;
        }

        try {
          await this.deviceRepo.update(tenantId, gcdrDevice.id, patch as never, SYSTEM_USER);
          addLog('APPLY_UPDATES', 'OK', `${row.deviceName} — patched: ${divergentFields.join(',')}`);
          updOk++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addLog('APPLY_UPDATES', 'FAIL', `${row.deviceName} — ${msg}`);
          updFail++;
        }
      }

      summary.applyUpdates = { ok: updOk, fail: updFail };

      await save('CONSOLIDATE_CREATES');

      // ---- PHASE: CONSOLIDATE_CREATES ----------------------------------
      const toCreate = actionPlan.filter(a => a.action === 'CREATE' && !a.targetDeviceId);
      let crtOk = 0, crtFail = 0;

      for (const item of toCreate) {
        const row = item.checked.row;
        const targetAssetId    = row.gcdrAssetId    || defaultAssetId;
        const targetCustomerId = row.gcdrCustomerId || customerId;

        if (!targetAssetId) {
          addLog('CONSOLIDATE_CREATES', 'FAIL', `${row.deviceName} — no assetId available (set defaultAssetId)`);
          crtFail++;
          continue;
        }

        if (dryRun) {
          addLog('CONSOLIDATE_CREATES', 'INFO', `[DRY-RUN] Would create ${row.deviceName}`);
          crtOk++;
          continue;
        }

        try {
          const created = await this.deviceRepo.create(tenantId, {
            assetId:       targetAssetId,
            name:          row.deviceName,
            displayName:   row.deviceName,
            label:         row.label       || undefined,
            type:          'METER',
            externalId:    row.tbId        || undefined,
            identifier:    row.identifier  || undefined,
            deviceType:    row.deviceType  || undefined,
            deviceProfile: row.deviceProfile || undefined,
            slaveId:       row.slaveId     ?? undefined,
            centralId:     row.centralId   || undefined,
          } as never, targetCustomerId, SYSTEM_USER);

          addLog('CONSOLIDATE_CREATES', 'OK', `${row.deviceName} — gcdrDeviceId=${created.id}`);
          crtOk++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addLog('CONSOLIDATE_CREATES', 'FAIL', `${row.deviceName} — ${msg}`);
          crtFail++;
        }
      }

      summary.consolidateCreates = { ok: crtOk, fail: crtFail };

      // ---- DONE --------------------------------------------------------
      const hasFails = (summary.relocate?.fail ?? 0) + (summary.applyUpdates?.fail ?? 0) + (summary.consolidateCreates?.fail ?? 0);
      const finalStatus = hasFails > 0 ? 'PARTIAL' : 'DONE';
      const totalOk = updOk + crtOk + relocOk;
      const totalFail = updFail + crtFail + relocFail;

      addLog('DONE', 'INFO', `Job complete — ${totalOk} OK, ${totalFail} FAIL`);

      await this.repo.update(tenantId, jobId, {
        status:       finalStatus,
        currentPhase: 'DONE',
        phasesSummary: summary,
        logEntries:   log,
        completedAt:  new Date(),
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('CHECK', 'ERROR', `Fatal error: ${msg}`);
      await this.repo.update(tenantId, jobId, {
        status:       'FAILED',
        logEntries:   log,
        phasesSummary: summary,
        errorMessage: msg,
        completedAt:  new Date(),
      });
    }
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  private parseAllFiles(files: Array<{ name: string; content: string }>): ParsedRow[] {
    const rows: ParsedRow[] = [];
    for (const file of files) {
      const lines = file.content.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim() || line.startsWith('[')) continue;

        const parts = line.split('|');
        const slaveRaw = parts[6]?.trim();

        rows.push({
          file:          file.name,
          tbId:          parts[0]?.trim() ?? '',
          deviceName:    parts[1]?.trim() ?? '',
          label:         parts[2]?.trim() ?? '',
          identifier:    parts[3]?.trim() ?? '',
          deviceType:    parts[4]?.trim() ?? '',
          deviceProfile: parts[5]?.trim() ?? '',
          slaveId:       slaveRaw && !isNaN(Number(slaveRaw)) ? parseInt(slaveRaw, 10) : null,
          centralId:     parts[7]?.trim() ?? '',
          gcdrCustomerId: parts[8]?.trim() ?? '',
          gcdrAssetId:   parts[9]?.trim() ?? '',
          gcdrDeviceId:  parts[10]?.trim() ?? '',
        });
      }
    }
    return rows;
  }

  private lookupDevice(
    row: ParsedRow,
    byId:         Map<string, Device>,
    byExternalId: Map<string, Device>,
    byCentralSlave: Map<string, Device>,
  ): Device | null {
    // Priority 1: explicit gcdrDeviceId
    if (row.gcdrDeviceId) {
      const d = byId.get(row.gcdrDeviceId);
      if (d) return d;
    }
    // Priority 2: externalId (tbId)
    if (row.tbId) {
      const d = byExternalId.get(row.tbId);
      if (d) return d;
    }
    // Priority 3: centralId + slaveId
    if (row.centralId && row.slaveId !== null) {
      const d = byCentralSlave.get(`${row.centralId}:${row.slaveId}`);
      if (d) return d;
    }
    return null;
  }

  private getDivergentFields(row: ParsedRow, device: Device): string[] {
    const diffs: string[] = [];

    const norm = (v: string | null | undefined) => (v ?? '').trim();
    const normN = (v: number | null | undefined) => v ?? null;

    if (norm(device.name)          !== norm(row.deviceName))    diffs.push('name');
    if (norm(device.displayName)   !== norm(row.deviceName))    diffs.push('displayName');
    if (norm(device.label)         !== norm(row.label))         diffs.push('label');
    if (norm(device.identifier)    !== norm(row.identifier))    diffs.push('identifier');
    if (norm(device.deviceType)    !== norm(row.deviceType))    diffs.push('deviceType');
    if (norm(device.deviceProfile) !== norm(row.deviceProfile)) diffs.push('deviceProfile');
    if (normN(device.slaveId)      !== row.slaveId)             diffs.push('slaveId');
    if (row.tbId && norm(device.externalId) !== norm(row.tbId)) diffs.push('externalId');

    // Remove 'name' if displayName is already there (same source)
    if (diffs.includes('name') && diffs.includes('displayName')) {
      diffs.splice(diffs.indexOf('name'), 1);
    }

    return diffs;
  }
}

export const deviceSyncJobService = new DeviceSyncJobService();
