import { z } from 'zod';
import {
  INV_ITEM_DOMAINS,
  INV_PURCHASE_TYPES,
  INV_STOCK_LOCATIONS,
  INV_MOVEMENT_TYPES,
} from '../../domain/entities/Inventory';

// =============================================================================
// RFC-0061 — Inventory request DTOs (P0/P1 finalized; later phases add theirs
// at implementation time — §API surface). Zod-validated in the controllers.
// Enum unions mirror the `text + CHECK` columns in schema.ts / migration 0067.
// Every list endpoint is paginated (page/pageSize → total/totalPages).
// =============================================================================

const uuid = z.string().uuid();

/** Shared pagination query (page/pageSize). */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// A positive numeric with ≤ 3 decimals (ledger grain, numeric(12,3)).
const Quantity3 = z
  .number()
  .positive()
  .refine((n) => Math.round(n * 1000) === n * 1000, 'at most 3 decimal places');

// -----------------------------------------------------------------------------
// M1 — Catálogo & BOM
// -----------------------------------------------------------------------------

export const CreateItemSchema = z
  .object({
    name: z.string().min(1).max(255),
    domain: z.enum(INV_ITEM_DOMAINS as unknown as [string, ...string[]]),
    link: z.string().max(2048).nullable().optional(),
    description: z.string().max(4096).nullable().optional(),
    isManufactured: z.boolean().optional().default(false),
    lossPercent: z.number().min(0).max(100).optional().default(0),
    lotQuantity: z.number().int().positive().nullable().optional(),
    purchaseType: z.enum(INV_PURCHASE_TYPES as unknown as [string, ...string[]]).nullable().optional(),
    photoFileId: uuid.nullable().optional(),
    active: z.boolean().optional().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    // W4 invariant, mirrored client-side for a friendly 400 before the DB CHECK.
    if (v.isManufactured && v.domain !== 'PRODUCT') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'isManufactured requires domain=PRODUCT', path: ['isManufactured'] });
    }
  });
export type CreateItemDTO = z.infer<typeof CreateItemSchema>;

export const UpdateItemSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    link: z.string().max(2048).nullable().optional(),
    description: z.string().max(4096).nullable().optional(),
    isManufactured: z.boolean().optional(),
    lossPercent: z.number().min(0).max(100).optional(),
    lotQuantity: z.number().int().positive().nullable().optional(),
    purchaseType: z.enum(INV_PURCHASE_TYPES as unknown as [string, ...string[]]).nullable().optional(),
    photoFileId: uuid.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateItemDTO = z.infer<typeof UpdateItemSchema>;

export const ItemListQuerySchema = PaginationQuerySchema.extend({
  domain: z.enum(INV_ITEM_DOMAINS as unknown as [string, ...string[]]).optional(),
  active: z.coerce.boolean().optional(),
  q: z.string().max(255).optional(),
});
export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;

/** PUT /items/:id/bom — the complete component list for a product. */
export const PutBomSchema = z
  .object({
    components: z
      .array(
        z.object({ componentItemId: uuid, quantity: Quantity3 }).strict(),
      )
      .max(500),
  })
  .strict();
export type PutBomDTO = z.infer<typeof PutBomSchema>;

// -----------------------------------------------------------------------------
// M2 — Livro-razão de estoque
// -----------------------------------------------------------------------------

export const StockBalancesQuerySchema = z
  .object({
    location: z.enum(INV_STOCK_LOCATIONS as unknown as [string, ...string[]]).optional(),
    domain: z.enum(INV_ITEM_DOMAINS as unknown as [string, ...string[]]).optional(),
  })
  .strict();
export type StockBalancesQuery = z.infer<typeof StockBalancesQuerySchema>;

const MovementQrSchema = z
  .object({
    qrValue: z.string().max(512).optional(),
    boxQr: z.string().max(512).optional(),
    homologationUnitId: uuid.optional(),
  })
  .strict();

export const CreateMovementSchema = z
  .object({
    itemId: uuid,
    location: z.enum(INV_STOCK_LOCATIONS as unknown as [string, ...string[]]),
    quantity: Quantity3,
    type: z.enum(INV_MOVEMENT_TYPES as unknown as [string, ...string[]]),
    reason: z.string().max(1024).optional(),
    responsible: z.string().max(255).optional(),
    photoFileId: uuid.optional(),
    purchaseOrderId: uuid.optional(),
    qrs: z.array(MovementQrSchema).max(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Transfer legs are created via POST /stock/transfers, not directly.
    if (v.type === 'TRANSFERENCIA_IN' || v.type === 'TRANSFERENCIA_OUT') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'use POST /stock/transfers for transfers', path: ['type'] });
    }
  });
export type CreateMovementDTO = z.infer<typeof CreateMovementSchema>;

export const CreateTransferSchema = z
  .object({
    itemId: uuid,
    fromLocation: z.enum(INV_STOCK_LOCATIONS as unknown as [string, ...string[]]),
    toLocation: z.enum(INV_STOCK_LOCATIONS as unknown as [string, ...string[]]),
    quantity: Quantity3,
    reason: z.string().max(1024).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fromLocation === v.toLocation) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fromLocation and toLocation must differ', path: ['toLocation'] });
    }
  });
export type CreateTransferDTO = z.infer<typeof CreateTransferSchema>;

/** POST /stock/reset — destructive; server-side confirmationToken (S3). */
export const StockResetSchema = z
  .object({
    confirmationToken: z.string().min(1),
    location: z.enum(INV_STOCK_LOCATIONS as unknown as [string, ...string[]]).optional(),
  })
  .strict();
export type StockResetDTO = z.infer<typeof StockResetSchema>;

// -----------------------------------------------------------------------------
// M3 — Compras
// -----------------------------------------------------------------------------

const DeadlineTypes = ['URGENTE', 'ESTA_SEMANA', 'ESTE_MES', 'CUSTOMIZADO'] as const;

export const CreatePurchaseOrderSchema = z
  .object({
    projectId: uuid,
    itemId: uuid,
    quantity: z.number().int().min(1).max(100000),
    recipient: z.string().max(255).optional(),
    deliveryPoint: z.string().max(255).optional(),
    deadlineType: z.enum(DeadlineTypes),
    deadlineDate: z.string().datetime().optional(),
    requesterNotes: z.string().max(4096).optional(),
    fileIds: z.array(uuid).max(20).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.deadlineType === 'CUSTOMIZADO' && !v.deadlineDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'deadlineDate is required when deadlineType=CUSTOMIZADO', path: ['deadlineDate'] });
    }
  });
export type CreatePurchaseOrderDTO = z.infer<typeof CreatePurchaseOrderSchema>;

/** Requester edit — allowed only while PENDENTE (server enforces, INV_EDIT_LOCKED_STATE). */
export const UpdatePurchaseOrderSchema = z
  .object({
    quantity: z.number().int().min(1).max(100000).optional(),
    recipient: z.string().max(255).optional(),
    deliveryPoint: z.string().max(255).optional(),
    deadlineType: z.enum(DeadlineTypes).optional(),
    deadlineDate: z.string().datetime().nullable().optional(),
    requesterNotes: z.string().max(4096).optional(),
    // Buyer-managed fields (RBAC gated in the service).
    buyerNotes: z.string().max(4096).optional(),
    passphrase: z.string().max(255).optional(),
    deliveryForecast: z.string().datetime().nullable().optional(),
  })
  .strict();
export type UpdatePurchaseOrderDTO = z.infer<typeof UpdatePurchaseOrderSchema>;

export const PurchaseOrderStatusSchema = z
  .object({
    status: z.enum([
      'COMPRADO_AGUARDANDO',
      'ENTREGUE',
      'RECEBIDO_OK',
      'RECEBIDO_PROBLEMA',
      'CANCELADO',
    ]),
    note: z.string().max(4096).optional(),
  })
  .strict();
export type PurchaseOrderStatusDTO = z.infer<typeof PurchaseOrderStatusSchema>;

export const PurchaseOrderListQuerySchema = PaginationQuerySchema.extend({
  status: z
    .enum(['PENDENTE', 'COMPRADO_AGUARDANDO', 'ENTREGUE', 'RECEBIDO_OK', 'RECEBIDO_PROBLEMA', 'CANCELADO'])
    .optional(),
  projectId: uuid.optional(),
  purchaseType: z.enum(INV_PURCHASE_TYPES as unknown as [string, ...string[]]).optional(),
  groupByProject: z.coerce.boolean().optional(),
});
export type PurchaseOrderListQuery = z.infer<typeof PurchaseOrderListQuerySchema>;

export const PurchaseOrderFilesSchema = z
  .object({ fileIds: z.array(uuid).min(1).max(20) })
  .strict();
export type PurchaseOrderFilesDTO = z.infer<typeof PurchaseOrderFilesSchema>;

// -----------------------------------------------------------------------------
// M9 — Projetos
// -----------------------------------------------------------------------------

export const CreateProjectSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(4096).nullable().optional(),
    customerId: uuid.nullable().optional(),
    legacyClientName: z.string().max(255).nullable().optional(),
    legacyClientCnpj: z.string().max(32).nullable().optional(),
  })
  .strict();
export type CreateProjectDTO = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = CreateProjectSchema.partial().strict();
export type UpdateProjectDTO = z.infer<typeof UpdateProjectSchema>;

// -----------------------------------------------------------------------------
// M5 — QR validate (S2) — contract for handheld per-beep feedback.
// -----------------------------------------------------------------------------

export const QrValidateSchema = z
  .object({
    codes: z.array(z.string().min(1).max(512)).min(1).max(200),
    expectedItemId: uuid.optional(),
    orderItemId: uuid.optional(),
  })
  .strict();
export type QrValidateDTO = z.infer<typeof QrValidateSchema>;
