// Shared fixtures/mocks for the RFC-0061 M4 unit suites (service with mocked
// production + stock repositories — no DB). Reuses the M2 item/movement
// factories.

import type {
  IInventoryProductionRepository,
  IProductionStockRepository,
} from '../../../src/services/inventory/InventoryProductionService';
import type {
  InvProductionDemandRow,
  InvAssemblyReleaseRow,
  InvAssemblyReleaseItemRow,
  InvAssemblyReleaseIssueRow,
  BomExplosionRow,
  NewReleaseInput,
  NewReleaseItemInput,
  NewIssueInput,
} from '../../../src/repositories/inventory/InventoryProductionRepository';
import type { NewMovementInput } from '../../../src/repositories/inventory/InventoryStockRepository';
import { makeItem, movementRowFrom, TENANT, USER } from './m2-helpers';

export { TENANT, USER };
export const CTX = { tenantId: TENANT, userId: USER };

export const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const COMPONENT_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
export const COMPONENT_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
export const RELEASE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const PHOTO_ID = '44444444-4444-4444-4444-444444444444';

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-0000-0000-0000-${String(seq).padStart(12, '0')}`;
}

export function makeDemand(overrides: Partial<InvProductionDemandRow> = {}): InvProductionDemandRow {
  return {
    id: nextId('11111111'),
    tenantId: TENANT,
    expeditionOrderItemId: nextId('99999999'),
    expeditionOrderId: null,
    itemId: PRODUCT_A,
    quantity: 1,
    status: 'PENDENTE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as InvProductionDemandRow;
}

export function makeRelease(overrides: Partial<InvAssemblyReleaseRow> = {}): InvAssemblyReleaseRow {
  return {
    id: RELEASE_ID,
    tenantId: TENANT,
    photoFileId: PHOTO_ID,
    responsibles: [USER],
    notes: null,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    createdBy: USER,
    ...overrides,
  } as InvAssemblyReleaseRow;
}

export function makeIssue(overrides: Partial<InvAssemblyReleaseIssueRow> = {}): InvAssemblyReleaseIssueRow {
  return {
    id: nextId('66666666'),
    tenantId: TENANT,
    releaseId: RELEASE_ID,
    releaseItemId: null,
    itemId: null,
    reportedQuantity: null,
    message: 'divergência',
    status: 'ABERTA',
    resolutionNote: null,
    reportedBy: USER,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date('2026-02-02T00:00:00Z'),
    ...overrides,
  } as InvAssemblyReleaseIssueRow;
}

export function makeBomRow(
  productItemId: string,
  componentItemId: string,
  quantity: string,
  lossPercent: string,
  componentName = `component ${componentItemId.slice(-2)}`,
): BomExplosionRow {
  return { productItemId, componentItemId, componentName, quantity, lossPercent };
}

export type MockProdRepo = jest.Mocked<IInventoryProductionRepository>;
export type MockStockRepo = jest.Mocked<IProductionStockRepository>;

/** Production repo mock: withTransaction just runs the callback. */
export function makeProdRepo(overrides: Record<string, jest.Mock> = {}): MockProdRepo {
  const repo = {
    withTransaction: jest.fn(async (fn: (tx: never) => Promise<unknown>) => fn({} as never)),
    listPendingDemandsGrouped: jest.fn(async () => ({ rows: [], total: 0 })),
    lockPendingDemandsForItem: jest.fn(async () => [] as InvProductionDemandRow[]),
    concludeDemand: jest.fn(async () => undefined),
    reduceDemandQuantity: jest.fn(async () => undefined),
    insertRelease: jest.fn(async (input: NewReleaseInput) =>
      makeRelease({
        photoFileId: input.photoFileId,
        responsibles: input.responsibles,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      }),
    ),
    insertReleaseItems: jest.fn(async (inputs: NewReleaseItemInput[]) =>
      inputs.map(
        (i) =>
          ({
            id: nextId('77777777'),
            tenantId: i.tenantId,
            releaseId: i.releaseId,
            itemId: i.itemId,
            quantity: i.quantity,
          }) as InvAssemblyReleaseItemRow,
      ),
    ),
    listReleases: jest.fn(async () => ({ rows: [], total: 0 })),
    listReleaseItems: jest.fn(async () => []),
    getReleaseById: jest.fn(async () => null),
    updateReleaseItemQuantity: jest.fn(async () => undefined),
    deleteRelease: jest.fn(async () => true),
    homologatedCountsByItem: jest.fn(async () => []),
    insertIssue: jest.fn(async (input: NewIssueInput) =>
      makeIssue({
        releaseId: input.releaseId,
        releaseItemId: input.releaseItemId ?? null,
        itemId: input.itemId ?? null,
        reportedQuantity: input.reportedQuantity ?? null,
        message: input.message ?? null,
        reportedBy: input.reportedBy ?? null,
      }),
    ),
    listIssues: jest.fn(async () => ({ rows: [], total: 0 })),
    getIssueById: jest.fn(async () => null),
    resolveIssue: jest.fn(async () => makeIssue({ status: 'RESOLVIDA', resolvedBy: USER, resolvedAt: new Date() })),
    resolveOpenIssues: jest.fn(async () => 0),
    getBomsForProducts: jest.fn(async () => [] as BomExplosionRow[]),
    listManufacturedProducts: jest.fn(async () => ({ rows: [], total: 0 })),
    findItemsByIds: jest.fn(async () => []),
    componentBalances: jest.fn(async () => []),
  } as unknown as MockProdRepo;
  return Object.assign(repo, overrides);
}

/**
 * Stock repo mock (the M2 seam composed inside the release tx). By default
 * every id resolves to a MANUFACTURED PRODUCT when it matches PRODUCT_*, and
 * to a plain COMPONENT otherwise; balances are effectively unlimited.
 */
export function makeStockRepo(overrides: Record<string, jest.Mock> = {}): MockStockRepo {
  const repo = {
    lockItem: jest.fn(async (_tenant: string, itemId: string) =>
      itemId === PRODUCT_A || itemId === PRODUCT_B
        ? makeItem({ id: itemId, name: `Produto ${itemId.slice(-2)}`, domain: 'PRODUCT', isManufactured: true })
        : makeItem({ id: itemId, name: `Componente ${itemId.slice(-2)}`, domain: 'COMPONENT' }),
    ),
    getBalance: jest.fn(async () => ({
      balance: '1000000',
      totalIn: '1000000',
      totalOut: '0',
      lastMovementAt: null,
    })),
    insertMovement: jest.fn(async (input: NewMovementInput) => movementRowFrom(input)),
  } as unknown as MockStockRepo;
  return Object.assign(repo, overrides);
}
