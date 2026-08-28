/**
 * RFC-0061 M2 — Idempotency-Key replay (S1/AC-9), best-effort per-process
 * cache (the schema has no durable idempotency storage yet — PR Follow-up).
 */

import { InventoryStockService } from '../../../src/services/inventory/InventoryStockService';
import type { CreateMovementDTO } from '../../../src/dto/request/InventoryDTO';
import { CTX, ITEM_ID, makeRepo } from './m2-helpers';

function entradaDto(): CreateMovementDTO {
  return { itemId: ITEM_ID, location: 'FABRICA', quantity: 3, type: 'ENTRADA' } as CreateMovementDTO;
}

describe('M2 idempotency replay', () => {
  it('replaying the same Idempotency-Key returns the original result and creates nothing', async () => {
    const repo = makeRepo();
    const svc = new InventoryStockService(repo);

    const first = await svc.createMovement(CTX, entradaDto(), 'same-key');
    const replay = await svc.createMovement(CTX, entradaDto(), 'same-key');

    expect(replay).toEqual(first);
    expect(replay.id).toBe(first.id);
    expect(repo.insertMovement).toHaveBeenCalledTimes(1);
    expect(repo.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('different keys create distinct movements', async () => {
    const repo = makeRepo();
    const svc = new InventoryStockService(repo);
    const a = await svc.createMovement(CTX, entradaDto(), 'key-a');
    const b = await svc.createMovement(CTX, entradaDto(), 'key-b');
    expect(a.id).not.toBe(b.id);
    expect(repo.insertMovement).toHaveBeenCalledTimes(2);
  });

  it('keys are scoped per tenant', async () => {
    const repo = makeRepo();
    const svc = new InventoryStockService(repo);
    await svc.createMovement(CTX, entradaDto(), 'shared-key');
    await svc.createMovement(
      { tenantId: '99999999-9999-9999-9999-999999999999', userId: CTX.userId },
      entradaDto(),
      'shared-key',
    );
    expect(repo.insertMovement).toHaveBeenCalledTimes(2);
  });

  it('movement and transfer keys do not collide', async () => {
    const repo = makeRepo();
    const svc = new InventoryStockService(repo);
    await svc.createMovement(CTX, entradaDto(), 'k');
    await svc.createTransfer(
      CTX,
      { itemId: ITEM_ID, fromLocation: 'FABRICA', toLocation: 'ALMOXARIFADO', quantity: 1 } as never,
      'k',
    );
    // 1 movement + 2 transfer legs — the transfer was NOT swallowed as a replay.
    expect(repo.insertMovement).toHaveBeenCalledTimes(3);
  });

  it('a failed attempt does not poison the key (retry after failure re-executes)', async () => {
    const repo = makeRepo();
    repo.insertMovement.mockRejectedValueOnce(new Error('transient'));
    const svc = new InventoryStockService(repo);

    await expect(svc.createMovement(CTX, entradaDto(), 'retry-key')).rejects.toThrow('transient');
    // Let the microtask that evicts the failed entry run.
    await new Promise((r) => setImmediate(r));

    const retry = await svc.createMovement(CTX, entradaDto(), 'retry-key');
    expect(retry.type).toBe('ENTRADA');
    expect(repo.insertMovement).toHaveBeenCalledTimes(2);
  });

  it('two concurrent requests with the same key share ONE execution', async () => {
    const repo = makeRepo();
    const svc = new InventoryStockService(repo);
    const [a, b] = await Promise.all([
      svc.createMovement(CTX, entradaDto(), 'race-key'),
      svc.createMovement(CTX, entradaDto(), 'race-key'),
    ]);
    expect(a.id).toBe(b.id);
    expect(repo.insertMovement).toHaveBeenCalledTimes(1);
  });
});
