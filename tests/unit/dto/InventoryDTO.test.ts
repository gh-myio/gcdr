import {
  CreateItemSchema,
  UpdateItemSchema,
  ItemListQuerySchema,
  PutBomSchema,
  StockBalancesQuerySchema,
  CreateMovementSchema,
  CreateTransferSchema,
  StockResetSchema,
  CreatePurchaseOrderSchema,
  PurchaseOrderStatusSchema,
  CreateProjectSchema,
  QrValidateSchema,
  PaginationQuerySchema,
} from '../../../src/dto/request/InventoryDTO';

// RFC-0061 — request DTO contract guard (valid / invalid / boundary cases).

const UUID = '11111111-1111-1111-1111-111111111111';
const UUID2 = '22222222-2222-2222-2222-222222222222';

describe('CreateItemSchema (M1)', () => {
  it('accepts a minimal valid PRODUCT', () => {
    const r = CreateItemSchema.parse({ name: 'Medidor 3F', domain: 'PRODUCT' });
    expect(r.name).toBe('Medidor 3F');
    expect(r.active).toBe(true);          // default applied
    expect(r.lossPercent).toBe(0);        // default applied
  });

  it('rejects an unknown domain', () => {
    expect(() => CreateItemSchema.parse({ name: 'x', domain: 'WIDGET' })).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => CreateItemSchema.parse({ name: 'x', domain: 'TOOL', foo: 1 })).toThrow();
  });

  it('enforces W4 invariant: isManufactured requires PRODUCT', () => {
    expect(() => CreateItemSchema.parse({ name: 'x', domain: 'COMPONENT', isManufactured: true })).toThrow();
    expect(CreateItemSchema.parse({ name: 'x', domain: 'PRODUCT', isManufactured: true }).isManufactured).toBe(true);
  });

  it('bounds lossPercent to 0..100', () => {
    expect(() => CreateItemSchema.parse({ name: 'x', domain: 'PRODUCT', lossPercent: 101 })).toThrow();
    expect(() => CreateItemSchema.parse({ name: 'x', domain: 'PRODUCT', lossPercent: -1 })).toThrow();
  });

  it('requires a non-empty name', () => {
    expect(() => CreateItemSchema.parse({ name: '', domain: 'PRODUCT' })).toThrow();
  });
});

describe('UpdateItemSchema (M1)', () => {
  it('accepts a partial patch', () => {
    expect(UpdateItemSchema.parse({ active: false }).active).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(() => UpdateItemSchema.parse({ nope: 1 })).toThrow();
  });
});

describe('ItemListQuerySchema (M1)', () => {
  it('coerces pagination and filters', () => {
    const r = ItemListQuerySchema.parse({ page: '2', pageSize: '50', domain: 'TOOL', active: 'true' });
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(50);
    expect(r.active).toBe(true);
  });
  it('defaults page/pageSize', () => {
    const r = ItemListQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });
  it('caps pageSize at 200', () => {
    expect(() => ItemListQuerySchema.parse({ pageSize: '201' })).toThrow();
  });
});

describe('PutBomSchema (M1)', () => {
  it('accepts components with 3-decimal quantities', () => {
    const r = PutBomSchema.parse({ components: [{ componentItemId: UUID, quantity: 1.5 }] });
    expect(r.components).toHaveLength(1);
  });
  it('rejects zero/negative quantity', () => {
    expect(() => PutBomSchema.parse({ components: [{ componentItemId: UUID, quantity: 0 }] })).toThrow();
  });
  it('rejects more than 3 decimals', () => {
    expect(() => PutBomSchema.parse({ components: [{ componentItemId: UUID, quantity: 1.2345 }] })).toThrow();
  });
});

describe('Stock schemas (M2)', () => {
  it('StockBalancesQuerySchema accepts location+domain', () => {
    expect(StockBalancesQuerySchema.parse({ location: 'ALMOXARIFADO', domain: 'PRODUCT' }).location).toBe('ALMOXARIFADO');
  });
  it('StockBalancesQuerySchema rejects a bad location', () => {
    expect(() => StockBalancesQuerySchema.parse({ location: 'GARAGE' })).toThrow();
  });

  it('CreateMovementSchema accepts a valid ENTRADA', () => {
    const r = CreateMovementSchema.parse({ itemId: UUID, location: 'FABRICA', quantity: 10, type: 'ENTRADA' });
    expect(r.type).toBe('ENTRADA');
  });
  it('CreateMovementSchema rejects transfer legs (use /stock/transfers)', () => {
    expect(() => CreateMovementSchema.parse({ itemId: UUID, location: 'FABRICA', quantity: 1, type: 'TRANSFERENCIA_IN' })).toThrow();
  });
  it('CreateMovementSchema rejects non-positive quantity', () => {
    expect(() => CreateMovementSchema.parse({ itemId: UUID, location: 'FABRICA', quantity: 0, type: 'ENTRADA' })).toThrow();
  });

  it('CreateTransferSchema requires distinct locations', () => {
    expect(() => CreateTransferSchema.parse({ itemId: UUID, fromLocation: 'FABRICA', toLocation: 'FABRICA', quantity: 1 })).toThrow();
    expect(CreateTransferSchema.parse({ itemId: UUID, fromLocation: 'FABRICA', toLocation: 'ALMOXARIFADO', quantity: 1 }).quantity).toBe(1);
  });

  it('StockResetSchema requires a confirmation token', () => {
    expect(() => StockResetSchema.parse({})).toThrow();
    expect(StockResetSchema.parse({ confirmationToken: 'zerar' }).confirmationToken).toBe('zerar');
  });
});

describe('Purchase-order schemas (M3)', () => {
  it('accepts a valid order', () => {
    const r = CreatePurchaseOrderSchema.parse({ projectId: UUID, itemId: UUID2, quantity: 5, deadlineType: 'ESTA_SEMANA' });
    expect(r.quantity).toBe(5);
  });
  it('requires deadlineDate when CUSTOMIZADO', () => {
    expect(() => CreatePurchaseOrderSchema.parse({ projectId: UUID, itemId: UUID2, quantity: 1, deadlineType: 'CUSTOMIZADO' })).toThrow();
    expect(CreatePurchaseOrderSchema.parse({ projectId: UUID, itemId: UUID2, quantity: 1, deadlineType: 'CUSTOMIZADO', deadlineDate: '2026-09-01T00:00:00.000Z' }).deadlineType).toBe('CUSTOMIZADO');
  });
  it('bounds quantity to 1..100000', () => {
    expect(() => CreatePurchaseOrderSchema.parse({ projectId: UUID, itemId: UUID2, quantity: 0, deadlineType: 'URGENTE' })).toThrow();
    expect(() => CreatePurchaseOrderSchema.parse({ projectId: UUID, itemId: UUID2, quantity: 100001, deadlineType: 'URGENTE' })).toThrow();
  });
  it('PurchaseOrderStatusSchema rejects PENDENTE as a target', () => {
    expect(() => PurchaseOrderStatusSchema.parse({ status: 'PENDENTE' })).toThrow();
    expect(PurchaseOrderStatusSchema.parse({ status: 'RECEBIDO_OK' }).status).toBe('RECEBIDO_OK');
  });
});

describe('Project + QR schemas (M9/M5)', () => {
  it('CreateProjectSchema requires a name', () => {
    expect(() => CreateProjectSchema.parse({})).toThrow();
    expect(CreateProjectSchema.parse({ name: 'Loja Q303A' }).name).toBe('Loja Q303A');
  });
  it('QrValidateSchema requires at least one code and caps at 200', () => {
    expect(() => QrValidateSchema.parse({ codes: [] })).toThrow();
    expect(QrValidateSchema.parse({ codes: ['1_2_3'], expectedItemId: UUID }).codes).toHaveLength(1);
    expect(() => QrValidateSchema.parse({ codes: Array(201).fill('x') })).toThrow();
  });
});

describe('PaginationQuerySchema', () => {
  it('rejects page < 1', () => {
    expect(() => PaginationQuerySchema.parse({ page: '0' })).toThrow();
  });
});
