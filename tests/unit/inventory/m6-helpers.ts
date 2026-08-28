// Shared fixtures/mocks for the RFC-0061 M6 unit suites (expedition service
// with mocked expedition/stock/homologation repositories — no DB). Reuses the
// M2 item/movement factories.

import {
  InventoryExpeditionService,
  IInventoryExpeditionRepository,
  IExpeditionStockRepository,
  IExpeditionHomologationRepository,
  IExpeditionItemRepository,
  IExpeditionPurchaseOrderService,
} from '../../../src/services/inventory/InventoryExpeditionService';
import type {
  InvExpeditionOrderRow,
  InvItemDeliveryRow,
  InvShipmentRow,
  InvProjectRow,
  InvProductionDemandRow,
  InvPurchaseDemandRow,
  NewDeliveryInput,
  NewShipmentInput,
  NewExpeditionOrderInput,
  NewOrderItemInput,
  NewProductionDemandInput,
  NewPurchaseDemandInput,
  NewUnitProductInput,
  OrderItemWithName,
  DeliveredQrRow,
} from '../../../src/repositories/inventory/InventoryExpeditionRepository';
import type {
  InvHomologationRow,
  InvHomologationUnitRow,
  InvQrRegistryRow,
} from '../../../src/repositories/inventory/InventoryHomologationRepository';
import type { NewMovementInput } from '../../../src/repositories/inventory/InventoryStockRepository';
import { makeItem, movementRowFrom, TENANT, USER, PHOTO_ID } from './m2-helpers';

export { TENANT, USER, PHOTO_ID };
export const CTX = { tenantId: TENANT, userId: USER };

export const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
export const CUSTOMER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02';
export const ORDER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';
export const ORDER_ITEM_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';
export const ORDER_ITEM_ID_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03';
export const ITEM_MANUFACTURED = 'ffffffff-ffff-4fff-8fff-ffffffffff01';
export const ITEM_PURCHASABLE = 'ffffffff-ffff-4fff-8fff-ffffffffff02';
export const PROOF_ID = '44444444-4444-4444-4444-444444444445';
export const HOMOLOG_ID = '66666666-6666-6666-6666-666666666666';

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-0000-0000-0000-${String(seq).padStart(12, '0')}`;
}

export function makeOrder(overrides: Partial<InvExpeditionOrderRow> = {}): InvExpeditionOrderRow {
  return {
    id: ORDER_ID,
    tenantId: TENANT,
    title: 'Pedido Myio de teste',
    projectId: PROJECT_ID,
    customerId: null,
    deliveryDate: new Date('2026-09-30T00:00:00Z'),
    status: 'PENDENTE',
    isReplacement: false,
    notes: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    createdBy: USER,
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    updatedBy: USER,
    ...overrides,
  } as InvExpeditionOrderRow;
}

export function makeOrderItem(overrides: Partial<OrderItemWithName> = {}): OrderItemWithName {
  return {
    id: ORDER_ITEM_ID,
    orderId: ORDER_ID,
    itemId: ITEM_MANUFACTURED,
    itemName: 'Produto manufaturado',
    isManufactured: true,
    domain: 'PRODUCT',
    quantity: 2,
    ...overrides,
  };
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

export function makeDeliveredQr(overrides: Partial<DeliveredQrRow> = {}): DeliveredQrRow {
  return {
    orderItemId: ORDER_ITEM_ID,
    itemId: ITEM_MANUFACTURED,
    qrValue: '100_1',
    boxQr: null,
    homologationUnitId: null,
    ...overrides,
  };
}

export function makeBox(overrides: Partial<InvHomologationRow> = {}): InvHomologationRow {
  return {
    id: HOMOLOG_ID,
    tenantId: TENANT,
    releaseId: null,
    itemId: ITEM_MANUFACTURED,
    boxSize: 10,
    boxQr: 'caixa-10/1',
    responsibleId: null,
    notes: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    createdBy: USER,
    ...overrides,
  } as InvHomologationRow;
}

export function makeHomologUnit(
  qrValue: string,
  overrides: Partial<InvHomologationUnitRow> = {},
): InvHomologationUnitRow {
  return {
    id: nextId('88888888'),
    tenantId: TENANT,
    homologationId: HOMOLOG_ID,
    position: 1,
    qrValue,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  } as InvHomologationUnitRow;
}

export function makeRegistryRow(qrValue: string, overrides: Partial<InvQrRegistryRow> = {}): InvQrRegistryRow {
  return {
    id: nextId('99999999'),
    tenantId: TENANT,
    qrValue,
    kind: 'UNIT',
    itemId: ITEM_MANUFACTURED,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    createdBy: USER,
    ...overrides,
  } as InvQrRegistryRow;
}

export function makeProductionDemand(overrides: Partial<InvProductionDemandRow> = {}): InvProductionDemandRow {
  return {
    id: nextId('11111111'),
    tenantId: TENANT,
    expeditionOrderItemId: ORDER_ITEM_ID,
    expeditionOrderId: ORDER_ID,
    itemId: ITEM_MANUFACTURED,
    quantity: 1,
    status: 'PENDENTE',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as InvProductionDemandRow;
}

export function makePurchaseDemand(overrides: Partial<InvPurchaseDemandRow> = {}): InvPurchaseDemandRow {
  return {
    id: nextId('22222222'),
    tenantId: TENANT,
    expeditionOrderItemId: ORDER_ITEM_ID_2,
    expeditionOrderId: ORDER_ID,
    purchaseOrderId: null,
    itemId: ITEM_PURCHASABLE,
    quantity: 1,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as InvPurchaseDemandRow;
}

export type MockExpeditionRepo = jest.Mocked<IInventoryExpeditionRepository>;
export type MockStockRepo = jest.Mocked<IExpeditionStockRepository>;
export type MockHomologRepo = jest.Mocked<IExpeditionHomologationRepository>;
export type MockItemRepo = jest.Mocked<IExpeditionItemRepository>;
export type MockPoService = jest.Mocked<IExpeditionPurchaseOrderService>;

/** Expedition repo mock: withTransaction just runs the callback. */
export function makeExpeditionRepo(overrides: Record<string, jest.Mock> = {}): MockExpeditionRepo {
  const repo = {
    withTransaction: jest.fn(async (fn: (tx: never) => Promise<unknown>) => fn({} as never)),
    list: jest.fn(async () => ({ rows: [], total: 0 })),
    getById: jest.fn(async () => makeOrder()),
    lockById: jest.fn(async () => makeOrder()),
    insertOrder: jest.fn(async (input: NewExpeditionOrderInput) =>
      makeOrder({
        id: ORDER_ID,
        title: input.title ?? null,
        projectId: input.projectId,
        customerId: input.customerId ?? null,
        deliveryDate: input.deliveryDate,
        isReplacement: input.isReplacement ?? false,
        notes: input.notes ?? null,
      }),
    ),
    updateOrder: jest.fn(
      async (_tenant: string, _id: string, patch: Record<string, unknown>) =>
        makeOrder(patch as Partial<InvExpeditionOrderRow>),
    ),
    deleteOrder: jest.fn(async () => true),
    listItemsByOrders: jest.fn(async () => [makeOrderItem()]),
    getOrderItem: jest.fn(async () => makeOrderItem()),
    insertItems: jest.fn(async (rows: NewOrderItemInput[]) =>
      rows.map((r) => ({
        id: nextId('eeeeeeee'),
        tenantId: r.tenantId,
        orderId: r.orderId,
        itemId: r.itemId,
        quantity: r.quantity,
      })),
    ),
    deleteItemsByOrder: jest.fn(async () => 0),
    deliveredQuantities: jest.fn(async () => new Map<string, number>()),
    insertDelivery: jest.fn(async (input: NewDeliveryInput) =>
      ({
        id: nextId('dddddddd'),
        tenantId: input.tenantId,
        orderId: input.orderId,
        orderItemId: input.orderItemId,
        quantity: input.quantity,
        photoFileId: input.photoFileId,
        createdAt: new Date(),
        createdBy: input.createdBy ?? null,
      }) as InvItemDeliveryRow,
    ),
    insertDeliveryQrs: jest.fn(async () => []),
    deliveredQrsByOrder: jest.fn(async () => [] as DeliveredQrRow[]),
    insertShipment: jest.fn(async (input: NewShipmentInput) =>
      ({
        id: nextId('cccccccc'),
        tenantId: input.tenantId,
        orderId: input.orderId,
        address: input.address,
        shippingMethod: input.shippingMethod,
        responsible: input.responsible,
        trackingCode: input.trackingCode,
        proofFileId: input.proofFileId,
        notes: input.notes ?? null,
        createdAt: new Date(),
        createdBy: input.createdBy ?? null,
      }) as InvShipmentRow,
    ),
    existingUnitProductLabels: jest.fn(async () => new Set<string>()),
    insertUnitProducts: jest.fn(async (rows: NewUnitProductInput[]) =>
      rows.map((r) => ({ id: nextId('bbbbbbbb'), ...r, status: 'PARADO' }) as never),
    ),
    getProject: jest.fn(async () => makeProject()),
    externalStatesByCodes: jest.fn(async () => []),
    enqueuePush: jest.fn(async () => undefined),
    findProductionDemandsByOrderItemIds: jest.fn(async () => [] as InvProductionDemandRow[]),
    findPurchaseDemandsByOrderItemIds: jest.fn(async () => [] as InvPurchaseDemandRow[]),
    insertProductionDemand: jest.fn(async (input: NewProductionDemandInput) =>
      makeProductionDemand({
        expeditionOrderItemId: input.expeditionOrderItemId,
        expeditionOrderId: input.expeditionOrderId,
        itemId: input.itemId,
        quantity: input.quantity,
      }),
    ),
    insertPurchaseDemand: jest.fn(async (input: NewPurchaseDemandInput) =>
      makePurchaseDemand({
        expeditionOrderItemId: input.expeditionOrderItemId,
        expeditionOrderId: input.expeditionOrderId,
        itemId: input.itemId,
        quantity: input.quantity,
      }),
    ),
    setPurchaseDemandOrder: jest.fn(async () => undefined),
  } as unknown as MockExpeditionRepo;
  return Object.assign(repo, overrides);
}

/** Stock repo mock (the M2 seam): manufactured PRODUCT by default, deep stock. */
export function makeStockRepo(overrides: Record<string, jest.Mock> = {}): MockStockRepo {
  const repo = {
    lockItem: jest.fn(async (_tenant: string, itemId: string) =>
      itemId === ITEM_PURCHASABLE
        ? makeItem({ id: itemId, name: 'Item comprável', domain: 'COMPONENT', isManufactured: false })
        : makeItem({ id: itemId, name: 'Produto manufaturado', domain: 'PRODUCT', isManufactured: true }),
    ),
    getBalance: jest.fn(async () => ({ balance: '100', totalIn: '100', totalOut: '0', lastMovementAt: null })),
    insertMovement: jest.fn(async (input: NewMovementInput) => movementRowFrom(input)),
    insertMovementQrs: jest.fn(async () => []),
    latestQrEventTypes: jest.fn(async () => new Map<string, string>()),
  } as unknown as MockStockRepo;
  return Object.assign(repo, overrides);
}

/** Homologation repo mock (the M5 seam): every QR resolves to a unit row. */
export function makeHomologRepo(overrides: Record<string, jest.Mock> = {}): MockHomologRepo {
  const repo = {
    findRegistryByValues: jest.fn(async () => [] as InvQrRegistryRow[]),
    // Every BARE code resolves to a size-1 homologation unit by default
    // (candidates include the full URL spelling — only the bare one matches).
    findUnitsByQrValues: jest.fn(async (_tenant: string, values: string[]) =>
      [...new Set(values)]
        .filter((v) => !v.startsWith('http'))
        .map((v) => ({
          unit: makeHomologUnit(v),
          homologation: makeBox({ boxSize: 1, boxQr: null }),
        })),
    ),
    findBoxesByQrValues: jest.fn(async () => [] as InvHomologationRow[]),
    unitsByHomologationIds: jest.fn(async () => [] as InvHomologationUnitRow[]),
    deliveryEventsByQrs: jest.fn(async () => []),
  } as unknown as MockHomologRepo;
  return Object.assign(repo, overrides);
}

export function makeItemRepo(overrides: Record<string, jest.Mock> = {}): MockItemRepo {
  const repo = {
    findByIds: jest.fn(async (_tenant: string, ids: string[]) =>
      ids.map((id) =>
        makeItem({
          id,
          name: `Item ${id.slice(-2)}`,
          domain: id === ITEM_PURCHASABLE ? 'COMPONENT' : 'PRODUCT',
          isManufactured: id !== ITEM_PURCHASABLE,
        }),
      ),
    ),
  } as unknown as MockItemRepo;
  return Object.assign(repo, overrides);
}

export function makePoService(overrides: Record<string, jest.Mock> = {}): MockPoService {
  const svc = {
    create: jest.fn(async () => ({ id: nextId('33333333'), status: 'PENDENTE' }) as never),
  } as unknown as MockPoService;
  return Object.assign(svc, overrides);
}

export interface ServiceBundle {
  service: InventoryExpeditionService;
  repo: MockExpeditionRepo;
  stock: MockStockRepo;
  homolog: MockHomologRepo;
  items: MockItemRepo;
  po: MockPoService;
}

export function makeService(
  parts: {
    repo?: MockExpeditionRepo;
    stock?: MockStockRepo;
    homolog?: MockHomologRepo;
    items?: MockItemRepo;
    po?: MockPoService;
  } = {},
): ServiceBundle {
  const repo = parts.repo ?? makeExpeditionRepo();
  const stock = parts.stock ?? makeStockRepo();
  const homolog = parts.homolog ?? makeHomologRepo();
  const items = parts.items ?? makeItemRepo();
  const po = parts.po ?? makePoService();
  return { service: new InventoryExpeditionService(repo, stock, homolog, items, po), repo, stock, homolog, items, po };
}
