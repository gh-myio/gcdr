import { CentralRestoreService } from '../../../src/services/CentralRestoreService';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const SHA = 'a'.repeat(64);

function makeService(
  opts: {
    central?: unknown;
    backup?: unknown;
    job?: unknown;
    listResult?: unknown[];
    activeJob?: unknown;
    updateResult?: unknown;
  } = {},
) {
  const jobs = {
    create: jest.fn(async (i: { id?: string; dryRun?: boolean }) => ({
      id: i.id ?? 'job-1',
      status: 'QUEUED',
      currentPhase: 'QUEUED',
      dryRun: i.dryRun ?? false,
      logEntries: [],
      ...i,
    })),
    getById: jest.fn(async () => ('job' in opts ? opts.job : null)),
    listByCentralPaged: jest.fn(async () => ({
      items: opts.listResult ?? [],
      total: (opts.listResult ?? []).length,
    })),
    findActiveByCentral: jest.fn(async () => ('activeJob' in opts ? opts.activeJob : null)),
    update: jest.fn(
      async (
        _t: string,
        id: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        patch: any,
        _expectedStatus?: string,
      ) => ('updateResult' in opts ? opts.updateResult : { id, ...patch }),
    ),
  };
  const backups = {
    getById: jest.fn(async () =>
      'backup' in opts
        ? opts.backup
        : {
            id: 'bkp-1',
            status: 'AVAILABLE',
            storageKey: 'backups/t1/c1/bkp-1.pgdump.custom',
            sha256: SHA,
            byteSize: 10,
          },
    ),
  };
  const centrals = {
    getById: jest.fn(async () =>
      'central' in opts ? opts.central : { id: 'c1', serialNumber: '1.2.3.4' },
    ),
  };
  const svc = new CentralRestoreService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jobs as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    backups as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    centrals as any,
  );
  return { svc, jobs, backups, centrals };
}

describe('CentralRestoreService', () => {
  describe('startRestore', () => {
    it('creates a QUEUED job and returns job metadata (no presigned URL for the browser)', async () => {
      const { svc, jobs } = makeService();
      const res = await svc.startRestore('t1', 'c1', 'u1', { sourceBackupId: 'bkp-1' });
      expect(res.status).toBe('QUEUED');
      expect(res.currentPhase).toBe('QUEUED');
      expect(res.sha256).toBe(SHA);
      // the browser must NOT receive the central's presigned download URL (F-B3)
      expect(res).not.toHaveProperty('downloadUrl');
      expect(res).not.toHaveProperty('expiresIn');
      expect(jobs.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', centralId: 'c1', sourceBackupId: 'bkp-1' }),
      );
    });

    it('throws NotFoundError when the central is missing', async () => {
      const { svc, jobs } = makeService({ central: null });
      await expect(svc.startRestore('t1', 'x', 'u1', { sourceBackupId: 'bkp-1' })).rejects.toThrow(
        NotFoundError,
      );
      expect(jobs.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the backup is missing', async () => {
      const { svc } = makeService({ backup: null });
      await expect(svc.startRestore('t1', 'c1', 'u1', { sourceBackupId: 'nope' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('throws ValidationError when the backup is not AVAILABLE (no job created)', async () => {
      const { svc, jobs } = makeService({ backup: { id: 'bkp-1', status: 'PENDING' } });
      await expect(svc.startRestore('t1', 'c1', 'u1', { sourceBackupId: 'bkp-1' })).rejects.toThrow(
        ValidationError,
      );
      expect(jobs.create).not.toHaveBeenCalled();
    });

    it('rejects a second restore while one is already active (no double-run)', async () => {
      const { svc, jobs } = makeService({
        activeJob: { id: 'job-active', status: 'RUNNING' },
      });
      await expect(svc.startRestore('t1', 'c1', 'u1', { sourceBackupId: 'bkp-1' })).rejects.toThrow(
        ValidationError,
      );
      // guard rejects before creating anything
      expect(jobs.create).not.toHaveBeenCalled();
    });
  });

  describe('updateProgress', () => {
    it('appends a log entry and advances the phase', async () => {
      const { svc, jobs } = makeService({
        job: { id: 'job-1', status: 'RUNNING', currentPhase: 'DOWNLOAD', logEntries: [] },
      });
      await svc.updateProgress('t1', 'c1', 'job-1', {
        currentPhase: 'RESTORE_DB',
        message: 'restoring db',
      });
      const patch = jobs.update.mock.calls[0][2];
      expect(patch.currentPhase).toBe('RESTORE_DB');
      expect(patch.logEntries).toHaveLength(1);
      expect(patch.completedAt).toBeUndefined();
    });

    it('stamps completedAt on a terminal status', async () => {
      const { svc, jobs } = makeService({
        job: { id: 'job-1', status: 'RUNNING', currentPhase: 'START_SERVICES', logEntries: [] },
      });
      await svc.updateProgress('t1', 'c1', 'job-1', {
        status: 'DONE',
        currentPhase: 'DONE',
        message: 'finished',
      });
      const patch = jobs.update.mock.calls[0][2];
      expect(patch.status).toBe('DONE');
      expect(patch.completedAt).toBeInstanceOf(Date);
    });

    it('rejects a phase regression (CR-S6)', async () => {
      const { svc, jobs } = makeService({
        job: { id: 'job-1', status: 'RUNNING', currentPhase: 'RESTORE_DB', logEntries: [] },
      });
      await expect(
        svc.updateProgress('t1', 'c1', 'job-1', { currentPhase: 'DOWNLOAD' }),
      ).rejects.toThrow(ValidationError);
      expect(jobs.update).not.toHaveBeenCalled();
    });

    it('rejects status DONE without reaching the DONE phase (CR-S6)', async () => {
      const { svc, jobs } = makeService({
        job: { id: 'job-1', status: 'RUNNING', currentPhase: 'RESTORE_DB', logEntries: [] },
      });
      await expect(svc.updateProgress('t1', 'c1', 'job-1', { status: 'DONE' })).rejects.toThrow(
        ValidationError,
      );
      expect(jobs.update).not.toHaveBeenCalled();
    });

    it('rejects an illegal status transition RUNNING -> QUEUED (CR-S6)', async () => {
      const { svc, jobs } = makeService({
        job: { id: 'job-1', status: 'RUNNING', currentPhase: 'DOWNLOAD', logEntries: [] },
      });
      await expect(svc.updateProgress('t1', 'c1', 'job-1', { status: 'QUEUED' })).rejects.toThrow(
        ValidationError,
      );
      expect(jobs.update).not.toHaveBeenCalled();
    });

    it('rejects updates to an already-finished job', async () => {
      const { svc, jobs } = makeService({
        job: { id: 'job-1', status: 'DONE', currentPhase: 'DONE', logEntries: [] },
      });
      await expect(
        svc.updateProgress('t1', 'c1', 'job-1', { message: 'late' }),
      ).rejects.toThrow(ValidationError);
      expect(jobs.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the job is missing', async () => {
      const { svc } = makeService({ job: null });
      await expect(svc.updateProgress('t1', 'c1', 'nope', { message: 'x' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('CAS: rejects the report when the job changed concurrently (update no-op)', async () => {
      const { svc, jobs } = makeService({
        job: { id: 'job-1', status: 'RUNNING', currentPhase: 'DOWNLOAD', logEntries: [] },
        updateResult: null, // reaper flipped it to FAILED between read and write
      });
      await expect(
        svc.updateProgress('t1', 'c1', 'job-1', { currentPhase: 'RESTORE_DB', message: 'x' }),
      ).rejects.toThrow(ValidationError);
      // CAS predicate carries the pre-read status
      expect(jobs.update).toHaveBeenCalledWith('t1', 'job-1', expect.any(Object), 'RUNNING');
    });
  });

  describe('cancelRestore', () => {
    it('cancels a non-terminal job (CANCELED + completedAt, CAS-guarded)', async () => {
      const { svc, jobs } = makeService({
        job: { id: 'job-1', status: 'RUNNING', currentPhase: 'DOWNLOAD', logEntries: [] },
      });
      await svc.cancelRestore('t1', 'c1', 'job-1', 'u1');
      const [, , patch, expected] = jobs.update.mock.calls[0];
      expect(patch.status).toBe('CANCELED');
      expect(patch.completedAt).toBeInstanceOf(Date);
      expect(expected).toBe('RUNNING'); // CAS on pre-read status
    });

    it('rejects cancelling an already-terminal job', async () => {
      const { svc, jobs } = makeService({
        job: { id: 'job-1', status: 'DONE', currentPhase: 'DONE', logEntries: [] },
      });
      await expect(svc.cancelRestore('t1', 'c1', 'job-1')).rejects.toThrow(ValidationError);
      expect(jobs.update).not.toHaveBeenCalled();
    });
  });

  describe('getJob / listJobs', () => {
    it('getJob throws NotFoundError when missing', async () => {
      const { svc } = makeService({ job: null });
      await expect(svc.getJob('t1', 'c1', 'nope')).rejects.toThrow(NotFoundError);
    });

    it('listJobs throws NotFoundError when the central is missing', async () => {
      const { svc } = makeService({ central: null });
      await expect(svc.listJobs('t1', 'x')).rejects.toThrow(NotFoundError);
    });

    it('listJobs returns a PaginatedResult envelope', async () => {
      const { svc } = makeService({ listResult: [{ id: 'j1' }, { id: 'j2' }] });
      const res = await svc.listJobs('t1', 'c1', { page: 1, limit: 50 });
      expect(res.items).toHaveLength(2);
      expect(res.pagination).toEqual(
        expect.objectContaining({ total: 2, totalPages: 1, hasMore: false }),
      );
    });
  });
});
