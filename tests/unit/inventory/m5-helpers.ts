// Shared fixtures/mocks for the RFC-0061 M5 unit suites (services with a
// mocked repository — no DB).

import type {
  IInventoryHomologationRepository,
  IStockEntryService,
} from '../../../src/services/inventory/InventoryHomologationService';
import type { IInventoryQrRepository } from '../../../src/services/inventory/InventoryQrService';
import type {
  InvHomologationRow,
  InvHomologationUnitRow,
  InvQrRegistryRow,
  InvItemRow,
  QrMovementEventRow,
  QrDeliveryEventRow,
} from '../../../src/repositories/inventory/InventoryHomologationRepository';

export const TENANT = '11111111-1111-1111-1111-111111111111';
export const USER = '22222222-2222-2222-2222-222222222222';
export const ITEM_ID = '33333333-3333-3333-3333-333333333333';
export const OTHER_ITEM_ID = '99999999-9999-9999-9999-999999999999';
export const RELEASE_ID = '55555555-5555-5555-5555-555555555555';
export const HOMOLOG_ID = '66666666-6666-6666-6666-666666666666';
export const BOX_ID = '77777777-7777-7777-7777-777777777777';
export const UNIT_ID = '88888888-8888-8888-8888-888888888888';

export const CTX = { tenantId: TENANT, userId: USER };

export const BASE = 'https://produto.myio.com.br/';

export function makeItem(overrides: Partial<InvItemRow> = {}): InvItemRow {
  return {
    id: ITEM_ID,
    tenantId: TENANT,
    name: 'Produto de teste',
    normalizedName: 'produto de teste',
    domain: 'PRODUCT',
    link: null,
    description: null,
    isManufactured: true,
    lossPercent: '0',
    lotQuantity: null,
    purchaseType: null,
    photoFileId: null,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedBy: null,
    ...overrides,
  } as InvItemRow;
}

let seq = 0;
export function nextId(): string {
  seq += 1;
  return `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`;
}

export function makeHomologation(overrides: Partial<InvHomologationRow> = {}): InvHomologationRow {
  return {
    id: HOMOLOG_ID,
    tenantId: TENANT,
    releaseId: null,
    itemId: ITEM_ID,
    boxSize: 1,
    boxQr: null,
    responsibleId: null,
    notes: null,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    createdBy: USER,
    ...overrides,
  } as InvHomologationRow;
}

export function makeUnit(overrides: Partial<InvHomologationUnitRow> = {}): InvHomologationUnitRow {
  return {
    id: UNIT_ID,
    tenantId: TENANT,
    homologationId: HOMOLOG_ID,
    position: 1,
    qrValue: '123_456',
    createdAt: new Date('2026-02-01T00:00:00Z'),
    ...overrides,
  } as InvHomologationUnitRow;
}

export function makeRegistryRow(overrides: Partial<InvQrRegistryRow> = {}): InvQrRegistryRow {
  return {
    id: nextId(),
    tenantId: TENANT,
    qrValue: '123_456',
    kind: 'UNIT',
    itemId: ITEM_ID,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    createdBy: USER,
    ...overrides,
  } as InvQrRegistryRow;
}

export function makeMovementEvent(overrides: Partial<QrMovementEventRow> = {}): QrMovementEventRow {
  return {
    qrValue: '123_456',
    boxQr: null,
    movementId: nextId(),
    type: 'ENTRADA',
    location: 'ALMOXARIFADO',
    quantity: '1',
    reason: 'Homologação — unitário',
    responsible: null,
    createdBy: USER,
    createdAt: new Date('2026-02-01T01:00:00Z'),
    ...overrides,
  };
}

export function makeDeliveryEvent(overrides: Partial<QrDeliveryEventRow> = {}): QrDeliveryEventRow {
  return {
    qrValue: '123_456',
    boxQr: null,
    deliveryId: nextId(),
    orderItemId: nextId(),
    orderId: nextId(),
    orderTitle: 'Pedido Cliente X',
    orderStatus: 'EM_TRANSITO',
    createdBy: USER,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Mock repositories/services
// -----------------------------------------------------------------------------

export type HomologRepoMock = jest.Mocked<IInventoryHomologationRepository>;

export function makeHomologRepoMock(): HomologRepoMock {
  return {
    withTransaction: jest.fn(async (fn: (tx: never) => Promise<unknown>) => fn({} as never)),
    getItem: jest.fn().mockResolvedValue(makeItem()),
    releasedQuantity: jest.fn().mockResolvedValue(null),
    homologatedCount: jest.fn().mockResolvedValue(0),
    findRegistryByValues: jest.fn().mockResolvedValue([]),
    insertRegistryRows: jest.fn().mockResolvedValue([]),
    deleteRegistryByValues: jest.fn().mockResolvedValue(0),
    insertHomologation: jest.fn(async (input: { tenantId: string }) =>
      makeHomologation({ id: nextId(), ...(input as Partial<InvHomologationRow>) }),
    ),
    insertUnits: jest.fn(
      async (_tenantId: string, homologationId: string, units: Array<{ qrValue: string; position?: number | null }>) =>
        units.map((u, i) => makeUnit({ id: nextId(), homologationId, qrValue: u.qrValue, position: u.position ?? i + 1 })),
    ),
    getHomologationById: jest.fn().mockResolvedValue(null),
    getUnitById: jest.fn().mockResolvedValue(null),
    countUnits: jest.fn().mockResolvedValue(0),
    unitsByHomologationIds: jest.fn().mockResolvedValue([]),
    moveUnit: jest.fn().mockResolvedValue(makeUnit()),
    deleteHomologation: jest.fn().mockResolvedValue(1),
    list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    maxBoxSeq: jest.fn().mockResolvedValue(0),
  } as unknown as HomologRepoMock;
}

export type QrRepoMock = jest.Mocked<IInventoryQrRepository>;

export function makeQrRepoMock(): QrRepoMock {
  return {
    findRegistryByValues: jest.fn().mockResolvedValue([]),
    findUnitsByQrValues: jest.fn().mockResolvedValue([]),
    findBoxesByQrValues: jest.fn().mockResolvedValue([]),
    unitsByHomologationIds: jest.fn().mockResolvedValue([]),
    movementEventsByQrs: jest.fn().mockResolvedValue([]),
    deliveryEventsByQrs: jest.fn().mockResolvedValue([]),
    getExpeditionOrderItem: jest.fn().mockResolvedValue(null),
  } as unknown as QrRepoMock;
}

export type StockServiceMock = jest.Mocked<IStockEntryService>;

export function makeStockServiceMock(): StockServiceMock {
  return {
    createMovement: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-0000-0000-0000-000000000001', qrs: [] }),
  } as unknown as StockServiceMock;
}
