/**
 * RFC-0061 M4 — release correction (§M4 "Divergências"): edits released
 * quantities with a FLOOR at already-homologated units per item; positive
 * delta → component SAIDA, negative → ENTRADA (reason "Correção de liberação
 * de montagem", loss factor applied); resolves the release's open issues.
 */

import {
  InventoryProductionService,
  REASON_ASSEMBLY_CORRECTION,
  COMPONENT_LOCATION,
} from '../../../src/services/inventory/InventoryProductionService';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';
import {
  CTX,
  PRODUCT_A,
  COMPONENT_1,
  USER,
  RELEASE_ID,
  makeBomRow,
  makeRelease,
  makeProdRepo,
  makeStockRepo,
} from './m4-helpers';

const RELEASE_ITEM_ID = '77777777-0000-4000-8000-000000000001';

function repoWithRelease(overrides: Record<string, jest.Mock> = {}) {
  return makeProdRepo({
    getReleaseById: jest.fn(async () => ({
      release: makeRelease(),
      items: [{ id: RELEASE_ITEM_ID, itemId: PRODUCT_A, itemName: 'Produto A', quantity: 10 }],
    })),
    getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '2', '10')]),
    homologatedCountsByItem: jest.fn(async () => [{ itemId: PRODUCT_A, homologatedCount: 4 }]),
    resolveOpenIssues: jest.fn(async () => 2),
    ...overrides,
  });
}

describe('M4 — release correction', () => {
  it('positive delta consumes extra components via SAIDA with the loss factor', async () => {
    const repo = repoWithRelease();
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    const result = await service.correctRelease(CTX, RELEASE_ID, {
      items: [{ releaseItemId: RELEASE_ITEM_ID, quantity: 12 }],
    });

    // delta +2 → 2 × 2 × 1.10 = 4.4 SAIDA.
    expect(repo.updateReleaseItemQuantity).toHaveBeenCalledWith(
      CTX.tenantId,
      RELEASE_ITEM_ID,
      12,
      expect.anything(),
    );
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: COMPONENT_1,
        quantity: '4.4',
        type: 'SAIDA',
        location: COMPONENT_LOCATION,
        reason: REASON_ASSEMBLY_CORRECTION,
      }),
      expect.anything(),
    );
    expect(result.adjustments).toEqual([
      expect.objectContaining({ componentItemId: COMPONENT_1, movementType: 'SAIDA', quantity: 4.4 }),
    ]);
    expect(result.resolvedIssues).toBe(2);
  });

  it('negative delta returns components via ENTRADA with the loss factor', async () => {
    const repo = repoWithRelease();
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    const result = await service.correctRelease(CTX, RELEASE_ID, {
      items: [{ releaseItemId: RELEASE_ITEM_ID, quantity: 6 }],
    });

    // delta −4 → 4 × 2 × 1.10 = 8.8 back in as ENTRADA.
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: COMPONENT_1,
        quantity: '8.8',
        type: 'ENTRADA',
        reason: REASON_ASSEMBLY_CORRECTION,
      }),
      expect.anything(),
    );
    expect(result.adjustments).toEqual([
      expect.objectContaining({ componentItemId: COMPONENT_1, movementType: 'ENTRADA', quantity: 8.8 }),
    ]);
  });

  it('rejects a quantity below the homologated floor (409, nothing written)', async () => {
    const repo = repoWithRelease();
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    // floor = 4 homologated units; 3 < 4 → conflict.
    await expect(
      service.correctRelease(CTX, RELEASE_ID, {
        items: [{ releaseItemId: RELEASE_ITEM_ID, quantity: 3 }],
      }),
    ).rejects.toThrow(ConflictError);
    expect(repo.updateReleaseItemQuantity).not.toHaveBeenCalled();
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
    expect(repo.resolveOpenIssues).not.toHaveBeenCalled();
  });

  it('accepts a quantity exactly at the homologated floor', async () => {
    const repo = repoWithRelease();
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    const result = await service.correctRelease(CTX, RELEASE_ID, {
      items: [{ releaseItemId: RELEASE_ITEM_ID, quantity: 4 }],
    });

    // delta −6 → ENTRADA 6 × 2 × 1.10 = 13.2.
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: '13.2', type: 'ENTRADA' }),
      expect.anything(),
    );
    expect(result.resolvedIssues).toBe(2);
  });

  it('an unchanged quantity writes no movement but still resolves open issues', async () => {
    const repo = repoWithRelease();
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    const result = await service.correctRelease(CTX, RELEASE_ID, {
      items: [{ releaseItemId: RELEASE_ITEM_ID, quantity: 10 }],
    });

    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
    expect(repo.updateReleaseItemQuantity).not.toHaveBeenCalled();
    expect(result.adjustments).toEqual([]);
    expect(result.resolvedIssues).toBe(2);
  });

  it('rejects a releaseItemId that does not belong to the release', async () => {
    const service = new InventoryProductionService(repoWithRelease(), makeStockRepo());
    await expect(
      service.correctRelease(CTX, RELEASE_ID, {
        items: [{ releaseItemId: '99999999-9999-4999-8999-999999999999', quantity: 5 }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('404s for an unknown release', async () => {
    const service = new InventoryProductionService(
      makeProdRepo({ getReleaseById: jest.fn(async () => null) }),
      makeStockRepo(),
    );
    await expect(
      service.correctRelease(CTX, RELEASE_ID, {
        items: [{ releaseItemId: RELEASE_ITEM_ID, quantity: 5 }],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('passes the resolution note and the caller to resolveOpenIssues', async () => {
    const repo = repoWithRelease();
    const service = new InventoryProductionService(repo, makeStockRepo());

    await service.correctRelease(CTX, RELEASE_ID, {
      items: [{ releaseItemId: RELEASE_ITEM_ID, quantity: 11 }],
      resolutionNote: 'ajuste combinado com o estoque',
    });

    expect(repo.resolveOpenIssues).toHaveBeenCalledWith(
      CTX.tenantId,
      RELEASE_ID,
      USER,
      'ajuste combinado com o estoque',
      expect.anything(),
    );
  });

  it('correction SAIDA still respects the negative-stock guard', async () => {
    const stockRepo = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '1', totalIn: '1', totalOut: '0', lastMovementAt: null })),
    });
    const service = new InventoryProductionService(repoWithRelease(), stockRepo);

    await expect(
      service.correctRelease(CTX, RELEASE_ID, {
        items: [{ releaseItemId: RELEASE_ITEM_ID, quantity: 12 }],
      }),
    ).rejects.toMatchObject({ code: 'INV_INSUFFICIENT_STOCK' });
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
  });
});

describe('M4 — release delete', () => {
  it('deletes and reports { deleted: true } (movements NOT reversed — source parity)', async () => {
    const repo = makeProdRepo();
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    const result = await service.deleteRelease(CTX, RELEASE_ID);

    expect(result).toEqual({ deleted: true });
    expect(repo.deleteRelease).toHaveBeenCalledWith(CTX.tenantId, RELEASE_ID);
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
  });

  it('404s when the release does not exist', async () => {
    const service = new InventoryProductionService(
      makeProdRepo({ deleteRelease: jest.fn(async () => false) }),
      makeStockRepo(),
    );
    await expect(service.deleteRelease(CTX, RELEASE_ID)).rejects.toThrow(NotFoundError);
  });
});
