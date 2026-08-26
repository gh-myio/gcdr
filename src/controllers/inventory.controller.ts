import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import {
  notImplemented,
  idempotencyKeyMissing,
  confirmationRequired,
} from '../shared/errors/InventoryError';
import {
  INV_ITEM_DOMAINS,
  INV_STOCK_LOCATIONS,
  INV_MOVEMENT_TYPES,
  INV_PURCHASE_TYPES,
  INV_BOX_SIZES,
  INV_SHIPPING_METHODS,
  PURCHASE_ORDER_TRANSITIONS,
  EXPEDITION_ORDER_TRANSITIONS,
} from '../domain/entities/Inventory';
import type { InvMetaResponse } from '../dto/response/InventoryResponseDTO';
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
  UpdatePurchaseOrderSchema,
  PurchaseOrderStatusSchema,
  PurchaseOrderListQuerySchema,
  PurchaseOrderFilesSchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  PaginationQuerySchema,
  QrValidateSchema,
} from '../dto/request/InventoryDTO';

// =============================================================================
// RFC-0061 — Inventory controller (contract-first kickoff).
//
// The routes, auth (mounted in app.ts with hybridAuthByMethod inventory:read/
// inventory:write) and request-DTO validation are REAL and testable. Business
// logic ships per phase (§Delivery phases); until then each endpoint validates
// its input and returns the defined 501 INV_NOT_IMPLEMENTED (Appendix D marker)
// carrying { module, phase }. `GET /meta` is concrete — it serves the enums and
// state machines so the frontend never re-implements them (S3).
//
// Mutations that create movements/deliveries/entries require an Idempotency-Key
// header (S1 → INV_IDEMPOTENCY_KEY_MISSING). Destructive verbs (DELETE,
// /stock/reset) require a server-side confirmation token (S3 →
// INV_CONFIRMATION_REQUIRED).
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(name: string, value: string): void {
  if (!value || !UUID_REGEX.test(value)) {
    throw new ValidationError(`Invalid ${name}: "${value ?? ''}"`);
  }
}

function requireIdempotencyKey(req: Request): void {
  const key = req.headers['idempotency-key'];
  if (!key || (Array.isArray(key) ? key.length === 0 : String(key).trim() === '')) {
    throw idempotencyKeyMissing();
  }
}

function requireConfirmation(req: Request): void {
  const header = req.headers['x-confirmation-token'];
  const body = (req.body ?? {}) as { confirmationToken?: unknown };
  const token = (Array.isArray(header) ? header[0] : header) ?? body.confirmationToken;
  if (!token || String(token).trim() === '') {
    throw confirmationRequired();
  }
}

/**
 * Build a deferred handler: run optional validation (path params, DTO,
 * idempotency/confirmation guards) then return the 501 contract marker.
 */
function defer(module: string, phase: string, validate?: (req: Request) => void) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (validate) validate(req);
      throw notImplemented(module, phase);
    } catch (err) {
      next(err);
    }
  };
}

const router = Router();

// -----------------------------------------------------------------------------
// Contract metadata (concrete) — enums + state machines + error codes.
// -----------------------------------------------------------------------------
router.get('/meta', (req: Request, res: Response, next: NextFunction) => {
  try {
    const data: InvMetaResponse = {
      itemDomains: [...INV_ITEM_DOMAINS],
      stockLocations: [...INV_STOCK_LOCATIONS],
      movementTypes: [...INV_MOVEMENT_TYPES],
      purchaseTypes: [...INV_PURCHASE_TYPES],
      boxSizes: [...INV_BOX_SIZES],
      shippingMethods: [...INV_SHIPPING_METHODS],
      purchaseOrderTransitions: PURCHASE_ORDER_TRANSITIONS,
      expeditionOrderTransitions: EXPEDITION_ORDER_TRANSITIONS,
      errorCodes: [
        'INV_ILLEGAL_TRANSITION', 'INV_ALREADY_IN_STATE', 'INV_INSUFFICIENT_STOCK',
        'INV_QR_ALREADY_USED', 'INV_QR_DUPLICATE', 'INV_QR_NOT_IN_REGISTRY',
        'INV_QR_WRONG_ITEM', 'INV_BOX_FULL', 'INV_BOX_EMPTY', 'INV_BOX_TOO_BIG',
        'INV_EDIT_LOCKED_STATE', 'INV_CONFIRMATION_REQUIRED',
        'INV_IDEMPOTENCY_KEY_MISSING', 'INV_NOT_IMPLEMENTED',
      ],
    };
    sendSuccess(res, data, 200, req.context?.requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// M1 — Catálogo & BOM (P0)
// -----------------------------------------------------------------------------
router.get('/items', defer('M1', 'P0', (req) => { ItemListQuerySchema.parse(req.query); }));
router.post('/items', defer('M1', 'P0', (req) => { CreateItemSchema.parse(req.body ?? {}); }));
router.get('/items/:id', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); }));
router.patch('/items/:id', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); UpdateItemSchema.parse(req.body ?? {}); }));
router.delete('/items/:id', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));
router.get('/items/:id/stock', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); }));
router.get('/items/:id/bom', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); }));
router.put('/items/:id/bom', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); PutBomSchema.parse(req.body ?? {}); }));

// -----------------------------------------------------------------------------
// M2 — Livro-razão de estoque (P0)
// -----------------------------------------------------------------------------
router.get('/stock/balances', defer('M2', 'P0', (req) => { StockBalancesQuerySchema.parse(req.query); }));
router.get('/stock/consistency', defer('M2', 'P0'));
router.get('/stock/movements', defer('M2', 'P0', (req) => { PaginationQuerySchema.parse(req.query); }));
router.get('/stock/movements/:id', defer('M2', 'P0', (req) => { requireUuid('id', req.params.id); }));
router.post('/stock/movements', defer('M2', 'P0', (req) => { requireIdempotencyKey(req); CreateMovementSchema.parse(req.body ?? {}); }));
router.post('/stock/transfers', defer('M2', 'P0', (req) => { requireIdempotencyKey(req); CreateTransferSchema.parse(req.body ?? {}); }));
router.post('/stock/reset', defer('M2', 'P0', (req) => { requireConfirmation(req); StockResetSchema.parse(req.body ?? {}); }));

// -----------------------------------------------------------------------------
// M3 — Compras (P1)
// -----------------------------------------------------------------------------
router.get('/purchase-orders', defer('M3', 'P1', (req) => { PurchaseOrderListQuerySchema.parse(req.query); }));
router.post('/purchase-orders', defer('M3', 'P1', (req) => { CreatePurchaseOrderSchema.parse(req.body ?? {}); }));
router.get('/purchase-orders/:id', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); }));
router.patch('/purchase-orders/:id', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); UpdatePurchaseOrderSchema.parse(req.body ?? {}); }));
router.post('/purchase-orders/:id/status', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); PurchaseOrderStatusSchema.parse(req.body ?? {}); }));
router.get('/purchase-orders/:id/events', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); }));
router.post('/purchase-orders/:id/files', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); PurchaseOrderFilesSchema.parse(req.body ?? {}); }));
router.delete('/purchase-orders/:id/files', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); }));
router.delete('/purchase-orders/:id', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));

// -----------------------------------------------------------------------------
// M4 — Produção (P2; demand resolution P3 — A4)
// -----------------------------------------------------------------------------
router.get('/production/demands', defer('M4', 'P2'));
router.post('/production/resolve-demand', defer('M4', 'P3'));
router.get('/production/capacity', defer('M4', 'P2'));
router.post('/production/simulator/preview', defer('M4', 'P2'));

router.get('/assembly-releases', defer('M4', 'P2'));
router.post('/assembly-releases', defer('M4', 'P2', (req) => { requireIdempotencyKey(req); }));
router.post('/assembly-releases/:id/correct', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.delete('/assembly-releases/:id', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));
router.get('/assembly-releases/:id/issues', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.post('/assembly-releases/:id/issues', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.post('/issues/:id/resolve', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); }));

// -----------------------------------------------------------------------------
// M5 — Homologação & QR (P2)
// -----------------------------------------------------------------------------
router.get('/homologations', defer('M5', 'P2'));
router.post('/homologations', defer('M5', 'P2', (req) => { requireIdempotencyKey(req); }));
router.get('/homologations/boxes', defer('M5', 'P2'));
router.post('/homologations/boxes/:id/add-unit', defer('M5', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.post('/homologations/units/:id/remove-from-box', defer('M5', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.post('/qr/generate', defer('M5', 'P2'));
router.get('/qr/trace/:code', defer('M5', 'P2'));
router.post('/qr/validate', defer('M5', 'P2', (req) => { QrValidateSchema.parse(req.body ?? {}); }));

// -----------------------------------------------------------------------------
// M6 — Expedição (P3)
// -----------------------------------------------------------------------------
router.get('/expedition-orders', defer('M6', 'P3', (req) => { PaginationQuerySchema.parse(req.query); }));
router.post('/expedition-orders', defer('M6', 'P3'));
router.get('/expedition-orders/:id', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.patch('/expedition-orders/:id', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.delete('/expedition-orders/:id', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));
router.post('/expedition-orders/:id/status', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/expedition-orders/:id/items/:itemId/deliver', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); requireUuid('itemId', req.params.itemId); requireIdempotencyKey(req); }));
router.post('/expedition-orders/:id/ship', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/expedition-orders/:id/return', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/expedition-orders/:id/lost', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/expedition-orders/:id/found', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.get('/expedition-orders/:id/transit-progress', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));

// -----------------------------------------------------------------------------
// M7 — Campo (P3)
// -----------------------------------------------------------------------------
router.get('/unit-products', defer('M7', 'P3', (req) => { PaginationQuerySchema.parse(req.query); }));
router.post('/unit-products', defer('M7', 'P3'));
router.patch('/unit-products/:id', defer('M7', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/unit-products/:id/move', defer('M7', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.get('/technician-items', defer('M7', 'P3'));
router.post('/technician-moves', defer('M7', 'P3'));
router.get('/damaged-items', defer('M7', 'P3', (req) => { PaginationQuerySchema.parse(req.query); }));
router.post('/damaged-items', defer('M7', 'P3'));
router.post('/damaged-items/:id/recover', defer('M7', 'P3', (req) => { requireUuid('id', req.params.id); }));

// -----------------------------------------------------------------------------
// M8 — Sync externo (P2 shadow → P4 live)
// -----------------------------------------------------------------------------
router.get('/external/states', defer('M8', 'P2', (req) => { PaginationQuerySchema.parse(req.query); }));
router.get('/external/sync/status', defer('M8', 'P2'));
router.post('/external/sync/run', defer('M8', 'P4'));

// -----------------------------------------------------------------------------
// M9 — Projetos (P1)
// -----------------------------------------------------------------------------
router.get('/projects', defer('M9', 'P1', (req) => { PaginationQuerySchema.parse(req.query); }));
router.post('/projects', defer('M9', 'P1', (req) => { CreateProjectSchema.parse(req.body ?? {}); }));
router.patch('/projects/:id', defer('M9', 'P1', (req) => { requireUuid('id', req.params.id); UpdateProjectSchema.parse(req.body ?? {}); }));
router.delete('/projects/:id', defer('M9', 'P1', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));

export default router;
