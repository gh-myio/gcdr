// Shared fixtures/mocks for the RFC-0061 M2 unit suites (service with a
// mocked repository — no DB).

import type {
  IInventoryStockRepository,
} from '../../../src/services/inventory/InventoryStockService';
import type {
  InvItemRow,
  InvStockMovementRow,
  InvMovementQrRow,
  NewMovementInput,
  NewMovementQrInput,
} from '../../../src/repositories/inventory/InventoryStockRepository';

export const TENANT = '11111111-1111-1111-1111-111111111111';
export const USER = '22222222-2222-2222-2222-222222222222';
export const ITEM_ID = '33333333-3333-3333-3333-333333333333';
export const PHOTO_ID = '44444444-4444-4444-4444-444444444444';

export const CTX = { tenantId: TENANT, userId: USER };

let movementSeq = 0;

export function makeItem(overrides: Partial<InvItemRow> = {}): InvItemRow {
  return {
    id: ITEM_ID,
    tenantId: TENANT,
    name: 'Item de teste',
    normalizedName: 'item de teste',
    domain: 'COMPONENT',
    link: null,
    description: null,
    isManufactured: false,
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

export function movementRowFrom(input: NewMovementInput): InvStockMovementRow {
  movementSeq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(movementSeq).padStart(12, '0')}`,
    tenantId: input.tenantId,
    itemId: input.itemId,
    location: input.location,
    quantity: input.quantity,
    type: input.type,
    reason: input.reason ?? null,
    responsible: input.responsible ?? null,
    photoFileId: input.photoFileId ?? null,
    purchaseOrderId: input.purchaseOrderId ?? null,
    transferGroupId: input.transferGroupId ?? null,
    imported: false,
    createdAt: new Date(),
    createdBy: input.createdBy ?? null,
  } as InvStockMovementRow;
}

export type MockRepo = jest.Mocked<IInventoryStockRepository>;

/**
 * Repo mock: withTransaction just runs the callback with a fake tx.
 * Overrides are intentionally loose-typed — jest.fn() literals with narrower
 * signatures (e.g. `jest.fn(async () => item)`) stay ergonomic in the suites.
 */
export function makeRepo(overrides: Record<string, jest.Mock> = {}): MockRepo {
  const repo = {
    withTransaction: jest.fn(async (fn: (tx: never) => Promise<unknown>) => fn({} as never)),
    lockItem: jest.fn(async () => makeItem()),
    getBalance: jest.fn(async () => ({ balance: '100', totalIn: '100', totalOut: '0', lastMovementAt: null })),
    listBalances: jest.fn(async () => []),
    listMovements: jest.fn(async () => ({ rows: [], total: 0 })),
    getMovementById: jest.fn(async () => null),
    insertMovement: jest.fn(async (input: NewMovementInput) => movementRowFrom(input)),
    insertMovementQrs: jest.fn(
      async (tenantId: string, movementId: string, qrs: NewMovementQrInput[]) =>
        qrs.map(
          (q, i) =>
            ({
              id: `55555555-0000-0000-0000-${String(i).padStart(12, '0')}`,
              tenantId,
              movementId,
              qrValue: q.qrValue ?? null,
              boxQr: q.boxQr ?? null,
              homologationUnitId: q.homologationUnitId ?? null,
            }) as InvMovementQrRow,
        ),
    ),
    latestQrEventTypes: jest.fn(async () => new Map<string, string>()),
    consistencyReport: jest.fn(async () => []),
    deleteMovements: jest.fn(async () => 0),
  } as unknown as MockRepo;
  return Object.assign(repo, overrides);
}
