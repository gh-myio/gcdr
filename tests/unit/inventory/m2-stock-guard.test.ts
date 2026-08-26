/**
 * RFC-0061 M2 — negative-stock guard (AC-2) and anti-double-exit QR check,
 * all inside the movement transaction (mocked repository — no DB).
 */

import { InventoryStockService } from '../../../src/services/inventory/InventoryStockService';
import type { CreateMovementDTO } from '../../../src/dto/request/InventoryDTO';
import { InventoryError } from '../../../src/shared/errors/InventoryError';
import { NotFoundError } from '../../../src/shared/errors/AppError';
import { CTX, ITEM_ID, PHOTO_ID, makeItem, makeRepo } from './m2-helpers';

function exitDto(overrides: Partial<CreateMovementDTO> = {}): CreateMovementDTO {
  return {
    itemId: ITEM_ID,
    location: 'ALMOXARIFADO',
    quantity: 5,
    type: 'SAIDA',
    photoFileId: PHOTO_ID,
    ...overrides,
  } as CreateMovementDTO;
}

describe('M2 negative-stock guard', () => {
  it('rejects an exit that would drive the balance negative — INV_INSUFFICIENT_STOCK with params', async () => {
    const repo = makeRepo({
      getBalance: jest.fn(async () => ({ balance: '3', totalIn: '3', totalOut: '0', lastMovementAt: null })),
    });
    const svc = new InventoryStockService(repo);

    const err = await svc.createMovement(CTX, exitDto({ quantity: 5 }), 'k1').catch((e) => e);
    expect(err).toBeInstanceOf(InventoryError);
    expect(err.code).toBe('INV_INSUFFICIENT_STOCK');
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ itemId: ITEM_ID, location: 'ALMOXARIFADO', balance: 3, requested: 5 });
    expect(repo.insertMovement).not.toHaveBeenCalled();
  });

  it('allows an exit that consumes exactly the whole balance', async () => {
    const repo = makeRepo({
      getBalance: jest.fn(async () => ({ balance: '5', totalIn: '5', totalOut: '0', lastMovementAt: null })),
    });
    const svc = new InventoryStockService(repo);
    const result = await svc.createMovement(CTX, exitDto({ quantity: 5 }), 'k2');
    expect(result.quantity).toBe(5);
    expect(repo.insertMovement).toHaveBeenCalledTimes(1);
  });

  it('compares fractional quantities at the numeric(12,3) grain', async () => {
    const repo = makeRepo({
      getBalance: jest.fn(async () => ({ balance: '0.3', totalIn: '0.3', totalOut: '0', lastMovementAt: null })),
    });
    const svc = new InventoryStockService(repo);
    // 0.1 + 0.2 !== 0.3 in floats; at the thousandths grain 0.300 covers it.
    const result = await svc.createMovement(CTX, exitDto({ quantity: 0.3 }), 'k3');
    expect(result.quantity).toBe(0.3);
  });

  it('locks the item before reading the balance (FOR UPDATE ordering)', async () => {
    const order: string[] = [];
    const repo = makeRepo({
      lockItem: jest.fn(async () => {
        order.push('lock');
        return makeItem();
      }),
      getBalance: jest.fn(async () => {
        order.push('balance');
        return { balance: '10', totalIn: '10', totalOut: '0', lastMovementAt: null };
      }),
    });
    const svc = new InventoryStockService(repo);
    await svc.createMovement(CTX, exitDto(), 'k4');
    expect(order).toEqual(['lock', 'balance']);
    expect(repo.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('404s when the item does not exist in the tenant', async () => {
    const repo = makeRepo({ lockItem: jest.fn(async () => null) });
    const svc = new InventoryStockService(repo);
    await expect(svc.createMovement(CTX, exitDto(), 'k5')).rejects.toThrow(NotFoundError);
  });
});

describe('M2 anti-double-exit QR check', () => {
  const item = makeItem({ domain: 'PRODUCT', isManufactured: true });

  it('rejects an exit whose QR was already exited — INV_QR_ALREADY_USED', async () => {
    const repo = makeRepo({
      lockItem: jest.fn(async () => item),
      latestQrEventTypes: jest.fn(async () => new Map([['QR-1', 'SAIDA']])),
    });
    const svc = new InventoryStockService(repo);
    const err = await svc
      .createMovement(CTX, exitDto({ quantity: 1, qrs: [{ qrValue: 'QR-1' }] }), 'k6')
      .catch((e) => e);
    expect(err).toBeInstanceOf(InventoryError);
    expect(err.code).toBe('INV_QR_ALREADY_USED');
    expect(err.details).toEqual({ qrValue: 'QR-1' });
    expect(repo.insertMovement).not.toHaveBeenCalled();
  });

  it('accepts a QR whose latest event brought it back in (re-entry then exit)', async () => {
    const repo = makeRepo({
      lockItem: jest.fn(async () => item),
      latestQrEventTypes: jest.fn(async () => new Map([['QR-1', 'ENTRADA']])),
    });
    const svc = new InventoryStockService(repo);
    const result = await svc.createMovement(CTX, exitDto({ quantity: 1, qrs: [{ qrValue: 'QR-1' }] }), 'k7');
    expect(result.qrs).toHaveLength(1);
  });
});
