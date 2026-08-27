// RFC-0061 M3 — InventoryPurchaseOrderService unit tests (repos + M2 stock
// service mocked). Covers the ENTIRE DEC-4 state machine (every legal, illegal
// and repeated transition), the exactly-once receipt ENTRADA (A1), the
// PENDENTE edit lock (INV_EDIT_LOCKED_STATE) and the WO-style event writes.
import {
  InventoryPurchaseOrderService,
  IInventoryPurchaseOrderRepository,
  IPurchaseItemRepository,
  IPurchaseProjectRepository,
  IPurchaseStockService,
  RECEIPT_ENTRY_LOCATION,
  RECEIPT_ENTRY_REASON,
} from '../../../src/services/inventory/InventoryPurchaseOrderService';
import type {
  InvPurchaseOrderRow,
  InvPurchaseOrderEventRow,
  InvPurchaseOrderFileRow,
  PurchaseOrderTx,
} from '../../../src/repositories/inventory/InventoryPurchaseOrderRepository';
import type { InvItemRow } from '../../../src/repositories/inventory/InventoryStockRepository';
import {
  PURCHASE_ORDER_TRANSITIONS,
  InvPurchaseOrderStatus,
} from '../../../src/domain/entities/Inventory';
import { InventoryError } from '../../../src/shared/errors/InventoryError';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '99999999-9999-9999-9999-999999999999';
const ORDER_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '44444444-4444-4444-4444-444444444444';
const FILE_ID = '55555555-5555-5555-5555-555555555555';

const CTX = { tenantId: TENANT, userId: USER };
const TX = {} as PurchaseOrderTx;

const ALL_STATUSES: InvPurchaseOrderStatus[] = [
  'PENDENTE',
  'COMPRADO_AGUARDANDO',
  'ENTREGUE',
  'RECEBIDO_OK',
  'RECEBIDO_PROBLEMA',
  'CANCELADO',
];

/** The 5 targets the status DTO accepts (PENDENTE is creation-only). */
const API_TARGETS = [
  'COMPRADO_AGUARDANDO',
  'ENTREGUE',
  'RECEBIDO_OK',
  'RECEBIDO_PROBLEMA',
  'CANCELADO',
] as const;

function orderRow(overrides: Partial<InvPurchaseOrderRow> = {}): InvPurchaseOrderRow {
  return {
    id: ORDER_ID,
    tenantId: TENANT,
    projectId: PROJECT_ID,
    requesterId: USER,
    itemId: ITEM_ID,
    itemNameSnapshot: 'Resistor 10k',
    itemLink: 'https://fornecedor.example/resistor',
    quantity: 50,
    recipient: 'Almoxarifado',
    deliveryPoint: 'Portaria 2',
    status: 'PENDENTE',
    deadlineType: 'ESTA_SEMANA',
    deadlineDate: null,
    deliveryForecast: null,
    requesterNotes: null,
    buyerNotes: null,
    passphrase: null,
    createdAt: new Date('2026-08-26T10:00:00Z'),
    createdBy: USER,
    updatedAt: new Date('2026-08-26T10:00:00Z'),
    updatedBy: USER,
    ...overrides,
  } as InvPurchaseOrderRow;
}

function itemRow(overrides: Partial<InvItemRow> = {}): InvItemRow {
  return {
    id: ITEM_ID,
    tenantId: TENANT,
    name: 'Resistor 10k',
    domain: 'COMPONENT',
    link: 'https://fornecedor.example/resistor',
    purchaseType: 'NACIONAL',
    ...overrides,
  } as InvItemRow;
}

/** A Drizzle-style wrapped Postgres error: SQLSTATE lives on `.cause`. */
function drizzleError(code: string, message: string): Error {
  const err = new Error('Failed query: ...');
  (err as Error & { cause: unknown }).cause = { code, message };
  return err;
}

describe('InventoryPurchaseOrderService', () => {
  let repo: jest.Mocked<IInventoryPurchaseOrderRepository>;
  let itemRepo: jest.Mocked<IPurchaseItemRepository>;
  let projectRepo: jest.Mocked<IPurchaseProjectRepository>;
  let stockService: jest.Mocked<IPurchaseStockService>;
  let service: InventoryPurchaseOrderService;

  beforeEach(() => {
    repo = {
      withTransaction: jest.fn(async (fn: (tx: PurchaseOrderTx) => Promise<unknown>) => fn(TX)),
      list: jest.fn(),
      getById: jest.fn(),
      lockById: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      insertEvent: jest.fn().mockResolvedValue({} as InvPurchaseOrderEventRow),
      listEvents: jest.fn(),
      findExistingFileAssetIds: jest.fn().mockResolvedValue([]),
      listFiles: jest.fn().mockResolvedValue([]),
      insertFiles: jest.fn().mockResolvedValue([]),
      deleteFiles: jest.fn(),
      hasReceiptEntry: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<IInventoryPurchaseOrderRepository>;
    itemRepo = { getById: jest.fn().mockResolvedValue(itemRow()) } as unknown as jest.Mocked<IPurchaseItemRepository>;
    projectRepo = {
      getById: jest.fn().mockResolvedValue({ id: PROJECT_ID }),
    } as unknown as jest.Mocked<IPurchaseProjectRepository>;
    stockService = {
      createMovement: jest.fn().mockResolvedValue({ id: 'mov-1' }),
    } as unknown as jest.Mocked<IPurchaseStockService>;
    service = new InventoryPurchaseOrderService(repo, itemRepo, projectRepo, stockService);
  });

  // ===========================================================================
  // State machine (DEC-4) — the whole map
  // ===========================================================================

  describe('changeStatus — state machine', () => {
    type ApiTarget = (typeof API_TARGETS)[number];
    const LEGAL: Array<[InvPurchaseOrderStatus, ApiTarget]> = [];
    const ILLEGAL: Array<[InvPurchaseOrderStatus, ApiTarget]> = [];
    for (const from of ALL_STATUSES) {
      for (const to of API_TARGETS) {
        if (to === from) continue; // repeated — its own suite below
        (PURCHASE_ORDER_TRANSITIONS[from].includes(to) ? LEGAL : ILLEGAL).push([from, to]);
      }
    }

    it('the fixture covers the entire map (6 legal, 19 illegal, 5 repeats)', () => {
      expect(LEGAL).toHaveLength(6);
      expect(ILLEGAL).toHaveLength(19);
    });

    it.each(LEGAL)('%s → %s is accepted, persisted and logged', async (from, to) => {
      repo.lockById.mockResolvedValue(orderRow({ status: from }));
      repo.update.mockResolvedValue(orderRow({ status: to }));

      const result = await service.changeStatus(CTX, ORDER_ID, { status: to });

      expect(result.status).toBe(to);
      expect(result.allowedTransitions).toEqual(PURCHASE_ORDER_TRANSITIONS[to]);
      expect(repo.update).toHaveBeenCalledWith(
        TENANT,
        ORDER_ID,
        { status: to, updatedBy: USER },
        TX,
      );
      expect(repo.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: ORDER_ID,
          actorId: USER,
          eventType: 'STATUS_ALTERADO',
          details: { from, to },
        }),
        TX,
      );
      // The automatic ENTRADA fires only on RECEBIDO_OK (§M3, AC-1).
      expect(stockService.createMovement).toHaveBeenCalledTimes(to === 'RECEBIDO_OK' ? 1 : 0);
    });

    it.each(ILLEGAL)(
      '%s → %s is rejected with INV_ILLEGAL_TRANSITION carrying current + allowedTransitions',
      async (from, to) => {
        repo.lockById.mockResolvedValue(orderRow({ status: from }));

        const promise = service.changeStatus(CTX, ORDER_ID, { status: to });
        await expect(promise).rejects.toBeInstanceOf(InventoryError);
        const err = (await promise.catch((e) => e)) as InventoryError;
        expect(err.code).toBe('INV_ILLEGAL_TRANSITION');
        expect(err.statusCode).toBe(409);
        expect(err.details).toEqual({
          current: from,
          allowedTransitions: PURCHASE_ORDER_TRANSITIONS[from],
        });
        expect(repo.update).not.toHaveBeenCalled();
        expect(repo.insertEvent).not.toHaveBeenCalled();
        expect(stockService.createMovement).not.toHaveBeenCalled();
      },
    );

    it.each(API_TARGETS.map((s) => [s] as [(typeof API_TARGETS)[number]]))(
      'repeating %s is rejected with INV_ALREADY_IN_STATE (A1)',
      async (status) => {
        repo.lockById.mockResolvedValue(orderRow({ status }));

        const promise = service.changeStatus(CTX, ORDER_ID, { status });
        await expect(promise).rejects.toBeInstanceOf(InventoryError);
        const err = (await promise.catch((e) => e)) as InventoryError;
        expect(err.code).toBe('INV_ALREADY_IN_STATE');
        expect(err.statusCode).toBe(409);
        expect(err.details).toEqual({ current: status });
        expect(repo.update).not.toHaveBeenCalled();
        expect(stockService.createMovement).not.toHaveBeenCalled();
      },
    );

    it('404s when the order does not exist', async () => {
      repo.lockById.mockResolvedValue(null);
      await expect(
        service.changeStatus(CTX, ORDER_ID, { status: 'CANCELADO' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('includes the note in the STATUS_ALTERADO details when provided', async () => {
      repo.lockById.mockResolvedValue(orderRow({ status: 'ENTREGUE' }));
      repo.update.mockResolvedValue(orderRow({ status: 'RECEBIDO_PROBLEMA' }));

      await service.changeStatus(CTX, ORDER_ID, { status: 'RECEBIDO_PROBLEMA', note: 'faltou 1 caixa' });

      expect(repo.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { from: 'ENTREGUE', to: 'RECEBIDO_PROBLEMA', note: 'faltou 1 caixa' },
        }),
        TX,
      );
    });
  });

  // ===========================================================================
  // Receipt ENTRADA (A1 — exactly once)
  // ===========================================================================

  describe('changeStatus — RECEBIDO_OK receipt entry', () => {
    beforeEach(() => {
      repo.lockById.mockResolvedValue(orderRow({ status: 'ENTREGUE' }));
      repo.update.mockResolvedValue(orderRow({ status: 'RECEBIDO_OK' }));
    });

    it('creates exactly ONE ENTRADA via the M2 service with a PO-derived idempotency key', async () => {
      await service.changeStatus(CTX, ORDER_ID, { status: 'RECEBIDO_OK' });

      expect(stockService.createMovement).toHaveBeenCalledTimes(1);
      expect(stockService.createMovement).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: USER },
        {
          itemId: ITEM_ID,
          location: RECEIPT_ENTRY_LOCATION,
          quantity: 50,
          type: 'ENTRADA',
          reason: RECEIPT_ENTRY_REASON,
          purchaseOrderId: ORDER_ID,
        },
        `po-receipt:${ORDER_ID}`,
      );
    });

    it('treats a duplicate-entry failure as idempotent success when the ledger row exists', async () => {
      // The DB partial UNIQUE fired (a racing confirmation won) — the entry is
      // there, so the loser must NOT bubble the conflict (AC-1).
      stockService.createMovement.mockRejectedValue(drizzleError('23505', 'duplicate key'));
      repo.hasReceiptEntry.mockResolvedValue(true);

      const result = await service.changeStatus(CTX, ORDER_ID, { status: 'RECEBIDO_OK' });

      expect(result.status).toBe('RECEBIDO_OK');
      expect(repo.hasReceiptEntry).toHaveBeenCalledWith(TENANT, ORDER_ID);
    });

    it('re-throws the movement failure when NO entry exists in the ledger', async () => {
      const boom = new Error('db down');
      stockService.createMovement.mockRejectedValue(boom);
      repo.hasReceiptEntry.mockResolvedValue(false);

      await expect(service.changeStatus(CTX, ORDER_ID, { status: 'RECEBIDO_OK' })).rejects.toBe(boom);
    });
  });

  // ===========================================================================
  // Create
  // ===========================================================================

  describe('create', () => {
    const dto = {
      projectId: PROJECT_ID,
      itemId: ITEM_ID,
      quantity: 50,
      deadlineType: 'ESTA_SEMANA',
    } as Parameters<InventoryPurchaseOrderService['create']>[1];

    beforeEach(() => {
      repo.insert.mockResolvedValue(orderRow());
    });

    it('sets the requester from ctx and snapshots the item name/link', async () => {
      await service.create(CTX, dto);

      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          requesterId: USER,
          createdBy: USER,
          itemId: ITEM_ID,
          itemNameSnapshot: 'Resistor 10k',
          itemLink: 'https://fornecedor.example/resistor',
        }),
        TX,
      );
    });

    it('writes the CRIADO event in the same transaction', async () => {
      await service.create(CTX, dto);

      expect(repo.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: ORDER_ID, actorId: USER, eventType: 'CRIADO' }),
        TX,
      );
    });

    it('links pre-uploaded file_assets after validating they exist', async () => {
      repo.findExistingFileAssetIds.mockResolvedValue([FILE_ID]);
      repo.insertFiles.mockResolvedValue([
        { id: 'link-1', fileId: FILE_ID, createdAt: new Date() } as InvPurchaseOrderFileRow,
      ]);

      const result = await service.create(CTX, { ...dto, fileIds: [FILE_ID] });

      expect(repo.insertFiles).toHaveBeenCalledWith(TENANT, ORDER_ID, [FILE_ID], USER, TX);
      expect(result.files).toEqual([expect.objectContaining({ fileId: FILE_ID })]);
    });

    it('rejects an unknown item (400) before touching the DB', async () => {
      itemRepo.getById.mockResolvedValue(null);
      await expect(service.create(CTX, dto)).rejects.toBeInstanceOf(ValidationError);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('rejects an unknown project (400)', async () => {
      projectRepo.getById.mockResolvedValue(null);
      await expect(service.create(CTX, dto)).rejects.toBeInstanceOf(ValidationError);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('rejects fileIds that do not exist in the tenant (400)', async () => {
      repo.findExistingFileAssetIds.mockResolvedValue([]);
      await expect(service.create(CTX, { ...dto, fileIds: [FILE_ID] })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('returns allowedTransitions for the fresh PENDENTE order (S3)', async () => {
      const result = await service.create(CTX, dto);
      expect(result.allowedTransitions).toEqual(['COMPRADO_AGUARDANDO', 'CANCELADO']);
    });
  });

  // ===========================================================================
  // Update (PATCH) — PENDENTE edit lock + buyer fields + events
  // ===========================================================================

  describe('update', () => {
    it.each(['COMPRADO_AGUARDANDO', 'ENTREGUE', 'RECEBIDO_OK', 'RECEBIDO_PROBLEMA', 'CANCELADO'] as const)(
      'rejects requester-field edits in %s with INV_EDIT_LOCKED_STATE',
      async (status) => {
        repo.lockById.mockResolvedValue(orderRow({ status }));

        const promise = service.update(CTX, ORDER_ID, { quantity: 99 });
        await expect(promise).rejects.toBeInstanceOf(InventoryError);
        const err = (await promise.catch((e) => e)) as InventoryError;
        expect(err.code).toBe('INV_EDIT_LOCKED_STATE');
        expect(err.statusCode).toBe(409);
        expect(err.details).toEqual({ current: status });
        expect(repo.update).not.toHaveBeenCalled();
      },
    );

    it('accepts requester-field edits while PENDENTE', async () => {
      repo.lockById.mockResolvedValue(orderRow({ status: 'PENDENTE' }));
      repo.update.mockResolvedValue(orderRow({ quantity: 99 }));

      const result = await service.update(CTX, ORDER_ID, { quantity: 99, recipient: 'Lab' });

      expect(result.quantity).toBe(99);
      expect(repo.update).toHaveBeenCalledWith(
        TENANT,
        ORDER_ID,
        expect.objectContaining({ quantity: 99, recipient: 'Lab', updatedBy: USER }),
        TX,
      );
    });

    it.each(['COMPRADO_AGUARDANDO', 'ENTREGUE', 'CANCELADO'] as const)(
      'accepts buyer fields (buyerNotes/passphrase/deliveryForecast) in %s',
      async (status) => {
        repo.lockById.mockResolvedValue(orderRow({ status }));
        repo.update.mockResolvedValue(orderRow({ status, buyerNotes: 'ok', passphrase: 'laranja' }));

        const result = await service.update(CTX, ORDER_ID, {
          buyerNotes: 'ok',
          passphrase: 'laranja',
          deliveryForecast: '2026-09-01T00:00:00.000Z',
        });

        expect(result.buyerNotes).toBe('ok');
        expect(repo.update).toHaveBeenCalledWith(
          TENANT,
          ORDER_ID,
          expect.objectContaining({
            buyerNotes: 'ok',
            passphrase: 'laranja',
            deliveryForecast: new Date('2026-09-01T00:00:00.000Z'),
          }),
          TX,
        );
      },
    );

    it('writes OBSERVACAO_ATUALIZADA when notes change (fields listed, passphrase never echoed)', async () => {
      repo.lockById.mockResolvedValue(orderRow({ status: 'PENDENTE' }));
      repo.update.mockResolvedValue(orderRow());

      await service.update(CTX, ORDER_ID, { requesterNotes: 'urgente', buyerNotes: 'visto' });

      expect(repo.insertEvent).toHaveBeenCalledTimes(1);
      expect(repo.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'OBSERVACAO_ATUALIZADA',
          details: { fields: ['requesterNotes', 'buyerNotes'] },
        }),
        TX,
      );
    });

    it('does NOT write an event for a patch without notes', async () => {
      repo.lockById.mockResolvedValue(orderRow({ status: 'PENDENTE' }));
      repo.update.mockResolvedValue(orderRow());

      await service.update(CTX, ORDER_ID, { quantity: 10 });

      expect(repo.insertEvent).not.toHaveBeenCalled();
    });

    it('rejects deadlineType=CUSTOMIZADO when no deadlineDate resolves (400)', async () => {
      repo.lockById.mockResolvedValue(orderRow({ status: 'PENDENTE', deadlineDate: null }));

      await expect(
        service.update(CTX, ORDER_ID, { deadlineType: 'CUSTOMIZADO' }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('accepts CUSTOMIZADO when the patch carries the date', async () => {
      repo.lockById.mockResolvedValue(orderRow({ status: 'PENDENTE', deadlineDate: null }));
      repo.update.mockResolvedValue(orderRow({ deadlineType: 'CUSTOMIZADO' }));

      await service.update(CTX, ORDER_ID, {
        deadlineType: 'CUSTOMIZADO',
        deadlineDate: '2026-09-15T00:00:00.000Z',
      });

      expect(repo.update).toHaveBeenCalled();
    });

    it('404s when the order does not exist', async () => {
      repo.lockById.mockResolvedValue(null);
      await expect(service.update(CTX, ORDER_ID, { quantity: 1 })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ===========================================================================
  // Reads
  // ===========================================================================

  describe('reads', () => {
    it('list returns the paginated envelope with allowedTransitions and purchaseType per row', async () => {
      repo.list.mockResolvedValue({
        rows: [{ order: orderRow({ status: 'ENTREGUE' }), purchaseType: 'IMPORTACAO' }],
        total: 41,
      });

      const result = await service.list(CTX, { page: 2, pageSize: 20 });

      expect(repo.list).toHaveBeenCalledWith(TENANT, expect.objectContaining({ page: 2, pageSize: 20 }));
      expect(result.total).toBe(41);
      expect(result.totalPages).toBe(3);
      expect(result.items[0].purchaseType).toBe('IMPORTACAO');
      expect(result.items[0].allowedTransitions).toEqual(['RECEBIDO_OK', 'RECEBIDO_PROBLEMA']);
    });

    it('forwards the buyer-queue filters to the repository', async () => {
      repo.list.mockResolvedValue({ rows: [], total: 0 });

      await service.list(CTX, {
        page: 1,
        pageSize: 20,
        status: 'COMPRADO_AGUARDANDO',
        projectId: PROJECT_ID,
        purchaseType: 'NACIONAL',
        groupByProject: true,
      });

      expect(repo.list).toHaveBeenCalledWith(TENANT, {
        page: 1,
        pageSize: 20,
        status: 'COMPRADO_AGUARDANDO',
        projectId: PROJECT_ID,
        purchaseType: 'NACIONAL',
        groupByProject: true,
      });
    });

    it('getById returns the detail with files and allowedTransitions', async () => {
      repo.getById.mockResolvedValue(orderRow());
      repo.listFiles.mockResolvedValue([
        { id: 'link-1', fileId: FILE_ID, createdAt: new Date() } as InvPurchaseOrderFileRow,
      ]);

      const result = await service.getById(CTX, ORDER_ID);

      expect(result.files).toHaveLength(1);
      expect(result.allowedTransitions).toEqual(['COMPRADO_AGUARDANDO', 'CANCELADO']);
    });

    it('getById 404s on a missing order', async () => {
      repo.getById.mockResolvedValue(null);
      await expect(service.getById(CTX, ORDER_ID)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('listEvents 404s on a missing order and paginates otherwise', async () => {
      repo.getById.mockResolvedValue(null);
      await expect(service.listEvents(CTX, ORDER_ID, 1, 20)).rejects.toBeInstanceOf(NotFoundError);

      repo.getById.mockResolvedValue(orderRow());
      repo.listEvents.mockResolvedValue({
        rows: [
          {
            id: 'ev-1',
            tenantId: TENANT,
            orderId: ORDER_ID,
            actorId: USER,
            eventType: 'CRIADO',
            details: { status: 'PENDENTE' },
            createdAt: new Date('2026-08-26T10:00:00Z'),
          } as InvPurchaseOrderEventRow,
        ],
        total: 1,
      });

      const result = await service.listEvents(CTX, ORDER_ID, 1, 20);
      expect(result.items[0]).toEqual(
        expect.objectContaining({ eventType: 'CRIADO', actorId: USER, details: { status: 'PENDENTE' } }),
      );
      expect(result.totalPages).toBe(1);
    });
  });

  // ===========================================================================
  // Files & delete
  // ===========================================================================

  describe('files', () => {
    it('addFiles validates asset existence and returns the full link list', async () => {
      repo.getById.mockResolvedValue(orderRow());
      repo.findExistingFileAssetIds.mockResolvedValue([FILE_ID]);
      repo.listFiles.mockResolvedValue([
        { id: 'link-1', fileId: FILE_ID, createdAt: new Date() } as InvPurchaseOrderFileRow,
      ]);

      const result = await service.addFiles(CTX, ORDER_ID, [FILE_ID]);

      expect(repo.insertFiles).toHaveBeenCalledWith(TENANT, ORDER_ID, [FILE_ID], USER);
      expect(result.files).toEqual([expect.objectContaining({ fileId: FILE_ID })]);
    });

    it('addFiles rejects unknown assets (400)', async () => {
      repo.getById.mockResolvedValue(orderRow());
      repo.findExistingFileAssetIds.mockResolvedValue([]);
      await expect(service.addFiles(CTX, ORDER_ID, [FILE_ID])).rejects.toBeInstanceOf(ValidationError);
      expect(repo.insertFiles).not.toHaveBeenCalled();
    });

    it('removeFiles unlinks and reports the count', async () => {
      repo.getById.mockResolvedValue(orderRow());
      repo.deleteFiles.mockResolvedValue(1);

      const result = await service.removeFiles(CTX, ORDER_ID, [FILE_ID]);

      expect(repo.deleteFiles).toHaveBeenCalledWith(TENANT, ORDER_ID, [FILE_ID]);
      expect(result).toEqual({ orderId: ORDER_ID, removed: 1 });
    });
  });

  describe('delete', () => {
    it('deletes an existing order', async () => {
      repo.delete.mockResolvedValue(true);
      await service.delete(CTX, ORDER_ID);
      expect(repo.delete).toHaveBeenCalledWith(TENANT, ORDER_ID);
    });

    it('404s on a missing order', async () => {
      repo.delete.mockResolvedValue(false);
      await expect(service.delete(CTX, ORDER_ID)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ===========================================================================
  // Drizzle error unwrapping (known gotcha: SQLSTATE on err.cause)
  // ===========================================================================

  describe('repo error mapping', () => {
    it('maps a wrapped 23503 (FK) from create to a friendly 400', async () => {
      repo.insert.mockRejectedValue(
        drizzleError('23503', 'violates foreign key constraint "inv_purchase_orders_project_id_..."'),
      );

      await expect(
        service.create(CTX, {
          projectId: PROJECT_ID,
          itemId: ITEM_ID,
          quantity: 1,
          deadlineType: 'URGENTE',
        } as Parameters<InventoryPurchaseOrderService['create']>[1]),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
