/**
 * RFC-0061 M4 — BOM explosion on assembly release (§M4): component SAIDA of
 * Σ bom.quantity × produced × (1 + loss_percent/100), rounded to 3 decimals
 * AFTER summing across the release's products, reason "Consumo de montagem",
 * from FABRICA, under the M2 negative-stock guard — inside the release tx.
 */

import {
  InventoryProductionService,
  CreateAssemblyReleaseDTO,
  REASON_ASSEMBLY_CONSUMPTION,
  COMPONENT_LOCATION,
  round3,
  ceil3,
} from '../../../src/services/inventory/InventoryProductionService';
import { InventoryError } from '../../../src/shared/errors/InventoryError';
import {
  CTX,
  PRODUCT_A,
  PRODUCT_B,
  COMPONENT_1,
  COMPONENT_2,
  PHOTO_ID,
  USER,
  makeBomRow,
  makeProdRepo,
  makeStockRepo,
} from './m4-helpers';

function releaseDto(items: Array<{ itemId: string; quantity: number }>): CreateAssemblyReleaseDTO {
  return { photoFileId: PHOTO_ID, responsibles: [USER], items } as CreateAssemblyReleaseDTO;
}

describe('M4 — BOM explosion with loss factor and 3-decimal rounding', () => {
  it('writes one SAIDA per component: qty × produced × (1 + loss/100)', async () => {
    const repo = makeProdRepo({
      getBomsForProducts: jest.fn(async () => [
        makeBomRow(PRODUCT_A, COMPONENT_1, '2', '10'), // 2 × 10 × 1.10 = 22
        makeBomRow(PRODUCT_A, COMPONENT_2, '0.333', '0'), // 0.333 × 10 = 3.33
      ]),
    });
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    const result = await service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 10 }]), 'b1');

    expect(stockRepo.insertMovement).toHaveBeenCalledTimes(2);
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: COMPONENT_1,
        quantity: '22',
        type: 'SAIDA',
        location: COMPONENT_LOCATION,
        reason: REASON_ASSEMBLY_CONSUMPTION,
        photoFileId: PHOTO_ID,
        createdBy: USER,
      }),
      expect.anything(),
    );
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: COMPONENT_2, quantity: '3.33', type: 'SAIDA' }),
      expect.anything(),
    );
    expect(result.consumedComponents).toEqual([
      expect.objectContaining({ componentItemId: COMPONENT_1, quantity: 22, location: 'FABRICA' }),
      expect.objectContaining({ componentItemId: COMPONENT_2, quantity: 3.33 }),
    ]);
  });

  it('rounds the summed consumption to 3 decimals (0.001 × 3 × 1.15 → 0.003)', async () => {
    const repo = makeProdRepo({
      getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '0.001', '15')]),
    });
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    await service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 3 }]), 'b2');

    // 0.001 × 3 × 1.15 = 0.00345 → 0.003 at the ledger's 3-decimal grain.
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: COMPONENT_1, quantity: '0.003' }),
      expect.anything(),
    );
  });

  it('aggregates a component shared by two products into ONE movement (sum, then round)', async () => {
    const repo = makeProdRepo({
      getBomsForProducts: jest.fn(async () => [
        makeBomRow(PRODUCT_A, COMPONENT_1, '2', '0'),
        makeBomRow(PRODUCT_B, COMPONENT_1, '0.5', '0'),
      ]),
    });
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    await service.createRelease(
      CTX,
      releaseDto([
        { itemId: PRODUCT_A, quantity: 1 },
        { itemId: PRODUCT_B, quantity: 1 },
      ]),
      'b3',
    );

    expect(stockRepo.insertMovement).toHaveBeenCalledTimes(1);
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: COMPONENT_1, quantity: '2.5' }),
      expect.anything(),
    );
  });

  it('fails the WHOLE release when a component lacks stock (INV_INSUFFICIENT_STOCK inside the tx)', async () => {
    const repo = makeProdRepo({
      getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '2', '0')]),
    });
    const stockRepo = makeStockRepo({
      getBalance: jest.fn(async () => ({ balance: '3', totalIn: '3', totalOut: '0', lastMovementAt: null })),
    });
    const service = new InventoryProductionService(repo, stockRepo);

    // needs 2 × 5 = 10 > balance 3 → guard fires, tx aborts, no movement.
    await expect(
      service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 5 }]), 'b4'),
    ).rejects.toMatchObject({ code: 'INV_INSUFFICIENT_STOCK' } as Partial<InventoryError>);
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
  });

  it('a product without BOM releases fine with zero component consumption', async () => {
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(makeProdRepo(), stockRepo);

    const result = await service.createRelease(CTX, releaseDto([{ itemId: PRODUCT_A, quantity: 4 }]), 'b5');

    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
    expect(result.consumedComponents).toEqual([]);
  });

  it('replays the original result for a repeated Idempotency-Key (no double consumption)', async () => {
    const repo = makeProdRepo({
      getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '1', '0')]),
    });
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);
    const dto = releaseDto([{ itemId: PRODUCT_A, quantity: 1 }]);

    const first = await service.createRelease(CTX, dto, 'same-key');
    const second = await service.createRelease(CTX, dto, 'same-key');

    expect(second).toBe(first);
    expect(stockRepo.insertMovement).toHaveBeenCalledTimes(1);
    expect(repo.insertRelease).toHaveBeenCalledTimes(1);
  });
});

describe('M4 — numeric helpers', () => {
  it('round3 rounds half-up at the 3rd decimal and kills FP noise', () => {
    expect(round3(0.0035)).toBe(0.004);
    expect(round3(0.00345)).toBe(0.003);
    expect(round3(0.1 * 3)).toBe(0.3); // 0.30000000000000004 → 0.3
  });

  it('ceil3 always rounds up at the 3rd decimal (but not on exact values)', () => {
    expect(ceil3(1.0001)).toBe(1.001);
    expect(ceil3(2.5)).toBe(2.5);
    expect(ceil3(0.1 + 0.2)).toBe(0.3); // FP noise must not bump the ceil
  });
});
