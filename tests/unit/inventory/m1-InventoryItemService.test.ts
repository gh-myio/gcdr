/**
 * RFC-0061 M1 — InventoryItemService unit tests (repository mocked, no DB).
 * Covers: (tenant, domain, normalized_name) uniqueness → 409, the W4
 * is_manufactured ⇒ PRODUCT invariant → 400, BOM replace-all rules, the
 * FK-RESTRICT delete → friendly 409, and the stock read model mapping.
 *
 * The 23505/23503 errors are asserted through a DrizzleQueryError-shaped
 * wrapper: the SQLSTATE lives on `err.cause`, NOT on the wrapper (known
 * gotcha — reference_drizzle_error_cause).
 */

import { InventoryItemService } from '../../../src/services/inventory/InventoryItemService';
import type { InventoryItemRepository, InvItemRow } from '../../../src/repositories/inventory/InventoryItemRepository';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';
import type { CreateItemDTO, PutBomDTO } from '../../../src/dto/request/InventoryDTO';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const COMPONENT_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';

/** Drizzle wraps driver errors; the SQLSTATE is only on the cause chain. */
function drizzleWrapped(sqlState: string): Error {
  const cause = Object.assign(new Error('driver error'), { code: sqlState });
  const wrapper = new Error('Failed query: insert into "inv_items" ...');
  (wrapper as { cause?: unknown }).cause = cause;
  return wrapper;
}

function itemRow(overrides: Partial<InvItemRow> = {}): InvItemRow {
  return {
    id: PRODUCT_ID,
    tenantId: TENANT,
    name: 'Medidor V6',
    normalizedName: 'medidor v6',
    domain: 'PRODUCT',
    link: null,
    description: null,
    isManufactured: true,
    lossPercent: '2.50',
    lotQuantity: null,
    purchaseType: null,
    photoFileId: null,
    active: true,
    createdAt: new Date('2026-08-01T12:00:00Z'),
    createdBy: null,
    updatedAt: new Date('2026-08-01T12:00:00Z'),
    updatedBy: null,
    ...overrides,
  } as InvItemRow;
}

function buildRepo(overrides: Partial<Record<keyof InventoryItemRepository, jest.Mock>> = {}) {
  return {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByIds: jest.fn(),
    getBom: jest.fn(),
    replaceBom: jest.fn(),
    getStockByItem: jest.fn(),
    listQuery: jest.fn(),
    bomQuery: jest.fn(),
    stockByItemQuery: jest.fn(),
    ...overrides,
  } as unknown as InventoryItemRepository;
}

const createDto = (overrides: Partial<CreateItemDTO> = {}): CreateItemDTO =>
  ({ name: 'Medidor V6', domain: 'PRODUCT', isManufactured: false, lossPercent: 0, active: true, ...overrides }) as CreateItemDTO;

describe('InventoryItemService — uniqueness (tenant, domain, normalized_name)', () => {
  it('maps a wrapped 23505 on create to ConflictError 409 with a clear message', async () => {
    const repo = buildRepo({ create: jest.fn().mockRejectedValue(drizzleWrapped('23505')) });
    const service = new InventoryItemService(repo);

    const err = await service.createItem(TENANT, createDto(), USER_ID).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('Medidor V6');
    expect(err.message).toContain('PRODUCT');
  });

  it('maps a wrapped 23505 on rename (update) to ConflictError 409', async () => {
    const repo = buildRepo({
      getById: jest.fn().mockResolvedValue(itemRow()),
      update: jest.fn().mockRejectedValue(drizzleWrapped('23505')),
    });
    const service = new InventoryItemService(repo);

    const err = await service.updateItem(TENANT, PRODUCT_ID, { name: 'Duplicado' }, USER_ID).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toContain('Duplicado');
  });

  it('rethrows non-23505 errors untouched (no false conflicts)', async () => {
    const boom = drizzleWrapped('40001');
    const repo = buildRepo({ create: jest.fn().mockRejectedValue(boom) });
    const service = new InventoryItemService(repo);

    await expect(service.createItem(TENANT, createDto(), USER_ID)).rejects.toBe(boom);
  });
});

describe('InventoryItemService — W4 invariant (is_manufactured ⇒ PRODUCT)', () => {
  it('rejects create with isManufactured=true and domain != PRODUCT (400)', async () => {
    const repo = buildRepo();
    const service = new InventoryItemService(repo);

    await expect(
      service.createItem(TENANT, createDto({ domain: 'COMPONENT', isManufactured: true }), USER_ID),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects setting isManufactured=true on a non-PRODUCT item via PATCH (400)', async () => {
    const repo = buildRepo({
      getById: jest.fn().mockResolvedValue(itemRow({ domain: 'COMPONENT', isManufactured: false })),
    });
    const service = new InventoryItemService(repo);

    await expect(
      service.updateItem(TENANT, PRODUCT_ID, { isManufactured: true }, USER_ID),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('keeps a manufactured PRODUCT valid on unrelated PATCH (effective value check)', async () => {
    const repo = buildRepo({
      getById: jest.fn().mockResolvedValue(itemRow()),
      update: jest.fn().mockResolvedValue(itemRow({ description: 'ok' })),
    });
    const service = new InventoryItemService(repo);

    const result = await service.updateItem(TENANT, PRODUCT_ID, { description: 'ok' }, USER_ID);
    expect(result.description).toBe('ok');
  });
});

describe('InventoryItemService — delete', () => {
  it('maps a wrapped FK 23503 (RESTRICT from the ledger) to a friendly 409', async () => {
    const repo = buildRepo({
      getById: jest.fn().mockResolvedValue(itemRow()),
      delete: jest.fn().mockRejectedValue(drizzleWrapped('23503')),
    });
    const service = new InventoryItemService(repo);

    const err = await service.deleteItem(TENANT, PRODUCT_ID).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('movimenta');
  });

  it('404s on a missing item before attempting the delete', async () => {
    const repo = buildRepo({ getById: jest.fn().mockResolvedValue(null) });
    const service = new InventoryItemService(repo);

    await expect(service.deleteItem(TENANT, PRODUCT_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

describe('InventoryItemService — BOM (PUT replaces the whole list)', () => {
  const putDto = (components: PutBomDTO['components']): PutBomDTO => ({ components });

  it('rejects a BOM on a non-PRODUCT item (400)', async () => {
    const repo = buildRepo({ getById: jest.fn().mockResolvedValue(itemRow({ domain: 'COMPONENT', isManufactured: false })) });
    const service = new InventoryItemService(repo);

    await expect(
      service.putBom(TENANT, PRODUCT_ID, putDto([{ componentItemId: COMPONENT_ID, quantity: 2 }]), USER_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects the product referencing itself as a component (400)', async () => {
    const repo = buildRepo({ getById: jest.fn().mockResolvedValue(itemRow()) });
    const service = new InventoryItemService(repo);

    await expect(
      service.putBom(TENANT, PRODUCT_ID, putDto([{ componentItemId: PRODUCT_ID, quantity: 1 }]), USER_ID),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.replaceBom).not.toHaveBeenCalled();
  });

  it('rejects a non-positive quantity (400)', async () => {
    const repo = buildRepo({ getById: jest.fn().mockResolvedValue(itemRow()) });
    const service = new InventoryItemService(repo);

    await expect(
      service.putBom(TENANT, PRODUCT_ID, putDto([{ componentItemId: COMPONENT_ID, quantity: 0 }]), USER_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects duplicated components in the payload (400)', async () => {
    const repo = buildRepo({ getById: jest.fn().mockResolvedValue(itemRow()) });
    const service = new InventoryItemService(repo);

    await expect(
      service.putBom(
        TENANT,
        PRODUCT_ID,
        putDto([
          { componentItemId: COMPONENT_ID, quantity: 1 },
          { componentItemId: COMPONENT_ID, quantity: 2 },
        ]),
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects components that do not exist in the tenant (400 listing the ids)', async () => {
    const repo = buildRepo({
      getById: jest.fn().mockResolvedValue(itemRow()),
      findByIds: jest.fn().mockResolvedValue([]),
    });
    const service = new InventoryItemService(repo);

    const err = await service
      .putBom(TENANT, PRODUCT_ID, putDto([{ componentItemId: COMPONENT_ID, quantity: 1 }]), USER_ID)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain(COMPONENT_ID);
    expect(repo.replaceBom).not.toHaveBeenCalled();
  });

  it('replaces the whole list in one call and returns the fresh read model', async () => {
    const repo = buildRepo({
      getById: jest.fn().mockResolvedValue(itemRow()),
      findByIds: jest.fn().mockResolvedValue([itemRow({ id: COMPONENT_ID, domain: 'COMPONENT', isManufactured: false })]),
      replaceBom: jest.fn().mockResolvedValue(undefined),
      getBom: jest.fn().mockResolvedValue([
        { componentItemId: COMPONENT_ID, componentName: 'Sensor', quantity: '2.500' },
      ]),
    });
    const service = new InventoryItemService(repo);

    const result = await service.putBom(
      TENANT,
      PRODUCT_ID,
      putDto([{ componentItemId: COMPONENT_ID, quantity: 2.5 }]),
      USER_ID,
    );

    expect(repo.replaceBom).toHaveBeenCalledWith(
      TENANT,
      PRODUCT_ID,
      [{ componentItemId: COMPONENT_ID, quantity: '2.5' }],
      USER_ID,
    );
    expect(result).toEqual({
      productItemId: PRODUCT_ID,
      components: [{ componentItemId: COMPONENT_ID, componentName: 'Sensor', quantity: 2.5 }],
    });
  });

  it('accepts an empty list (clears the BOM) without touching findByIds', async () => {
    const repo = buildRepo({
      getById: jest.fn().mockResolvedValue(itemRow()),
      findByIds: jest.fn().mockResolvedValue([]),
      replaceBom: jest.fn().mockResolvedValue(undefined),
      getBom: jest.fn().mockResolvedValue([]),
    });
    const service = new InventoryItemService(repo);

    const result = await service.putBom(TENANT, PRODUCT_ID, putDto([]), USER_ID);
    expect(repo.replaceBom).toHaveBeenCalledWith(TENANT, PRODUCT_ID, [], USER_ID);
    expect(result.components).toEqual([]);
  });
});

describe('InventoryItemService — stock read model & list pagination', () => {
  it('maps aggregated ledger rows to the InvStockBalanceResponse shape', async () => {
    const repo = buildRepo({
      getById: jest.fn().mockResolvedValue(itemRow()),
      getStockByItem: jest.fn().mockResolvedValue([
        {
          location: 'FABRICA',
          totalIn: '10.000',
          totalOut: '3.000',
          balance: '7.000',
          lastMovementAt: new Date('2026-08-20T10:00:00Z'),
        },
      ]),
    });
    const service = new InventoryItemService(repo);

    const rows = await service.getItemStock(TENANT, PRODUCT_ID);
    expect(rows).toEqual([
      {
        itemId: PRODUCT_ID,
        itemName: 'Medidor V6',
        domain: 'PRODUCT',
        location: 'FABRICA',
        balance: 7,
        totalIn: 10,
        totalOut: 3,
        lastMovementAt: '2026-08-20T10:00:00.000Z',
      },
    ]);
  });

  it('404s the stock read for a missing item', async () => {
    const repo = buildRepo({ getById: jest.fn().mockResolvedValue(null) });
    const service = new InventoryItemService(repo);

    await expect(service.getItemStock(TENANT, PRODUCT_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('computes total/totalPages for the list envelope', async () => {
    const repo = buildRepo({
      list: jest.fn().mockResolvedValue({ items: [itemRow()], total: 41 }),
    });
    const service = new InventoryItemService(repo);

    const result = await service.listItems(TENANT, { page: 1, pageSize: 20 });
    expect(result.total).toBe(41);
    expect(result.totalPages).toBe(3);
    expect(result.items[0]).toMatchObject({ id: PRODUCT_ID, lossPercent: 2.5 });
  });
});
