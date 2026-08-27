// Shared fixtures/mocks for the RFC-0061 M7 unit suites (service with mocked
// field + stock + QR-registry repositories — no DB). Reuses the M2 item and
// movement factories.

import type {
  IInventoryFieldRepository,
  IFieldStockRepository,
  IFieldQrRegistryRepository,
} from '../../../src/services/inventory/InventoryFieldService';
import type {
  InvUnitProductRow,
  InvTechnicianMoveRow,
  InvDamagedItemRow,
  DispatchRow,
  NewUnitProductInput,
  NewTechnicianMoveInput,
  NewDamagedItemInput,
  InvProjectRow,
} from '../../../src/repositories/inventory/InventoryFieldRepository';
import type {
  NewMovementInput,
  NewMovementQrInput,
  InvMovementQrRow,
} from '../../../src/repositories/inventory/InventoryStockRepository';
import type { InvQrRegistryRow } from '../../../src/repositories/inventory/InventoryHomologationRepository';
import { makeItem, movementRowFrom, TENANT, USER, ITEM_ID } from './m2-helpers';

export { TENANT, USER, ITEM_ID };
export const CTX = { tenantId: TENANT, userId: USER };

export const UNIT_ID = '99999999-9999-4999-8999-999999999999';
export const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
export const CUSTOMER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
export const DISPATCH_ID = 'cccccccc-3333-4333-8333-333333333333';
export const DAMAGED_ID = 'dddddddd-4444-4444-8444-444444444444';
export const PHOTO_ID = '44444444-4444-4444-4444-444444444444';
export const QR = '250101_000123';
export const TECHNICIAN = 'João da Silva';

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

export function makeUnit(overrides: Partial<InvUnitProductRow> = {}): InvUnitProductRow {
  return {
    id: UNIT_ID,
    tenantId: TENANT,
    itemId: ITEM_ID,
    label: QR,
    status: 'PARADO',
    installedAt: null,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    clientNameSnapshot: 'Cliente Moxuara',
    expeditionOrderId: null,
    movedTo: null,
    movedTechnician: null,
    movePhotoFileId: null,
    movedAt: null,
    moveNotes: null,
    notes: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    createdBy: USER,
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    ...overrides,
  } as InvUnitProductRow;
}

export function makeProject(overrides: Partial<InvProjectRow> = {}): InvProjectRow {
  return {
    id: PROJECT_ID,
    tenantId: TENANT,
    name: 'Projeto Moxuara',
    description: null,
    customerId: CUSTOMER_ID,
    legacyClientName: null,
    legacyClientCnpj: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedBy: null,
    ...overrides,
  } as InvProjectRow;
}

export function makeDamaged(overrides: Partial<InvDamagedItemRow> = {}): InvDamagedItemRow {
  return {
    id: DAMAGED_ID,
    tenantId: TENANT,
    itemId: ITEM_ID,
    productNameSnapshot: 'Item de teste',
    quantity: 1,
    source: 'Cliente',
    sourceDetail: `Projeto Moxuara / ${QR}`,
    reason: 'display quebrado',
    photoFileId: null,
    status: 'AVARIADO',
    recoveredTo: null,
    recoveryNotes: null,
    recoveredBy: null,
    recoveredAt: null,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    createdBy: USER,
    ...overrides,
  } as InvDamagedItemRow;
}

export function makeDispatchRow(overrides: Partial<DispatchRow> = {}): DispatchRow {
  return {
    movementId: DISPATCH_ID,
    itemId: ITEM_ID,
    itemName: 'Item de teste',
    technician: TECHNICIAN,
    location: 'ALMOXARIFADO',
    quantity: '5',
    movedQuantity: 0,
    reason: 'Saída para técnico',
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

/** The dispatch as its raw inv_stock_movements row (for lockDispatch). */
export function makeDispatchMovement(overrides: Record<string, unknown> = {}) {
  return {
    id: DISPATCH_ID,
    tenantId: TENANT,
    itemId: ITEM_ID,
    location: 'ALMOXARIFADO',
    quantity: '5',
    type: 'SAIDA',
    reason: 'Saída para técnico',
    responsible: TECHNICIAN,
    photoFileId: null,
    purchaseOrderId: null,
    transferGroupId: null,
    imported: false,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    createdBy: USER,
    ...overrides,
  };
}

export function makeRegistryRow(overrides: Partial<InvQrRegistryRow> = {}): InvQrRegistryRow {
  return {
    id: nextId('eeeeeeee'),
    tenantId: TENANT,
    qrValue: QR,
    kind: 'UNIT',
    itemId: ITEM_ID,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    createdBy: null,
    ...overrides,
  } as InvQrRegistryRow;
}

export type MockFieldRepo = jest.Mocked<IInventoryFieldRepository>;
export type MockStockRepo = jest.Mocked<IFieldStockRepository>;
export type MockQrRepo = jest.Mocked<IFieldQrRegistryRepository>;

/** Field repo mock: withTransaction just runs the callback. */
export function makeFieldRepo(overrides: Record<string, jest.Mock> = {}): MockFieldRepo {
  const repo = {
    withTransaction: jest.fn(async (fn: (tx: never) => Promise<unknown>) => fn({} as never)),
    listUnitProducts: jest.fn(async () => ({ rows: [], total: 0 })),
    getUnitProduct: jest.fn(async () => null),
    getUnitProductForUpdate: jest.fn(async () => makeUnit()),
    findUnitByLabel: jest.fn(async () => null),
    insertUnitProducts: jest.fn(async (inputs: NewUnitProductInput[]) =>
      inputs.map((input) =>
        makeUnit({
          id: nextId('99999999'),
          itemId: input.itemId ?? null,
          label: input.label ?? null,
          status: input.status ?? 'PARADO',
          projectId: input.projectId ?? null,
          customerId: input.customerId ?? null,
          clientNameSnapshot: input.clientNameSnapshot ?? null,
          notes: input.notes ?? null,
        }),
      ),
    ),
    updateUnitStatus: jest.fn(async (_t: string, id: string, status: string, installedAt: Date | null) =>
      makeUnit({ id, status, installedAt }),
    ),
    markUnitMoved: jest.fn(async (_t: string, id: string, fields: Record<string, unknown>) =>
      makeUnit({ id, ...(fields as Partial<InvUnitProductRow>) }),
    ),
    listDispatches: jest.fn(async () => [] as DispatchRow[]),
    lockDispatch: jest.fn(async () => makeDispatchMovement() as never),
    sumTechnicianMoves: jest.fn(async () => 0),
    insertTechnicianMove: jest.fn(async (input: NewTechnicianMoveInput) =>
      ({
        id: nextId('ffffffff'),
        tenantId: input.tenantId,
        movementId: input.movementId,
        itemId: input.itemId ?? null,
        technician: input.technician ?? null,
        destination: input.destination,
        projectId: input.projectId ?? null,
        quantity: input.quantity,
        notes: input.notes ?? null,
        createdAt: new Date('2026-05-02T00:00:00Z'),
        createdBy: input.createdBy ?? null,
      }) as InvTechnicianMoveRow,
    ),
    listMovementQrs: jest.fn(async () => [] as InvMovementQrRow[]),
    listDamagedItems: jest.fn(async () => ({ rows: [], total: 0 })),
    getDamagedItemForUpdate: jest.fn(async () => makeDamaged()),
    insertDamagedItem: jest.fn(async (input: NewDamagedItemInput) =>
      makeDamaged({
        id: nextId('dddddddd'),
        itemId: input.itemId ?? null,
        productNameSnapshot: input.productNameSnapshot ?? null,
        quantity: input.quantity,
        source: input.source ?? null,
        sourceDetail: input.sourceDetail ?? null,
        reason: input.reason ?? null,
        photoFileId: input.photoFileId ?? null,
      }),
    ),
    markDamagedRecovered: jest.fn(async (_t: string, id: string, fields: Record<string, unknown>) =>
      makeDamaged({
        id,
        status: 'RECUPERADO',
        ...(fields as Partial<InvDamagedItemRow>),
      }),
    ),
    getProject: jest.fn(async () => makeProject()),
  } as unknown as MockFieldRepo;
  return Object.assign(repo, overrides);
}

/** Stock repo mock (the M2 seam composed inside the field tx). */
export function makeStockRepo(overrides: Record<string, jest.Mock> = {}): MockStockRepo {
  const repo = {
    lockItem: jest.fn(async (_tenant: string, itemId: string) => makeItem({ id: itemId })),
    getBalance: jest.fn(async () => ({ balance: '100', totalIn: '100', totalOut: '0', lastMovementAt: null })),
    insertMovement: jest.fn(async (input: NewMovementInput) => movementRowFrom(input)),
    insertMovementQrs: jest.fn(
      async (tenantId: string, movementId: string, qrs: NewMovementQrInput[]) =>
        qrs.map(
          (q, i) =>
            ({
              id: `55555555-0000-4000-8000-${String(i).padStart(12, '0')}`,
              tenantId,
              movementId,
              qrValue: q.qrValue ?? null,
              boxQr: q.boxQr ?? null,
              homologationUnitId: q.homologationUnitId ?? null,
            }) as InvMovementQrRow,
        ),
    ),
  } as unknown as MockStockRepo;
  return Object.assign(repo, overrides);
}

/** QR-registry repo mock (M5 seam): every code is a homologated UNIT QR. */
export function makeQrRepo(overrides: Record<string, jest.Mock> = {}): MockQrRepo {
  const repo = {
    findRegistryByValues: jest.fn(async (_tenant: string, values: string[]) =>
      values.map((qrValue) => makeRegistryRow({ qrValue })),
    ),
    getItem: jest.fn(async (_tenant: string, itemId: string) => makeItem({ id: itemId })),
  } as unknown as MockQrRepo;
  return Object.assign(repo, overrides);
}
