// Shared fixtures/mocks for the RFC-0061 M8 unit suites (sync service + outbox
// worker with every repository mocked and the platform client stubbed — no DB,
// NO network: the real ExternalPlatformClient is never constructed here).

import {
  InventoryExternalSyncService,
  IExternalSyncRepository,
  IExternalHomologRepository,
  IExternalStockRepository,
  IExternalFieldRepository,
  IExternalExpeditionRepository,
} from '../../../src/services/inventory/InventoryExternalSyncService';
import {
  InventoryOutboxWorker,
  IOutboxRepository,
  IOutboxHomologRepository,
} from '../../../src/services/inventory/InventoryOutboxWorker';
import type { ExternalPlatformClient, ExternalProduct } from '../../../src/services/inventory/ExternalPlatformClient';
import type {
  InvExternalStateRow,
  InvExternalSyncStateRow,
  InvExternalPushOutboxRow,
  DispatchByQrRow,
} from '../../../src/repositories/inventory/InventoryExternalRepository';
import type {
  InvQrRegistryRow,
  InvHomologationRow,
  InvHomologationUnitRow,
  UnitWithHomologationRow,
} from '../../../src/repositories/inventory/InventoryHomologationRepository';

export const TENANT = '11111111-1111-1111-1111-111111111111';
export const ITEM_ID = '33333333-3333-3333-3333-333333333333';
export const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
export const CUSTOMER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
export const ORDER_ID = 'cccccccc-9999-4999-8999-999999999999';
export const HOMOLOGATION_ID = 'eeeeeeee-5555-4555-8555-555555555555';
export const BOX_HOMOLOGATION_ID = 'eeeeeeee-6666-4666-8666-666666666666';
export const UNIT_ROW_ID = 'ffffffff-7777-4777-8777-777777777777';

export const CODE = '250101_000123';
export const CODE_2 = '250101_000124';
export const QR_URL = `https://produto.myio.com.br/${CODE}`;
export const BOX_QR = 'https://produto.myio.com.br/caixa-10/2026-01';
/** The mirror keys box states by the normalized spelling (URL prefix stripped). */
export const BOX_CODE = 'caixa-10/2026-01';

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

// -----------------------------------------------------------------------------
// Row factories
// -----------------------------------------------------------------------------

export function makeProduct(overrides: Partial<ExternalProduct> = {}): ExternalProduct {
  return {
    code: CODE,
    productType: 'SmartLight v3',
    location: 'estoque',
    status: 'parado',
    technician: null,
    clientName: null,
    changedAt: null,
    raw: { code: overrides.code ?? CODE },
    ...overrides,
  };
}

export function makeRegistryRow(overrides: Partial<InvQrRegistryRow> = {}): InvQrRegistryRow {
  return {
    id: nextId('11111111'),
    tenantId: TENANT,
    qrValue: CODE,
    kind: 'UNIT',
    itemId: ITEM_ID,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    createdBy: null,
    ...overrides,
  } as InvQrRegistryRow;
}

export function makeHomologation(overrides: Partial<InvHomologationRow> = {}): InvHomologationRow {
  return {
    id: HOMOLOGATION_ID,
    tenantId: TENANT,
    releaseId: null,
    itemId: ITEM_ID,
    boxSize: 1,
    boxQr: null,
    responsibleId: null,
    notes: null,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    createdBy: null,
    ...overrides,
  } as InvHomologationRow;
}

export function makeHomologationUnit(overrides: Partial<InvHomologationUnitRow> = {}): InvHomologationUnitRow {
  return {
    id: UNIT_ROW_ID,
    tenantId: TENANT,
    homologationId: HOMOLOGATION_ID,
    position: 1,
    qrValue: CODE,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    ...overrides,
  } as InvHomologationUnitRow;
}

export function makeUnitWithHomologation(
  unit: Partial<InvHomologationUnitRow> = {},
  homologation: Partial<InvHomologationRow> = {},
): UnitWithHomologationRow {
  return { unit: makeHomologationUnit(unit), homologation: makeHomologation(homologation) };
}

export function makeStateRow(overrides: Partial<InvExternalStateRow> = {}): InvExternalStateRow {
  return {
    id: nextId('22222222'),
    tenantId: TENANT,
    code: CODE,
    productType: 'SmartLight v3',
    location: 'estoque',
    status: 'parado',
    technician: null,
    clientName: null,
    qrValue: CODE,
    itemId: ITEM_ID,
    homologationUnitId: UNIT_ROW_ID,
    lastChangeAt: new Date('2026-03-01T00:00:00Z'),
    payload: {},
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    ...overrides,
  } as InvExternalStateRow;
}

export function makeSyncStateRow(overrides: Partial<InvExternalSyncStateRow> = {}): InvExternalSyncStateRow {
  return {
    tenantId: TENANT,
    leaseUntil: null,
    lastRunAt: null,
    lastStatus: null,
    lastMessage: null,
    totalItems: null,
    ...overrides,
  } as InvExternalSyncStateRow;
}

export function makeOutboxRow(overrides: Partial<InvExternalPushOutboxRow> = {}): InvExternalPushOutboxRow {
  return {
    id: nextId('33333333'),
    tenantId: TENANT,
    qrCodes: [CODE],
    location: 'expedicao',
    status: 'PENDING',
    technician: null,
    clientName: null,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    dispatchedAt: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  } as InvExternalPushOutboxRow;
}

export function makeDispatchByQr(overrides: Partial<DispatchByQrRow> = {}): DispatchByQrRow {
  return {
    movementId: nextId('44444444'),
    itemId: ITEM_ID,
    technician: 'João da Silva',
    quantity: '1',
    movedQuantity: 0,
    qrValue: CODE,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Mocked dependencies
// -----------------------------------------------------------------------------

export type MockSyncRepo = jest.Mocked<IExternalSyncRepository>;
export type MockHomologRepo = jest.Mocked<IExternalHomologRepository>;
export type MockStockRepo = jest.Mocked<IExternalStockRepository>;
export type MockFieldRepo = jest.Mocked<IExternalFieldRepository>;
export type MockExpeditionRepo = jest.Mocked<IExternalExpeditionRepository>;

export interface MockClient {
  listProducts: jest.Mock;
  createProduct: jest.Mock;
  patchProduct: jest.Mock;
}

export function makeClient(products: ExternalProduct[] = []): MockClient {
  return {
    listProducts: jest.fn(async () => products),
    createProduct: jest.fn(async () => makeProduct()),
    patchProduct: jest.fn(async () => undefined),
  };
}

export function makeSyncRepo(): MockSyncRepo {
  return {
    listStates: jest.fn(async () => ({ rows: [], total: 0 })),
    allStates: jest.fn(async () => [] as InvExternalStateRow[]),
    upsertState: jest.fn(async () => makeStateRow()),
    deleteStatesNotIn: jest.fn(async () => 0),
    claimLease: jest.fn(async () => makeSyncStateRow({ leaseUntil: new Date(Date.now() + 180_000) })),
    releaseLease: jest.fn(async () => undefined),
    getSyncState: jest.fn(async () => makeSyncStateRow()),
    outboxCounters: jest.fn(async () => ({ pending: 0, retryable: 0, dead: 0, done: 0 })),
    unitProductsByLabels: jest.fn(async () => []),
    projectsByNamesInsensitive: jest.fn(async () => []),
    dispatchesByQrValues: jest.fn(async () => [] as DispatchByQrRow[]),
    listOpenDamaged: jest.fn(async () => []),
    ordersInTransit: jest.fn(async () => []),
  } as unknown as MockSyncRepo;
}

export function makeHomologRepo(): MockHomologRepo {
  return {
    withTransaction: jest.fn(async (fn: (tx: never) => Promise<unknown>) => fn({} as never)),
    findRegistryByValues: jest.fn(async () => [] as InvQrRegistryRow[]),
    findUnitsByQrValues: jest.fn(async () => [] as UnitWithHomologationRow[]),
    findBoxesByQrValues: jest.fn(async () => [] as InvHomologationRow[]),
    unitsByHomologationIds: jest.fn(async () => [] as InvHomologationUnitRow[]),
    insertHomologation: jest.fn(async () => makeHomologation({ id: nextId('55555555') })),
    moveUnit: jest.fn(async () => makeHomologationUnit()),
    countUnits: jest.fn(async () => 0),
    deleteHomologation: jest.fn(async () => 1),
    deleteRegistryByValues: jest.fn(async () => 1),
  } as unknown as MockHomologRepo;
}

export function makeStockRepo(): MockStockRepo {
  return {
    withTransaction: jest.fn(async (fn: (tx: never) => Promise<unknown>) => fn({} as never)),
    lockItem: jest.fn(async () => ({ id: ITEM_ID }) as never),
    getBalance: jest.fn(async () => ({ balance: '5', totalIn: '5', totalOut: '0', lastMovementAt: null })),
    insertMovement: jest.fn(async () => ({ id: nextId('66666666') }) as never),
    insertMovementQrs: jest.fn(async () => []),
    latestQrEventTypes: jest.fn(async () => new Map<string, string>()),
  } as unknown as MockStockRepo;
}

export function makeFieldRepo(): MockFieldRepo {
  return {
    insertUnitProducts: jest.fn(async () => []),
    updateUnitStatus: jest.fn(async () => null),
    markUnitMoved: jest.fn(async () => null),
    insertTechnicianMove: jest.fn(async () => ({}) as never),
    insertDamagedItem: jest.fn(async () => ({}) as never),
  } as unknown as MockFieldRepo;
}

export function makeExpeditionRepo(): MockExpeditionRepo {
  return {
    withTransaction: jest.fn(async (fn: (tx: never) => Promise<unknown>) => fn({} as never)),
    deliveredQrsByOrder: jest.fn(async () => []),
    updateOrder: jest.fn(async () => null),
    existingUnitProductLabels: jest.fn(async () => new Set<string>()),
    insertUnitProducts: jest.fn(async () => []),
    getProject: jest.fn(async () => null),
  } as unknown as MockExpeditionRepo;
}

export interface SyncHarness {
  service: InventoryExternalSyncService;
  repository: MockSyncRepo;
  homologRepository: MockHomologRepo;
  stockRepository: MockStockRepo;
  fieldRepository: MockFieldRepo;
  expeditionRepository: MockExpeditionRepo;
  client: MockClient;
}

export function makeSyncHarness(products: ExternalProduct[] = []): SyncHarness {
  const repository = makeSyncRepo();
  const homologRepository = makeHomologRepo();
  const stockRepository = makeStockRepo();
  const fieldRepository = makeFieldRepo();
  const expeditionRepository = makeExpeditionRepo();
  const client = makeClient(products);
  const service = new InventoryExternalSyncService({
    repository,
    homologRepository,
    stockRepository,
    fieldRepository,
    expeditionRepository,
    clientProvider: () => client as unknown as ExternalPlatformClient,
  });
  return { service, repository, homologRepository, stockRepository, fieldRepository, expeditionRepository, client };
}

export interface OutboxHarness {
  worker: InventoryOutboxWorker;
  repository: jest.Mocked<IOutboxRepository>;
  homologRepository: jest.Mocked<IOutboxHomologRepository>;
  client: MockClient;
  /** Rows the mocked claim returns per call (drained batches). */
  queue: InvExternalPushOutboxRow[][];
}

export function makeOutboxHarness(batches: InvExternalPushOutboxRow[][] = []): OutboxHarness {
  const queue = [...batches];
  const repository = {
    withTransaction: jest.fn(async (fn: (tx: never) => Promise<unknown>) => fn({} as never)),
    claimOutboxBatch: jest.fn(async () => queue.shift() ?? []),
    markOutboxDispatched: jest.fn(async () => undefined),
    markOutboxFailed: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<IOutboxRepository>;
  const homologRepository = {
    findRegistryByValues: jest.fn(async () => [] as InvQrRegistryRow[]),
    findBoxesByQrValues: jest.fn(async () => [] as InvHomologationRow[]),
    unitsByHomologationIds: jest.fn(async () => [] as InvHomologationUnitRow[]),
  } as unknown as jest.Mocked<IOutboxHomologRepository>;
  const client = makeClient();
  const worker = new InventoryOutboxWorker({
    repository,
    homologRepository,
    clientProvider: () => client as unknown as ExternalPlatformClient,
  });
  return { worker, repository, homologRepository, client, queue };
}

// -----------------------------------------------------------------------------
// Env helpers (INV_SYNC_LIVE — J4 shadow gate)
// -----------------------------------------------------------------------------

export function withLiveEnv(): void {
  process.env.INV_SYNC_LIVE = 'true';
}

export function clearLiveEnv(): void {
  delete process.env.INV_SYNC_LIVE;
}
