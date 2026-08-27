/**
 * RFC-0061 M2 — transfers: two legs (OUT with the guard + IN) inside ONE
 * repository transaction, sharing a transfer_group_id (mocked repo — no DB).
 */

import { InventoryStockService } from '../../../src/services/inventory/InventoryStockService';
import type { CreateTransferDTO } from '../../../src/dto/request/InventoryDTO';
import { InventoryError } from '../../../src/shared/errors/InventoryError';
import type { NewMovementInput } from '../../../src/repositories/inventory/InventoryStockRepository';
import { CTX, ITEM_ID, makeRepo, movementRowFrom } from './m2-helpers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function transferDto(overrides: Partial<CreateTransferDTO> = {}): CreateTransferDTO {
  return {
    itemId: ITEM_ID,
    fromLocation: 'FABRICA',
    toLocation: 'ALMOXARIFADO',
    quantity: 4,
    ...overrides,
  } as CreateTransferDTO;
}

describe('M2 transfers', () => {
  it('creates OUT + IN legs in the same transaction with a shared transferGroupId', async () => {
    const repo = makeRepo();
    const svc = new InventoryStockService(repo);

    const result = await svc.createTransfer(CTX, transferDto(), 'tk1');

    expect(repo.withTransaction).toHaveBeenCalledTimes(1);
    expect(repo.insertMovement).toHaveBeenCalledTimes(2);

    const inputs = repo.insertMovement.mock.calls.map((c) => c[0] as NewMovementInput);
    const out = inputs.find((i) => i.type === 'TRANSFERENCIA_OUT');
    const inn = inputs.find((i) => i.type === 'TRANSFERENCIA_IN');
    expect(out).toMatchObject({ location: 'FABRICA', quantity: '4', transferGroupId: result.transferGroupId });
    expect(inn).toMatchObject({ location: 'ALMOXARIFADO', quantity: '4', transferGroupId: result.transferGroupId });

    expect(result.transferGroupId).toMatch(UUID_RE);
    expect(result.out.type).toBe('TRANSFERENCIA_OUT');
    expect(result.in.type).toBe('TRANSFERENCIA_IN');
    expect(result.out.transferGroupId).toBe(result.in.transferGroupId);
  });

  it('guards the OUT leg against negative stock and inserts NOTHING on failure', async () => {
    const repo = makeRepo({
      getBalance: jest.fn(async () => ({ balance: '2', totalIn: '2', totalOut: '0', lastMovementAt: null })),
    });
    const svc = new InventoryStockService(repo);

    const err = await svc.createTransfer(CTX, transferDto({ quantity: 4 }), 'tk2').catch((e) => e);
    expect(err).toBeInstanceOf(InventoryError);
    expect(err.code).toBe('INV_INSUFFICIENT_STOCK');
    expect(err.details).toMatchObject({ location: 'FABRICA', balance: 2, requested: 4 });
    expect(repo.insertMovement).not.toHaveBeenCalled();
  });

  it('reads the balance at the FROM location', async () => {
    const repo = makeRepo();
    const svc = new InventoryStockService(repo);
    await svc.createTransfer(CTX, transferDto(), 'tk3');
    expect(repo.getBalance).toHaveBeenCalledWith(CTX.tenantId, ITEM_ID, 'FABRICA', expect.anything());
  });

  it('bubbles a mid-transfer insert failure (atomicity: tx rolls back both legs)', async () => {
    const repo = makeRepo();
    repo.insertMovement
      .mockImplementationOnce(async (input) => movementRowFrom(input as NewMovementInput))
      .mockImplementationOnce(async () => {
        throw new Error('boom on IN leg');
      });
    const svc = new InventoryStockService(repo);

    await expect(svc.createTransfer(CTX, transferDto(), 'tk4')).rejects.toThrow('boom on IN leg');
    // Both inserts were attempted inside ONE withTransaction call — the real
    // Drizzle transaction rolls back the successful OUT leg with the failure.
    expect(repo.withTransaction).toHaveBeenCalledTimes(1);
    expect(repo.insertMovement).toHaveBeenCalledTimes(2);
  });
});
