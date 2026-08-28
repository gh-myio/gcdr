/**
 * RFC-0061 §M4 — demand resolution (P3, A4 — ships with M6; service with
 * mocked repositories — no DB).
 *
 * For expedition-order items short on ALMOXARIFADO stock: manufactured →
 * inv_production_demands; purchasable → automatic purchase order (recipient/
 * delivery point "Estoque", CUSTOMIZADO deadline = delivery date, note
 * "Demanda automática do pedido") + inv_purchase_demands. Idempotent per
 * expedition_order_item_id (UNIQUE).
 */

import {
  AUTO_PURCHASE_RECIPIENT,
  AUTO_PURCHASE_DELIVERY_POINT,
  AUTO_PURCHASE_NOTE,
} from '../../../src/services/inventory/InventoryExpeditionService';
import { ValidationError } from '../../../src/shared/errors/AppError';
import {
  CTX,
  ORDER_ID,
  ORDER_ITEM_ID,
  ORDER_ITEM_ID_2,
  ITEM_MANUFACTURED,
  ITEM_PURCHASABLE,
  PROJECT_ID,
  makeOrder,
  makeOrderItem,
  makeProductionDemand,
  makePurchaseDemand,
  makeExpeditionRepo,
  makeStockRepo,
  makePoService,
  makeService,
} from './m6-helpers';

const DTO = { expeditionOrderId: ORDER_ID };

function manufacturedItem(qty = 10) {
  return makeOrderItem({ id: ORDER_ITEM_ID, itemId: ITEM_MANUFACTURED, isManufactured: true, quantity: qty });
}

function purchasableItem(qty = 10) {
  return makeOrderItem({
    id: ORDER_ITEM_ID_2,
    itemId: ITEM_PURCHASABLE,
    itemName: 'Item comprável',
    isManufactured: false,
    domain: 'COMPONENT',
    quantity: qty,
  });
}

describe('M4 resolve-demand — shortage detection (saldo ALMOXARIFADO)', () => {
  it('no shortage → action NONE, nothing written', async () => {
    const repo = makeExpeditionRepo({ listItemsByOrders: jest.fn(async () => [manufacturedItem(5)]) });
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '5', totalIn: '5', totalOut: '0', lastMovementAt: null })),
    });
    const { service } = makeService({ repo, stock });
    const result = await service.resolveDemand(CTX, DTO);
    expect(result.items).toEqual([
      expect.objectContaining({ orderItemId: ORDER_ITEM_ID, required: 5, balance: 5, shortage: 0, action: 'NONE' }),
    ]);
    expect(repo.insertProductionDemand).not.toHaveBeenCalled();
    expect(repo.insertPurchaseDemand).not.toHaveBeenCalled();
  });

  it('manufactured shortage → inv_production_demands with the missing quantity', async () => {
    const repo = makeExpeditionRepo({ listItemsByOrders: jest.fn(async () => [manufacturedItem(10)]) });
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '3', totalIn: '3', totalOut: '0', lastMovementAt: null })),
    });
    const { service, po } = makeService({ repo, stock });
    const result = await service.resolveDemand(CTX, DTO);

    expect(repo.insertProductionDemand).toHaveBeenCalledWith({
      tenantId: CTX.tenantId,
      expeditionOrderItemId: ORDER_ITEM_ID,
      expeditionOrderId: ORDER_ID,
      itemId: ITEM_MANUFACTURED,
      quantity: 7,
    });
    expect(po.create).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({ action: 'PRODUCTION_DEMAND', shortage: 7 });
    expect(result.items[0].productionDemandId).toBeTruthy();
  });

  it('purchasable shortage → automatic purchase order + inv_purchase_demands', async () => {
    const repo = makeExpeditionRepo({ listItemsByOrders: jest.fn(async () => [purchasableItem(10)]) });
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '4', totalIn: '4', totalOut: '0', lastMovementAt: null })),
    });
    const po = makePoService({
      create: jest.fn(async () => ({ id: '33333333-0000-4000-8000-000000000001', status: 'PENDENTE' }) as never),
    });
    const { service } = makeService({ repo, stock, po });
    const result = await service.resolveDemand(CTX, DTO);

    expect(po.create).toHaveBeenCalledWith(CTX, {
      projectId: PROJECT_ID,
      itemId: ITEM_PURCHASABLE,
      quantity: 6,
      recipient: AUTO_PURCHASE_RECIPIENT,
      deliveryPoint: AUTO_PURCHASE_DELIVERY_POINT,
      deadlineType: 'CUSTOMIZADO',
      deadlineDate: new Date('2026-09-30T00:00:00Z').toISOString(), // order delivery date
      requesterNotes: AUTO_PURCHASE_NOTE,
    });
    expect(repo.insertPurchaseDemand).toHaveBeenCalledWith({
      tenantId: CTX.tenantId,
      expeditionOrderItemId: ORDER_ITEM_ID_2,
      expeditionOrderId: ORDER_ID,
      itemId: ITEM_PURCHASABLE,
      quantity: 6,
    });
    expect(repo.setPurchaseDemandOrder).toHaveBeenCalledWith(
      CTX.tenantId,
      expect.any(String),
      '33333333-0000-4000-8000-000000000001',
    );
    expect(result.items[0]).toMatchObject({
      action: 'PURCHASE_ORDER',
      shortage: 6,
      purchaseOrderId: '33333333-0000-4000-8000-000000000001',
    });
  });

  it('fractional balance rounds the shortage UP (never under-provisions)', async () => {
    const repo = makeExpeditionRepo({ listItemsByOrders: jest.fn(async () => [manufacturedItem(10)]) });
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '3.4', totalIn: '3.4', totalOut: '0', lastMovementAt: null })),
    });
    const { service } = makeService({ repo, stock });
    const result = await service.resolveDemand(CTX, DTO);
    expect(result.items[0].shortage).toBe(7); // ceil(10 − 3.4)
  });

  it('mixed order resolves each item by its own kind', async () => {
    const repo = makeExpeditionRepo({
      listItemsByOrders: jest.fn(async () => [manufacturedItem(10), purchasableItem(10)]),
    });
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '0', totalIn: '0', totalOut: '0', lastMovementAt: null })),
    });
    const { service, po } = makeService({ repo, stock });
    const result = await service.resolveDemand(CTX, DTO);
    expect(result.items.map((i) => i.action)).toEqual(['PRODUCTION_DEMAND', 'PURCHASE_ORDER']);
    expect(repo.insertProductionDemand).toHaveBeenCalledTimes(1);
    expect(repo.insertPurchaseDemand).toHaveBeenCalledTimes(1);
    expect(po.create).toHaveBeenCalledTimes(1);
  });
});

describe('M4 resolve-demand — idempotency (UNIQUE per expedition_order_item_id)', () => {
  it('an existing production demand short-circuits to ALREADY_RESOLVED', async () => {
    const existing = makeProductionDemand({ expeditionOrderItemId: ORDER_ITEM_ID });
    const repo = makeExpeditionRepo({
      listItemsByOrders: jest.fn(async () => [manufacturedItem(10)]),
      findProductionDemandsByOrderItemIds: jest.fn(async () => [existing]),
    });
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '0', totalIn: '0', totalOut: '0', lastMovementAt: null })),
    });
    const { service } = makeService({ repo, stock });
    const result = await service.resolveDemand(CTX, DTO);
    expect(result.items[0]).toMatchObject({ action: 'ALREADY_RESOLVED', productionDemandId: existing.id });
    expect(repo.insertProductionDemand).not.toHaveBeenCalled();
  });

  it('an existing purchase demand short-circuits and never re-creates the PO', async () => {
    const existing = makePurchaseDemand({
      expeditionOrderItemId: ORDER_ITEM_ID_2,
      purchaseOrderId: '33333333-0000-4000-8000-000000000009',
    });
    const repo = makeExpeditionRepo({
      listItemsByOrders: jest.fn(async () => [purchasableItem(10)]),
      findPurchaseDemandsByOrderItemIds: jest.fn(async () => [existing]),
    });
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '0', totalIn: '0', totalOut: '0', lastMovementAt: null })),
    });
    const { service, po } = makeService({ repo, stock });
    const result = await service.resolveDemand(CTX, DTO);
    expect(result.items[0]).toMatchObject({
      action: 'ALREADY_RESOLVED',
      purchaseOrderId: '33333333-0000-4000-8000-000000000009',
    });
    expect(po.create).not.toHaveBeenCalled();
    expect(repo.insertPurchaseDemand).not.toHaveBeenCalled();
  });

  it('a concurrent claim (insert returns null on conflict) reports ALREADY_RESOLVED', async () => {
    const repo = makeExpeditionRepo({
      listItemsByOrders: jest.fn(async () => [manufacturedItem(10), purchasableItem(10)]),
      insertProductionDemand: jest.fn(async () => null),
      insertPurchaseDemand: jest.fn(async () => null),
    });
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '0', totalIn: '0', totalOut: '0', lastMovementAt: null })),
    });
    const { service, po } = makeService({ repo, stock });
    const result = await service.resolveDemand(CTX, DTO);
    expect(result.items.map((i) => i.action)).toEqual(['ALREADY_RESOLVED', 'ALREADY_RESOLVED']);
    // The UNIQUE claim lost → the automatic PO must NOT be created.
    expect(po.create).not.toHaveBeenCalled();
  });
});

describe('M4 resolve-demand — guards', () => {
  it('404 for an unknown expedition order', async () => {
    const repo = makeExpeditionRepo({ getById: jest.fn(async () => null) });
    const { service } = makeService({ repo });
    const err = await service.resolveDemand(CTX, DTO).catch((e) => e);
    expect(err.statusCode).toBe(404);
  });

  it('purchasable shortage on an order without project → ValidationError', async () => {
    const repo = makeExpeditionRepo({
      getById: jest.fn(async () => makeOrder({ projectId: null })),
      listItemsByOrders: jest.fn(async () => [purchasableItem(10)]),
    });
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '0', totalIn: '0', totalOut: '0', lastMovementAt: null })),
    });
    const { service } = makeService({ repo, stock });
    const err = await service.resolveDemand(CTX, DTO).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('projeto');
  });
});
