import {
  InventoryItemRepository,
  inventoryItemRepository,
  InvItemRow,
  InvItemUpdatePatch,
} from '../../repositories/inventory/InventoryItemRepository';
import {
  CreateItemDTO,
  UpdateItemDTO,
  ItemListQuery,
  PutBomDTO,
} from '../../dto/request/InventoryDTO';
import {
  InvItemResponse,
  InvPaginatedResponse,
  InvStockBalanceResponse,
} from '../../dto/response/InventoryResponseDTO';
import type { InvItemDomain, InvPurchaseType, InvStockLocation } from '../../domain/entities/Inventory';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/AppError';

// =============================================================================
// RFC-0061 M1 — Catálogo & BOM business rules:
//   - name unique per (tenant, domain, lower(btrim(name))) — 23505 → 409
//   - W4 invariant: is_manufactured = true ⇒ domain = 'PRODUCT' (400)
//   - BOM PUT replaces the whole list; component ≠ product; quantity > 0
//   - DELETE with ledger/PO references (FK RESTRICT, 23503) → friendly 409
// =============================================================================

/** BOM read model (M1) — component list of a product. */
export interface InvBomComponentResponse {
  componentItemId: string;
  componentName: string;
  quantity: number;
}
export interface InvBomResponse {
  productItemId: string;
  components: InvBomComponentResponse[];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Drizzle/postgres-js wraps driver errors (DrizzleQueryError): the real
 * SQLSTATE lives on `err.cause`, not on the wrapper. Walk the cause chain.
 */
function pgSqlState(err: unknown): string | undefined {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** created_by/updated_by are uuid columns; req.context.userId may be 'system'. */
function asActorUuid(userId: string | undefined): string | null {
  return userId && UUID_REGEX.test(userId) ? userId : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class InventoryItemService {
  private repository: InventoryItemRepository;

  constructor(repository?: InventoryItemRepository) {
    this.repository = repository ?? inventoryItemRepository;
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  async listItems(tenantId: string, query: ItemListQuery): Promise<InvPaginatedResponse<InvItemResponse>> {
    const { items, total } = await this.repository.list(tenantId, {
      page: query.page,
      pageSize: query.pageSize,
      domain: query.domain,
      active: query.active,
      q: query.q,
    });

    return {
      items: items.map((row) => this.mapItem(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getItem(tenantId: string, id: string): Promise<InvItemResponse> {
    const row = await this.repository.getById(tenantId, id);
    if (!row) throw new NotFoundError(`Item ${id} not found`);
    return this.mapItem(row);
  }

  async createItem(tenantId: string, dto: CreateItemDTO, userId?: string): Promise<InvItemResponse> {
    // W4 invariant — the DTO mirrors it, the service is the authority.
    this.assertManufacturedInvariant(dto.isManufactured ?? false, dto.domain);

    try {
      const row = await this.repository.create({
        tenantId,
        name: dto.name,
        domain: dto.domain,
        link: dto.link ?? null,
        description: dto.description ?? null,
        isManufactured: dto.isManufactured ?? false,
        lossPercent: String(dto.lossPercent ?? 0),
        lotQuantity: dto.lotQuantity ?? null,
        purchaseType: dto.purchaseType ?? null,
        photoFileId: dto.photoFileId ?? null,
        active: dto.active ?? true,
        createdBy: asActorUuid(userId),
      });
      return this.mapItem(row);
    } catch (err) {
      this.rethrowUniqueNameViolation(err, dto.name, dto.domain);
    }
  }

  async updateItem(tenantId: string, id: string, dto: UpdateItemDTO, userId?: string): Promise<InvItemResponse> {
    const current = await this.repository.getById(tenantId, id);
    if (!current) throw new NotFoundError(`Item ${id} not found`);

    // Domain is immutable; validate the EFFECTIVE isManufactured against it.
    const effectiveManufactured = dto.isManufactured ?? current.isManufactured;
    this.assertManufacturedInvariant(effectiveManufactured, current.domain);

    const patch: InvItemUpdatePatch = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.link !== undefined) patch.link = dto.link;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.isManufactured !== undefined) patch.isManufactured = dto.isManufactured;
    if (dto.lossPercent !== undefined) patch.lossPercent = String(dto.lossPercent);
    if (dto.lotQuantity !== undefined) patch.lotQuantity = dto.lotQuantity;
    if (dto.purchaseType !== undefined) patch.purchaseType = dto.purchaseType;
    if (dto.photoFileId !== undefined) patch.photoFileId = dto.photoFileId;
    if (dto.active !== undefined) patch.active = dto.active;

    try {
      const row = await this.repository.update(tenantId, id, patch, asActorUuid(userId));
      if (!row) throw new NotFoundError(`Item ${id} not found`);
      return this.mapItem(row);
    } catch (err) {
      this.rethrowUniqueNameViolation(err, dto.name ?? current.name, current.domain);
    }
  }

  async deleteItem(tenantId: string, id: string): Promise<void> {
    const current = await this.repository.getById(tenantId, id);
    if (!current) throw new NotFoundError(`Item ${id} not found`);

    try {
      await this.repository.delete(tenantId, id);
    } catch (err) {
      if (pgSqlState(err) === '23503') {
        // FK RESTRICT — ledger movements / purchase orders reference the item.
        throw new ConflictError(
          'Item possui movimentações de estoque ou pedidos vinculados e não pode ser excluído',
        );
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Stock (GET /items/:id/stock)
  // ---------------------------------------------------------------------------

  async getItemStock(tenantId: string, id: string): Promise<InvStockBalanceResponse[]> {
    const item = await this.repository.getById(tenantId, id);
    if (!item) throw new NotFoundError(`Item ${id} not found`);

    const rows = await this.repository.getStockByItem(tenantId, id);
    return rows.map((row) => ({
      itemId: item.id,
      itemName: item.name,
      domain: item.domain as InvItemDomain,
      location: row.location as InvStockLocation,
      balance: Number(row.balance),
      totalIn: Number(row.totalIn),
      totalOut: Number(row.totalOut),
      lastMovementAt: toIso(row.lastMovementAt),
    }));
  }

  // ---------------------------------------------------------------------------
  // BOM
  // ---------------------------------------------------------------------------

  async getBom(tenantId: string, productItemId: string): Promise<InvBomResponse> {
    const item = await this.repository.getById(tenantId, productItemId);
    if (!item) throw new NotFoundError(`Item ${productItemId} not found`);

    const rows = await this.repository.getBom(tenantId, productItemId);
    return {
      productItemId,
      components: rows.map((r) => ({
        componentItemId: r.componentItemId,
        componentName: r.componentName,
        quantity: Number(r.quantity),
      })),
    };
  }

  /** Replace-all semantics: the payload IS the BOM; an empty list clears it. */
  async putBom(tenantId: string, productItemId: string, dto: PutBomDTO, userId?: string): Promise<InvBomResponse> {
    const product = await this.repository.getById(tenantId, productItemId);
    if (!product) throw new NotFoundError(`Item ${productItemId} not found`);
    if (product.domain !== 'PRODUCT') {
      throw new ValidationError('BOM is only supported for PRODUCT items');
    }

    const seen = new Set<string>();
    for (const component of dto.components) {
      if (component.componentItemId === productItemId) {
        throw new ValidationError('A product cannot be a component of its own BOM');
      }
      if (!(component.quantity > 0)) {
        throw new ValidationError('BOM component quantity must be greater than zero');
      }
      if (seen.has(component.componentItemId)) {
        throw new ValidationError(`Duplicate component in BOM: ${component.componentItemId}`);
      }
      seen.add(component.componentItemId);
    }

    const ids = dto.components.map((c) => c.componentItemId);
    const found = await this.repository.findByIds(tenantId, ids);
    const foundIds = new Set(found.map((r) => r.id));
    const missing = ids.filter((cid) => !foundIds.has(cid));
    if (missing.length > 0) {
      throw new ValidationError(`Component item(s) not found: ${missing.join(', ')}`);
    }

    await this.repository.replaceBom(
      tenantId,
      productItemId,
      dto.components.map((c) => ({ componentItemId: c.componentItemId, quantity: String(c.quantity) })),
      asActorUuid(userId),
    );

    return this.getBom(tenantId, productItemId);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertManufacturedInvariant(isManufactured: boolean, domain: string): void {
    if (isManufactured && domain !== 'PRODUCT') {
      throw new ValidationError('isManufactured requires domain=PRODUCT');
    }
  }

  /**
   * Map a unique violation on (tenant, domain, normalized_name) to a clear
   * 409. Appendix D has no item-name code, so the generic CONFLICT applies
   * (the DrizzleQueryError wrapper hides the SQLSTATE — read err.cause).
   */
  private rethrowUniqueNameViolation(err: unknown, name: string, domain: string): never {
    if (pgSqlState(err) === '23505') {
      throw new ConflictError(`Já existe um item com o nome "${name}" no domínio ${domain}`);
    }
    throw err;
  }

  private mapItem(row: InvItemRow): InvItemResponse {
    return {
      id: row.id,
      name: row.name,
      domain: row.domain as InvItemDomain,
      link: row.link,
      description: row.description,
      isManufactured: row.isManufactured,
      lossPercent: Number(row.lossPercent),
      lotQuantity: row.lotQuantity,
      purchaseType: row.purchaseType as InvPurchaseType | null,
      photoFileId: row.photoFileId,
      active: row.active,
      createdAt: toIso(row.createdAt) as string,
      updatedAt: toIso(row.updatedAt) as string,
    };
  }
}

// Singleton (service layer convention).
export const inventoryItemService = new InventoryItemService();
