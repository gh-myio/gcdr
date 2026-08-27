/**
 * RFC-0061 M4 — capacity (min over components of floor(balance / (bom.qty ×
 * loss factor)), limiting components flagged, "sem regras" for products
 * without BOM) and the simulator preview (DEC-13: preview-only — NEVER
 * writes; required = ceil to 3 decimals with the loss factor).
 */

import { InventoryProductionService } from '../../../src/services/inventory/InventoryProductionService';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';
import { makeItem } from './m2-helpers';
import {
  TENANT,
  PRODUCT_A,
  PRODUCT_B,
  COMPONENT_1,
  COMPONENT_2,
  makeBomRow,
  makeProdRepo,
  makeStockRepo,
} from './m4-helpers';

describe('M4 — production capacity', () => {
  it('possible = min over components; the limiting component(s) are flagged', async () => {
    const repo = makeProdRepo({
      listManufacturedProducts: jest.fn(async () => ({
        rows: [{ id: PRODUCT_A, name: 'Produto A' }],
        total: 1,
      })),
      getBomsForProducts: jest.fn(async () => [
        makeBomRow(PRODUCT_A, COMPONENT_1, '2', '0'), // bal 10 / 2 = 5
        makeBomRow(PRODUCT_A, COMPONENT_2, '1', '100'), // bal 8 / (1×2) = 4 ← limiting
      ]),
      componentBalances: jest.fn(async () => [
        { itemId: COMPONENT_1, balance: '10' },
        { itemId: COMPONENT_2, balance: '8' },
      ]),
    });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.getCapacity(TENANT, 1, 20);

    expect(result.total).toBe(1);
    const row = result.items[0];
    expect(row.hasBom).toBe(true);
    expect(row.possible).toBe(4);
    const c1 = row.components.find((c) => c.componentItemId === COMPONENT_1);
    const c2 = row.components.find((c) => c.componentItemId === COMPONENT_2);
    expect(c1).toMatchObject({ possible: 5, limiting: false, requiredPerUnit: 2 });
    expect(c2).toMatchObject({ possible: 4, limiting: true, requiredPerUnit: 2 });
  });

  it('floors fractional capacity (balance 9, perUnit 2 → 4)', async () => {
    const repo = makeProdRepo({
      listManufacturedProducts: jest.fn(async () => ({
        rows: [{ id: PRODUCT_A, name: 'Produto A' }],
        total: 1,
      })),
      getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '2', '0')]),
      componentBalances: jest.fn(async () => [{ itemId: COMPONENT_1, balance: '9' }]),
    });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.getCapacity(TENANT, 1, 20);
    expect(result.items[0].possible).toBe(4);
  });

  it('a product without BOM comes back as "sem regras" (hasBom false, possible null)', async () => {
    const repo = makeProdRepo({
      listManufacturedProducts: jest.fn(async () => ({
        rows: [
          { id: PRODUCT_A, name: 'Produto A' },
          { id: PRODUCT_B, name: 'Produto B' },
        ],
        total: 2,
      })),
      getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '1', '0')]),
      componentBalances: jest.fn(async () => [{ itemId: COMPONENT_1, balance: '3' }]),
    });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.getCapacity(TENANT, 1, 20);

    const b = result.items.find((r) => r.itemId === PRODUCT_B);
    expect(b).toMatchObject({ hasBom: false, possible: null, components: [] });
    const a = result.items.find((r) => r.itemId === PRODUCT_A);
    expect(a).toMatchObject({ hasBom: true, possible: 3 });
  });

  it('a component with no movements counts as balance 0 → possible 0', async () => {
    const repo = makeProdRepo({
      listManufacturedProducts: jest.fn(async () => ({
        rows: [{ id: PRODUCT_A, name: 'Produto A' }],
        total: 1,
      })),
      getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '1', '0')]),
      componentBalances: jest.fn(async () => []),
    });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.getCapacity(TENANT, 1, 20);
    expect(result.items[0].possible).toBe(0);
    expect(result.items[0].components[0].limiting).toBe(true);
  });
});

describe('M4 — simulator preview (DEC-13: preview-only)', () => {
  const catalog = [
    makeItem({ id: PRODUCT_A, name: 'Produto A', domain: 'PRODUCT', isManufactured: true }),
    makeItem({ id: PRODUCT_B, name: 'Produto B', domain: 'PRODUCT', isManufactured: true }),
  ];

  it('computes required with the loss factor, ceil to 3 decimals, vs balance', async () => {
    const repo = makeProdRepo({
      findItemsByIds: jest.fn(async () => catalog),
      getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '0.333', '10')]),
      componentBalances: jest.fn(async () => [{ itemId: COMPONENT_1, balance: '1' }]),
    });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.previewSimulation(TENANT, {
      items: [{ itemId: PRODUCT_A, quantity: 3 }],
    });

    // 0.333 × 3 × 1.10 = 1.0989 → ceil3 = 1.099; balance 1 → missing 0.099.
    expect(result.components).toEqual([
      expect.objectContaining({
        componentItemId: COMPONENT_1,
        required: 1.099,
        balance: 1,
        missing: 0.099,
        sufficient: false,
      }),
    ]);
    expect(result.feasible).toBe(false);
    expect(result.location).toBe('FABRICA');
  });

  it('is feasible when every component is covered; products without BOM are flagged', async () => {
    const repo = makeProdRepo({
      findItemsByIds: jest.fn(async () => catalog),
      getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '2', '0')]),
      componentBalances: jest.fn(async () => [{ itemId: COMPONENT_1, balance: '100' }]),
    });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.previewSimulation(TENANT, {
      items: [
        { itemId: PRODUCT_A, quantity: 5 },
        { itemId: PRODUCT_B, quantity: 1 },
      ],
    });

    expect(result.components).toEqual([
      expect.objectContaining({ componentItemId: COMPONENT_1, required: 10, missing: 0, sufficient: true }),
    ]);
    expect(result.feasible).toBe(true);
    expect(result.products).toEqual([
      expect.objectContaining({ itemId: PRODUCT_A, hasBom: true }),
      expect.objectContaining({ itemId: PRODUCT_B, hasBom: false }),
    ]);
  });

  it('NEVER writes: no movements, releases or demand updates on preview', async () => {
    const repo = makeProdRepo({
      findItemsByIds: jest.fn(async () => catalog),
      getBomsForProducts: jest.fn(async () => [makeBomRow(PRODUCT_A, COMPONENT_1, '1', '0')]),
      componentBalances: jest.fn(async () => [{ itemId: COMPONENT_1, balance: '0' }]),
    });
    const stockRepo = makeStockRepo();
    const service = new InventoryProductionService(repo, stockRepo);

    await service.previewSimulation(TENANT, { items: [{ itemId: PRODUCT_A, quantity: 100 }] });

    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
    expect(stockRepo.lockItem).not.toHaveBeenCalled();
    expect(repo.insertRelease).not.toHaveBeenCalled();
    expect(repo.insertReleaseItems).not.toHaveBeenCalled();
    expect(repo.concludeDemand).not.toHaveBeenCalled();
    expect(repo.reduceDemandQuantity).not.toHaveBeenCalled();
    expect(repo.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects unknown or non-manufactured items', async () => {
    const service = new InventoryProductionService(
      makeProdRepo({ findItemsByIds: jest.fn(async () => []) }),
      makeStockRepo(),
    );
    await expect(
      service.previewSimulation(TENANT, { items: [{ itemId: PRODUCT_A, quantity: 1 }] }),
    ).rejects.toThrow(NotFoundError);

    const service2 = new InventoryProductionService(
      makeProdRepo({
        findItemsByIds: jest.fn(async () => [makeItem({ id: PRODUCT_A, domain: 'COMPONENT' })]),
      }),
      makeStockRepo(),
    );
    await expect(
      service2.previewSimulation(TENANT, { items: [{ itemId: PRODUCT_A, quantity: 1 }] }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('M4 — fila de produção read model', () => {
  it('maps grouped demand rows with the ALMOXARIFADO balance as a number', async () => {
    const repo = makeProdRepo({
      listPendingDemandsGrouped: jest.fn(async () => ({
        rows: [
          {
            itemId: PRODUCT_A,
            itemName: 'Produto A',
            totalQuantity: 7,
            demandCount: 3,
            oldestCreatedAt: new Date('2026-01-05T00:00:00Z'),
            almoxarifadoBalance: '2.5',
          },
        ],
        total: 1,
      })),
    });
    const service = new InventoryProductionService(repo, makeStockRepo());

    const result = await service.listDemands(TENANT, 1, 20);

    expect(result.items[0]).toEqual({
      itemId: PRODUCT_A,
      itemName: 'Produto A',
      totalQuantity: 7,
      demandCount: 3,
      oldestCreatedAt: '2026-01-05T00:00:00.000Z',
      almoxarifadoBalance: 2.5,
    });
    expect(result.totalPages).toBe(1);
  });
});
