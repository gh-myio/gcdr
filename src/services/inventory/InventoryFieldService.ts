// =============================================================================
// RFC-0061 M7 — Campo service (Cliente / Técnico / Avarias).
//
// ANTI-DOUBLE-COUNT RULE (§M7, ported from the source): moves out of the
// client and out of a technician's custody are TRACKING-ONLY — they never
// touch the stock ledger — EXCEPT when the destination is the warehouse
// (ALMOXARIFADO), which writes an ENTRADA *and re-links the QR on the new
// movement* (inv_movement_qrs). Without the re-link the M8 sync would see the
// QR's latest ledger event as the original SAIDA and "correct" the return
// away. Matrix:
//
//   unit-product move   TECNICO | PERDIDO | AVARIADO → no ledger write
//   unit-product move   ALMOXARIFADO → ENTRADA "Devolução do cliente" + QR link
//   technician move     UNIDADE | PERDIDO → no ledger write
//   technician move     ALMOXARIFADO → ENTRADA "Devolução do técnico <nome>" + QR links
//   technician move     AVARIADO → inv_damaged_items only (no ledger)
//   damaged report      from stock → SAIDA "Item avariado — <motivo>" (balance-guarded)
//   damaged recovery    always ENTRADA "Recuperação de item avariado" (+ QR re-link
//                       when source_detail carries a QR code); TECNICO/UNIDADE add a
//                       paired SAIDA in the same tx (net-zero — custody leaves stock)
//
// Composing with M2 (same trade-off as M4, documented there): this service
// drives inventoryStockRepository.lockItem / getBalance / insertMovement /
// insertMovementQrs with the FIELD transaction's executor, so every
// multi-write composition (move + ENTRADA + QR link, technician-move +
// damaged report, recovery + movements + unit rows) commits or rolls back
// atomically.
//
// M7 DTOs live here (exported Zod schemas): the RFC finalizes later-phase DTOs
// at implementation time and src/dto is frozen for this PR (module-boundary
// rule) — follow-up: fold them into src/dto/request/InventoryDTO.ts in a
// consolidating PR.
// =============================================================================

import { z } from 'zod';
import {
  InventoryFieldRepository,
  inventoryFieldRepository,
  FieldDbClient,
  InvUnitProductRow,
  InvDamagedItemRow,
  InvStockMovementRow,
  DispatchRow,
  NewUnitProductInput,
} from '../../repositories/inventory/InventoryFieldRepository';
import {
  InventoryStockRepository,
  inventoryStockRepository,
} from '../../repositories/inventory/InventoryStockRepository';
import {
  InventoryHomologationRepository,
  inventoryHomologationRepository,
} from '../../repositories/inventory/InventoryHomologationRepository';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/AppError';
import {
  alreadyInState,
  insufficientStock,
  qrDuplicate,
  qrNotInRegistry,
} from '../../shared/errors/InventoryError';
import { QR_CODE_REGEX, normalizeQrInput } from './InventoryQrService';
import type { InvPaginatedResponse } from '../../dto/response/InventoryResponseDTO';

// -----------------------------------------------------------------------------
// Request DTOs (M7 — finalized at implementation time per the RFC)
// -----------------------------------------------------------------------------

const uuid = z.string().uuid();
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
};

export const UnitProductListQuerySchema = z.object({
  ...pagination,
  /** Default listing = active units (moved_to IS NULL); true includes moved. */
  includeMoved: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .default(false),
  projectId: uuid.optional(),
  status: z.enum(['PARADO', 'INSTALADO']).optional(),
});
export type UnitProductListQuery = z.infer<typeof UnitProductListQuerySchema>;

export const CreateUnitProductSchema = z
  .object({
    itemId: uuid,
    /** Optional label = an available homologated QR (validated against M5). */
    label: z.string().min(1).max(120).optional(),
    projectId: uuid.optional(),
    notes: z.string().max(4096).optional(),
  })
  .strict();
export type CreateUnitProductDTO = z.infer<typeof CreateUnitProductSchema>;

export const UpdateUnitProductSchema = z
  .object({ status: z.enum(['PARADO', 'INSTALADO']) })
  .strict();
export type UpdateUnitProductDTO = z.infer<typeof UpdateUnitProductSchema>;

export const MoveUnitProductSchema = z
  .object({
    destination: z.enum(['TECNICO', 'ALMOXARIFADO', 'PERDIDO', 'AVARIADO']),
    technician: z.string().min(1).max(200).optional(),
    photoFileId: uuid.optional(),
    notes: z.string().max(4096).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.destination === 'TECNICO' && !v.technician) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'technician is required for destination TECNICO',
        path: ['technician'],
      });
    }
    if (v.destination === 'AVARIADO' && !v.notes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'notes is required for destination AVARIADO',
        path: ['notes'],
      });
    }
  });
export type MoveUnitProductDTO = z.infer<typeof MoveUnitProductSchema>;

export const TechnicianItemsQuerySchema = z.object({ ...pagination });
export type TechnicianItemsQuery = z.infer<typeof TechnicianItemsQuerySchema>;

export const CreateTechnicianMoveSchema = z
  .object({
    /** The dispatch (SAIDA with responsible) this move consumes from. */
    movementId: uuid,
    destination: z.enum(['UNIDADE', 'PERDIDO', 'ALMOXARIFADO', 'AVARIADO']),
    quantity: z.number().int().min(1).max(100000),
    projectId: uuid.optional(),
    notes: z.string().max(4096).optional(),
    photoFileId: uuid.optional(),
    /** Which dispatch QRs return with an ALMOXARIFADO move (re-link — §M7). */
    qrValues: z.array(z.string().min(1).max(200)).max(1000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.destination === 'UNIDADE' && !v.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'projectId is required for destination UNIDADE',
        path: ['projectId'],
      });
    }
    if (v.destination === 'AVARIADO' && !v.notes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'notes (motivo) is required for destination AVARIADO',
        path: ['notes'],
      });
    }
    if (v.qrValues && new Set(v.qrValues).size !== v.qrValues.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate qrValues', path: ['qrValues'] });
    }
  });
export type CreateTechnicianMoveDTO = z.infer<typeof CreateTechnicianMoveSchema>;

export const DamagedListQuerySchema = z.object({
  ...pagination,
  status: z.enum(['AVARIADO', 'RECUPERADO']).optional(),
});
export type DamagedListQuery = z.infer<typeof DamagedListQuerySchema>;

export const CreateDamagedItemSchema = z
  .object({
    itemId: uuid,
    quantity: z.number().int().min(1).max(100000),
    /** Which stock the damaged units leave from (SAIDA is balance-guarded). */
    location: z.enum(['FABRICA', 'ALMOXARIFADO', 'ALMOXARIFADO_GERAL']),
    reason: z.string().min(1).max(4096),
    photoFileId: uuid.optional(),
    sourceDetail: z.string().max(500).optional(),
    qrValues: z.array(z.string().min(1).max(200)).max(1000).optional(),
  })
  .strict();
export type CreateDamagedItemDTO = z.infer<typeof CreateDamagedItemSchema>;

export const RecoverDamagedItemSchema = z
  .object({
    destination: z.enum(['ESTOQUE', 'TECNICO', 'UNIDADE']),
    /** Stock the recovery re-enters (and leaves again for TECNICO/UNIDADE). */
    location: z.enum(['FABRICA', 'ALMOXARIFADO', 'ALMOXARIFADO_GERAL']).default('ALMOXARIFADO'),
    technician: z.string().min(1).max(200).optional(),
    projectId: uuid.optional(),
    notes: z.string().max(4096).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.destination === 'TECNICO' && !v.technician) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'technician is required for destination TECNICO',
        path: ['technician'],
      });
    }
    if (v.destination === 'UNIDADE' && !v.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'projectId is required for destination UNIDADE',
        path: ['projectId'],
      });
    }
  });
export type RecoverDamagedItemDTO = z.infer<typeof RecoverDamagedItemSchema>;

// -----------------------------------------------------------------------------
// Response read models
// -----------------------------------------------------------------------------

export interface InvUnitProductResponse {
  id: string;
  itemId: string | null;
  itemName: string | null;
  label: string | null;
  status: string;
  installedAt: string | null;
  projectId: string | null;
  projectName: string | null;
  customerId: string | null;
  clientNameSnapshot: string | null;
  expeditionOrderId: string | null;
  movedTo: string | null;
  movedTechnician: string | null;
  movePhotoFileId: string | null;
  movedAt: string | null;
  moveNotes: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface InvUnitMoveResponse {
  unit: InvUnitProductResponse;
  /** The ENTRADA written for destination ALMOXARIFADO; null otherwise (§M7). */
  stockMovementId: string | null;
  /** The damage report created for destination AVARIADO; null otherwise. */
  damagedItemId: string | null;
}

export interface InvDispatchQr {
  qrValue: string | null;
  boxQr: string | null;
}

export interface InvTechnicianDispatchResponse {
  movementId: string;
  itemId: string;
  itemName: string | null;
  quantity: number;
  movedQuantity: number;
  remaining: number;
  location: string;
  reason: string | null;
  createdAt: string;
  qrs: InvDispatchQr[];
}

export interface InvTechnicianGroupResponse {
  technician: string;
  totalRemaining: number;
  dispatches: InvTechnicianDispatchResponse[];
}

export interface InvTechnicianMoveResponse {
  id: string;
  movementId: string;
  itemId: string | null;
  technician: string | null;
  destination: string;
  projectId: string | null;
  quantity: number;
  notes: string | null;
  createdAt: string;
  /** ENTRADA written for destination ALMOXARIFADO; null otherwise (§M7). */
  stockMovementId: string | null;
  damagedItemId: string | null;
  createdUnitProductIds: string[];
}

export interface InvDamagedItemResponse {
  id: string;
  itemId: string | null;
  productNameSnapshot: string | null;
  quantity: number;
  source: string | null;
  sourceDetail: string | null;
  reason: string | null;
  photoFileId: string | null;
  status: string;
  recoveredTo: string | null;
  recoveryNotes: string | null;
  recoveredBy: string | null;
  recoveredAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface InvCreateDamagedResponse {
  damaged: InvDamagedItemResponse;
  stockMovementId: string;
}

export interface InvRecoverDamagedResponse {
  damaged: InvDamagedItemResponse;
  entryMovementId: string;
  exitMovementId: string | null;
  createdUnitProductIds: string[];
  /** QR code re-linked from source_detail (null when none was found). */
  relinkedQr: string | null;
}

// -----------------------------------------------------------------------------
// Seams (mocked in unit tests)
// -----------------------------------------------------------------------------

export type IInventoryFieldRepository = Pick<
  InventoryFieldRepository,
  | 'withTransaction'
  | 'listUnitProducts'
  | 'getUnitProduct'
  | 'getUnitProductForUpdate'
  | 'findUnitByLabel'
  | 'insertUnitProducts'
  | 'updateUnitStatus'
  | 'markUnitMoved'
  | 'listDispatches'
  | 'lockDispatch'
  | 'sumTechnicianMoves'
  | 'insertTechnicianMove'
  | 'listMovementQrs'
  | 'listDamagedItems'
  | 'getDamagedItemForUpdate'
  | 'insertDamagedItem'
  | 'markDamagedRecovered'
  | 'getProject'
>;

/** The M2 seam this service composes inside the field transactions. */
export type IFieldStockRepository = Pick<
  InventoryStockRepository,
  'lockItem' | 'getBalance' | 'insertMovement' | 'insertMovementQrs'
>;

/** The M5 seam — homologated-QR registry lookups (label validation). */
export type IFieldQrRegistryRepository = Pick<
  InventoryHomologationRepository,
  'findRegistryByValues' | 'getItem'
>;

export interface FieldContext {
  tenantId: string;
  userId?: string;
}

// -----------------------------------------------------------------------------
// Constants & helpers
// -----------------------------------------------------------------------------

/** Returns from the field re-enter the warehouse (§M7). */
export const RETURN_LOCATION = 'ALMOXARIFADO';
export const REASON_CLIENT_RETURN = 'Devolução do cliente';
export const REASON_DAMAGED_RECOVERY = 'Recuperação de item avariado';
export function reasonTechnicianReturn(technician: string): string {
  return `Devolução do técnico ${technician}`;
}
export function reasonDamaged(motivo: string): string {
  return `Item avariado — ${motivo}`;
}

/** A QR code embedded anywhere in free text (source_detail — recovery re-link). */
const EMBEDDED_QR_REGEX = /\d+(?:_\d+)+/;

/** Extract the QR code carried by a damage report's source_detail, if any. */
export function extractQrFromSourceDetail(sourceDetail: string | null | undefined): string | null {
  if (!sourceDetail) return null;
  const match = EMBEDDED_QR_REGEX.exec(sourceDetail);
  return match ? match[0] : null;
}

// Idempotency cache tuning (best-effort, per-process — same M2/M4 pattern).
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 5000;

export class InventoryFieldService {
  private repository: IInventoryFieldRepository;

  private stockRepository: IFieldStockRepository;

  private qrRepository: IFieldQrRegistryRepository;

  private idempotencyCache = new Map<string, { at: number; promise: Promise<unknown> }>();

  constructor(
    repository?: IInventoryFieldRepository,
    stockRepository?: IFieldStockRepository,
    qrRepository?: IFieldQrRegistryRepository,
  ) {
    this.repository = repository ?? inventoryFieldRepository;
    this.stockRepository = stockRepository ?? inventoryStockRepository;
    this.qrRepository = qrRepository ?? inventoryHomologationRepository;
  }

  // ---------------------------------------------------------------------------
  // Unit products (Cliente)
  // ---------------------------------------------------------------------------

  async listUnitProducts(
    tenantId: string,
    query: UnitProductListQuery,
  ): Promise<InvPaginatedResponse<InvUnitProductResponse>> {
    const { rows, total } = await this.repository.listUnitProducts(tenantId, {
      page: query.page,
      pageSize: query.pageSize,
      includeMoved: query.includeMoved,
      projectId: query.projectId,
      status: query.status,
    });
    return {
      items: rows.map((r) => this.toUnitResponse(r.unit, r.itemName, r.projectName)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Create a unit product at the client. Optional label must be an available
   * homologated QR (M5 registry) not already used as the label of another
   * ACTIVE unit; the DB unique index (which spans moved units too) is the
   * backstop → 23505 maps to INV_QR_DUPLICATE.
   */
  async createUnitProduct(ctx: FieldContext, dto: CreateUnitProductDTO): Promise<InvUnitProductResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const item = await this.qrRepository.getItem(ctx.tenantId, dto.itemId, tx);
        if (!item) throw new NotFoundError(`Item ${dto.itemId} not found`);

        const label = dto.label ? normalizeQrInput(dto.label).code : undefined;
        if (label) await this.assertLabelAvailable(ctx.tenantId, label, tx);

        const project = dto.projectId ? await this.getProjectOr404(ctx.tenantId, dto.projectId, tx) : null;

        const [unit] = await this.repository.insertUnitProducts(
          [
            {
              tenantId: ctx.tenantId,
              itemId: dto.itemId,
              label: label ?? null,
              status: 'PARADO',
              projectId: project?.id ?? null,
              customerId: project?.customerId ?? null,
              // Source rule "Projeto = Cliente": client name = project name.
              clientNameSnapshot: project?.name ?? null,
              notes: dto.notes ?? null,
              createdBy: ctx.userId ?? null,
            },
          ],
          tx,
        );
        return this.toUnitResponse(unit, item.name, project?.name ?? null);
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  /** INSTALADO/PARADO toggle; installs stamp installed_at (§M7). */
  async updateUnitProduct(
    ctx: FieldContext,
    id: string,
    dto: UpdateUnitProductDTO,
  ): Promise<InvUnitProductResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const unit = await this.repository.getUnitProductForUpdate(ctx.tenantId, id, tx);
        if (!unit) throw new NotFoundError(`Unit product ${id} not found`);
        if (unit.movedTo) {
          throw new ConflictError(`Unidade já movida para ${unit.movedTo} — status não pode ser alterado`);
        }
        if (unit.status === dto.status) throw alreadyInState(unit.status);

        const installedAt = dto.status === 'INSTALADO' ? new Date() : null;
        const updated = await this.repository.updateUnitStatus(ctx.tenantId, id, dto.status, installedAt, tx);
        return this.toUnitResponse(updated ?? unit, null, null);
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  /**
   * Move a unit out of the client. ANTI-DOUBLE-COUNT (§M7): only destination
   * ALMOXARIFADO writes stock — ENTRADA "Devolução do cliente" + QR re-link on
   * the new movement so the M8 sync doesn't undo the return; TECNICO/PERDIDO
   * are tracking-only; AVARIADO additionally opens an inv_damaged_items report
   * (source "Cliente", source_detail = project/label — the label keeps the QR
   * recoverable later).
   */
  async moveUnitProduct(
    ctx: FieldContext,
    id: string,
    dto: MoveUnitProductDTO,
    idempotencyKey: string,
  ): Promise<InvUnitMoveResponse> {
    return this.idempotent(ctx.tenantId, `unit-move:${idempotencyKey}`, () =>
      this.doMoveUnitProduct(ctx, id, dto),
    );
  }

  private async doMoveUnitProduct(
    ctx: FieldContext,
    id: string,
    dto: MoveUnitProductDTO,
  ): Promise<InvUnitMoveResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const unit = await this.repository.getUnitProductForUpdate(ctx.tenantId, id, tx);
        if (!unit) throw new NotFoundError(`Unit product ${id} not found`);
        if (unit.movedTo) throw alreadyInState(unit.movedTo);

        let stockMovementId: string | null = null;
        let damagedItemId: string | null = null;

        if (dto.destination === 'ALMOXARIFADO') {
          // The ONLY move destination that touches the ledger (§M7).
          const movement = await this.writeReturnEntry(ctx, unit, tx);
          stockMovementId = movement.id;
        } else if (dto.destination === 'AVARIADO') {
          const itemName = unit.itemId
            ? (await this.qrRepository.getItem(ctx.tenantId, unit.itemId, tx))?.name ?? null
            : null;
          const project = unit.projectId
            ? await this.repository.getProject(ctx.tenantId, unit.projectId, tx)
            : null;
          const sourceDetail = [project?.name ?? unit.clientNameSnapshot, unit.label]
            .filter((v): v is string => !!v)
            .join(' / ');
          const damaged = await this.repository.insertDamagedItem(
            {
              tenantId: ctx.tenantId,
              itemId: unit.itemId,
              productNameSnapshot: itemName,
              quantity: 1,
              source: 'Cliente',
              sourceDetail: sourceDetail || null,
              reason: dto.notes ?? null,
              photoFileId: dto.photoFileId ?? null,
              createdBy: ctx.userId ?? null,
            },
            tx,
          );
          damagedItemId = damaged.id;
        }
        // TECNICO / PERDIDO: tracking-only — no ledger write.

        const moved = await this.repository.markUnitMoved(
          ctx.tenantId,
          id,
          {
            movedTo: dto.destination,
            movedTechnician: dto.destination === 'TECNICO' ? dto.technician ?? null : null,
            movePhotoFileId: dto.photoFileId ?? null,
            movedAt: new Date(),
            moveNotes: dto.notes ?? null,
          },
          tx,
        );

        return {
          unit: this.toUnitResponse(moved ?? unit, null, null),
          stockMovementId,
          damagedItemId,
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  /** ENTRADA "Devolução do cliente" + QR re-link for the returned unit. */
  private async writeReturnEntry(
    ctx: FieldContext,
    unit: InvUnitProductRow,
    tx: FieldDbClient,
  ): Promise<InvStockMovementRow> {
    if (!unit.itemId) {
      throw new ValidationError('Unidade sem item vinculado não pode retornar ao estoque');
    }
    const movement = await this.stockRepository.insertMovement(
      {
        tenantId: ctx.tenantId,
        itemId: unit.itemId,
        location: RETURN_LOCATION,
        quantity: '1',
        type: 'ENTRADA',
        reason: REASON_CLIENT_RETURN,
        createdBy: ctx.userId ?? null,
      },
      tx,
    );
    // Re-link the unit's QR to the ENTRADA: the QR's latest ledger event
    // becomes this return, so the M8 sync will not "correct" it back out.
    if (unit.label && QR_CODE_REGEX.test(unit.label)) {
      await this.stockRepository.insertMovementQrs(ctx.tenantId, movement.id, [{ qrValue: unit.label }], tx);
    }
    return movement;
  }

  // ---------------------------------------------------------------------------
  // Technician custody (Técnico)
  // ---------------------------------------------------------------------------

  /**
   * Items with technicians: dispatches (SAIDAs with a responsible) grouped by
   * technician; per-dispatch remaining = quantity − Σ technician moves;
   * fully-consumed dispatches are omitted; dispatch QRs attached. Grouping and
   * pagination happen in memory — dispatch volume is operational-scale (one
   * company); revisit with a SQL GROUP BY if it ever grows (follow-up).
   */
  async listTechnicianItems(
    tenantId: string,
    query: TechnicianItemsQuery,
  ): Promise<InvPaginatedResponse<InvTechnicianGroupResponse>> {
    const dispatches = await this.repository.listDispatches(tenantId);
    const open = dispatches.filter((d) => Number(d.quantity) - d.movedQuantity > 0);
    const qrs = await this.repository.listMovementQrs(tenantId, open.map((d) => d.movementId));
    const qrsByMovement = new Map<string, InvDispatchQr[]>();
    for (const qr of qrs) {
      const list = qrsByMovement.get(qr.movementId) ?? [];
      list.push({ qrValue: qr.qrValue ?? null, boxQr: qr.boxQr ?? null });
      qrsByMovement.set(qr.movementId, list);
    }

    const groups = new Map<string, InvTechnicianGroupResponse>();
    for (const d of open) {
      const group = groups.get(d.technician) ?? {
        technician: d.technician,
        totalRemaining: 0,
        dispatches: [],
      };
      const remaining = Number(d.quantity) - d.movedQuantity;
      group.totalRemaining += remaining;
      group.dispatches.push(this.toDispatchResponse(d, remaining, qrsByMovement.get(d.movementId) ?? []));
      groups.set(d.technician, group);
    }

    const all = [...groups.values()].sort((a, b) => a.technician.localeCompare(b.technician));
    const start = (query.page - 1) * query.pageSize;
    return {
      items: all.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: all.length,
      totalPages: Math.ceil(all.length / query.pageSize),
    };
  }

  /**
   * Move units out of a technician's custody. ANTI-DOUBLE-COUNT (§M7):
   * UNIDADE/PERDIDO are pure tracking (no ledger); ALMOXARIFADO writes an
   * ENTRADA "Devolução do técnico <nome>" + QR re-links; AVARIADO opens an
   * inv_damaged_items report (source "Técnico") without touching the ledger.
   */
  async createTechnicianMove(
    ctx: FieldContext,
    dto: CreateTechnicianMoveDTO,
    idempotencyKey: string,
  ): Promise<InvTechnicianMoveResponse> {
    return this.idempotent(ctx.tenantId, `tech-move:${idempotencyKey}`, () =>
      this.doCreateTechnicianMove(ctx, dto),
    );
  }

  private async doCreateTechnicianMove(
    ctx: FieldContext,
    dto: CreateTechnicianMoveDTO,
  ): Promise<InvTechnicianMoveResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        // Lock the dispatch row: concurrent moves against the same dispatch
        // serialize here, so the remaining check cannot race.
        const dispatch = await this.repository.lockDispatch(ctx.tenantId, dto.movementId, tx);
        if (!dispatch) throw new NotFoundError(`Dispatch ${dto.movementId} not found`);
        const technician = (dispatch.responsible ?? '').trim();
        if (dispatch.type !== 'SAIDA' || technician === '') {
          throw new ValidationError('Movimento não é um despacho para técnico (SAIDA com responsável)');
        }

        const consumed = await this.repository.sumTechnicianMoves(ctx.tenantId, dto.movementId, tx);
        const remaining = Number(dispatch.quantity) - consumed;
        if (dto.quantity > remaining) {
          throw new ValidationError(
            `Quantidade (${dto.quantity}) excede o restante do despacho (${remaining})`,
          );
        }

        const qrValues = await this.resolveDispatchQrs(ctx.tenantId, dto, tx);

        const move = await this.repository.insertTechnicianMove(
          {
            tenantId: ctx.tenantId,
            movementId: dto.movementId,
            itemId: dispatch.itemId,
            technician,
            destination: dto.destination,
            projectId: dto.projectId ?? null,
            quantity: dto.quantity,
            notes: dto.notes ?? null,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );

        let stockMovementId: string | null = null;
        let damagedItemId: string | null = null;
        let createdUnitProductIds: string[] = [];

        if (dto.destination === 'ALMOXARIFADO') {
          // The ONLY technician destination that touches the ledger (§M7).
          const entry = await this.stockRepository.insertMovement(
            {
              tenantId: ctx.tenantId,
              itemId: dispatch.itemId,
              location: RETURN_LOCATION,
              quantity: String(dto.quantity),
              type: 'ENTRADA',
              reason: reasonTechnicianReturn(technician),
              createdBy: ctx.userId ?? null,
            },
            tx,
          );
          stockMovementId = entry.id;
          if (qrValues.length > 0) {
            // Re-link the returning QRs so the M8 sync doesn't undo the return.
            await this.stockRepository.insertMovementQrs(
              ctx.tenantId,
              entry.id,
              qrValues.map((qrValue) => ({ qrValue })),
              tx,
            );
          }
        } else if (dto.destination === 'UNIDADE') {
          const project = await this.getProjectOr404(ctx.tenantId, dto.projectId as string, tx);
          const inputs: NewUnitProductInput[] = Array.from({ length: dto.quantity }, () => ({
            tenantId: ctx.tenantId,
            itemId: dispatch.itemId,
            label: null, // §M7: unit products created from technician moves have no label
            status: 'PARADO',
            projectId: project.id,
            customerId: project.customerId ?? null,
            clientNameSnapshot: project.name,
            createdBy: ctx.userId ?? null,
          }));
          const units = await this.repository.insertUnitProducts(inputs, tx);
          createdUnitProductIds = units.map((u) => u.id);
        } else if (dto.destination === 'AVARIADO') {
          const item = await this.qrRepository.getItem(ctx.tenantId, dispatch.itemId, tx);
          const damaged = await this.repository.insertDamagedItem(
            {
              tenantId: ctx.tenantId,
              itemId: dispatch.itemId,
              productNameSnapshot: item?.name ?? null,
              quantity: dto.quantity,
              source: 'Técnico',
              sourceDetail: technician,
              reason: dto.notes ?? null,
              photoFileId: dto.photoFileId ?? null,
              createdBy: ctx.userId ?? null,
            },
            tx,
          );
          damagedItemId = damaged.id;
        }
        // PERDIDO: tracking-only — no ledger write.

        return {
          id: move.id,
          movementId: move.movementId as string,
          itemId: move.itemId ?? null,
          technician: move.technician ?? null,
          destination: move.destination,
          projectId: move.projectId ?? null,
          quantity: move.quantity,
          notes: move.notes ?? null,
          createdAt: this.iso(move.createdAt),
          stockMovementId,
          damagedItemId,
          createdUnitProductIds,
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  /** qrValues must belong to the dispatch and match the quantity (when given). */
  private async resolveDispatchQrs(
    tenantId: string,
    dto: CreateTechnicianMoveDTO,
    tx: FieldDbClient,
  ): Promise<string[]> {
    if (!dto.qrValues?.length) return [];
    const codes = dto.qrValues.map((v) => normalizeQrInput(v).code);
    if (codes.length !== dto.quantity) {
      throw new ValidationError(
        `qrValues (${codes.length}) deve igualar a quantidade devolvida (${dto.quantity})`,
      );
    }
    const dispatchQrs = await this.repository.listMovementQrs(tenantId, [dto.movementId], tx);
    const known = new Set(dispatchQrs.map((q) => q.qrValue).filter((v): v is string => !!v));
    for (const code of codes) {
      if (!known.has(code)) {
        throw new ValidationError(`QR ${code} não pertence ao despacho informado`);
      }
    }
    return codes;
  }

  // ---------------------------------------------------------------------------
  // Damaged items (Avarias)
  // ---------------------------------------------------------------------------

  async listDamagedItems(
    tenantId: string,
    query: DamagedListQuery,
  ): Promise<InvPaginatedResponse<InvDamagedItemResponse>> {
    const { rows, total } = await this.repository.listDamagedItems(tenantId, {
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    });
    return {
      items: rows.map((r) => this.toDamagedResponse(r)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Report damage FROM STOCK: qty is capped by the location balance (checked
   * under the item lock — M2 guard re-applied) and leaves the ledger as a
   * SAIDA "Item avariado — <motivo>". Damage found at the client or with a
   * technician arrives through the move routes above, not here.
   */
  async createDamagedItem(
    ctx: FieldContext,
    dto: CreateDamagedItemDTO,
    idempotencyKey: string,
  ): Promise<InvCreateDamagedResponse> {
    return this.idempotent(ctx.tenantId, `damaged:${idempotencyKey}`, () =>
      this.doCreateDamagedItem(ctx, dto),
    );
  }

  private async doCreateDamagedItem(
    ctx: FieldContext,
    dto: CreateDamagedItemDTO,
  ): Promise<InvCreateDamagedResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const item = await this.stockRepository.lockItem(ctx.tenantId, dto.itemId, tx);
        if (!item) throw new NotFoundError(`Item ${dto.itemId} not found`);

        const totals = await this.stockRepository.getBalance(ctx.tenantId, dto.itemId, dto.location, tx);
        const balance = Number(totals.balance);
        if (dto.quantity > balance) {
          throw insufficientStock(dto.itemId, dto.location, balance, dto.quantity);
        }

        const exit = await this.stockRepository.insertMovement(
          {
            tenantId: ctx.tenantId,
            itemId: dto.itemId,
            location: dto.location,
            quantity: String(dto.quantity),
            type: 'SAIDA',
            reason: reasonDamaged(dto.reason),
            photoFileId: dto.photoFileId ?? null,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );
        if (dto.qrValues?.length) {
          await this.stockRepository.insertMovementQrs(
            ctx.tenantId,
            exit.id,
            dto.qrValues.map((v) => ({ qrValue: normalizeQrInput(v).code })),
            tx,
          );
        }

        const damaged = await this.repository.insertDamagedItem(
          {
            tenantId: ctx.tenantId,
            itemId: dto.itemId,
            productNameSnapshot: item.name,
            quantity: dto.quantity,
            source: 'Estoque',
            sourceDetail: dto.sourceDetail ?? dto.location,
            reason: dto.reason,
            photoFileId: dto.photoFileId ?? null,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );

        return { damaged: this.toDamagedResponse(damaged), stockMovementId: exit.id };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  /**
   * Recover a damaged item to ESTOQUE | TECNICO | UNIDADE (§M7):
   *   - always an ENTRADA "Recuperação de item avariado" at dto.location;
   *   - TECNICO: plus a SAIDA with responsible = technician (net-zero — the
   *     recovered units go straight into the technician's custody);
   *   - UNIDADE: plus a SAIDA and `quantity` inv_unit_products rows in the
   *     project — the FIRST unit inherits the QR as its label.
   *
   * QR RE-LINK (source rule, kept): when source_detail carries a QR code
   * (`\d+(_\d+)+`), it is re-linked on the new movement(s) in
   * inv_movement_qrs. Without this the M8 sync — which reads each QR's LATEST
   * ledger event — would still see the pre-damage exit and revert the
   * recovery on its next 5-minute run.
   *
   * The paired SAIDA needs no negative-stock guard: it consumes exactly the
   * quantity the ENTRADA added in the same transaction.
   */
  async recoverDamagedItem(
    ctx: FieldContext,
    id: string,
    dto: RecoverDamagedItemDTO,
    idempotencyKey: string,
  ): Promise<InvRecoverDamagedResponse> {
    return this.idempotent(ctx.tenantId, `recover:${idempotencyKey}`, () =>
      this.doRecoverDamagedItem(ctx, id, dto),
    );
  }

  private async doRecoverDamagedItem(
    ctx: FieldContext,
    id: string,
    dto: RecoverDamagedItemDTO,
  ): Promise<InvRecoverDamagedResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const damaged = await this.repository.getDamagedItemForUpdate(ctx.tenantId, id, tx);
        if (!damaged) throw new NotFoundError(`Damaged item ${id} not found`);
        if (damaged.status !== 'AVARIADO') throw alreadyInState(damaged.status);
        if (!damaged.itemId) {
          throw new ValidationError('Item avariado sem produto vinculado não pode ser recuperado');
        }

        const relinkedQr = extractQrFromSourceDetail(damaged.sourceDetail);
        const qrLinks = relinkedQr ? [{ qrValue: relinkedQr }] : [];

        const entry = await this.stockRepository.insertMovement(
          {
            tenantId: ctx.tenantId,
            itemId: damaged.itemId,
            location: dto.location,
            quantity: String(damaged.quantity),
            type: 'ENTRADA',
            reason: REASON_DAMAGED_RECOVERY,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );
        if (qrLinks.length > 0) {
          await this.stockRepository.insertMovementQrs(ctx.tenantId, entry.id, qrLinks, tx);
        }

        let exitMovementId: string | null = null;
        let createdUnitProductIds: string[] = [];

        if (dto.destination === 'TECNICO' || dto.destination === 'UNIDADE') {
          const exit = await this.stockRepository.insertMovement(
            {
              tenantId: ctx.tenantId,
              itemId: damaged.itemId,
              location: dto.location,
              quantity: String(damaged.quantity),
              type: 'SAIDA',
              reason: REASON_DAMAGED_RECOVERY,
              responsible: dto.destination === 'TECNICO' ? (dto.technician as string) : null,
              createdBy: ctx.userId ?? null,
            },
            tx,
          );
          exitMovementId = exit.id;
          if (qrLinks.length > 0) {
            // Latest ledger event for the QR must reflect where it went.
            await this.stockRepository.insertMovementQrs(ctx.tenantId, exit.id, qrLinks, tx);
          }

          if (dto.destination === 'UNIDADE') {
            const project = await this.getProjectOr404(ctx.tenantId, dto.projectId as string, tx);
            // First unit inherits the QR as label — unless another unit row
            // already holds it (the label unique index spans moved units too).
            let inheritedLabel: string | null = null;
            if (relinkedQr) {
              const holder = await this.repository.findUnitByLabel(ctx.tenantId, relinkedQr, false, tx);
              if (!holder) inheritedLabel = relinkedQr;
            }
            const inputs: NewUnitProductInput[] = Array.from({ length: damaged.quantity }, (_, i) => ({
              tenantId: ctx.tenantId,
              itemId: damaged.itemId,
              label: i === 0 ? inheritedLabel : null,
              status: 'PARADO',
              projectId: project.id,
              customerId: project.customerId ?? null,
              clientNameSnapshot: project.name,
              createdBy: ctx.userId ?? null,
            }));
            const units = await this.repository.insertUnitProducts(inputs, tx);
            createdUnitProductIds = units.map((u) => u.id);
          }
        }

        const updated = await this.repository.markDamagedRecovered(
          ctx.tenantId,
          id,
          {
            recoveredTo: dto.destination,
            recoveryNotes: dto.notes ?? null,
            recoveredBy: ctx.userId ?? null,
            recoveredAt: new Date(),
          },
          tx,
        );

        return {
          damaged: this.toDamagedResponse(updated ?? damaged),
          entryMovementId: entry.id,
          exitMovementId,
          createdUnitProductIds,
          relinkedQr,
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Guards & lookups
  // ---------------------------------------------------------------------------

  /**
   * A label must be a homologated QR (M5 registry, kind UNIT) not already used
   * by another ACTIVE unit (INV_QR_DUPLICATE). NOTE: the DB unique index spans
   * moved units too, so a QR whose historical unit kept its label also fails —
   * surfaced by the same 409 through mapRepoError.
   */
  private async assertLabelAvailable(tenantId: string, label: string, tx: FieldDbClient): Promise<void> {
    const [registry] = await this.qrRepository.findRegistryByValues(tenantId, [label], tx);
    if (!registry || registry.kind !== 'UNIT') throw qrNotInRegistry(label);
    const active = await this.repository.findUnitByLabel(tenantId, label, true, tx);
    if (active) throw qrDuplicate(label);
  }

  private async getProjectOr404(tenantId: string, projectId: string, tx: FieldDbClient) {
    const project = await this.repository.getProject(tenantId, projectId, tx);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    return project;
  }

  // ---------------------------------------------------------------------------
  // Idempotency (best-effort, per-process — same M2/M4 pattern)
  // ---------------------------------------------------------------------------

  private async idempotent<T>(tenantId: string, key: string, run: () => Promise<T>): Promise<T> {
    const cacheKey = `${tenantId}:${key}`;
    const now = Date.now();
    const hit = this.idempotencyCache.get(cacheKey);
    if (hit && now - hit.at < IDEMPOTENCY_TTL_MS) {
      return hit.promise as Promise<T>;
    }

    const promise = run();
    this.idempotencyCache.set(cacheKey, { at: now, promise });
    // A failed attempt must NOT poison the key (client retries the same key).
    promise.catch(() => this.idempotencyCache.delete(cacheKey));
    this.evictStaleIdempotencyEntries(now);
    return promise;
  }

  private evictStaleIdempotencyEntries(now: number): void {
    if (this.idempotencyCache.size <= IDEMPOTENCY_MAX_ENTRIES) return;
    for (const [key, entry] of this.idempotencyCache) {
      if (now - entry.at >= IDEMPOTENCY_TTL_MS) this.idempotencyCache.delete(key);
      if (this.idempotencyCache.size <= IDEMPOTENCY_MAX_ENTRIES) return;
    }
    for (const key of this.idempotencyCache.keys()) {
      if (this.idempotencyCache.size <= IDEMPOTENCY_MAX_ENTRIES) return;
      this.idempotencyCache.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------------

  private iso(value: Date | string | null | undefined): string {
    return value ? new Date(value).toISOString() : new Date().toISOString();
  }

  private toUnitResponse(
    row: InvUnitProductRow,
    itemName: string | null,
    projectName: string | null,
  ): InvUnitProductResponse {
    return {
      id: row.id,
      itemId: row.itemId ?? null,
      itemName,
      label: row.label ?? null,
      status: row.status,
      installedAt: row.installedAt ? new Date(row.installedAt).toISOString() : null,
      projectId: row.projectId ?? null,
      projectName,
      customerId: row.customerId ?? null,
      clientNameSnapshot: row.clientNameSnapshot ?? null,
      expeditionOrderId: row.expeditionOrderId ?? null,
      movedTo: row.movedTo ?? null,
      movedTechnician: row.movedTechnician ?? null,
      movePhotoFileId: row.movePhotoFileId ?? null,
      movedAt: row.movedAt ? new Date(row.movedAt).toISOString() : null,
      moveNotes: row.moveNotes ?? null,
      notes: row.notes ?? null,
      createdAt: this.iso(row.createdAt),
      createdBy: row.createdBy ?? null,
    };
  }

  private toDispatchResponse(
    d: DispatchRow,
    remaining: number,
    qrs: InvDispatchQr[],
  ): InvTechnicianDispatchResponse {
    return {
      movementId: d.movementId,
      itemId: d.itemId,
      itemName: d.itemName,
      quantity: Number(d.quantity),
      movedQuantity: d.movedQuantity,
      remaining,
      location: d.location,
      reason: d.reason,
      createdAt: this.iso(d.createdAt),
      qrs,
    };
  }

  private toDamagedResponse(row: InvDamagedItemRow): InvDamagedItemResponse {
    return {
      id: row.id,
      itemId: row.itemId ?? null,
      productNameSnapshot: row.productNameSnapshot ?? null,
      quantity: row.quantity,
      source: row.source ?? null,
      sourceDetail: row.sourceDetail ?? null,
      reason: row.reason ?? null,
      photoFileId: row.photoFileId ?? null,
      status: row.status,
      recoveredTo: row.recoveredTo ?? null,
      recoveryNotes: row.recoveryNotes ?? null,
      recoveredBy: row.recoveredBy ?? null,
      recoveredAt: row.recoveredAt ? new Date(row.recoveredAt).toISOString() : null,
      createdAt: this.iso(row.createdAt),
      createdBy: row.createdBy ?? null,
    };
  }

  /**
   * Map low-level DB errors to the RFC contract. Drizzle wraps the driver
   * error (DrizzleQueryError): the real SQLSTATE lives on `err.cause.code`,
   * not `err.code`/`err.message` — inspect both (known gotcha).
   */
  private mapRepoError(err: unknown): never {
    if (err instanceof AppError) throw err;
    const top = err as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    const cause = top.cause ?? {};
    const code = cause.code ?? top.code;
    const message = `${top.message ?? String(err)}\n${cause.message ?? ''}`;

    if (code === '23505' || /duplicate key/i.test(message)) {
      if (/inv_unit_products_label_uq/i.test(message)) {
        throw new ConflictError('Label (QR) já utilizado por outra unidade');
      }
      throw new ConflictError('Registro duplicado (violação de unicidade)');
    }
    if (code === '23503' || /foreign key/i.test(message)) {
      throw new ValidationError('Referência inexistente (item, projeto, foto ou movimento)');
    }
    if (code === '40001' || code === '40P01') {
      throw new ConflictError('Conflito de concorrência — tente novamente');
    }
    throw err;
  }
}

export const inventoryFieldService = new InventoryFieldService();
