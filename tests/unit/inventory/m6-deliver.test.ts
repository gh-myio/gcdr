/**
 * RFC-0061 M6 — baixa/separação (deliver) rules (service with mocked
 * repositories — no DB).
 *
 * quantity ≤ disponível; photo mandatory (DTO); manufactured → exactly one
 * stockOnly QR per unit (registry + not used; boxes expand); writes
 * inv_item_deliveries + inv_delivery_qrs + the SAIDA movement (reason "Baixa
 * para pedido Myio") in ONE transaction; auto-status (PRONTO_ENTREGA when all
 * delivered, else PRODUZINDO, never regressing ENTREGUE_CLIENTE); push
 * "expedicao" enqueued in the same transaction (DEC-6); Idempotency-Key
 * replays the original result.
 */

import {
  DeliverItemSchema,
  REASON_EXPEDITION_DELIVERY,
  DELIVERY_LOCATION,
} from '../../../src/services/inventory/InventoryExpeditionService';
import { ValidationError } from '../../../src/shared/errors/AppError';
import {
  CTX,
  ORDER_ID,
  ORDER_ITEM_ID,
  ORDER_ITEM_ID_2,
  ITEM_MANUFACTURED,
  ITEM_PURCHASABLE,
  PHOTO_ID,
  makeOrder,
  makeOrderItem,
  makeBox,
  makeHomologUnit,
  makeRegistryRow,
  makeExpeditionRepo,
  makeStockRepo,
  makeHomologRepo,
  makeService,
} from './m6-helpers';

const DELIVER_2 = { quantity: 2, photoFileId: PHOTO_ID, qrs: ['100_1', '100_2'] };
let keySeq = 0;
const key = () => `idem-${++keySeq}`;

describe('M6 deliver — DTO shape', () => {
  it('photoFileId is mandatory (foto obrigatória)', () => {
    expect(() => DeliverItemSchema.parse({ quantity: 1 })).toThrow();
    expect(() => DeliverItemSchema.parse({ quantity: 1, photoFileId: PHOTO_ID })).not.toThrow();
  });

  it('quantity must be a positive integer', () => {
    expect(() => DeliverItemSchema.parse({ quantity: 0, photoFileId: PHOTO_ID })).toThrow();
    expect(() => DeliverItemSchema.parse({ quantity: 1.5, photoFileId: PHOTO_ID })).toThrow();
  });
});

describe('M6 deliver — guards', () => {
  it('rejects deliver when the order is EM_TRANSITO (state conflict 409)', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
    });
    const { service } = makeService({ repo });
    const err = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key()).catch((e) => e);
    expect(err.code).toBe('INV_ILLEGAL_TRANSITION');
    expect(err.statusCode).toBe(409);
  });

  it('404 when the order item belongs to another order', async () => {
    const repo = makeExpeditionRepo({
      getOrderItem: jest.fn(async () => makeOrderItem({ orderId: 'ffffffff-0000-4000-8000-000000000000' })),
    });
    const { service } = makeService({ repo });
    const err = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key()).catch((e) => e);
    expect(err.statusCode).toBe(404);
  });

  it('quantity > disponível (ordered − delivered) → ValidationError', async () => {
    const repo = makeExpeditionRepo({
      deliveredQuantities: jest.fn(async () => new Map([[ORDER_ITEM_ID, 1]])), // 1 of 2 delivered
    });
    const { service } = makeService({ repo });
    const err = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key()).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('excede o disponível');
  });

  it('manufactured item without QRs → ValidationError (1 QR por unidade)', async () => {
    const { service } = makeService();
    const err = await service
      .deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, { quantity: 2, photoFileId: PHOTO_ID }, key())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('1 QR por unidade');
  });

  it('QR count ≠ quantity → ValidationError', async () => {
    const { service } = makeService();
    const err = await service
      .deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, { quantity: 2, photoFileId: PHOTO_ID, qrs: ['100_1'] }, key())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('deve igualar o número de QRs');
  });

  it('QR not homologated/registered → INV_QR_NOT_IN_REGISTRY 422 (stockOnly)', async () => {
    const homolog = makeHomologRepo({ findUnitsByQrValues: jest.fn(async () => []) });
    const { service } = makeService({ homolog });
    const err = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key()).catch((e) => e);
    expect(err.code).toBe('INV_QR_NOT_IN_REGISTRY');
    expect(err.statusCode).toBe(422);
  });

  it('QR of another item → INV_QR_WRONG_ITEM 422', async () => {
    const homolog = makeHomologRepo({
      findUnitsByQrValues: jest.fn(async (_t: string, values: string[]) =>
        values
          .filter((v) => !v.startsWith('http'))
          .map((v) => ({
            unit: makeHomologUnit(v),
            homologation: makeBox({ boxSize: 1, boxQr: null, itemId: ITEM_PURCHASABLE }),
          })),
      ),
    });
    const { service } = makeService({ homolog });
    const err = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key()).catch((e) => e);
    expect(err.code).toBe('INV_QR_WRONG_ITEM');
    expect(err.statusCode).toBe(422);
  });

  it('QR already delivered (expedition baixa) → INV_QR_ALREADY_USED 409', async () => {
    const homolog = makeHomologRepo({
      deliveryEventsByQrs: jest.fn(async () => [{ qrValue: '100_1', boxQr: null }]),
    });
    const { service } = makeService({ homolog });
    const err = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key()).catch((e) => e);
    expect(err.code).toBe('INV_QR_ALREADY_USED');
    expect(err.statusCode).toBe(409);
  });

  it('QR whose latest ledger event is an exit → INV_QR_ALREADY_USED 409', async () => {
    const stock = makeStockRepo({
      latestQrEventTypes: jest.fn(async () => new Map([['100_2', 'SAIDA']])),
    });
    const { service } = makeService({ stock });
    const err = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key()).catch((e) => e);
    expect(err.code).toBe('INV_QR_ALREADY_USED');
  });

  it('duplicate QR in the request → ValidationError', async () => {
    const { service } = makeService();
    const err = await service
      .deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, { quantity: 2, photoFileId: PHOTO_ID, qrs: ['100_1', '100_1'] }, key())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('duplicado');
  });

  it('non-manufactured item rejects QRs', async () => {
    const repo = makeExpeditionRepo({
      getOrderItem: jest.fn(async () =>
        makeOrderItem({ id: ORDER_ITEM_ID_2, itemId: ITEM_PURCHASABLE, isManufactured: false, domain: 'COMPONENT' }),
      ),
    });
    const { service } = makeService({ repo });
    const err = await service
      .deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID_2, { quantity: 1, photoFileId: PHOTO_ID, qrs: ['100_1'] }, key())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('manufaturados');
  });

  it('insufficient ALMOXARIFADO balance → INV_INSUFFICIENT_STOCK 409', async () => {
    const stock = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '1', totalIn: '1', totalOut: '0', lastMovementAt: null })),
    });
    const { service } = makeService({ stock });
    const err = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key()).catch((e) => e);
    expect(err.code).toBe('INV_INSUFFICIENT_STOCK');
    expect(err.statusCode).toBe(409);
    expect(err.details).toMatchObject({ itemId: ITEM_MANUFACTURED, location: DELIVERY_LOCATION });
  });
});

describe('M6 deliver — box expansion', () => {
  it('a box QR expands to its units (1 QR per unit satisfied by the box)', async () => {
    const box = makeBox({ boxQr: 'caixa-10/7', boxSize: 10 });
    const units = [makeHomologUnit('200_1'), makeHomologUnit('200_2')];
    const homolog = makeHomologRepo({
      findBoxesByQrValues: jest.fn(async () => [box]),
      unitsByHomologationIds: jest.fn(async () => units),
    });
    const repo = makeExpeditionRepo();
    const { service, stock } = makeService({ repo, homolog });
    const result = await service.deliverItem(
      CTX,
      ORDER_ID,
      ORDER_ITEM_ID,
      { quantity: 2, photoFileId: PHOTO_ID, qrs: ['caixa-10/7'] },
      key(),
    );
    expect(result.qrs).toEqual([
      { qrValue: '200_1', boxQr: 'caixa-10/7' },
      { qrValue: '200_2', boxQr: 'caixa-10/7' },
    ]);
    expect(stock.insertMovementQrs).toHaveBeenCalledWith(
      CTX.tenantId,
      expect.any(String),
      [
        expect.objectContaining({ qrValue: '200_1', boxQr: 'caixa-10/7' }),
        expect.objectContaining({ qrValue: '200_2', boxQr: 'caixa-10/7' }),
      ],
      expect.anything(),
    );
  });

  it('empty box → INV_BOX_EMPTY 422', async () => {
    const homolog = makeHomologRepo({
      findBoxesByQrValues: jest.fn(async () => [makeBox({ boxQr: 'caixa-10/7' })]),
      unitsByHomologationIds: jest.fn(async () => []),
    });
    const { service } = makeService({ homolog });
    const err = await service
      .deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, { quantity: 2, photoFileId: PHOTO_ID, qrs: ['caixa-10/7'] }, key())
      .catch((e) => e);
    expect(err.code).toBe('INV_BOX_EMPTY');
    expect(err.statusCode).toBe(422);
  });

  it('registry-only UNIT identity is accepted (same stockOnly semantics as M5)', async () => {
    const homolog = makeHomologRepo({
      findUnitsByQrValues: jest.fn(async () => []),
      findRegistryByValues: jest.fn(async (_t: string, values: string[]) =>
        values.filter((v) => !v.startsWith('http')).map((v) => makeRegistryRow(v)),
      ),
    });
    const { service } = makeService({ homolog });
    const result = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key());
    expect(result.qrs.map((q) => q.qrValue)).toEqual(['100_1', '100_2']);
  });
});

describe('M6 deliver — happy path, auto-status and push', () => {
  it('writes delivery + delivery QRs + the SAIDA movement in one transaction', async () => {
    const repo = makeExpeditionRepo();
    const { service, stock } = makeService({ repo });
    const result = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key());

    expect(repo.withTransaction).toHaveBeenCalledTimes(1);
    expect(repo.insertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, orderItemId: ORDER_ITEM_ID, quantity: 2, photoFileId: PHOTO_ID }),
      expect.anything(),
    );
    expect(repo.insertDeliveryQrs).toHaveBeenCalledWith(
      CTX.tenantId,
      expect.any(String),
      ORDER_ITEM_ID,
      [
        expect.objectContaining({ qrValue: '100_1' }),
        expect.objectContaining({ qrValue: '100_2' }),
      ],
      expect.anything(),
    );
    expect(stock.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: ITEM_MANUFACTURED,
        location: DELIVERY_LOCATION,
        quantity: '2',
        type: 'SAIDA',
        reason: REASON_EXPEDITION_DELIVERY,
        photoFileId: PHOTO_ID,
      }),
      expect.anything(),
    );
    expect(result.movementId).toBeTruthy();
  });

  it('all items delivered → auto-advance to PRONTO_ENTREGA', async () => {
    const repo = makeExpeditionRepo({
      // Second read (post-insert) reports the full quantity delivered.
      deliveredQuantities: jest
        .fn()
        .mockResolvedValueOnce(new Map()) // pre-insert: nothing delivered
        .mockResolvedValue(new Map([[ORDER_ITEM_ID, 2]])), // post-insert
    });
    const { service } = makeService({ repo });
    const result = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key());
    expect(repo.updateOrder).toHaveBeenCalledWith(
      CTX.tenantId,
      ORDER_ID,
      expect.objectContaining({ status: 'PRONTO_ENTREGA' }),
      expect.anything(),
    );
    expect(result.autoAdvanced).toBe(true);
  });

  it('partial delivery → auto-advance to PRODUZINDO', async () => {
    const repo = makeExpeditionRepo({
      deliveredQuantities: jest
        .fn()
        .mockResolvedValueOnce(new Map())
        .mockResolvedValue(new Map([[ORDER_ITEM_ID, 1]])),
    });
    const { service } = makeService({ repo });
    await service.deliverItem(
      CTX,
      ORDER_ID,
      ORDER_ITEM_ID,
      { quantity: 1, photoFileId: PHOTO_ID, qrs: ['100_1'] },
      key(),
    );
    expect(repo.updateOrder).toHaveBeenCalledWith(
      CTX.tenantId,
      ORDER_ID,
      expect.objectContaining({ status: 'PRODUZINDO' }),
      expect.anything(),
    );
  });

  it('no auto-update when the status is already the computed one', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PRODUZINDO' })),
      deliveredQuantities: jest
        .fn()
        .mockResolvedValueOnce(new Map())
        .mockResolvedValue(new Map([[ORDER_ITEM_ID, 1]])),
    });
    const { service } = makeService({ repo });
    const result = await service.deliverItem(
      CTX,
      ORDER_ID,
      ORDER_ITEM_ID,
      { quantity: 1, photoFileId: PHOTO_ID, qrs: ['100_1'] },
      key(),
    );
    expect(repo.updateOrder).not.toHaveBeenCalled();
    expect(result.autoAdvanced).toBe(false);
  });

  it('enqueues the "expedicao" push with the delivered unit QRs (DEC-6)', async () => {
    const repo = makeExpeditionRepo();
    const { service } = makeService({ repo });
    await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, key());
    expect(repo.enqueuePush).toHaveBeenCalledWith(
      CTX.tenantId,
      { qrCodes: ['100_1', '100_2'], location: 'expedicao' },
      expect.anything(),
    );
  });
});

describe('M6 deliver — idempotency (S1)', () => {
  it('same Idempotency-Key executes once and replays the original result', async () => {
    const repo = makeExpeditionRepo();
    const { service } = makeService({ repo });
    const idemKey = key();
    const first = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, idemKey);
    const second = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, idemKey);
    expect(second).toBe(first);
    expect(repo.insertDelivery).toHaveBeenCalledTimes(1);
    expect(repo.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('a failed attempt does not poison the key (retry re-executes)', async () => {
    const repo = makeExpeditionRepo({
      insertDelivery: jest
        .fn()
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockImplementation(async (input: { quantity: number; photoFileId: string }) => ({
          id: 'dddddddd-0000-0000-0000-000000000099',
          tenantId: CTX.tenantId,
          orderId: ORDER_ID,
          orderItemId: ORDER_ITEM_ID,
          quantity: input.quantity,
          photoFileId: input.photoFileId,
          createdAt: new Date(),
          createdBy: null,
        })),
    });
    const { service } = makeService({ repo });
    const idemKey = key();
    await expect(service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, idemKey)).rejects.toThrow();
    const retry = await service.deliverItem(CTX, ORDER_ID, ORDER_ITEM_ID, DELIVER_2, idemKey);
    expect(retry.delivery.quantity).toBe(2);
    expect(repo.insertDelivery).toHaveBeenCalledTimes(2);
  });
});
