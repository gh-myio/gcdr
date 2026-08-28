/**
 * RFC-0061 M10 — one-shot import of the "Myio Compras" legacy system
 * (Lovable/Supabase) into the GCDR inventory domain (`inv_*`).
 *
 * Operational contract (RFC §Migration & import, A5):
 *   - Topological order: items → boms → customers/projects → purchase orders →
 *     releases → homologations(+registry) → movements(+QRs) → expedition →
 *     demands → field → external states. (Physical insert order is FK-safe;
 *     it preserves the RFC's data-dependency order.)
 *   - Raw-ledger mode: rows are written DIRECTLY via Drizzle with
 *     `imported=true` — the M2 service guards (QR/photo requirements,
 *     negative-stock lock) do NOT apply to historical rows.
 *   - Parity: the frozen source balance views are diffed against the imported
 *     ledger per (item, location); non-zero exit on any diff unless
 *     --allow-diff.
 *   - Idempotency: source UUIDs are REUSED as target ids and every insert is
 *     ON CONFLICT DO NOTHING, so a re-run without wiping inserts nothing new.
 *     For clean weekly rehearsals prefer `--wipe-first --yes`, which deletes
 *     all inv_* rows of the tenant first.
 *
 * Usage:
 *   tsx scripts/inventory/import-comprasmyio.ts \
 *     --backup ./backup.json \
 *     [--supabase-url https://<proj>.supabase.co --supabase-key <key>] \
 *     [--tenant 11111111-1111-1111-1111-111111111111] \
 *     [--files-dir ./buckets] [--report ./parity-report.json] \
 *     [--dry-run] [--wipe-first --yes] [--allow-diff] [--actor <uuid>]
 *
 * DATABASE_URL must be set except for a --dry-run without user/customer
 * matching. Supabase creds may also come from SUPABASE_URL / SUPABASE_SERVICE_KEY.
 */

import { createHash, randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../../src/infrastructure/database/drizzle/schema';
import {
  BalanceEntry,
  ItemMergeResult,
  ItemPlan,
  MovementType,
  SourceRow,
  StockLocation,
  THIRD_PARTY_LOCATION,
  TOOL_LOCATION,
  UserMatchResult,
  aggregateBalances,
  asBool,
  asNumber,
  asString,
  buildParityDiff,
  dedupOrderLogs,
  makeCurationProduct,
  mapExpeditionStatus,
  mapMovementType,
  mapOrderLogToEvent,
  mapPurchaseStatus,
  mapShippingMethod,
  mapSyncStatus,
  mapTechnicianDestination,
  mapUnitStatus,
  matchUsersByEmail,
  mergeItems,
  normalizeName,
  parseStorageUrl,
  pick,
  resolveItemByText,
} from './lib/transform';
import { ReportBuilder, buildSourceSnapshot } from './lib/report';
import { fetchExtras } from './lib/supabase';

type Db = PostgresJsDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// CLI options
// ---------------------------------------------------------------------------

interface Options {
  backupPath: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  tenantId: string;
  dryRun: boolean;
  filesDir?: string;
  reportPath?: string;
  wipeFirst: boolean;
  yes: boolean;
  allowDiff: boolean;
  actorId: string;
  curatedThirdParty: string[];
}

const DEFAULT_TENANT = '11111111-1111-1111-1111-111111111111';
/** Nil-uuid importer actor — used only where the schema demands a NOT NULL uuid. */
const IMPORT_ACTOR = '00000000-0000-0000-0000-000000000000';
const IMPORT_TAG = 'comprasmyio';

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    backupPath: '',
    tenantId: DEFAULT_TENANT,
    dryRun: false,
    wipeFirst: false,
    yes: false,
    allowDiff: false,
    actorId: IMPORT_ACTOR,
    curatedThirdParty: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case '--backup': opts.backupPath = next(); break;
      case '--supabase-url': opts.supabaseUrl = next(); break;
      case '--supabase-key': opts.supabaseKey = next(); break;
      case '--tenant': opts.tenantId = next(); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--files-dir': opts.filesDir = next(); break;
      case '--report': opts.reportPath = next(); break;
      case '--wipe-first': opts.wipeFirst = true; break;
      case '--yes': opts.yes = true; break;
      case '--allow-diff': opts.allowDiff = true; break;
      case '--actor': opts.actorId = next(); break;
      case '--curated-third-party': opts.curatedThirdParty = next().split(',').map((s) => s.trim()); break;
      case '--help':
      case '-h':
        console.info('See header comment of scripts/inventory/import-comprasmyio.ts for usage.');
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  opts.supabaseUrl = opts.supabaseUrl ?? process.env.SUPABASE_URL;
  opts.supabaseKey = opts.supabaseKey ?? process.env.SUPABASE_SERVICE_KEY;
  if (!opts.backupPath) throw new Error('--backup <path.json> is required');
  if (opts.wipeFirst && !opts.yes && !opts.dryRun) {
    throw new Error('--wipe-first is destructive: confirm with --yes');
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Backup loading
// ---------------------------------------------------------------------------

type Backup = Record<string, SourceRow[]>;

function loadBackup(backupPath: string): Backup {
  const raw = JSON.parse(readFileSync(backupPath, 'utf8')) as Record<string, unknown>;
  // exportDatabaseBackup emits either the table map directly or under `tables`.
  const map = (raw.tables ?? raw.data ?? raw) as Record<string, unknown>;
  const backup: Backup = {};
  for (const [table, rows] of Object.entries(map)) {
    if (Array.isArray(rows)) backup[table] = rows as SourceRow[];
  }
  return backup;
}

function tableOf(backup: Backup, ...names: string[]): SourceRow[] {
  for (const n of names) {
    if (backup[n]) return backup[n];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Import plan — all target rows, assembled before any write
// ---------------------------------------------------------------------------

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];

interface ImportPlan {
  fileAssets: Insert<typeof schema.fileAssets>[];
  items: Insert<typeof schema.invItems>[];
  boms: Insert<typeof schema.invBoms>[];
  customers: Insert<typeof schema.customers>[];
  projects: Insert<typeof schema.invProjects>[];
  purchaseOrders: Insert<typeof schema.invPurchaseOrders>[];
  purchaseOrderEvents: Insert<typeof schema.invPurchaseOrderEvents>[];
  purchaseOrderFiles: Insert<typeof schema.invPurchaseOrderFiles>[];
  assemblyReleases: Insert<typeof schema.invAssemblyReleases>[];
  assemblyReleaseItems: Insert<typeof schema.invAssemblyReleaseItems>[];
  assemblyReleaseIssues: Insert<typeof schema.invAssemblyReleaseIssues>[];
  homologations: Insert<typeof schema.invHomologations>[];
  homologationUnits: Insert<typeof schema.invHomologationUnits>[];
  qrRegistry: Insert<typeof schema.invQrRegistry>[];
  stockMovements: Insert<typeof schema.invStockMovements>[];
  movementQrs: Insert<typeof schema.invMovementQrs>[];
  expeditionOrders: Insert<typeof schema.invExpeditionOrders>[];
  expeditionOrderItems: Insert<typeof schema.invExpeditionOrderItems>[];
  itemDeliveries: Insert<typeof schema.invItemDeliveries>[];
  deliveryQrs: Insert<typeof schema.invDeliveryQrs>[];
  shipments: Insert<typeof schema.invShipments>[];
  productionDemands: Insert<typeof schema.invProductionDemands>[];
  purchaseDemands: Insert<typeof schema.invPurchaseDemands>[];
  unitProducts: Insert<typeof schema.invUnitProducts>[];
  technicianMoves: Insert<typeof schema.invTechnicianMoves>[];
  damagedItems: Insert<typeof schema.invDamagedItems>[];
  externalStates: Insert<typeof schema.invExternalStates>[];
  externalSyncState: Insert<typeof schema.invExternalSyncState>[];
  /** planned movements in aggregate form for the dry-run parity check */
  plannedBalanceInput: Array<{ itemId: string; location: StockLocation; type: MovementType; quantity: number }>;
  sourceSnapshot: BalanceEntry[];
  snapshotAvailable: boolean;
  merge: ItemMergeResult;
  userMatch: UserMatchResult;
}

interface PlanContext {
  opts: Options;
  backup: Backup;
  report: ReportBuilder;
  plan: ImportPlan;
  userId: (sourceId: string | undefined) => string | undefined;
  /** create-or-reuse a file_assets row for a bucket path; null when unavailable */
  fileId: (url: string | undefined, table: string, required: boolean) => string | undefined;
  ensureFallbackProject: () => string;
}

function ts(v: unknown): Date | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// --- file handling (DEC-8) --------------------------------------------------

function makeFileResolver(ctx: Omit<PlanContext, 'fileId' | 'userId' | 'ensureFallbackProject'>): {
  fileId: PlanContext['fileId'];
  placeholderUsed: () => number;
} {
  const { opts, report, plan } = ctx;
  const cache = new Map<string, string>();
  let placeholderId: string | undefined;
  let placeholderUses = 0;

  const placeholder = (): string => {
    if (!placeholderId) {
      placeholderId = randomUUID();
      plan.fileAssets.push({
        id: placeholderId,
        tenantId: opts.tenantId,
        ownerType: 'INVENTORY_IMPORT',
        ownerId: IMPORT_TAG,
        filename: 'missing-import-photo.placeholder',
        contentType: 'application/octet-stream',
        byteSize: 0,
        sha256: createHash('sha256').update('').digest('hex'),
        storageProvider: 'LOCAL',
        storageBucket: 'import',
        storageKey: `${IMPORT_TAG}/missing-photo`,
        status: 'ACTIVE',
        scanStatus: 'SKIPPED',
        uploadedBy: opts.actorId,
        metadata: { import: IMPORT_TAG, placeholder: true },
      });
    }
    placeholderUses++;
    return placeholderId;
  };

  const fileId: PlanContext['fileId'] = (url, table, required) => {
    const parsed = parseStorageUrl(url);
    if (parsed && opts.filesDir) {
      const cacheKey = `${parsed.bucket}/${parsed.path}`;
      const hit = cache.get(cacheKey);
      if (hit) return hit;
      const localPath = path.join(opts.filesDir, parsed.bucket, parsed.path);
      if (existsSync(localPath)) {
        const id = randomUUID();
        // Single read: size and hash from the same buffer (no stat/read race).
        const fileBuf = readFileSync(localPath);
        const bytes = fileBuf.length;
        plan.fileAssets.push({
          id,
          tenantId: opts.tenantId,
          ownerType: 'INVENTORY_IMPORT',
          ownerId: IMPORT_TAG,
          filename: path.basename(parsed.path),
          contentType: guessContentType(parsed.path),
          byteSize: bytes,
          sha256: createHash('sha256').update(fileBuf).digest('hex'),
          storageProvider: 'LOCAL',
          storageBucket: parsed.bucket,
          storageKey: parsed.path,
          status: 'ACTIVE',
          scanStatus: 'SKIPPED',
          uploadedBy: opts.actorId,
          metadata: { import: IMPORT_TAG, sourceUrl: url },
        });
        cache.set(cacheKey, id);
        return id;
      }
    }
    if (url || required) report.missingFile(table);
    // NOT NULL photo/proof columns get the LOCAL placeholder asset; nullable
    // columns stay NULL (both counted in the report's missingFiles section).
    return required ? placeholder() : undefined;
  };

  return { fileId, placeholderUsed: () => placeholderUses };
}

function guessContentType(p: string): string {
  const ext = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.pdf': 'application/pdf', '.heic': 'image/heic',
  };
  return map[ext] ?? 'application/octet-stream';
}

// --- planning phases ---------------------------------------------------------

function planItems(ctx: PlanContext, merge: ItemMergeResult): void {
  const { opts, report, plan } = ctx;
  // myio_product_images keyed by product name → photo_file_id (Appendix B)
  const images = tableOf(ctx.backup, 'myio_product_images');
  const imageByName = new Map<string, string | undefined>();
  for (const img of images) {
    const name = asString(pick(img, ['product_name', 'name']));
    const url = asString(pick(img, ['image_url', 'url', 'photo_url']));
    if (name) imageByName.set(normalizeName(name), url);
  }
  report.addSource('myio_product_images', images.length);

  for (const item of merge.items) {
    const photoUrl = item.photoUrl ?? imageByName.get(normalizeName(item.name));
    plan.items.push({
      id: item.targetId,
      tenantId: opts.tenantId,
      name: item.name,
      domain: item.domain,
      link: item.link,
      description: item.description,
      isManufactured: item.isManufactured,
      lossPercent: String(item.lossPercent),
      lotQuantity: item.lotQuantity,
      purchaseType: item.purchaseType,
      photoFileId: photoUrl ? ctx.fileId(photoUrl, 'inv_items', false) : undefined,
      active: true,
      createdAt: ts(item.createdAt),
    });
    if (item.flaggedForCuration) {
      report.curationItems.push({
        id: item.targetId,
        name: item.name,
        reason: 'created from unmatched free-text reference (Appendix B)',
      });
    }
  }
}

function planBoms(ctx: PlanContext, merge: ItemMergeResult): void {
  const rows = tableOf(ctx.backup, 'product_boms', 'boms');
  ctx.report.addSource('product_boms', rows.length);
  const seen = new Set<string>();
  for (const row of rows) {
    const product = merge.bySourceId.get(asString(pick(row, ['product_id', 'product_material_id'])) ?? '');
    const component = merge.bySourceId.get(asString(pick(row, ['component_id', 'component_material_id', 'material_id'])) ?? '');
    const qty = asNumber(pick(row, ['quantity', 'qty']));
    if (!product || !component || !qty || qty <= 0) {
      ctx.report.addSkipped('inv_boms', 1, 'unresolvable product/component or non-positive quantity');
      continue;
    }
    // Merged duplicates can collapse two source BOM rows onto the same pair.
    const key = `${product.targetId} ${component.targetId}`;
    if (seen.has(key)) { ctx.report.addSkipped('inv_boms', 1, 'duplicate pair after item merge'); continue; }
    seen.add(key);
    ctx.plan.boms.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: ctx.opts.tenantId,
      productItemId: product.targetId,
      componentItemId: component.targetId,
      quantity: String(qty),
      createdAt: ts(pick(row, ['created_at'])),
    });
  }
}

interface CustomerRef { id: string; name: string }

function planCustomersAndProjects(
  ctx: PlanContext,
  existingCustomers: CustomerRef[],
): Map<string, string> {
  const { opts, report, plan, backup } = ctx;
  const clients = tableOf(backup, 'clients');
  const projects = tableOf(backup, 'projects');
  report.addSource('clients', clients.length);
  report.addSource('projects', projects.length);

  const customersByName = new Map(existingCustomers.map((c) => [normalizeName(c.name), c.id]));
  const customerBySourceClientId = new Map<string, string>();

  for (const client of clients) {
    const name = asString(pick(client, ['name', 'nome'])) ?? '';
    const cnpj = asString(pick(client, ['cnpj', 'document']));
    const sourceId = asString(pick(client, ['id'])) ?? randomUUID();
    const matched = customersByName.get(normalizeName(name));
    if (matched) {
      customerBySourceClientId.set(sourceId, matched);
      continue;
    }
    // Create a flat COMPANY customer (Appendix B: create if absent).
    const id = sourceId;
    const code = `IMP-${normalizeName(name).replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`.replace(/-+$/, '')
      || `IMP-${id.slice(0, 8)}`;
    plan.customers.push({
      id,
      tenantId: opts.tenantId,
      parentCustomerId: null,
      path: `/${opts.tenantId}/${id}`,
      depth: 0,
      name,
      displayName: name,
      code,
      type: 'COMPANY',
      metadata: { import: IMPORT_TAG, legacyClientId: sourceId, cnpj },
      status: 'ACTIVE',
    });
    customersByName.set(normalizeName(name), id);
    customerBySourceClientId.set(sourceId, id);
  }

  const projectIdMap = new Map<string, string>();
  for (const project of projects) {
    const id = asString(pick(project, ['id'])) ?? randomUUID();
    const clientId = asString(pick(project, ['client_id']));
    const client = clients.find((c) => asString(pick(c, ['id'])) === clientId);
    plan.projects.push({
      id,
      tenantId: opts.tenantId,
      name: asString(pick(project, ['name', 'nome'])) ?? '(sem nome)',
      description: asString(pick(project, ['description', 'descricao'])),
      customerId: clientId ? customerBySourceClientId.get(clientId) : undefined,
      legacyClientName: client ? asString(pick(client, ['name', 'nome'])) : asString(pick(project, ['client_name'])),
      legacyClientCnpj: client ? asString(pick(client, ['cnpj', 'document'])) : undefined,
      createdAt: ts(pick(project, ['created_at'])),
    });
    projectIdMap.set(id, id);
  }
  return projectIdMap;
}

function planPurchaseOrders(
  ctx: PlanContext,
  merge: ItemMergeResult,
  projectIds: Map<string, string>,
): void {
  const { opts, report, plan, backup } = ctx;
  const orders = tableOf(backup, 'purchase_orders');
  const logs = tableOf(backup, 'order_logs');
  const attachments = tableOf(backup, 'order_attachments', 'purchase_order_files', 'order_files');
  report.addSource('purchase_orders', orders.length);
  report.addSource('order_logs', logs.length);
  if (attachments.length) report.addSource('order_attachments', attachments.length);

  const orderIds = new Set<string>();

  for (const row of orders) {
    const id = asString(pick(row, ['id'])) ?? randomUUID();
    const materialId = asString(pick(row, ['material_id', 'item_id']));
    let item = materialId ? merge.bySourceId.get(materialId) : undefined;
    const itemText = asString(pick(row, ['item_name', 'material_name', 'product_name']));
    if (!item && itemText) {
      item = resolveItemByText(itemText, merge.byDomainName);
      if (!item) {
        item = makeCurationProduct(itemText);
        registerCurationItem(ctx, merge, item);
      }
    }
    if (!item) {
      report.addSkipped('inv_purchase_orders', 1, 'order references no resolvable item');
      continue;
    }
    const rawStatus = asString(pick(row, ['status'])) ?? 'pendente';
    const status = mapPurchaseStatus(rawStatus);
    if (!status) {
      report.addSkipped('inv_purchase_orders', 1, `unknown status "${rawStatus}"`);
      continue;
    }
    if (status === 'COMPRADO_AGUARDANDO' && rawStatus.toLowerCase() !== 'comprado_aguardando') {
      report.remap(`purchase:${rawStatus.toLowerCase()}→COMPRADO_AGUARDANDO`);
    }
    const requesterSourceId = asString(pick(row, ['requester_id', 'user_id', 'created_by']));
    const requesterId = ctx.userId(requesterSourceId);
    const requesterName = asString(pick(row, ['requester_name']));
    let requesterNotes = asString(pick(row, ['notes', 'requester_notes', 'observacoes']));
    if (!requesterId && requesterName) {
      requesterNotes = [requesterNotes, `[Solicitante legado: ${requesterName}]`].filter(Boolean).join('\n');
    }
    const projectSourceId = asString(pick(row, ['project_id']));
    const projectId =
      (projectSourceId && projectIds.get(projectSourceId)) || ctx.ensureFallbackProject();
    const quantity = Math.min(Math.max(asNumber(pick(row, ['quantity', 'qty'])) ?? 1, 1), 100000);

    plan.purchaseOrders.push({
      id,
      tenantId: opts.tenantId,
      projectId,
      requesterId,
      itemId: item.targetId,
      itemNameSnapshot: itemText ?? item.name,
      itemLink: asString(pick(row, ['item_link', 'link'])),
      quantity,
      recipient: asString(pick(row, ['recipient', 'destinatario'])),
      deliveryPoint: asString(pick(row, ['delivery_point', 'ponto_entrega'])),
      status,
      deadlineType: mapDeadlineType(asString(pick(row, ['deadline_type', 'prazo']))),
      deadlineDate: ts(pick(row, ['deadline_date', 'deadline'])),
      deliveryForecast: ts(pick(row, ['delivery_forecast', 'previsao_entrega'])),
      requesterNotes,
      buyerNotes: asString(pick(row, ['buyer_notes'])),
      passphrase: asString(pick(row, ['passphrase', 'senha_entrega'])),
      createdAt: ts(pick(row, ['created_at'])),
      updatedAt: ts(pick(row, ['updated_at'])),
      createdBy: requesterId,
    });
    orderIds.add(id);
  }

  // order_logs: de-dup the doubled trigger rows, then map onto the event model.
  const { kept, dropped } = dedupOrderLogs(logs);
  report.orderLogsDeduplicated = dropped;
  for (const log of kept) {
    const orderId = asString(pick(log, ['order_id', 'purchase_order_id']));
    if (!orderId || !orderIds.has(orderId)) {
      report.addSkipped('inv_purchase_order_events', 1, 'log references a missing order');
      continue;
    }
    const { eventType, details } = mapOrderLogToEvent(log);
    plan.purchaseOrderEvents.push({
      id: asString(pick(log, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      orderId,
      actorId: ctx.userId(asString(pick(log, ['user_id', 'actor_id', 'created_by']))),
      eventType,
      details,
      createdAt: ts(pick(log, ['created_at'])),
    });
  }

  for (const att of attachments) {
    const orderId = asString(pick(att, ['order_id', 'purchase_order_id']));
    const url = asString(pick(att, ['file_url', 'url', 'path', 'storage_path']));
    if (!orderId || !orderIds.has(orderId)) {
      report.addSkipped('inv_purchase_order_files', 1, 'attachment references a missing order');
      continue;
    }
    const fileId = ctx.fileId(url, 'inv_purchase_order_files', false);
    if (!fileId) continue; // counted as missing file
    plan.purchaseOrderFiles.push({
      id: asString(pick(att, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      orderId,
      fileId,
      createdAt: ts(pick(att, ['created_at'])),
    });
  }
}

function mapDeadlineType(v: string | undefined): string | undefined {
  switch ((v ?? '').toLowerCase()) {
    case 'urgente': return 'URGENTE';
    case 'esta_semana': return 'ESTA_SEMANA';
    case 'este_mes': return 'ESTE_MES';
    case 'customizado': return 'CUSTOMIZADO';
    default: return undefined;
  }
}

function registerCurationItem(ctx: PlanContext, merge: ItemMergeResult, item: ItemPlan): void {
  merge.byDomainName.set(`${item.domain} ${normalizeName(item.name)}`, item);
  merge.items.push(item);
  ctx.plan.items.push({
    id: item.targetId,
    tenantId: ctx.opts.tenantId,
    name: item.name,
    domain: item.domain,
    isManufactured: false,
    lossPercent: '0',
    active: true,
  });
  ctx.report.curationItems.push({
    id: item.targetId,
    name: item.name,
    reason: 'created from unmatched free-text reference (Appendix B)',
  });
}

function planReleasesAndHomologations(ctx: PlanContext, merge: ItemMergeResult): {
  unitIds: Set<string>;
  unitItemByUnitId: Map<string, string>;
} {
  const { opts, report, plan, backup } = ctx;
  const releases = tableOf(backup, 'assembly_releases');
  const releaseItems = tableOf(backup, 'assembly_release_items');
  const issues = tableOf(backup, 'assembly_release_issues');
  const homologations = tableOf(backup, 'homologations');
  const units = tableOf(backup, 'homologation_units');
  report.addSource('assembly_releases', releases.length);
  report.addSource('assembly_release_items', releaseItems.length);
  report.addSource('assembly_release_issues', issues.length);
  report.addSource('homologations', homologations.length);
  report.addSource('homologation_units', units.length);

  const releaseIds = new Set<string>();
  for (const row of releases) {
    const id = asString(pick(row, ['id'])) ?? randomUUID();
    const responsibles = (pick<unknown[]>(row, ['responsibles', 'responsaveis']) ?? [])
      .map((r) => ctx.userId(asString(r)))
      .filter((r): r is string => Boolean(r));
    plan.assemblyReleases.push({
      id,
      tenantId: opts.tenantId,
      photoFileId: ctx.fileId(asString(pick(row, ['photo_url', 'photo'])), 'inv_assembly_releases', true) as string,
      responsibles,
      notes: asString(pick(row, ['notes', 'observacoes'])),
      createdAt: ts(pick(row, ['created_at'])),
      createdBy: ctx.userId(asString(pick(row, ['created_by', 'user_id']))),
    });
    releaseIds.add(id);
  }

  const releaseItemIds = new Set<string>();
  for (const row of releaseItems) {
    const releaseId = asString(pick(row, ['release_id']));
    const item = resolveRowItem(row, merge, ctx);
    const qty = asNumber(pick(row, ['quantity', 'qty']));
    if (!releaseId || !releaseIds.has(releaseId) || !item || !qty || qty <= 0) {
      report.addSkipped('inv_assembly_release_items', 1, 'missing release/item or non-positive quantity');
      continue;
    }
    const id = asString(pick(row, ['id'])) ?? randomUUID();
    plan.assemblyReleaseItems.push({
      id,
      tenantId: opts.tenantId,
      releaseId,
      itemId: item.targetId,
      quantity: Math.round(qty),
    });
    releaseItemIds.add(id);
  }

  for (const row of issues) {
    const releaseId = asString(pick(row, ['release_id']));
    if (!releaseId || !releaseIds.has(releaseId)) {
      report.addSkipped('inv_assembly_release_issues', 1, 'issue references a missing release');
      continue;
    }
    const releaseItemId = asString(pick(row, ['release_item_id']));
    const item = resolveRowItem(row, merge, ctx, false);
    plan.assemblyReleaseIssues.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      releaseId,
      releaseItemId: releaseItemId && releaseItemIds.has(releaseItemId) ? releaseItemId : undefined,
      itemId: item?.targetId,
      reportedQuantity: asNumber(pick(row, ['reported_quantity', 'quantity'])),
      message: asString(pick(row, ['message', 'mensagem'])),
      status: (asString(pick(row, ['status'])) ?? '').toLowerCase() === 'resolvida' ? 'RESOLVIDA' : 'ABERTA',
      resolutionNote: asString(pick(row, ['resolution_note'])),
      reportedBy: ctx.userId(asString(pick(row, ['reported_by']))),
      resolvedBy: ctx.userId(asString(pick(row, ['resolved_by']))),
      resolvedAt: ts(pick(row, ['resolved_at'])),
      createdAt: ts(pick(row, ['created_at'])),
    });
  }

  const homologationIds = new Map<string, string>(); // homolog id → item id
  const seenBoxQrs = new Set<string>();
  for (const row of homologations) {
    const id = asString(pick(row, ['id'])) ?? randomUUID();
    const item = resolveRowItem(row, merge, ctx);
    if (!item) {
      report.addSkipped('inv_homologations', 1, 'homologation references no resolvable item');
      continue;
    }
    const releaseId = asString(pick(row, ['release_id']));
    const boxSizeRaw = asNumber(pick(row, ['box_size', 'tamanho_caixa'])) ?? 1;
    const boxSize = [1, 10, 50, 100, 224].includes(boxSizeRaw) ? boxSizeRaw : 1;
    if (boxSize !== boxSizeRaw) report.warn(`inv_homologations ${id}: box_size ${boxSizeRaw} coerced to 1`);
    const boxQr = asString(pick(row, ['box_qr']));
    plan.homologations.push({
      id,
      tenantId: opts.tenantId,
      releaseId: releaseId && releaseIds.has(releaseId) ? releaseId : undefined,
      itemId: item.targetId,
      boxSize,
      boxQr,
      responsibleId: ctx.userId(asString(pick(row, ['responsible_id', 'responsible']))),
      notes: asString(pick(row, ['notes'])),
      createdAt: ts(pick(row, ['created_at'])),
      createdBy: ctx.userId(asString(pick(row, ['created_by']))),
    });
    homologationIds.set(id, item.targetId);
    if (boxQr && !seenBoxQrs.has(boxQr)) {
      seenBoxQrs.add(boxQr);
      plan.qrRegistry.push({
        id: randomUUID(),
        tenantId: opts.tenantId,
        qrValue: boxQr,
        kind: 'BOX',
        itemId: item.targetId,
        createdBy: opts.actorId,
      });
    }
  }

  const unitIds = new Set<string>();
  const unitItemByUnitId = new Map<string, string>();
  const seenUnitQrs = new Set<string>();
  for (const row of units) {
    const homologationId = asString(pick(row, ['homologation_id']));
    const qrValue = asString(pick(row, ['qr_value', 'qr']));
    if (!homologationId || !homologationIds.has(homologationId) || !qrValue) {
      report.addSkipped('inv_homologation_units', 1, 'unit missing homologation or qr_value');
      continue;
    }
    if (seenUnitQrs.has(qrValue) || seenBoxQrs.has(qrValue)) {
      report.addSkipped('inv_homologation_units', 1, `duplicate QR in source: ${qrValue}`);
      continue;
    }
    seenUnitQrs.add(qrValue);
    const id = asString(pick(row, ['id'])) ?? randomUUID();
    const itemId = homologationIds.get(homologationId);
    plan.homologationUnits.push({
      id,
      tenantId: opts.tenantId,
      homologationId,
      position: asNumber(pick(row, ['position'])),
      qrValue,
      createdAt: ts(pick(row, ['created_at'])),
    });
    unitIds.add(id);
    if (itemId) unitItemByUnitId.set(id, itemId);
    plan.qrRegistry.push({
      id: randomUUID(),
      tenantId: opts.tenantId,
      qrValue,
      kind: 'UNIT',
      itemId,
      createdBy: opts.actorId,
    });
  }

  return { unitIds, unitItemByUnitId };
}

/** item resolution for rows that may carry a material/product id OR a free-text name */
function resolveRowItem(
  row: SourceRow,
  merge: ItemMergeResult,
  ctx: PlanContext,
  createIfMissing = true,
): ItemPlan | undefined {
  const sourceId = asString(pick(row, ['product_id', 'material_id', 'item_id', 'tool_asset_id']));
  if (sourceId) {
    const hit = merge.bySourceId.get(sourceId);
    if (hit) return hit;
  }
  const text = asString(pick(row, ['product_name', 'item_name', 'material_name', 'product', 'name']));
  if (!text) return undefined;
  const hit = resolveItemByText(text, merge.byDomainName);
  if (hit) return hit;
  if (!createIfMissing) return undefined;
  const created = makeCurationProduct(text);
  registerCurationItem(ctx, merge, created);
  return created;
}

function planMovements(
  ctx: PlanContext,
  merge: ItemMergeResult,
  extras: { toolMovements: SourceRow[] },
  unitIds: Set<string>,
  purchaseOrderIds: Set<string>,
): void {
  const { opts, report, plan, backup } = ctx;
  const stockMovements = tableOf(backup, 'stock_movements');
  const movementQrs = tableOf(backup, 'stock_movement_qrs');
  const terceirosMovements = tableOf(backup, 'terceiros_movements');
  const toolMovements = extras.toolMovements.length
    ? extras.toolMovements
    : tableOf(backup, 'tool_movements');
  report.addSource('stock_movements', stockMovements.length);
  report.addSource('stock_movement_qrs', movementQrs.length);
  report.addSource('terceiros_movements', terceirosMovements.length);
  report.addSource('tool_movements', toolMovements.length);

  const movementIds = new Set<string>();

  const addMovement = (
    row: SourceRow,
    sourceItemKeys: string[],
    defaultLocation: StockLocation,
    table: string,
  ): void => {
    const sourceItemId = asString(pick(row, sourceItemKeys));
    const item = sourceItemId ? merge.bySourceId.get(sourceItemId) : undefined;
    if (!item) {
      report.addSkipped('inv_stock_movements', 1, `${table}: movement references no resolvable item`);
      return;
    }
    const type = mapMovementType(asString(pick(row, ['movement_type', 'type', 'tipo'])));
    const quantity = asNumber(pick(row, ['quantity', 'qty']));
    if (!type || !quantity || quantity <= 0) {
      report.addSkipped('inv_stock_movements', 1, `${table}: unknown type or non-positive quantity`);
      return;
    }
    // DEC-3: location of the material's row at import time.
    const location = (sourceItemId && merge.locationBySourceId.get(sourceItemId)) || defaultLocation;
    const id = asString(pick(row, ['id'])) ?? randomUUID();
    const purchaseOrderId = asString(pick(row, ['purchase_order_id', 'order_id']));
    plan.stockMovements.push({
      id,
      tenantId: opts.tenantId,
      itemId: item.targetId,
      location,
      quantity: String(quantity),
      type,
      reason: asString(pick(row, ['reason', 'motivo'])),
      responsible: asString(pick(row, ['responsible', 'responsavel', 'technician'])),
      photoFileId: ctx.fileId(asString(pick(row, ['photo_url', 'photo'])), 'inv_stock_movements', false),
      purchaseOrderId: purchaseOrderId && purchaseOrderIds.has(purchaseOrderId) ? purchaseOrderId : undefined,
      imported: true,   // A5 --raw-ledger: bypasses M2 service guards by design
      createdAt: ts(pick(row, ['created_at'])),
      createdBy: ctx.userId(asString(pick(row, ['created_by', 'user_id']))),
    });
    movementIds.add(id);
    plan.plannedBalanceInput.push({ itemId: item.targetId, location, type, quantity });
  };

  for (const row of stockMovements) addMovement(row, ['material_id'], 'ALMOXARIFADO', 'stock_movements');
  for (const row of terceirosMovements) {
    addMovement(row, ['material_id', 'terceiros_material_id'], THIRD_PARTY_LOCATION, 'terceiros_movements');
  }
  for (const row of toolMovements) {
    addMovement(row, ['tool_asset_id', 'asset_id', 'material_id'], TOOL_LOCATION, 'tool_movements');
  }

  for (const row of movementQrs) {
    const movementId = asString(pick(row, ['movement_id', 'stock_movement_id']));
    if (!movementId || !movementIds.has(movementId)) {
      report.addSkipped('inv_movement_qrs', 1, 'qr row references a missing movement');
      continue;
    }
    const unitId = asString(pick(row, ['homologation_unit_id']));
    plan.movementQrs.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      movementId,
      qrValue: asString(pick(row, ['qr_value', 'qr'])),
      boxQr: asString(pick(row, ['box_qr'])),
      homologationUnitId: unitId && unitIds.has(unitId) ? unitId : undefined,
    });
  }
}

function planExpedition(
  ctx: PlanContext,
  merge: ItemMergeResult,
  projectIds: Map<string, string>,
  unitIds: Set<string>,
): Set<string> {
  const { opts, report, plan, backup } = ctx;
  const orders = tableOf(backup, 'myio_orders');
  const orderItems = tableOf(backup, 'myio_order_items');
  const deliveries = tableOf(backup, 'myio_item_deliveries');
  const deliveryQrs = tableOf(backup, 'myio_delivery_qrs');
  const shipments = tableOf(backup, 'myio_shipments');
  report.addSource('myio_orders', orders.length);
  report.addSource('myio_order_items', orderItems.length);
  report.addSource('myio_item_deliveries', deliveries.length);
  report.addSource('myio_delivery_qrs', deliveryQrs.length);
  report.addSource('myio_shipments', shipments.length);

  const orderIds = new Set<string>();
  for (const row of orders) {
    const id = asString(pick(row, ['id'])) ?? randomUUID();
    const rawStatus = asString(pick(row, ['status'])) ?? 'pendente';
    const status = mapExpeditionStatus(rawStatus) ?? 'PENDENTE';
    if (!mapExpeditionStatus(rawStatus)) report.remap(`expedition:${rawStatus}→PENDENTE`);
    const projectSourceId = asString(pick(row, ['project_id']));
    plan.expeditionOrders.push({
      id,
      tenantId: opts.tenantId,
      title: asString(pick(row, ['title', 'titulo', 'name'])),
      projectId: projectSourceId ? projectIds.get(projectSourceId) : undefined,
      deliveryDate: ts(pick(row, ['delivery_date', 'data_entrega'])) ?? ts(pick(row, ['created_at'])) ?? new Date(),
      status,
      isReplacement: asBool(pick(row, ['is_replacement', 'reposicao'])),
      notes: asString(pick(row, ['notes', 'observacoes'])),
      createdAt: ts(pick(row, ['created_at'])),
      updatedAt: ts(pick(row, ['updated_at'])),
      createdBy: ctx.userId(asString(pick(row, ['created_by', 'user_id']))),
    });
    orderIds.add(id);
  }

  const orderItemIds = new Set<string>();
  for (const row of orderItems) {
    const orderId = asString(pick(row, ['order_id']));
    // DEC-5: source uses free-text product names — resolve to FK, create
    // curation-flagged PRODUCT when unmatched (Appendix B).
    const item = resolveRowItem(row, merge, ctx);
    const qty = asNumber(pick(row, ['quantity', 'qty']));
    if (!orderId || !orderIds.has(orderId) || !item || !qty || qty <= 0) {
      report.addSkipped('inv_expedition_order_items', 1, 'missing order/item or non-positive quantity');
      continue;
    }
    const id = asString(pick(row, ['id'])) ?? randomUUID();
    plan.expeditionOrderItems.push({
      id,
      tenantId: opts.tenantId,
      orderId,
      itemId: item.targetId,
      quantity: Math.round(qty),
    });
    orderItemIds.add(id);
  }

  const deliveryIds = new Set<string>();
  for (const row of deliveries) {
    const orderId = asString(pick(row, ['order_id']));
    const orderItemId = asString(pick(row, ['order_item_id', 'item_id']));
    const qty = asNumber(pick(row, ['quantity', 'qty']));
    if (!orderId || !orderIds.has(orderId) || !orderItemId || !orderItemIds.has(orderItemId) || !qty) {
      report.addSkipped('inv_item_deliveries', 1, 'delivery references missing order/item');
      continue;
    }
    const id = asString(pick(row, ['id'])) ?? randomUUID();
    plan.itemDeliveries.push({
      id,
      tenantId: opts.tenantId,
      orderId,
      orderItemId,
      quantity: Math.round(qty),
      photoFileId: ctx.fileId(asString(pick(row, ['photo_url', 'photo'])), 'inv_item_deliveries', true) as string,
      createdAt: ts(pick(row, ['created_at'])),
      createdBy: ctx.userId(asString(pick(row, ['created_by', 'user_id']))),
    });
    deliveryIds.add(id);
  }

  for (const row of deliveryQrs) {
    const deliveryId = asString(pick(row, ['delivery_id']));
    const orderItemId = asString(pick(row, ['order_item_id']));
    if (!deliveryId || !deliveryIds.has(deliveryId) || !orderItemId || !orderItemIds.has(orderItemId)) {
      report.addSkipped('inv_delivery_qrs', 1, 'qr references missing delivery/order item');
      continue;
    }
    const unitId = asString(pick(row, ['homologation_unit_id']));
    plan.deliveryQrs.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      deliveryId,
      orderItemId,
      qrValue: asString(pick(row, ['qr_value', 'qr'])),
      boxQr: asString(pick(row, ['box_qr'])),
      homologationUnitId: unitId && unitIds.has(unitId) ? unitId : undefined,
    });
  }

  for (const row of shipments) {
    const orderId = asString(pick(row, ['order_id']));
    if (!orderId || !orderIds.has(orderId)) {
      report.addSkipped('inv_shipments', 1, 'shipment references a missing order');
      continue;
    }
    plan.shipments.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      orderId,
      address: asString(pick(row, ['address', 'endereco'])),
      shippingMethod: mapShippingMethod(asString(pick(row, ['shipping_method', 'metodo']))),
      responsible: asString(pick(row, ['responsible', 'responsavel'])),
      trackingCode: asString(pick(row, ['tracking_code', 'rastreio'])),
      proofFileId: ctx.fileId(asString(pick(row, ['proof_url', 'proof', 'photo_url'])), 'inv_shipments', true) as string,
      notes: asString(pick(row, ['notes'])),
      createdAt: ts(pick(row, ['created_at'])),
      createdBy: ctx.userId(asString(pick(row, ['created_by', 'user_id']))),
    });
  }

  return orderIds;
}

function planDemands(
  ctx: PlanContext,
  merge: ItemMergeResult,
  expeditionOrderIds: Set<string>,
  purchaseOrderIds: Set<string>,
): void {
  const { opts, report, plan, backup } = ctx;
  const productionDemands = tableOf(backup, 'production_demands');
  const purchaseDemands = tableOf(backup, 'purchase_demands');
  report.addSource('production_demands', productionDemands.length);
  report.addSource('purchase_demands', purchaseDemands.length);

  for (const row of productionDemands) {
    const orderItemId = asString(pick(row, ['order_item_id', 'expedition_order_item_id']));
    if (!orderItemId) {
      report.addSkipped('inv_production_demands', 1, 'demand without order item id');
      continue;
    }
    const item = resolveRowItem(row, merge, ctx, false);
    const orderId = asString(pick(row, ['order_id', 'expedition_order_id']));
    plan.productionDemands.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      expeditionOrderItemId: orderItemId,
      expeditionOrderId: orderId && expeditionOrderIds.has(orderId) ? orderId : undefined,
      itemId: item?.targetId,
      quantity: Math.round(asNumber(pick(row, ['quantity', 'qty'])) ?? 0),
      status: (asString(pick(row, ['status'])) ?? '').toLowerCase() === 'concluido' ? 'CONCLUIDO' : 'PENDENTE',
      createdAt: ts(pick(row, ['created_at'])),
    });
  }

  for (const row of purchaseDemands) {
    const orderItemId = asString(pick(row, ['order_item_id', 'expedition_order_item_id']));
    if (!orderItemId) {
      report.addSkipped('inv_purchase_demands', 1, 'demand without order item id');
      continue;
    }
    const item = resolveRowItem(row, merge, ctx, false);
    const orderId = asString(pick(row, ['order_id', 'expedition_order_id']));
    const poId = asString(pick(row, ['purchase_order_id']));
    plan.purchaseDemands.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      expeditionOrderItemId: orderItemId,
      expeditionOrderId: orderId && expeditionOrderIds.has(orderId) ? orderId : undefined,
      purchaseOrderId: poId && purchaseOrderIds.has(poId) ? poId : undefined,
      itemId: item?.targetId,
      quantity: Math.round(asNumber(pick(row, ['quantity', 'qty'])) ?? 0),
      createdAt: ts(pick(row, ['created_at'])),
    });
  }
}

function planField(
  ctx: PlanContext,
  merge: ItemMergeResult,
  projectIds: Map<string, string>,
  customerIdByProject: Map<string, string | undefined>,
  expeditionOrderIds: Set<string>,
  movementIds: Set<string>,
): void {
  const { opts, report, plan, backup } = ctx;
  const unitProducts = tableOf(backup, 'unit_products');
  const technicianMoves = tableOf(backup, 'technician_moves');
  const damagedItems = tableOf(backup, 'damaged_items');
  report.addSource('unit_products', unitProducts.length);
  report.addSource('technician_moves', technicianMoves.length);
  report.addSource('damaged_items', damagedItems.length);

  const seenLabels = new Set<string>();
  for (const row of unitProducts) {
    const item = resolveRowItem(row, merge, ctx, false);
    const label = asString(pick(row, ['label', 'qr_value', 'qr']));
    if (label) {
      if (seenLabels.has(label)) {
        report.addSkipped('inv_unit_products', 1, `duplicate unit label ${label}`);
        continue;
      }
      seenLabels.add(label);
    }
    const projectSourceId = asString(pick(row, ['project_id']));
    const projectId = projectSourceId ? projectIds.get(projectSourceId) : undefined;
    const orderId = asString(pick(row, ['order_id', 'expedition_order_id']));
    plan.unitProducts.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      itemId: item?.targetId,
      label,
      status: mapUnitStatus(asString(pick(row, ['status']))),
      installedAt: ts(pick(row, ['installed_at'])),
      projectId,
      customerId: projectId ? customerIdByProject.get(projectId) : undefined,
      clientNameSnapshot: asString(pick(row, ['client_name', 'cliente'])),
      expeditionOrderId: orderId && expeditionOrderIds.has(orderId) ? orderId : undefined,
      movedTo: mapTechnicianDestination(asString(pick(row, ['moved_to']))) ?? undefined,
      movedTechnician: asString(pick(row, ['moved_technician', 'technician'])),
      movePhotoFileId: ctx.fileId(asString(pick(row, ['move_photo_url'])), 'inv_unit_products', false),
      movedAt: ts(pick(row, ['moved_at'])),
      moveNotes: asString(pick(row, ['move_notes'])),
      notes: asString(pick(row, ['notes'])),
      createdAt: ts(pick(row, ['created_at'])),
      updatedAt: ts(pick(row, ['updated_at'])),
      createdBy: ctx.userId(asString(pick(row, ['created_by', 'user_id']))),
    });
  }

  for (const row of technicianMoves) {
    const item = resolveRowItem(row, merge, ctx, false);
    // Appendix B: destination gains AVARIADO — previously the source CHECK
    // rejected it and the sync swallowed the error (Appendix C defect #2).
    const destination = mapTechnicianDestination(asString(pick(row, ['destination', 'destino'])));
    const qty = asNumber(pick(row, ['quantity', 'qty']));
    if (!destination || !qty || qty <= 0) {
      report.addSkipped('inv_technician_moves', 1, 'unknown destination or non-positive quantity');
      continue;
    }
    const movementId = asString(pick(row, ['movement_id', 'stock_movement_id']));
    const projectSourceId = asString(pick(row, ['project_id']));
    plan.technicianMoves.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      movementId: movementId && movementIds.has(movementId) ? movementId : undefined,
      itemId: item?.targetId,
      technician: asString(pick(row, ['technician', 'tecnico'])),
      destination,
      projectId: projectSourceId ? projectIds.get(projectSourceId) : undefined,
      quantity: Math.round(qty),
      notes: asString(pick(row, ['notes'])),
      createdAt: ts(pick(row, ['created_at'])),
      createdBy: ctx.userId(asString(pick(row, ['created_by', 'user_id']))),
    });
  }

  for (const row of damagedItems) {
    const item = resolveRowItem(row, merge, ctx, false);
    const qty = asNumber(pick(row, ['quantity', 'qty']));
    if (!qty || qty <= 0) {
      report.addSkipped('inv_damaged_items', 1, 'non-positive quantity');
      continue;
    }
    plan.damagedItems.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      itemId: item?.targetId,
      productNameSnapshot: asString(pick(row, ['product_name', 'item_name', 'name'])),
      quantity: Math.round(qty),
      source: asString(pick(row, ['source', 'origem'])),
      sourceDetail: asString(pick(row, ['source_detail'])),
      reason: asString(pick(row, ['reason', 'motivo'])),
      photoFileId: ctx.fileId(asString(pick(row, ['photo_url'])), 'inv_damaged_items', false),
      status: (asString(pick(row, ['status'])) ?? '').toLowerCase() === 'recuperado' ? 'RECUPERADO' : 'AVARIADO',
      recoveredTo: asString(pick(row, ['recovered_to'])),
      recoveryNotes: asString(pick(row, ['recovery_notes'])),
      recoveredBy: ctx.userId(asString(pick(row, ['recovered_by']))),
      recoveredAt: ts(pick(row, ['recovered_at'])),
      createdAt: ts(pick(row, ['created_at'])),
      createdBy: ctx.userId(asString(pick(row, ['created_by', 'user_id']))),
    });
  }
}

function planExternal(ctx: PlanContext, merge: ItemMergeResult, unitIdsByQr: Map<string, string>): void {
  const { opts, report, plan, backup } = ctx;
  const states = tableOf(backup, 'external_product_states', 'external_states');
  const syncState = tableOf(backup, 'external_sync_state');
  report.addSource('external_product_states', states.length);
  report.addSource('external_sync_state', syncState.length);

  const seenCodes = new Set<string>();
  for (const row of states) {
    const code = asString(pick(row, ['code', 'codigo']));
    if (!code || seenCodes.has(code)) {
      report.addSkipped('inv_external_states', 1, code ? `duplicate code ${code}` : 'state without code');
      continue;
    }
    seenCodes.add(code);
    const qrValue = asString(pick(row, ['qr_value', 'qr']));
    const item = resolveRowItem(row, merge, ctx, false);
    plan.externalStates.push({
      id: asString(pick(row, ['id'])) ?? randomUUID(),
      tenantId: opts.tenantId,
      code,
      productType: asString(pick(row, ['product_type'])),
      location: asString(pick(row, ['location'])),
      status: asString(pick(row, ['status'])),
      technician: asString(pick(row, ['technician'])),
      clientName: asString(pick(row, ['client_name'])),
      qrValue,
      itemId: item?.targetId,
      homologationUnitId: qrValue ? unitIdsByQr.get(qrValue) : undefined,
      lastChangeAt: ts(pick(row, ['last_change_at', 'updated_at'])),
      payload: pick(row, ['payload', 'raw']) ?? null,
      updatedAt: ts(pick(row, ['updated_at'])),
    });
  }

  const syncRow = syncState[0];
  if (syncRow) {
    plan.externalSyncState.push({
      tenantId: opts.tenantId,
      lastRunAt: ts(pick(syncRow, ['last_run_at'])),
      lastStatus: mapSyncStatus(asString(pick(syncRow, ['last_status', 'status']))),
      lastMessage: asString(pick(syncRow, ['last_message', 'message'])),
      totalItems: asNumber(pick(syncRow, ['total_items'])),
    });
  }
}

// ---------------------------------------------------------------------------
// Plan orchestration
// ---------------------------------------------------------------------------

interface GcdrRefs {
  users: Array<{ id: string; email: string }>;
  customers: CustomerRef[];
}

function buildPlan(
  opts: Options,
  backup: Backup,
  extras: {
    toolAssets: SourceRow[];
    toolMovements: SourceRow[];
    materialStock: SourceRow[];
    terceirosMaterialStock: SourceRow[];
    toolAssetStock: SourceRow[];
  },
  refs: GcdrRefs,
  report: ReportBuilder,
): ImportPlan {
  // Import-flag coverage: only inv_stock_movements has an `imported` column in
  // the current schema — set there. Other imported rows are identifiable by
  // their reused source UUIDs + this report (schema intentionally NOT altered).
  report.warn(
    'imported=true flag set on inv_stock_movements only (sole table with the column); ' +
    'other tables identified via reused source UUIDs and this report',
  );

  const profiles = tableOf(backup, 'profiles');
  report.addSource('profiles', profiles.length);
  const userMatch = matchUsersByEmail(profiles, refs.users);
  if (userMatch.unmatched.length > 0) {
    report.warn(
      `${userMatch.unmatched.length} source user(s) have no GCDR match by email — ` +
      'their rows import with created_by NULL (names kept in text fields where the schema has one)',
    );
  }

  const materials = tableOf(backup, 'materials');
  const terceiros = tableOf(backup, 'terceiros_materials');
  const toolAssets = extras.toolAssets.length ? extras.toolAssets : tableOf(backup, 'tool_assets');
  report.addSource('materials', materials.length);
  report.addSource('terceiros_materials', terceiros.length);
  report.addSource('tool_assets', toolAssets.length);
  if (!extras.toolAssets.length && !backup['tool_assets']) {
    report.warn('tool_assets/tool_movements are NOT in the backup and no --supabase-url was given — TOOL domain not imported (Appendix C defect #5)');
  }

  const merge = mergeItems(materials, terceiros, toolAssets, opts.curatedThirdParty);

  const plan: ImportPlan = {
    fileAssets: [], items: [], boms: [], customers: [], projects: [],
    purchaseOrders: [], purchaseOrderEvents: [], purchaseOrderFiles: [],
    assemblyReleases: [], assemblyReleaseItems: [], assemblyReleaseIssues: [],
    homologations: [], homologationUnits: [], qrRegistry: [],
    stockMovements: [], movementQrs: [],
    expeditionOrders: [], expeditionOrderItems: [], itemDeliveries: [], deliveryQrs: [], shipments: [],
    productionDemands: [], purchaseDemands: [],
    unitProducts: [], technicianMoves: [], damagedItems: [],
    externalStates: [], externalSyncState: [],
    plannedBalanceInput: [],
    sourceSnapshot: [],
    snapshotAvailable: false,
    merge,
    userMatch,
  };

  let fallbackProjectId: string | undefined;
  const baseCtx = { opts, backup, report, plan };
  const { fileId } = makeFileResolver(baseCtx);
  const ctx: PlanContext = {
    ...baseCtx,
    fileId,
    userId: (sourceId) => (sourceId ? userMatch.bySourceUserId.get(sourceId) : undefined),
    ensureFallbackProject: () => {
      if (!fallbackProjectId) {
        fallbackProjectId = randomUUID();
        plan.projects.push({
          id: fallbackProjectId,
          tenantId: opts.tenantId,
          name: '(Importado — sem projeto)',
          description: `Fallback do import ${IMPORT_TAG}: pedidos legados sem projeto`,
        });
        report.warn('fallback project created for purchase orders without a source project');
      }
      return fallbackProjectId;
    },
  };

  // Topological order (A5)
  planItems(ctx, merge);
  planBoms(ctx, merge);
  const projectIds = planCustomersAndProjects(ctx, refs.customers);
  planPurchaseOrders(ctx, merge, projectIds);
  const purchaseOrderIds = new Set(plan.purchaseOrders.map((o) => o.id as string));
  const { unitIds } = planReleasesAndHomologations(ctx, merge);
  planMovements(ctx, merge, { toolMovements: extras.toolMovements }, unitIds, purchaseOrderIds);
  const movementIds = new Set(plan.stockMovements.map((m) => m.id as string));
  const expeditionOrderIds = planExpedition(ctx, merge, projectIds, unitIds);
  planDemands(ctx, merge, expeditionOrderIds, purchaseOrderIds);
  const customerIdByProject = new Map(plan.projects.map((p) => [p.id as string, p.customerId ?? undefined]));
  planField(ctx, merge, projectIds, customerIdByProject, expeditionOrderIds, movementIds);
  const unitIdsByQr = new Map(
    plan.homologationUnits.map((u) => [u.qrValue as string, u.id as string]),
  );
  planExternal(ctx, merge, unitIdsByQr);

  // Parity source snapshot (A5 step 0) — needs the three balance views.
  const haveViews =
    extras.materialStock.length > 0 ||
    extras.terceirosMaterialStock.length > 0 ||
    extras.toolAssetStock.length > 0 ||
    Boolean(backup['material_stock']);
  if (haveViews) {
    const { snapshot, unmappedRows } = buildSourceSnapshot(
      {
        materialStock: extras.materialStock.length ? extras.materialStock : tableOf(backup, 'material_stock'),
        terceirosMaterialStock: extras.terceirosMaterialStock.length
          ? extras.terceirosMaterialStock
          : tableOf(backup, 'terceiros_material_stock'),
        toolAssetStock: extras.toolAssetStock.length ? extras.toolAssetStock : tableOf(backup, 'tool_asset_stock'),
      },
      merge,
    );
    plan.sourceSnapshot = snapshot;
    plan.snapshotAvailable = true;
    if (unmappedRows > 0) report.warn(`parity snapshot: ${unmappedRows} view row(s) reference unknown items`);
  } else {
    report.warn('balance views unavailable (no --supabase-url and none in backup) — parity check SKIPPED');
  }

  // Imported counts (rows planned for insert)
  const importedCounts: Array<[string, number]> = [
    ['inv_items', plan.items.length],
    ['inv_boms', plan.boms.length],
    ['customers (created)', plan.customers.length],
    ['inv_projects', plan.projects.length],
    ['inv_purchase_orders', plan.purchaseOrders.length],
    ['inv_purchase_order_events', plan.purchaseOrderEvents.length],
    ['inv_purchase_order_files', plan.purchaseOrderFiles.length],
    ['inv_assembly_releases', plan.assemblyReleases.length],
    ['inv_assembly_release_items', plan.assemblyReleaseItems.length],
    ['inv_assembly_release_issues', plan.assemblyReleaseIssues.length],
    ['inv_homologations', plan.homologations.length],
    ['inv_homologation_units', plan.homologationUnits.length],
    ['inv_qr_registry', plan.qrRegistry.length],
    ['inv_stock_movements', plan.stockMovements.length],
    ['inv_movement_qrs', plan.movementQrs.length],
    ['inv_expedition_orders', plan.expeditionOrders.length],
    ['inv_expedition_order_items', plan.expeditionOrderItems.length],
    ['inv_item_deliveries', plan.itemDeliveries.length],
    ['inv_delivery_qrs', plan.deliveryQrs.length],
    ['inv_shipments', plan.shipments.length],
    ['inv_production_demands', plan.productionDemands.length],
    ['inv_purchase_demands', plan.purchaseDemands.length],
    ['inv_unit_products', plan.unitProducts.length],
    ['inv_technician_moves', plan.technicianMoves.length],
    ['inv_damaged_items', plan.damagedItems.length],
    ['inv_external_states', plan.externalStates.length],
    ['inv_external_sync_state', plan.externalSyncState.length],
    ['file_assets', plan.fileAssets.length],
  ];
  for (const [table, n] of importedCounts) report.addImported(table, n);

  return plan;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async function wipeTenant(db: Db, tenantId: string): Promise<void> {
  // children → parents, all scoped to the tenant
  const tables = [
    schema.invMovementQrs, schema.invDeliveryQrs, schema.invItemDeliveries, schema.invShipments,
    schema.invTechnicianMoves, schema.invDamagedItems, schema.invUnitProducts,
    schema.invProductionDemands, schema.invPurchaseDemands,
    schema.invExpeditionOrderItems, schema.invExpeditionOrders,
    schema.invExternalStates, schema.invExternalPushOutbox, schema.invExternalSyncState,
    schema.invStockMovements,
    schema.invHomologationUnits, schema.invHomologations,
    schema.invAssemblyReleaseIssues, schema.invAssemblyReleaseItems, schema.invAssemblyReleases,
    schema.invPurchaseOrderEvents, schema.invPurchaseOrderFiles, schema.invPurchaseOrders,
    schema.invQrRegistry, schema.invBoms, schema.invProjects, schema.invItems,
  ] as const;
  for (const table of tables) {
    await db.delete(table).where(eq(table.tenantId, tenantId));
  }
  // Only the import's own file rows — file_assets is shared with other domains.
  await db.execute(sql`
    DELETE FROM file_assets
    WHERE tenant_id = ${tenantId} AND metadata->>'import' = ${IMPORT_TAG}
  `);
}

async function executePlan(db: Db, plan: ImportPlan, opts: Options): Promise<void> {
  await db.transaction(async (tx) => {
    if (opts.wipeFirst) {
      console.info('Wiping existing inv_* rows for tenant', opts.tenantId, '...');
      await wipeTenant(tx as unknown as Db, opts.tenantId);
    }
    const insert = async <T extends Parameters<Db['insert']>[0]>(
      table: T,
      rows: unknown[],
      label: string,
    ): Promise<void> => {
      if (rows.length === 0) return;
      for (const batch of chunk(rows, 200)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx.insert(table) as any).values(batch).onConflictDoNothing();
      }
      console.info(`  ${label}: ${rows.length} row(s)`);
    };

    // FK-safe physical order (preserves the RFC's topological data order).
    await insert(schema.fileAssets, plan.fileAssets, 'file_assets');
    await insert(schema.invItems, plan.items, 'inv_items');
    await insert(schema.invBoms, plan.boms, 'inv_boms');
    await insert(schema.customers, plan.customers, 'customers (created from clients)');
    await insert(schema.invProjects, plan.projects, 'inv_projects');
    await insert(schema.invPurchaseOrders, plan.purchaseOrders, 'inv_purchase_orders');
    await insert(schema.invPurchaseOrderEvents, plan.purchaseOrderEvents, 'inv_purchase_order_events');
    await insert(schema.invPurchaseOrderFiles, plan.purchaseOrderFiles, 'inv_purchase_order_files');
    await insert(schema.invAssemblyReleases, plan.assemblyReleases, 'inv_assembly_releases');
    await insert(schema.invAssemblyReleaseItems, plan.assemblyReleaseItems, 'inv_assembly_release_items');
    await insert(schema.invAssemblyReleaseIssues, plan.assemblyReleaseIssues, 'inv_assembly_release_issues');
    await insert(schema.invHomologations, plan.homologations, 'inv_homologations');
    await insert(schema.invHomologationUnits, plan.homologationUnits, 'inv_homologation_units');
    await insert(schema.invQrRegistry, plan.qrRegistry, 'inv_qr_registry');
    await insert(schema.invStockMovements, plan.stockMovements, 'inv_stock_movements');
    await insert(schema.invMovementQrs, plan.movementQrs, 'inv_movement_qrs');
    await insert(schema.invExpeditionOrders, plan.expeditionOrders, 'inv_expedition_orders');
    await insert(schema.invExpeditionOrderItems, plan.expeditionOrderItems, 'inv_expedition_order_items');
    await insert(schema.invItemDeliveries, plan.itemDeliveries, 'inv_item_deliveries');
    await insert(schema.invDeliveryQrs, plan.deliveryQrs, 'inv_delivery_qrs');
    await insert(schema.invShipments, plan.shipments, 'inv_shipments');
    await insert(schema.invProductionDemands, plan.productionDemands, 'inv_production_demands');
    await insert(schema.invPurchaseDemands, plan.purchaseDemands, 'inv_purchase_demands');
    await insert(schema.invUnitProducts, plan.unitProducts, 'inv_unit_products');
    await insert(schema.invTechnicianMoves, plan.technicianMoves, 'inv_technician_moves');
    await insert(schema.invDamagedItems, plan.damagedItems, 'inv_damaged_items');
    await insert(schema.invExternalStates, plan.externalStates, 'inv_external_states');
    await insert(schema.invExternalSyncState, plan.externalSyncState, 'inv_external_sync_state');
  });
}

/** Post-import ledger aggregation — the definitive parity side. */
async function fetchTargetBalances(db: Db, tenantId: string): Promise<BalanceEntry[]> {
  const rows = await db.execute(sql`
    SELECT item_id, location,
           COALESCE(SUM(CASE WHEN type IN ('ENTRADA','AJUSTE','TRANSFERENCIA_IN')
                             THEN quantity ELSE -quantity END), 0) AS balance
    FROM inv_stock_movements
    WHERE tenant_id = ${tenantId}
    GROUP BY item_id, location
  `);
  return (rows as unknown as Array<{ item_id: string; location: string; balance: string }>).map((r) => ({
    itemId: r.item_id,
    location: r.location as StockLocation,
    balance: Number(r.balance),
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const report = new ReportBuilder();
  console.info(`M10 import — backup=${opts.backupPath} tenant=${opts.tenantId} mode=${opts.dryRun ? 'dry-run' : 'import'}`);

  const backup = loadBackup(opts.backupPath);
  console.info(`Backup loaded: ${Object.keys(backup).length} table(s)`);

  let extras = {
    toolAssets: [] as SourceRow[], toolMovements: [] as SourceRow[],
    materialStock: [] as SourceRow[], terceirosMaterialStock: [] as SourceRow[],
    toolAssetStock: [] as SourceRow[],
  };
  if (opts.supabaseUrl && opts.supabaseKey) {
    console.info('Fetching tool_* tables and balance views from Supabase REST ...');
    extras = await fetchExtras({ url: opts.supabaseUrl, key: opts.supabaseKey });
    console.info(
      `  tool_assets=${extras.toolAssets.length} tool_movements=${extras.toolMovements.length} ` +
      `views=${extras.materialStock.length}/${extras.terceirosMaterialStock.length}/${extras.toolAssetStock.length}`,
    );
  }

  // GCDR refs (users for email match, customers for client match).
  let db: Db | undefined;
  let sqlClient: postgres.Sql | undefined;
  const refs: GcdrRefs = { users: [], customers: [] };
  if (process.env.DATABASE_URL) {
    sqlClient = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(sqlClient, { schema });
    refs.users = (
      await db.select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.tenantId, opts.tenantId))
    ).map((u) => ({ id: u.id, email: u.email }));
    refs.customers = await db
      .select({ id: schema.customers.id, name: schema.customers.name })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, opts.tenantId), isNull(schema.customers.deletedAt)));
    console.info(`GCDR refs: ${refs.users.length} user(s), ${refs.customers.length} customer(s)`);
  } else if (opts.dryRun) {
    report.warn('DATABASE_URL not set — dry-run without user/customer matching (all actors unmatched)');
  } else {
    throw new Error('DATABASE_URL must be set for a real import');
  }

  try {
    const plan = buildPlan(opts, backup, extras, refs, report);

    let targetBalances = aggregateBalances(plan.plannedBalanceInput);
    if (!opts.dryRun && db) {
      console.info('Executing import transaction ...');
      await executePlan(db, plan, opts);
      console.info('Import committed. Aggregating ledger for parity ...');
      targetBalances = await fetchTargetBalances(db, opts.tenantId);
    }

    const diffs = plan.snapshotAvailable ? buildParityDiff(plan.sourceSnapshot, targetBalances) : [];
    const parityStatus = !plan.snapshotAvailable ? 'SKIPPED' : diffs.length === 0 ? 'ZERO_DIFF' : 'DIFF';

    const fullReport = report.build({
      mode: opts.dryRun ? 'dry-run' : 'import',
      tenantId: opts.tenantId,
      backupFile: path.resolve(opts.backupPath),
      users: {
        matched: plan.userMatch.bySourceUserId.size,
        unmatched: plan.userMatch.unmatched,
      },
      mergedItems: plan.merge.merged,
      parity: {
        status: parityStatus,
        checkedPairs: plan.sourceSnapshot.length,
        diffs,
        note: plan.snapshotAvailable ? undefined : 'balance views unavailable — snapshot skipped',
      },
    });

    const reportPath = opts.reportPath ?? path.join(process.cwd(), `m10-import-report-${Date.now()}.json`);
    writeFileSync(reportPath, JSON.stringify(fullReport, null, 2), 'utf8');
    console.info(`Report written: ${reportPath}`);
    const diffSuffix = diffs.length ? ` (${diffs.length} diff(s))` : '';
    console.info(`Parity: ${parityStatus}${diffSuffix}`);
    for (const w of fullReport.warnings) console.warn(`  warn: ${w}`);

    if (parityStatus === 'DIFF' && !opts.allowDiff) {
      console.error('Parity FAILED — balances diverge from the source snapshot (use --allow-diff to override).');
      process.exitCode = 2;
    }
  } finally {
    await sqlClient?.end();
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
