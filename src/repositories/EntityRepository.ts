import { eq, and, or, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { RegistryEntity, EntityType } from '../domain/entities/Entity';
import {
  CreateEntityDTO,
  UpdateEntityDTO,
  ListEntitiesQueryDTO,
  BulkReplaceDTO,
  BulkReplaceNodeInput,
  ENTITY_MAX_DEPTH,
  ENTITY_DEFAULT_PAGE_SIZE,
} from '../dto/request/EntityDTO';
import { PaginatedResult } from '../shared/types';
import {
  IEntityRepository,
  ResolvedEntities,
  DeepOptions,
  ResolveOptions,
} from './interfaces/IEntityRepository';
import { AppError } from '../shared/errors/AppError';
import { countWhere } from './helpers/countQuery';
import { generateId } from '../shared/utils/idGenerator';

const { entities, entityTypes } = schema;

/** The Drizzle transaction client passed to `db.transaction(async (tx) => …)`. */
type EntityTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type EntityRow = typeof entities.$inferSelect;
type EntityTypeRow = typeof entityTypes.$inferSelect;

/**
 * RFC-0047 — Generic Entity Registry · repository (Drizzle).
 *
 * Tenant-scoped, soft-delete-aware data access over `entities` + `entity_types`.
 * The service layer owns business rules (uniqueness translation, parent-type,
 * optimistic version, SYSTEM_PROTECTED→HTTP, metadata Zod); here we only run the
 * plain Drizzle queries and let DB errors (unique violation, the trigger's
 * `SYSTEM_PROTECTED`, `ENTITY_CYCLE`) propagate untouched.
 */
export class EntityRepository implements IEntityRepository {
  // ===========================================================================
  // entity_types registry
  // ===========================================================================

  async listEntityTypes(tenantId: string): Promise<EntityType[]> {
    const rows = await db
      .select()
      .from(entityTypes)
      .where(eq(entityTypes.tenantId, tenantId))
      .orderBy(entityTypes.entityType);

    return rows.map((r) => this.mapTypeToEntity(r));
  }

  async getEntityType(tenantId: string, entityType: string): Promise<EntityType | null> {
    const [row] = await db
      .select()
      .from(entityTypes)
      .where(and(eq(entityTypes.tenantId, tenantId), eq(entityTypes.entityType, entityType)))
      .limit(1);

    return row ? this.mapTypeToEntity(row) : null;
  }

  async createEntityType(
    tenantId: string,
    data: { entityType: string; label: string; description?: string | null; allowedParentTypes: string[] },
  ): Promise<EntityType> {
    const [row] = await db
      .insert(entityTypes)
      .values({
        tenantId,
        entityType: data.entityType,
        label: data.label,
        description: data.description ?? null,
        allowedParentTypes: data.allowedParentTypes,
        isActive: true,
      })
      .returning();

    return this.mapTypeToEntity(row);
  }

  async updateEntityType(
    tenantId: string,
    entityType: string,
    data: { label?: string; description?: string | null; allowedParentTypes?: string[]; isActive?: boolean },
  ): Promise<EntityType> {
    const patch: Partial<typeof entityTypes.$inferInsert> = {};
    if (data.label !== undefined) patch.label = data.label;
    if (data.description !== undefined) patch.description = data.description;
    if (data.allowedParentTypes !== undefined) patch.allowedParentTypes = data.allowedParentTypes;
    if (data.isActive !== undefined) patch.isActive = data.isActive;

    const [row] = await db
      .update(entityTypes)
      .set(patch)
      .where(and(eq(entityTypes.tenantId, tenantId), eq(entityTypes.entityType, entityType)))
      .returning();

    return this.mapTypeToEntity(row);
  }

  async deleteEntityType(tenantId: string, entityType: string): Promise<void> {
    // ON DELETE RESTRICT on entities.entity_type → Postgres 23503 if still in
    // use; the service maps that to 409 TYPE_IN_USE.
    await db
      .delete(entityTypes)
      .where(and(eq(entityTypes.tenantId, tenantId), eq(entityTypes.entityType, entityType)));
  }

  // ===========================================================================
  // entities CRUD
  // ===========================================================================

  async create(tenantId: string, data: CreateEntityDTO, createdBy: string): Promise<RegistryEntity> {
    const [row] = await db
      .insert(entities)
      .values({
        tenantId,
        customerId: data.customerId ?? null,
        entityType: data.entityType,
        entityKey: data.entityKey,
        entityValue: data.entityValue ?? null,
        parentEntityId: data.parentEntityId ?? null,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
        isSystem: data.isSystem ?? false,
        metadata: data.metadata ?? {},
        createdBy,
        updatedBy: createdBy,
      })
      .returning();

    return this.mapToEntity(row);
  }

  async getById(tenantId: string, id: string, options?: DeepOptions): Promise<RegistryEntity | null> {
    const includeDeleted = options?.includeDeleted ?? false;
    const conditions = [eq(entities.tenantId, tenantId), eq(entities.id, id)];
    if (!includeDeleted) conditions.push(eq(entities.isDeleted, false));

    const [row] = await db
      .select()
      .from(entities)
      .where(and(...conditions))
      .limit(1);

    if (!row) return null;

    const node = this.mapToEntity(row);
    const deep = this.normalizeDeep(options?.deep);
    if (deep >= 1) {
      node.children = await this.fetchSubtree(tenantId, id, deep, 1, options);
    }
    return node;
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateEntityDTO,
    updatedBy: string,
    options?: { isAdmin?: boolean; metadataMode?: 'merge' | 'replace' },
  ): Promise<RegistryEntity> {
    const run = async (tx: EntityTx): Promise<RegistryEntity> => {
      // Admin path: set the GUC so the entities_protect_system trigger bypasses
      // for this transaction (SET LOCAL → scoped to the tx, auto-reset on commit).
      if (options?.isAdmin) {
        await tx.execute(sql`SELECT set_config('app.is_admin', 'on', true)`);
      }

      const existing = await tx
        .select()
        .from(entities)
        .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id), eq(entities.isDeleted, false)))
        .limit(1);

      const current = existing[0];
      if (!current) throw new AppError('NOT_FOUND', `Entity ${id} not found`, 404);

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
        updatedBy,
        version: current.version + 1,
      };

      if (data.entityKey !== undefined) updateData.entityKey = data.entityKey;
      if (data.entityValue !== undefined) updateData.entityValue = data.entityValue;
      if (data.parentEntityId !== undefined) updateData.parentEntityId = data.parentEntityId;
      if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;

      if (data.metadata !== undefined) {
        if (options?.metadataMode === 'replace') {
          updateData.metadata = data.metadata;
        } else {
          // JSON Merge Patch (RFC 7396) top-level merge: null removes a key.
          const merged: Record<string, unknown> = {
            ...(current.metadata as Record<string, unknown>),
          };
          for (const [k, v] of Object.entries(data.metadata)) {
            if (v === null) delete merged[k];
            else merged[k] = v;
          }
          updateData.metadata = merged;
        }
      }

      const [row] = await tx
        .update(entities)
        .set(updateData)
        .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id), eq(entities.isDeleted, false)))
        .returning();

      if (!row) throw new AppError('NOT_FOUND', `Entity ${id} not found`, 404);
      return this.mapToEntity(row);
    };

    return db.transaction(run);
  }

  async softDelete(tenantId: string, id: string, updatedBy: string): Promise<void> {
    const [row] = await db
      .update(entities)
      .set({ isDeleted: true, updatedAt: new Date(), updatedBy })
      .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id), eq(entities.isDeleted, false)))
      .returning({ id: entities.id });

    if (!row) throw new AppError('NOT_FOUND', `Entity ${id} not found`, 404);
  }

  async hardDelete(tenantId: string, id: string, options?: { cascade?: boolean }): Promise<void> {
    if (options?.cascade) {
      // Delete the whole subtree (descendants first) so ON DELETE RESTRICT on the
      // self-FK does not block. Bounded recursive CTE collects descendant ids.
      await db.execute(sql`
        WITH RECURSIVE subtree AS (
          SELECT ${entities.id} AS id
          FROM ${entities}
          WHERE ${entities.tenantId} = ${tenantId} AND ${entities.id} = ${id}
          UNION ALL
          SELECT e.id
          FROM ${entities} e
          JOIN subtree s ON e.parent_entity_id = s.id
          WHERE e.tenant_id = ${tenantId}
        )
        DELETE FROM ${entities}
        WHERE ${entities.tenantId} = ${tenantId}
          AND ${entities.id} IN (SELECT id FROM subtree)
      `);
      return;
    }

    await db
      .delete(entities)
      .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id)));
  }

  async restore(tenantId: string, id: string, updatedBy: string): Promise<RegistryEntity> {
    const [row] = await db
      .update(entities)
      .set({ isDeleted: false, updatedAt: new Date(), updatedBy })
      .where(and(eq(entities.tenantId, tenantId), eq(entities.id, id), eq(entities.isDeleted, true)))
      .returning();

    if (!row) throw new AppError('NOT_FOUND', `Entity ${id} not found`, 404);
    return this.mapToEntity(row);
  }

  // ===========================================================================
  // list / traversal
  // ===========================================================================

  async list(tenantId: string, params: ListEntitiesQueryDTO): Promise<PaginatedResult<RegistryEntity>> {
    const pageSize = params.pageSize ?? ENTITY_DEFAULT_PAGE_SIZE;
    const page = params.page ?? 1;
    const offset = (page - 1) * pageSize;

    const conditions = this.buildListConditions(tenantId, params);
    const orderBy = this.buildOrderBy(params.sort);

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(entities)
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset(offset),
      countWhere(entities, conditions),
    ]);

    const items: RegistryEntity[] = [];
    const deep = this.normalizeDeep(params.deep);
    for (const row of rows) {
      const node = this.mapToEntity(row);
      if (deep >= 1) {
        node.children = await this.fetchSubtree(tenantId, node.id, deep, 1, {
          state: params.state,
          includeDeleted: params.includeDeleted,
        });
      }
      items.push(node);
    }

    return {
      items,
      pagination: {
        total,
        totalPages: Math.ceil(total / pageSize),
        hasMore: offset + rows.length < total,
        nextCursor: offset + rows.length < total ? String(page + 1) : undefined,
      },
    };
  }

  async getChildren(tenantId: string, parentId: string, options?: DeepOptions): Promise<RegistryEntity[]> {
    const deep = this.normalizeDeep(options?.deep);
    // deep<=1 → direct children only; deep>1 → bounded subtree.
    return this.fetchSubtree(tenantId, parentId, Math.max(deep, 1), 1, options);
  }

  async resolve(tenantId: string, customerId: string, options?: ResolveOptions): Promise<ResolvedEntities> {
    const hasCustomer = await this.hasCustomerRows(tenantId, customerId);
    const source: 'customer' | 'system' = hasCustomer ? 'customer' : 'system';

    const state = options?.state ?? 'active';
    const deep = this.normalizeDeep(options?.deep);

    const scopeCond = hasCustomer
      ? eq(entities.customerId, customerId)
      : isNull(entities.customerId);

    const conditions: SQL[] = [
      eq(entities.tenantId, tenantId),
      scopeCond,
      eq(entities.isDeleted, false),
    ];
    const stateCond = this.stateCondition(state);
    if (stateCond) conditions.push(stateCond);

    // Whole forest for the resolved scope, ordered deterministically. We materialize
    // the flat set then build the forest in-memory (bounded by ENTITY_MAX_DEPTH).
    const rows = await db
      .select()
      .from(entities)
      .where(and(...conditions))
      .orderBy(entities.sortOrder, entities.entityKey);

    const roots = this.buildForest(rows, deep >= 1 ? deep : 1);

    return { source, roots, version: this.computeVersion(rows) } as ResolvedEntities & { version: string };
  }

  // ===========================================================================
  // clone / revert / bulk-replace
  // ===========================================================================

  async clone(tenantId: string, customerId: string, createdBy: string): Promise<{ cloned: number }> {
    return db.transaction(async (tx) => {
      // Lock the system forest while we snapshot it (FOR SHARE — readers ok, no
      // structural change underneath the clone).
      const sysRows = await tx
        .select()
        .from(entities)
        .where(and(
          eq(entities.tenantId, tenantId),
          isNull(entities.customerId),
          eq(entities.isDeleted, false),
        ))
        .orderBy(entities.sortOrder, entities.entityKey)
        .for('share');

      if (sysRows.length === 0) return { cloned: 0 };

      // Build old→new id map up front so we can remap parent pointers.
      const idMap = new Map<string, string>();
      for (const r of sysRows) idMap.set(r.id, generateId());

      // Insert topologically (parents before children) so the self-FK is satisfied.
      const ordered = this.topoSort(sysRows);
      for (const r of ordered) {
        await tx.insert(entities).values({
          id: idMap.get(r.id)!,
          tenantId,
          customerId,
          entityType: r.entityType,
          entityKey: r.entityKey,
          entityValue: r.entityValue,
          parentEntityId: r.parentEntityId ? idMap.get(r.parentEntityId) ?? null : null,
          sortOrder: r.sortOrder,
          cloneScopeKey: r.cloneScopeKey,
          isSystem: false,
          isActive: r.isActive,
          isDeleted: false,
          metadata: r.metadata as Record<string, unknown>,
          version: 1,
          createdBy,
          updatedBy: createdBy,
        });
      }

      return { cloned: sysRows.length };
    });
  }

  async revert(tenantId: string, customerId: string, updatedBy: string): Promise<{ reverted: number }> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(entities)
        .set({ isDeleted: true, updatedAt: new Date(), updatedBy })
        .where(and(
          eq(entities.tenantId, tenantId),
          eq(entities.customerId, customerId),
          eq(entities.isDeleted, false),
        ))
        .returning({ id: entities.id });

      return { reverted: rows.length };
    });
  }

  async bulkReplace(
    tenantId: string,
    customerId: string,
    entityType: string,
    data: BulkReplaceDTO,
    actorId: string,
  ): Promise<{ replaced: number; roots: RegistryEntity[] }> {
    return db.transaction(async (tx) => {
      // 1. Soft-delete every existing customer row for this (customer, type).
      const deleted = await tx
        .update(entities)
        .set({ isDeleted: true, updatedAt: new Date(), updatedBy: actorId })
        .where(and(
          eq(entities.tenantId, tenantId),
          eq(entities.customerId, customerId),
          eq(entities.entityType, entityType),
          eq(entities.isDeleted, false),
        ))
        .returning({ id: entities.id });

      // 2. Insert the new forest in topological order, remapping parents by nesting.
      const inserted: EntityRow[] = [];
      const insertNode = async (
        node: BulkReplaceNodeInput,
        parentId: string | null,
        index: number,
      ): Promise<void> => {
        const [row] = await tx
          .insert(entities)
          .values({
            tenantId,
            customerId,
            entityType,
            entityKey: node.entityKey,
            entityValue: node.entityValue ?? null,
            parentEntityId: parentId,
            sortOrder: node.sortOrder ?? index,
            isSystem: false,
            isActive: node.isActive ?? true,
            isDeleted: false,
            metadata: node.metadata ?? {},
            version: 1,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();
        inserted.push(row);

        const children = node.children ?? [];
        for (let i = 0; i < children.length; i++) {
          await insertNode(children[i], row.id, i);
        }
      };

      for (let i = 0; i < data.roots.length; i++) {
        await insertNode(data.roots[i], null, i);
      }

      // 3. Recompute the subtree version inside the tx (service's If-Match check
      //    happens against this). Build the returned roots from the freshly
      //    inserted rows, ordered by sort_order then entity_key.
      const sorted = [...inserted].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.entityKey.localeCompare(b.entityKey),
      );
      const roots = this.buildForest(sorted, ENTITY_MAX_DEPTH);

      return {
        replaced: deleted.length,
        roots,
        version: this.computeVersion(sorted),
      } as { replaced: number; roots: RegistryEntity[]; version: string };
    });
  }

  // ===========================================================================
  // helpers the service calls (cycle / scope)
  // ===========================================================================

  async hasCustomerRows(tenantId: string, customerId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(
        eq(entities.tenantId, tenantId),
        eq(entities.customerId, customerId),
        eq(entities.isDeleted, false),
      ))
      .limit(1);

    return !!row;
  }

  async getAncestorIds(tenantId: string, id: string): Promise<string[]> {
    // Walk up via a recursive CTE; return root-first.
    const result = await db.execute<{ id: string; depth: number }>(sql`
      WITH RECURSIVE ancestors AS (
        SELECT ${entities.id} AS id, ${entities.parentEntityId} AS parent_entity_id, 0 AS depth
        FROM ${entities}
        WHERE ${entities.tenantId} = ${tenantId} AND ${entities.id} = ${id}
        UNION ALL
        SELECT e.id, e.parent_entity_id, a.depth + 1
        FROM ${entities} e
        JOIN ancestors a ON e.id = a.parent_entity_id
        WHERE e.tenant_id = ${tenantId}
      )
      SELECT id, depth FROM ancestors WHERE id <> ${id} ORDER BY depth DESC
    `);

    const rows = (result as unknown as { rows?: { id: string }[] }).rows ?? (result as unknown as { id: string }[]);
    return rows.map((r) => r.id);
  }

  async wouldCreateCycle(tenantId: string, id: string, newParentId: string | null): Promise<boolean> {
    if (newParentId === null) return false;
    if (newParentId === id) return true;
    // A cycle forms iff `id` is an ancestor of `newParentId` (i.e. newParentId is
    // a descendant of id). Walk newParentId's ancestor chain; if it contains id → cycle.
    const ancestors = await this.getAncestorIds(tenantId, newParentId);
    return ancestors.includes(id);
  }

  async countChildren(tenantId: string, id: string): Promise<number> {
    return countWhere(entities, [
      eq(entities.tenantId, tenantId),
      eq(entities.parentEntityId, id),
      eq(entities.isDeleted, false),
    ]);
  }

  // ===========================================================================
  // private helpers
  // ===========================================================================

  /** Build the WHERE conditions for `list` from the parsed query DTO. */
  private buildListConditions(tenantId: string, params: ListEntitiesQueryDTO): SQL[] {
    const conditions: SQL[] = [eq(entities.tenantId, tenantId)];

    // scope: system (customer_id NULL) | customer (needs customerId) | all
    if (params.scope === 'system') {
      conditions.push(isNull(entities.customerId));
    } else if (params.scope === 'customer') {
      if (params.customerId) {
        conditions.push(eq(entities.customerId, params.customerId));
      } else {
        conditions.push(sql`${entities.customerId} IS NOT NULL`);
      }
    }
    // scope === 'all' → no customer_id constraint (but an explicit customerId
    // filter below still narrows it).

    if (params.customerId && params.scope !== 'system') {
      conditions.push(eq(entities.customerId, params.customerId));
    }

    if (params.type && params.type.length > 0) {
      conditions.push(inArray(entities.entityType, params.type));
    }
    if (params.id && params.id.length > 0) {
      conditions.push(inArray(entities.id, params.id));
    }
    if (params.key !== undefined) {
      conditions.push(eq(entities.entityKey, params.key));
    }
    if (params.value !== undefined) {
      conditions.push(eq(entities.entityValue, params.value));
    }

    // parentId: a uuid → that parent; literal 'null' → roots.
    if (params.parentId !== undefined) {
      if (params.parentId === 'null') {
        conditions.push(isNull(entities.parentEntityId));
      } else {
        conditions.push(eq(entities.parentEntityId, params.parentId));
      }
    }

    // q: partial, case-insensitive over key+value, with % and _ escaped.
    if (params.q !== undefined && params.q.length > 0) {
      const pattern = `%${this.escapeLike(params.q)}%`;
      conditions.push(
        or(
          sql`${entities.entityKey} ILIKE ${pattern} ESCAPE '\\'`,
          sql`${entities.entityValue} ILIKE ${pattern} ESCAPE '\\'`,
        )!,
      );
    }

    // metadata.<path> containment (@>): every extra key on the passthrough DTO.
    for (const cond of this.metadataContainmentConditions(params)) {
      conditions.push(cond);
    }

    // state: active | inactive | all
    const stateCond = this.stateCondition(params.state);
    if (stateCond) conditions.push(stateCond);

    // soft-delete filter
    if (!params.includeDeleted) {
      conditions.push(eq(entities.isDeleted, false));
    }

    return conditions;
  }

  /** `metadata.<path>=<value>` → JSONB containment `metadata @> '{"path":"value"}'`. */
  private metadataContainmentConditions(params: ListEntitiesQueryDTO): SQL[] {
    const out: SQL[] = [];
    const known = new Set([
      'type', 'key', 'value', 'q', 'id', 'parentId', 'customerId',
      'scope', 'state', 'includeDeleted', 'deep', 'page', 'pageSize', 'sort',
    ]);
    for (const [rawKey, rawVal] of Object.entries(params as Record<string, unknown>)) {
      if (!rawKey.startsWith('metadata.')) continue;
      if (known.has(rawKey)) continue;
      if (rawVal === undefined || rawVal === null) continue;
      const path = rawKey.slice('metadata.'.length);
      if (!path) continue;
      // Only top-level scalar keys are valid containment predicates.
      const value = Array.isArray(rawVal) ? rawVal[0] : rawVal;
      const json = JSON.stringify({ [path]: value });
      out.push(sql`${entities.metadata} @> ${json}::jsonb`);
    }
    return out;
  }

  /** Translate `sort=<field>_<asc|desc>` into Drizzle order columns; ties → entity_key. */
  private buildOrderBy(sort?: string): SQL[] {
    const fallback = [sql`${entities.sortOrder} ASC`, sql`${entities.entityKey} ASC`];
    if (!sort) return fallback;

    const match = /^(.*)_(asc|desc)$/.exec(sort);
    if (!match) return fallback;
    const field = match[1];
    const dir = match[2] === 'desc' ? sql`DESC` : sql`ASC`;

    const col = this.sortColumn(field);
    if (!col) return fallback;

    if (field === 'sort_order') {
      return [sql`${col} ${dir}`, sql`${entities.entityKey} ASC`];
    }
    // Always append entity_key as a stable tie-breaker.
    return [sql`${col} ${dir}`, sql`${entities.entityKey} ASC`];
  }

  private sortColumn(field: string): SQL | null {
    switch (field) {
      case 'sort_order': return sql`${entities.sortOrder}`;
      case 'entity_key': return sql`${entities.entityKey}`;
      case 'entity_type': return sql`${entities.entityType}`;
      case 'created_at': return sql`${entities.createdAt}`;
      case 'updated_at': return sql`${entities.updatedAt}`;
      case 'version': return sql`${entities.version}`;
      default: return null;
    }
  }

  private stateCondition(state?: 'active' | 'inactive' | 'all'): SQL | null {
    if (state === 'inactive') return eq(entities.isActive, false);
    if (state === 'all') return null;
    // default / 'active'
    return eq(entities.isActive, true);
  }

  /** Escape LIKE/ILIKE metacharacters so `q` is treated literally. */
  private escapeLike(input: string): string {
    return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  }

  private normalizeDeep(deep?: number | 'all'): number {
    if (deep === undefined) return 0;
    if (deep === 'all') return ENTITY_MAX_DEPTH;
    return Math.min(Math.max(deep, 0), ENTITY_MAX_DEPTH);
  }

  /**
   * Fetch a node's descendants as a nested forest, bounded by `maxDepth`. Each
   * parent cut off at the depth boundary is marked `truncated:true`. Children at
   * every level ordered by sort_order then entity_key.
   */
  private async fetchSubtree(
    tenantId: string,
    parentId: string,
    maxDepth: number,
    currentDepth: number,
    options?: { state?: 'active' | 'inactive' | 'all'; includeDeleted?: boolean },
  ): Promise<RegistryEntity[]> {
    const conditions: SQL[] = [
      eq(entities.tenantId, tenantId),
      eq(entities.parentEntityId, parentId),
    ];
    const stateCond = this.stateCondition(options?.state);
    if (stateCond) conditions.push(stateCond);
    if (!options?.includeDeleted) conditions.push(eq(entities.isDeleted, false));

    const rows = await db
      .select()
      .from(entities)
      .where(and(...conditions))
      .orderBy(entities.sortOrder, entities.entityKey);

    const children: RegistryEntity[] = [];
    for (const row of rows) {
      const node = this.mapToEntity(row);
      if (currentDepth < maxDepth) {
        node.children = await this.fetchSubtree(tenantId, node.id, maxDepth, currentDepth + 1, options);
      } else {
        // At the depth boundary — mark if this node actually has children.
        const childCount = await this.countChildren(tenantId, node.id);
        if (childCount > 0) node.truncated = true;
      }
      children.push(node);
    }
    return children;
  }

  /**
   * Build a nested forest from a flat, already-ordered row set (in-memory; used
   * by resolve/bulkReplace where the whole scope is materialized at once).
   */
  private buildForest(rows: EntityRow[], maxDepth: number): RegistryEntity[] {
    const byId = new Map<string, RegistryEntity>();
    for (const r of rows) byId.set(r.id, this.mapToEntity(r));

    const roots: RegistryEntity[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      if (r.parentEntityId && byId.has(r.parentEntityId)) {
        const parent = byId.get(r.parentEntityId)!;
        (parent.children ??= []).push(node);
      } else {
        roots.push(node);
      }
    }

    // Enforce depth bound: cut beyond maxDepth, marking the boundary parent.
    const prune = (node: RegistryEntity, depth: number): void => {
      if (!node.children || node.children.length === 0) return;
      if (depth >= maxDepth) {
        node.truncated = true;
        delete node.children;
        return;
      }
      for (const child of node.children) prune(child, depth + 1);
    };
    for (const root of roots) prune(root, 1);

    return roots;
  }

  /** Order rows parent-before-child for FK-safe inserts. */
  private topoSort(rows: EntityRow[]): EntityRow[] {
    const present = new Set(rows.map((r) => r.id));
    const ordered: EntityRow[] = [];
    const placed = new Set<string>();
    let remaining = [...rows];

    // Roots first (no parent, or parent outside the set), then iteratively whatever
    // has its parent already placed.
    while (remaining.length > 0) {
      const next = remaining.filter(
        (r) => !r.parentEntityId || !present.has(r.parentEntityId) || placed.has(r.parentEntityId),
      );
      if (next.length === 0) {
        // Cycle or dangling — append the rest as-is to avoid an infinite loop.
        ordered.push(...remaining);
        break;
      }
      for (const r of next) {
        ordered.push(r);
        placed.add(r.id);
      }
      remaining = remaining.filter((r) => !placed.has(r.id));
    }
    return ordered;
  }

  /**
   * Stable content hash of a resolved tree: order rows by sort_order/entity_key
   * and digest (key, sort_order, value, metadata, parent) — insensitive to row id
   * / insertion order so the version only changes when the *content* changes.
   */
  private computeVersion(rows: EntityRow[]): string {
    const ordered = [...rows].sort(
      (a, b) =>
        a.entityType.localeCompare(b.entityType) ||
        a.sortOrder - b.sortOrder ||
        a.entityKey.localeCompare(b.entityKey),
    );
    const canonical = ordered.map((r) => ({
      t: r.entityType,
      k: r.entityKey,
      s: r.sortOrder,
      v: r.entityValue,
      a: r.isActive,
      m: r.metadata,
      p: r.parentEntityId ? this.relativeKey(r.parentEntityId, rows) : null,
    }));
    const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
    return `v_${hash}`;
  }

  /** Map a parent id to its (type,key) so the hash ignores volatile uuids. */
  private relativeKey(parentId: string, rows: EntityRow[]): string {
    const p = rows.find((r) => r.id === parentId);
    return p ? `${p.entityType}:${p.entityKey}` : parentId;
  }

  private mapToEntity(row: EntityRow): RegistryEntity {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      entityType: row.entityType,
      entityKey: row.entityKey,
      entityValue: row.entityValue,
      parentEntityId: row.parentEntityId,
      sortOrder: row.sortOrder,
      cloneScopeKey: row.cloneScopeKey,
      isSystem: row.isSystem,
      isActive: row.isActive,
      isDeleted: row.isDeleted,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
      version: row.version,
    };
  }

  private mapTypeToEntity(row: EntityTypeRow): EntityType {
    return {
      entityType: row.entityType,
      label: row.label,
      description: row.description,
      allowedParentTypes: row.allowedParentTypes,
      isActive: row.isActive,
    };
  }
}

// Export singleton instance
export const entityRepository = new EntityRepository();
