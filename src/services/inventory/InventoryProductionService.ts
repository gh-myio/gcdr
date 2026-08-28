// =============================================================================
// RFC-0061 M4 — Produção service (business rules).
//
// Owns:
//   - Fila de Produção: pending demands grouped by product + ALMOXARIFADO
//     balance side-by-side (§M4).
//   - Liberação de Montagem: photo + responsibles + manufactured PRODUCT
//     items; consumes the demand queue FIFO (PENDENTE, created_at asc —
//     conclude or partial-reduce) and explodes the BOM into component SAIDA
//     movements (reason "Consumo de montagem") with the component's loss
//     factor, 3-decimal rounding — ALL inside one DB transaction.
//   - Divergências: issue report / resolve.
//   - Correção: edits released quantities with a FLOOR at already-homologated
//     units per item; positive delta → SAIDA, negative → ENTRADA (reason
//     "Correção de liberação de montagem", loss factor applied); resolves the
//     release's open issues.
//   - Capacidade: min over BOM components of floor(balance / (qty × loss)).
//   - Simulador: preview-only (DEC-13) — NO writes ever.
//
// Composing with M2 (trade-off, documented): InventoryStockService.
// createMovement opens its OWN transaction (repository.withTransaction), so it
// cannot join the release transaction. The M2 *repository* was explicitly
// designed for composition ("every mutating method accepts an optional
// executor"), so this service drives inventoryStockRepository.lockItem /
// getBalance / insertMovement with the release transaction's executor and
// re-applies the M2 negative-stock guard itself (same lock → derived balance →
// INV_INSUFFICIENT_STOCK sequence). Release + demand consumption + component
// SAIDAs therefore commit or roll back atomically — the release only exists if
// every component consumption succeeded.
//
// Component consumption location: FABRICA (assembly happens at the factory;
// homologation later moves finished goods into ALMOXARIFADO — §M5). The
// production queue shows the ALMOXARIFADO ("Estoque Myio") balance per §M4.
//
// M4 DTOs live here (exported Zod schemas): the RFC finalizes P2 DTOs at
// implementation time and src/dto is frozen for this PR (module-boundary
// rule) — follow-up: fold them into src/dto/request/InventoryDTO.ts in a
// consolidating PR.
// =============================================================================

import { z } from 'zod';
import {
  InventoryProductionRepository,
  inventoryProductionRepository,
  ProductionDbClient,
  InvAssemblyReleaseRow,
  InvAssemblyReleaseIssueRow,
  BomExplosionRow,
  ReleaseItemWithName,
} from '../../repositories/inventory/InventoryProductionRepository';
import {
  InventoryStockRepository,
  inventoryStockRepository,
} from '../../repositories/inventory/InventoryStockRepository';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/AppError';
import { alreadyInState, insufficientStock } from '../../shared/errors/InventoryError';
import type { InvPaginatedResponse } from '../../dto/response/InventoryResponseDTO';

// -----------------------------------------------------------------------------
// Request DTOs (M4 — finalized at implementation time per the RFC)
// -----------------------------------------------------------------------------

const uuid = z.string().uuid();

export const CreateAssemblyReleaseSchema = z
  .object({
    photoFileId: uuid,
    responsibles: z.array(uuid).min(1).max(50),
    notes: z.string().max(4096).optional(),
    items: z
      .array(z.object({ itemId: uuid, quantity: z.number().int().min(1).max(100000) }).strict())
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.itemId)).size !== v.items.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate itemId in items', path: ['items'] });
    }
  });
export type CreateAssemblyReleaseDTO = z.infer<typeof CreateAssemblyReleaseSchema>;

export const CreateReleaseIssueSchema = z
  .object({
    releaseItemId: uuid.optional(),
    itemId: uuid.optional(),
    reportedQuantity: z.number().int().min(0).max(100000).optional(),
    message: z.string().max(4096).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.reportedQuantity === undefined && !v.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an issue needs a reportedQuantity or a message',
        path: ['message'],
      });
    }
  });
export type CreateReleaseIssueDTO = z.infer<typeof CreateReleaseIssueSchema>;

export const ResolveIssueSchema = z
  .object({ resolutionNote: z.string().max(4096).optional() })
  .strict();
export type ResolveIssueDTO = z.infer<typeof ResolveIssueSchema>;

export const CorrectAssemblyReleaseSchema = z
  .object({
    items: z
      .array(z.object({ releaseItemId: uuid, quantity: z.number().int().min(1).max(100000) }).strict())
      .min(1)
      .max(200),
    resolutionNote: z.string().max(4096).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.releaseItemId)).size !== v.items.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate releaseItemId in items', path: ['items'] });
    }
  });
export type CorrectAssemblyReleaseDTO = z.infer<typeof CorrectAssemblyReleaseSchema>;

export const SimulatorPreviewSchema = z
  .object({
    items: z
      .array(z.object({ itemId: uuid, quantity: z.number().int().min(1).max(100000) }).strict())
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.itemId)).size !== v.items.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate itemId in items', path: ['items'] });
    }
  });
export type SimulatorPreviewDTO = z.infer<typeof SimulatorPreviewSchema>;

// -----------------------------------------------------------------------------
// Response read models
// -----------------------------------------------------------------------------

export interface InvProductionDemandGroupResponse {
  itemId: string;
  itemName: string;
  totalQuantity: number;
  demandCount: number;
  oldestCreatedAt: string | null;
  almoxarifadoBalance: number;
}

export interface InvAssemblyReleaseResponse {
  id: string;
  photoFileId: string;
  responsibles: string[];
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  items: Array<{ id: string; itemId: string; itemName: string; quantity: number }>;
}

export interface InvConsumedComponent {
  componentItemId: string;
  componentName: string;
  quantity: number;
  location: string;
}

export interface InvCreateReleaseResponse {
  release: InvAssemblyReleaseResponse;
  consumedComponents: InvConsumedComponent[];
  demandSummary: { concluded: number; reducedPartial: number };
}

export interface InvReleaseIssueResponse {
  id: string;
  releaseId: string;
  releaseItemId: string | null;
  itemId: string | null;
  reportedQuantity: number | null;
  message: string | null;
  status: string;
  resolutionNote: string | null;
  reportedBy: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface InvComponentAdjustment {
  componentItemId: string;
  componentName: string;
  movementType: 'SAIDA' | 'ENTRADA';
  quantity: number;
  location: string;
}

export interface InvCorrectReleaseResponse {
  release: InvAssemblyReleaseResponse;
  adjustments: InvComponentAdjustment[];
  resolvedIssues: number;
}

export interface InvCapacityComponent {
  componentItemId: string;
  componentName: string;
  bomQuantity: number;
  lossPercent: number;
  requiredPerUnit: number;
  balance: number;
  possible: number;
  limiting: boolean;
}

export interface InvCapacityRow {
  itemId: string;
  itemName: string;
  hasBom: boolean;
  /** null when the product has no BOM ("sem regras"). */
  possible: number | null;
  components: InvCapacityComponent[];
}

export interface InvSimulatorComponent {
  componentItemId: string;
  componentName: string;
  required: number;
  balance: number;
  missing: number;
  sufficient: boolean;
}

export interface InvSimulatorPreviewResponse {
  location: string;
  products: Array<{ itemId: string; itemName: string; quantity: number; hasBom: boolean }>;
  components: InvSimulatorComponent[];
  feasible: boolean;
}

// -----------------------------------------------------------------------------
// Seams (mocked in unit tests)
// -----------------------------------------------------------------------------

export type IInventoryProductionRepository = Pick<
  InventoryProductionRepository,
  | 'withTransaction'
  | 'listPendingDemandsGrouped'
  | 'lockPendingDemandsForItem'
  | 'concludeDemand'
  | 'reduceDemandQuantity'
  | 'insertRelease'
  | 'insertReleaseItems'
  | 'listReleases'
  | 'listReleaseItems'
  | 'getReleaseById'
  | 'updateReleaseItemQuantity'
  | 'deleteRelease'
  | 'homologatedCountsByItem'
  | 'insertIssue'
  | 'listIssues'
  | 'getIssueById'
  | 'resolveIssue'
  | 'resolveOpenIssues'
  | 'getBomsForProducts'
  | 'listManufacturedProducts'
  | 'findItemsByIds'
  | 'componentBalances'
>;

/** The M2 seam this service composes inside the release transaction. */
export type IProductionStockRepository = Pick<
  InventoryStockRepository,
  'lockItem' | 'getBalance' | 'insertMovement'
>;

export interface ProductionContext {
  tenantId: string;
  userId?: string;
}

// -----------------------------------------------------------------------------
// Constants & numeric helpers
// -----------------------------------------------------------------------------

/** Components are consumed from the factory floor (see header). */
export const COMPONENT_LOCATION = 'FABRICA';
export const REASON_ASSEMBLY_CONSUMPTION = 'Consumo de montagem';
export const REASON_ASSEMBLY_CORRECTION = 'Correção de liberação de montagem';

// Idempotency cache tuning (best-effort, per-process — same M2 pattern).
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 5000;

/** Kill FP noise at micro precision, then round half-up to 3 decimals. */
export function round3(n: number): number {
  return Math.round(Math.round(n * 1e6) / 1000) / 1000;
}

/** Ceil to 3 decimals (simulator — never under-reserve components). */
export function ceil3(n: number): number {
  return Math.ceil(Math.round(n * 1e6) / 1000) / 1000;
}

function lossFactor(lossPercent: string | number): number {
  return 1 + Number(lossPercent) / 100;
}

/** floor(balance / perUnit) on micro-integers (no FP division drift). */
function floorDiv(balance: number, perUnit: number): number {
  const perUnitMicro = Math.round(perUnit * 1e6);
  if (perUnitMicro <= 0) return 0;
  return Math.floor(Math.round(balance * 1e6) / perUnitMicro);
}

export class InventoryProductionService {
  private repository: IInventoryProductionRepository;

  private stockRepository: IProductionStockRepository;

  private idempotencyCache = new Map<string, { at: number; promise: Promise<unknown> }>();

  constructor(repository?: IInventoryProductionRepository, stockRepository?: IProductionStockRepository) {
    this.repository = repository ?? inventoryProductionRepository;
    this.stockRepository = stockRepository ?? inventoryStockRepository;
  }

  // ---------------------------------------------------------------------------
  // Fila de Produção
  // ---------------------------------------------------------------------------

  async listDemands(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<InvPaginatedResponse<InvProductionDemandGroupResponse>> {
    const { rows, total } = await this.repository.listPendingDemandsGrouped(tenantId, page, pageSize);
    return {
      items: rows.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        totalQuantity: r.totalQuantity,
        demandCount: r.demandCount,
        oldestCreatedAt: r.oldestCreatedAt ? r.oldestCreatedAt.toISOString() : null,
        almoxarifadoBalance: Number(r.almoxarifadoBalance),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // Liberação de Montagem
  // ---------------------------------------------------------------------------

  async listReleases(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<InvPaginatedResponse<InvAssemblyReleaseResponse>> {
    const { rows, total } = await this.repository.listReleases(tenantId, page, pageSize);
    const items = await this.repository.listReleaseItems(tenantId, rows.map((r) => r.id));
    const byRelease = new Map<string, ReleaseItemWithName[]>();
    for (const item of items) {
      const list = byRelease.get(item.releaseId) ?? [];
      list.push(item);
      byRelease.set(item.releaseId, list);
    }
    return {
      items: rows.map((r) => this.toReleaseResponse(r, byRelease.get(r.id) ?? [])),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async createRelease(
    ctx: ProductionContext,
    dto: CreateAssemblyReleaseDTO,
    idempotencyKey: string,
  ): Promise<InvCreateReleaseResponse> {
    return this.idempotent(ctx.tenantId, `release:${idempotencyKey}`, () =>
      this.doCreateRelease(ctx, dto),
    );
  }

  private async doCreateRelease(
    ctx: ProductionContext,
    dto: CreateAssemblyReleaseDTO,
  ): Promise<InvCreateReleaseResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        // 1) Validate + lock the products (deterministic id order — deadlock
        //    hygiene: products first, then components, each sorted).
        const sortedItems = [...dto.items].sort((a, b) => a.itemId.localeCompare(b.itemId));
        const nameById = new Map<string, string>();
        for (const entry of sortedItems) {
          const item = await this.stockRepository.lockItem(ctx.tenantId, entry.itemId, tx);
          if (!item) throw new NotFoundError(`Item ${entry.itemId} not found`);
          if (item.domain !== 'PRODUCT' || !item.isManufactured) {
            throw new ValidationError(
              `Liberação de montagem aceita apenas produtos manufaturados (item ${item.name})`,
            );
          }
          nameById.set(item.id, item.name);
        }

        // 2) Release + items.
        const release = await this.repository.insertRelease(
          {
            tenantId: ctx.tenantId,
            photoFileId: dto.photoFileId,
            responsibles: dto.responsibles,
            notes: dto.notes ?? null,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );
        const releaseItems = await this.repository.insertReleaseItems(
          dto.items.map((i) => ({
            tenantId: ctx.tenantId,
            releaseId: release.id,
            itemId: i.itemId,
            quantity: i.quantity,
          })),
          tx,
        );

        // 3) FIFO demand consumption (PENDENTE per item, created_at asc).
        const demandSummary = { concluded: 0, reducedPartial: 0 };
        for (const entry of sortedItems) {
          let remaining = entry.quantity;
          if (remaining <= 0) continue;
          const queue = await this.repository.lockPendingDemandsForItem(ctx.tenantId, entry.itemId, tx);
          for (const demand of queue) {
            if (remaining <= 0) break;
            if (demand.quantity <= remaining) {
              await this.repository.concludeDemand(ctx.tenantId, demand.id, tx);
              remaining -= demand.quantity;
              demandSummary.concluded += 1;
            } else {
              await this.repository.reduceDemandQuantity(
                ctx.tenantId,
                demand.id,
                demand.quantity - remaining,
                tx,
              );
              remaining = 0;
              demandSummary.reducedPartial += 1;
            }
          }
        }

        // 4) BOM explosion → component SAIDAs with loss factor (§M4):
        //    Σ bom.quantity × produced × (1 + loss_percent/100), rounded to 3
        //    decimals per component AFTER summing across products.
        const boms = await this.repository.getBomsForProducts(
          ctx.tenantId,
          dto.items.map((i) => i.itemId),
          tx,
        );
        const producedByItem = new Map(dto.items.map((i) => [i.itemId, i.quantity]));
        const consumption = this.explodeBom(boms, producedByItem);

        const consumedComponents: InvConsumedComponent[] = [];
        for (const comp of consumption) {
          if (comp.quantity <= 0) continue;
          await this.consumeComponent(ctx, comp.componentItemId, comp.quantity, {
            reason: REASON_ASSEMBLY_CONSUMPTION,
            photoFileId: dto.photoFileId,
            tx,
          });
          consumedComponents.push({ ...comp, location: COMPONENT_LOCATION });
        }

        return {
          release: this.toReleaseResponse(
            release,
            releaseItems.map((ri) => ({
              id: ri.id,
              itemId: ri.itemId,
              itemName: nameById.get(ri.itemId) ?? '',
              quantity: ri.quantity,
            })),
          ),
          consumedComponents,
          demandSummary,
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Divergências (issues)
  // ---------------------------------------------------------------------------

  async reportIssue(
    ctx: ProductionContext,
    releaseId: string,
    dto: CreateReleaseIssueDTO,
  ): Promise<InvReleaseIssueResponse> {
    const found = await this.repository.getReleaseById(ctx.tenantId, releaseId);
    if (!found) throw new NotFoundError(`Assembly release ${releaseId} not found`);
    if (dto.releaseItemId && !found.items.some((i) => i.id === dto.releaseItemId)) {
      throw new ValidationError(`releaseItemId ${dto.releaseItemId} does not belong to release ${releaseId}`);
    }
    try {
      const row = await this.repository.insertIssue({
        tenantId: ctx.tenantId,
        releaseId,
        releaseItemId: dto.releaseItemId ?? null,
        itemId: dto.itemId ?? null,
        reportedQuantity: dto.reportedQuantity ?? null,
        message: dto.message ?? null,
        reportedBy: ctx.userId ?? null,
      });
      return this.toIssueResponse(row);
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async listIssues(
    tenantId: string,
    releaseId: string,
    page: number,
    pageSize: number,
  ): Promise<InvPaginatedResponse<InvReleaseIssueResponse>> {
    const found = await this.repository.getReleaseById(tenantId, releaseId);
    if (!found) throw new NotFoundError(`Assembly release ${releaseId} not found`);
    const { rows, total } = await this.repository.listIssues(tenantId, releaseId, page, pageSize);
    return {
      items: rows.map((r) => this.toIssueResponse(r)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async resolveIssue(
    ctx: ProductionContext,
    issueId: string,
    dto: ResolveIssueDTO,
  ): Promise<InvReleaseIssueResponse> {
    const issue = await this.repository.getIssueById(ctx.tenantId, issueId);
    if (!issue) throw new NotFoundError(`Issue ${issueId} not found`);
    if (issue.status === 'RESOLVIDA') throw alreadyInState('RESOLVIDA');
    try {
      const row = await this.repository.resolveIssue(
        ctx.tenantId,
        issueId,
        ctx.userId ?? null,
        dto.resolutionNote ?? null,
      );
      // The guarded UPDATE (status='ABERTA') lost a race → already resolved.
      if (!row) throw alreadyInState('RESOLVIDA');
      return this.toIssueResponse(row);
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Correção de liberação
  // ---------------------------------------------------------------------------

  async correctRelease(
    ctx: ProductionContext,
    releaseId: string,
    dto: CorrectAssemblyReleaseDTO,
  ): Promise<InvCorrectReleaseResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const found = await this.repository.getReleaseById(ctx.tenantId, releaseId, tx);
        if (!found) throw new NotFoundError(`Assembly release ${releaseId} not found`);
        const itemsById = new Map(found.items.map((i) => [i.id, i]));

        // FLOOR: units already homologated per item (M5 tables, read-only).
        const homologated = new Map(
          (await this.repository.homologatedCountsByItem(ctx.tenantId, releaseId, tx)).map((h) => [
            h.itemId,
            h.homologatedCount,
          ]),
        );

        // Signed per-component delta, aggregated across the corrected items.
        const deltaByProduct = new Map<string, number>();
        for (const entry of dto.items) {
          const releaseItem = itemsById.get(entry.releaseItemId);
          if (!releaseItem) {
            throw new ValidationError(
              `releaseItemId ${entry.releaseItemId} does not belong to release ${releaseId}`,
            );
          }
          const floor = homologated.get(releaseItem.itemId) ?? 0;
          if (entry.quantity < floor) {
            throw new ConflictError(
              `Quantidade (${entry.quantity}) abaixo do já homologado (${floor}) para o item ${releaseItem.itemName}`,
            );
          }
          const delta = entry.quantity - releaseItem.quantity;
          if (delta !== 0) {
            deltaByProduct.set(
              releaseItem.itemId,
              (deltaByProduct.get(releaseItem.itemId) ?? 0) + delta,
            );
            await this.repository.updateReleaseItemQuantity(
              ctx.tenantId,
              releaseItem.id,
              entry.quantity,
              tx,
            );
          }
        }

        // BOM explosion of the signed deltas → net component adjustments.
        const boms = await this.repository.getBomsForProducts(
          ctx.tenantId,
          [...deltaByProduct.keys()],
          tx,
        );
        const netByComponent = new Map<string, { name: string; micro: number }>();
        for (const bom of boms) {
          const delta = deltaByProduct.get(bom.productItemId) ?? 0;
          if (delta === 0) continue;
          const amount = Number(bom.quantity) * delta * lossFactor(bom.lossPercent);
          const acc = netByComponent.get(bom.componentItemId) ?? { name: bom.componentName, micro: 0 };
          acc.micro += Math.round(amount * 1e6);
          netByComponent.set(bom.componentItemId, acc);
        }

        const adjustments: InvComponentAdjustment[] = [];
        const sortedComponents = [...netByComponent.entries()].sort(([a], [b]) => a.localeCompare(b));
        for (const [componentItemId, acc] of sortedComponents) {
          const net = Math.round(acc.micro / 1000) / 1000; // 3-decimal grain
          if (net === 0) continue;
          if (net > 0) {
            await this.consumeComponent(ctx, componentItemId, net, {
              reason: REASON_ASSEMBLY_CORRECTION,
              photoFileId: found.release.photoFileId,
              tx,
            });
            adjustments.push({
              componentItemId,
              componentName: acc.name,
              movementType: 'SAIDA',
              quantity: net,
              location: COMPONENT_LOCATION,
            });
          } else {
            await this.stockRepository.insertMovement(
              {
                tenantId: ctx.tenantId,
                itemId: componentItemId,
                location: COMPONENT_LOCATION,
                quantity: String(-net),
                type: 'ENTRADA',
                reason: REASON_ASSEMBLY_CORRECTION,
                createdBy: ctx.userId ?? null,
              },
              tx,
            );
            adjustments.push({
              componentItemId,
              componentName: acc.name,
              movementType: 'ENTRADA',
              quantity: -net,
              location: COMPONENT_LOCATION,
            });
          }
        }

        const resolvedIssues = await this.repository.resolveOpenIssues(
          ctx.tenantId,
          releaseId,
          ctx.userId ?? null,
          dto.resolutionNote ?? 'Resolvida via correção de liberação',
          tx,
        );

        const updated = await this.repository.getReleaseById(ctx.tenantId, releaseId, tx);
        return {
          release: this.toReleaseResponse(updated?.release ?? found.release, updated?.items ?? found.items),
          adjustments,
          resolvedIssues,
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Hard delete of a release: schema cascades remove its items, issues and its
   * homologations (+units). Stock movements are intentionally NOT reversed —
   * parity with the source system, where deleting a release keeps the ledger
   * history (an explicit AJUSTE, audited as such, is the correction path).
   */
  async deleteRelease(ctx: ProductionContext, releaseId: string): Promise<{ deleted: boolean }> {
    try {
      const deleted = await this.repository.deleteRelease(ctx.tenantId, releaseId);
      if (!deleted) throw new NotFoundError(`Assembly release ${releaseId} not found`);
      return { deleted: true };
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Capacidade
  // ---------------------------------------------------------------------------

  async getCapacity(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<InvPaginatedResponse<InvCapacityRow>> {
    const { rows: products, total } = await this.repository.listManufacturedProducts(
      tenantId,
      page,
      pageSize,
    );
    const boms = await this.repository.getBomsForProducts(tenantId, products.map((p) => p.id));
    const componentIds = [...new Set(boms.map((b) => b.componentItemId))];
    const balances = new Map(
      (await this.repository.componentBalances(tenantId, componentIds, COMPONENT_LOCATION)).map((b) => [
        b.itemId,
        Number(b.balance),
      ]),
    );

    const bomsByProduct = new Map<string, BomExplosionRow[]>();
    for (const bom of boms) {
      const list = bomsByProduct.get(bom.productItemId) ?? [];
      list.push(bom);
      bomsByProduct.set(bom.productItemId, list);
    }

    const items: InvCapacityRow[] = products.map((product) => {
      const productBoms = bomsByProduct.get(product.id) ?? [];
      if (productBoms.length === 0) {
        // "sem regras" — the product has no BOM to compute capacity from.
        return { itemId: product.id, itemName: product.name, hasBom: false, possible: null, components: [] };
      }
      const components = productBoms.map((bom) => {
        const balance = balances.get(bom.componentItemId) ?? 0;
        const requiredPerUnit = round3(Number(bom.quantity) * lossFactor(bom.lossPercent));
        const possible = Math.max(0, floorDiv(balance, Number(bom.quantity) * lossFactor(bom.lossPercent)));
        return {
          componentItemId: bom.componentItemId,
          componentName: bom.componentName,
          bomQuantity: Number(bom.quantity),
          lossPercent: Number(bom.lossPercent),
          requiredPerUnit,
          balance,
          possible,
          limiting: false,
        };
      });
      const possible = Math.min(...components.map((c) => c.possible));
      for (const c of components) c.limiting = c.possible === possible;
      return { itemId: product.id, itemName: product.name, hasBom: true, possible, components };
    });

    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  // ---------------------------------------------------------------------------
  // Simulador (DEC-13: preview-only — NO writes)
  // ---------------------------------------------------------------------------

  async previewSimulation(tenantId: string, dto: SimulatorPreviewDTO): Promise<InvSimulatorPreviewResponse> {
    const itemIds = dto.items.map((i) => i.itemId);
    const catalog = await this.repository.findItemsByIds(tenantId, itemIds);
    const catalogById = new Map(catalog.map((c) => [c.id, c]));
    for (const entry of dto.items) {
      const item = catalogById.get(entry.itemId);
      if (!item) throw new NotFoundError(`Item ${entry.itemId} not found`);
      if (item.domain !== 'PRODUCT' || !item.isManufactured) {
        throw new ValidationError(`Simulador aceita apenas produtos manufaturados (item ${item.name})`);
      }
    }

    const boms = await this.repository.getBomsForProducts(tenantId, itemIds);
    const bomProducts = new Set(boms.map((b) => b.productItemId));
    const desiredByItem = new Map(dto.items.map((i) => [i.itemId, i.quantity]));

    // Required per component = ceil3(Σ bom.qty × desired × loss factor).
    const requiredByComponent = new Map<string, { name: string; micro: number }>();
    for (const bom of boms) {
      const desired = desiredByItem.get(bom.productItemId) ?? 0;
      if (desired <= 0) continue;
      const amount = Number(bom.quantity) * desired * lossFactor(bom.lossPercent);
      const acc = requiredByComponent.get(bom.componentItemId) ?? { name: bom.componentName, micro: 0 };
      acc.micro += Math.round(amount * 1e6);
      requiredByComponent.set(bom.componentItemId, acc);
    }

    const componentIds = [...requiredByComponent.keys()];
    const balances = new Map(
      (await this.repository.componentBalances(tenantId, componentIds, COMPONENT_LOCATION)).map((b) => [
        b.itemId,
        Number(b.balance),
      ]),
    );

    const components: InvSimulatorComponent[] = [...requiredByComponent.entries()]
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
      .map(([componentItemId, acc]) => {
        const required = Math.ceil(acc.micro / 1000) / 1000; // ceil to 3 decimals
        const balance = balances.get(componentItemId) ?? 0;
        const missing = Math.max(0, round3(required - balance));
        return {
          componentItemId,
          componentName: acc.name,
          required,
          balance,
          missing,
          sufficient: missing === 0,
        };
      });

    return {
      location: COMPONENT_LOCATION,
      products: dto.items.map((i) => ({
        itemId: i.itemId,
        itemName: catalogById.get(i.itemId)?.name ?? '',
        quantity: i.quantity,
        hasBom: bomProducts.has(i.itemId),
      })),
      components,
      feasible: components.length > 0 && components.every((c) => c.sufficient),
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Σ bom.qty × produced × loss factor per component, rounded to 3 decimals. */
  private explodeBom(
    boms: BomExplosionRow[],
    producedByItem: Map<string, number>,
  ): Array<{ componentItemId: string; componentName: string; quantity: number }> {
    const acc = new Map<string, { name: string; micro: number }>();
    for (const bom of boms) {
      const produced = producedByItem.get(bom.productItemId) ?? 0;
      if (produced <= 0) continue;
      const amount = Number(bom.quantity) * produced * lossFactor(bom.lossPercent);
      const entry = acc.get(bom.componentItemId) ?? { name: bom.componentName, micro: 0 };
      entry.micro += Math.round(amount * 1e6);
      acc.set(bom.componentItemId, entry);
    }
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b)) // deterministic lock order
      .map(([componentItemId, entry]) => ({
        componentItemId,
        componentName: entry.name,
        quantity: Math.round(entry.micro / 1000) / 1000,
      }));
  }

  /**
   * Component SAIDA under the M2 guard sequence, composed with the release
   * transaction: FOR UPDATE item lock → derived balance → guard → insert.
   */
  private async consumeComponent(
    ctx: ProductionContext,
    componentItemId: string,
    quantity: number,
    opts: { reason: string; photoFileId?: string | null; tx: ProductionDbClient },
  ): Promise<void> {
    const item = await this.stockRepository.lockItem(ctx.tenantId, componentItemId, opts.tx);
    if (!item) throw new NotFoundError(`Component ${componentItemId} not found`);
    const totals = await this.stockRepository.getBalance(
      ctx.tenantId,
      componentItemId,
      COMPONENT_LOCATION,
      opts.tx,
    );
    const balance = Number(totals.balance);
    if (Math.round(balance * 1000) < Math.round(quantity * 1000)) {
      throw insufficientStock(componentItemId, COMPONENT_LOCATION, balance, quantity);
    }
    await this.stockRepository.insertMovement(
      {
        tenantId: ctx.tenantId,
        itemId: componentItemId,
        location: COMPONENT_LOCATION,
        quantity: String(quantity),
        type: 'SAIDA',
        reason: opts.reason,
        photoFileId: opts.photoFileId ?? null,
        createdBy: ctx.userId ?? null,
      },
      opts.tx,
    );
  }

  private toReleaseResponse(
    row: InvAssemblyReleaseRow,
    items: ReleaseItemWithName[],
  ): InvAssemblyReleaseResponse {
    return {
      id: row.id,
      photoFileId: row.photoFileId,
      responsibles: row.responsibles ?? [],
      notes: row.notes ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      createdBy: row.createdBy ?? null,
      items: items.map((i) => ({ id: i.id, itemId: i.itemId, itemName: i.itemName, quantity: i.quantity })),
    };
  }

  private toIssueResponse(row: InvAssemblyReleaseIssueRow): InvReleaseIssueResponse {
    return {
      id: row.id,
      releaseId: row.releaseId,
      releaseItemId: row.releaseItemId ?? null,
      itemId: row.itemId ?? null,
      reportedQuantity: row.reportedQuantity ?? null,
      message: row.message ?? null,
      status: row.status,
      resolutionNote: row.resolutionNote ?? null,
      reportedBy: row.reportedBy ?? null,
      resolvedBy: row.resolvedBy ?? null,
      resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Idempotency (best-effort, per-process — same M2 pattern; durable storage
  // is the standing inv_idempotency_keys follow-up from the M2 PR).
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
    // A failed attempt must NOT poison the key — retries reuse it on purpose.
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
  // Error mapping (Drizzle gotcha: the real SQLSTATE lives on `err.cause`)
  // ---------------------------------------------------------------------------

  private mapRepoError(err: unknown): never {
    if (err instanceof AppError) throw err;
    const top = err as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    const cause = top.cause ?? {};
    const code = cause.code ?? top.code;
    const message = `${top.message ?? String(err)}\n${cause.message ?? ''}`;

    if (code === '23505' || /duplicate key/i.test(message)) {
      throw new ConflictError('Registro duplicado (violação de unicidade)');
    }
    if (code === '23503' || /foreign key/i.test(message)) {
      throw new ValidationError('Referência inexistente (item, foto, release ou demanda)');
    }
    if (code === '23514' || /check constraint/i.test(message)) {
      throw new ValidationError('Valor viola uma restrição do banco (quantidade/status)');
    }
    if (code === '40001' || code === '40P01') {
      throw new ConflictError('Conflito de concorrência — tente novamente');
    }
    throw err;
  }
}

export const inventoryProductionService = new InventoryProductionService();
