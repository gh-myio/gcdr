/**
 * RFC-0061 M4 — FIFO consumption of the production-demand queue by an
 * assembly release (§M4): PENDENTE demands per item, created_at asc; a
 * release concludes demands it fully covers and partial-reduces the first it
 * cannot — all inside the release transaction.
 */

import {
  InventoryProductionService,
  CreateAssemblyReleaseDTO,
} from '../../../src/services/inventory/InventoryProductionService';
import { ValidationError, NotFoundError } from '../../../src/shared/errors/AppError';
import {
  CTX,
  PRODUCT_A,
  PRODUCT_B,
  PHOTO_ID,
  USER,
  makeDemand,
  makeProdRepo,
  makeStockRepo,
} from './m4-helpers';
import { makeItem } from './m2-helpers';

function releaseDto(items: Array<{ itemId: string; quantity: number }>): CreateAssemblyReleaseDTO {
  return { photoFileId: PHOTO_ID, responsibles: [USER], items } as CreateAssemblyReleaseDTO;
}

describe('M4 — FIFO demand consumption on release', () => {
  it('concludes older demands fully covered and partial-reduces the next one', async () => {
    const d1 = makeDemand({ quantity: 3, createdAt: new Date('2026-01-01T00:00:00Z') });
    const d2 = makeDemand({ quantity: 4, createdAt: new Date('2026-01-02T00:00:00Z') });
    const repo = makeProdRepo({
      lockPendingDemandsForItem: jest.fn(async () => [d1, d2]),
    });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 5 }]), 'k1');

    // 5 produced: d1 (3) concluded; d2 reduced 4 → 2, stays PENDENTE.
    expect(repo.concludeDemand).toHaveBeenCalledTimes(1);
    expect(repo.concludeDemand).toHaveBeenCalledWith(CTX.tenantId, d1.id, expect.anything());
    expect(repo.reduceDemandQuantity).toHaveBeenCalledTimes(1);
    expect(repo.reduceDemandQuantity).toHaveBeenCalledWith(CTX.tenantId, d2.id, 2, expect.anything());
    expect(result.demandSummary).toEqual({ concluded: 1, reducedPartial: 1 });
  });

  it('concludes every demand when production exactly matches the queue', async () => {
    const d1 = makeDemand({ quantity: 3 });
    const d2 = makeDemand({ quantity: 4 });
    const repo = makeProdRepo({ lockPendingDemandsForItem: jest.fn(async () => [d1, d2]) });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 7 }]), 'k2');

    expect(repo.concludeDemand).toHaveBeenCalledTimes(2);
    expect(repo.reduceDemandQuantity).not.toHaveBeenCalled();
    expect(result.demandSummary).toEqual({ concluded: 2, reducedPartial: 0 });
  });

  it('surplus production beyond the queue concludes everything and ignores the rest', async () => {
    const d1 = makeDemand({ quantity: 3 });
    const repo = makeProdRepo({ lockPendingDemandsForItem: jest.fn(async () => [d1]) });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 10 }]), 'k3');

    expect(repo.concludeDemand).toHaveBeenCalledTimes(1);
    expect(repo.reduceDemandQuantity).not.toHaveBeenCalled();
    expect(result.demandSummary).toEqual({ concluded: 1, reducedPartial: 0 });
  });

  it('an empty queue leaves the demand tables untouched', async () => {
    const repo = makeProdRepo();
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 2 }]), 'k4');

    expect(repo.concludeDemand).not.toHaveBeenCalled();
    expect(repo.reduceDemandQuantity).not.toHaveBeenCalled();
    expect(result.demandSummary).toEqual({ concluded: 0, reducedPartial: 0 });
  });

  it('consumes each product queue independently (two items in one release)', async () => {
    const dA = makeDemand({ itemId: PRODUCT_A, quantity: 2 });
    const dB = makeDemand({ itemId: PRODUCT_B, quantity: 5 });
    const lock = jest.fn(async (_t: string, itemId: string) => (itemId === PRODUCT_A ? [dA] : [dB]));
    const repo = makeProdRepo({ lockPendingDemandsForItem: lock });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.createRelease(
      CTX,
      releaseDto([
        { itemId: PRODUCT_A, quantity: 2 },
        { itemId: PRODUCT_B, quantity: 3 },
      ]),
      'k5',
    );

    expect(repo.concludeDemand).toHaveBeenCalledWith(CTX.tenantId, dA.id, expect.anything());
    expect(repo.reduceDemandQuantity).toHaveBeenCalledWith(CTX.tenantId, dB.id, 2, expect.anything());
    expect(result.demandSummary).toEqual({ concluded: 1, reducedPartial: 1 });
  });

  it('rejects a release item that is not a manufactured PRODUCT', async () => {
    const stockRepo = makeStockRepo({
      lockItem: jest.fn(async (_t: string, id: string) => makeItem({ id, domain: 'COMPONENT' })),
    });
    const service = new InventoryProductionService(makeProdRepo(), stockRepo);

    await expect(
      service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 1 }]), 'k6'),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a release for an unknown item (404)', async () => {
    const stockRepo = makeStockRepo({ lockItem: jest.fn(async () => null) });
    const service = new InventoryProductionService(makeProdRepo(), stockRepo);

    await expect(
      service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 1 }]), 'k7'),
    ).rejects.toThrow(NotFoundError);
  });
});
