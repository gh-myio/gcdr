import { createHash } from 'crypto';
import { ZodError } from 'zod';
import { RegistryEntity, EntityType } from '../domain/entities/Entity';
import {
  CreateEntityDTO,
  UpdateEntityDTO,
  ListEntitiesQueryDTO,
  BulkReplaceDTO,
  validateMetadataForType,
} from '../dto/request/EntityDTO';
import {
  IEntityRepository,
  DeepOptions,
  ResolveOptions,
  ResolvedEntities,
} from '../repositories/interfaces/IEntityRepository';
import { EntityRepository } from '../repositories/EntityRepository';
import { AppError, NotFoundError, ValidationError } from '../shared/errors/AppError';

// =============================================================================
// RFC-0047 — Generic Entity Registry · service layer
// =============================================================================
// Business rules ON TOP of the (plain-Drizzle) repository port: admin gating for
// `entity_type` creation + `is_system` mutation, per-type `metadata` Zod
// validation, cycle / allowed-parent-type checks, optimistic `version`
// (per-row PATCH) + subtree `If-Match` (bulk-replace), and the error-code
// contract (RFC-0047-Entity-API.md §errors). The controller computes `isAdmin`
// from scopes and passes it down; the DB triggers are the backstop. See
// docs/rfcs/RFC-0047-*.

/** Shape of the resolved-config response (version is computed in the service). */
export interface ResolvedEntitiesResult {
  source: 'customer' | 'system';
  version: string;
  roots: RegistryEntity[];
}

/**
 * Deterministic version hash of a resolved forest. Mirrors the alarm-bundle
 * versioning pattern: a stable hash over the salient, order-independent fields
 * of every node so it is invariant to row ordering but changes on any
 * structural / content edit. Surfaced as `X-Version-Id` and reused as the
 * `If-Match` token a bulk-replace is validated against.
 */
export function computeVersion(roots: RegistryEntity[]): string {
  const parts: string[] = [];
  const walk = (nodes: RegistryEntity[]): void => {
    // Sort so the hash is independent of the order the repo returned siblings.
    const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    for (const n of ordered) {
      parts.push(
        [
          n.id,
          n.entityType,
          n.entityKey,
          n.entityValue ?? '',
          n.parentEntityId ?? '',
          n.sortOrder,
          n.isActive ? 1 : 0,
          n.isDeleted ? 1 : 0,
          n.version,
          JSON.stringify(n.metadata ?? {}),
        ].join(''),
      );
      if (n.children && n.children.length) walk(n.children);
    }
  };
  walk(roots);
  const hash = createHash('sha256').update(parts.join('')).digest('hex');
  return `v_${hash.slice(0, 24)}`;
}

export class EntityService {
  private repository: IEntityRepository;

  constructor(repository?: IEntityRepository) {
    this.repository = repository || new EntityRepository();
  }

  // ---------------------------------------------------------------------------
  // Error mapping helpers
  // ---------------------------------------------------------------------------

  /**
   * Map low-level repo/DB errors to the RFC error-code contract. The DB
   * `is_system` protection trigger raises a generic exception whose message
   * contains `SYSTEM_PROTECTED`; the unique index surfaces a Postgres
   * unique-violation (code `23505`). Anything else is re-thrown unchanged.
   */
  private mapRepoError(err: unknown): never {
    if (err instanceof AppError) throw err;

    // Drizzle wraps the driver error: the real PostgresError (message
    // 'SYSTEM_PROTECTED', the SQLSTATE on `.code`) lives on `.cause`, while the
    // top-level `.message` is a "Failed query: …" wrapper and `.code` is
    // undefined. Inspect both so the mapping fires regardless of wrapping.
    const top = err as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    const cause = top.cause ?? {};
    const message = `${top.message ?? String(err)}\n${cause.message ?? ''}`;
    const code = cause.code ?? top.code;

    if (message.includes('SYSTEM_PROTECTED')) {
      throw new AppError('SYSTEM_PROTECTED', 'Operation not allowed on a system-protected row', 409);
    }
    if (code === '23505' || /unique|duplicate key/i.test(message)) {
      throw new AppError('DUPLICATE_KEY', 'An entity with this (scope, type, key, parent) already exists', 409);
    }
    if (code === '23503' || /foreign key/i.test(message)) {
      throw new AppError('TYPE_IN_USE', 'Entity type is still referenced by one or more entities', 409);
    }
    throw err;
  }

  /** Re-throw a ZodError from per-type metadata validation as 400 VALIDATION_ERROR. */
  private toValidationError(err: unknown): never {
    if (err instanceof ZodError) {
      const details: Record<string, string[]> = {};
      for (const issue of err.errors) {
        const key = issue.path.length ? issue.path.join('.') : 'metadata';
        (details[key] ??= []).push(issue.message);
      }
      throw new ValidationError('Invalid metadata for entity type', details);
    }
    throw err;
  }

  /** Validate per-type metadata; ZodError -> 400 VALIDATION_ERROR. No-op for free-form types. */
  private validateMetadata(entityType: string, metadata: Record<string, unknown>): void {
    try {
      validateMetadataForType(entityType, metadata);
    } catch (err) {
      this.toValidationError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // entity_types registry
  // ---------------------------------------------------------------------------

  async listEntityTypes(tenantId: string): Promise<EntityType[]> {
    return this.repository.listEntityTypes(tenantId);
  }

  async createEntityType(
    tenantId: string,
    dto: { entityType: string; label: string; description?: string | null; allowedParentTypes: string[] },
    opts: { isAdmin: boolean },
  ): Promise<EntityType> {
    if (!opts.isAdmin) {
      throw new AppError('FORBIDDEN', 'Creating an entity type requires admin scope', 403);
    }
    const existing = await this.repository.getEntityType(tenantId, dto.entityType);
    if (existing) {
      throw new AppError('DUPLICATE_KEY', `Entity type ${dto.entityType} already exists`, 409);
    }
    try {
      return await this.repository.createEntityType(tenantId, dto);
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async updateEntityType(
    tenantId: string,
    entityType: string,
    dto: { label?: string; description?: string | null; allowedParentTypes?: string[]; isActive?: boolean },
    opts: { isAdmin: boolean },
  ): Promise<EntityType> {
    if (!opts.isAdmin) {
      throw new AppError('FORBIDDEN', 'Editing an entity type requires admin scope', 403);
    }
    const existing = await this.repository.getEntityType(tenantId, entityType);
    if (!existing) {
      throw new NotFoundError(`Entity type ${entityType} not found`);
    }
    try {
      return await this.repository.updateEntityType(tenantId, entityType, dto);
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async deleteEntityType(
    tenantId: string,
    entityType: string,
    opts: { isAdmin: boolean },
  ): Promise<void> {
    if (!opts.isAdmin) {
      throw new AppError('FORBIDDEN', 'Deleting an entity type requires admin scope', 403);
    }
    const existing = await this.repository.getEntityType(tenantId, entityType);
    if (!existing) {
      throw new NotFoundError(`Entity type ${entityType} not found`);
    }
    try {
      await this.repository.deleteEntityType(tenantId, entityType);
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async create(
    tenantId: string,
    dto: CreateEntityDTO,
    userId: string,
    opts: { isAdmin?: boolean } = {},
  ): Promise<RegistryEntity> {
    // 0) minting a protected system default is admin-only and must be unscoped
    //    (DB CHECK entities_system_scope: is_system ⇒ customer_id IS NULL).
    if (dto.isSystem) {
      if (!opts.isAdmin) {
        throw new AppError('FORBIDDEN', 'Creating a system entity requires admin scope', 403);
      }
      if (dto.customerId) {
        throw new ValidationError('A system entity cannot be scoped to a customer (customerId must be null)');
      }
    }

    // 1) the type must be registered.
    const type = await this.repository.getEntityType(tenantId, dto.entityType);
    if (!type) {
      throw new ValidationError(`Unknown entity type ${dto.entityType}`);
    }

    // 2) per-type metadata shape.
    this.validateMetadata(dto.entityType, dto.metadata ?? {});

    // 3) parent must exist and be an allowed parent type.
    if (dto.parentEntityId) {
      const parent = await this.repository.getById(tenantId, dto.parentEntityId);
      if (!parent) {
        throw new NotFoundError(`Parent entity ${dto.parentEntityId} not found`);
      }
      this.assertAllowedParentType(type, parent.entityType);
    } else if (type.allowedParentTypes.length > 0 && !type.allowedParentTypes.includes('')) {
      // A type that MUST hang under a parent cannot be created as a root.
      // (An empty `allowedParentTypes` means root-only; a populated list with no
      // root marker means a parent is required.)
      throw new AppError(
        'INVALID_PARENT_TYPE',
        `Type ${dto.entityType} requires a parent of: ${type.allowedParentTypes.join(', ')}`,
        400,
      );
    }

    try {
      return await this.repository.create(tenantId, dto, userId);
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async getById(tenantId: string, id: string, opts?: DeepOptions): Promise<RegistryEntity> {
    const entity = await this.repository.getById(tenantId, id, opts);
    if (!entity) {
      throw new NotFoundError(`Entity ${id} not found`);
    }
    return entity;
  }

  async list(
    tenantId: string,
    query: ListEntitiesQueryDTO,
  ): Promise<{ items: RegistryEntity[]; pagination: { total?: number; totalPages?: number; hasMore: boolean } }> {
    const result = await this.repository.list(tenantId, query);
    return { items: result.items, pagination: result.pagination };
  }

  async getChildren(tenantId: string, id: string, opts?: DeepOptions): Promise<RegistryEntity[]> {
    // Surface a 404 if the parent itself doesn't exist (don't silently return []).
    const parent = await this.repository.getById(tenantId, id);
    if (!parent) {
      throw new NotFoundError(`Entity ${id} not found`);
    }
    return this.repository.getChildren(tenantId, id, opts);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateEntityDTO,
    userId: string,
    opts: { isAdmin: boolean; metadataMode?: 'merge' | 'replace' },
  ): Promise<RegistryEntity> {
    const current = await this.repository.getById(tenantId, id);
    if (!current) {
      throw new NotFoundError(`Entity ${id} not found`);
    }

    // is_system rows are admin-only to edit (the DB trigger is the backstop).
    if (current.isSystem && !opts.isAdmin) {
      throw new AppError('SYSTEM_PROTECTED', 'Editing a system-protected entity requires admin scope', 409);
    }

    // Optimistic lock: a sent-but-stale version is a conflict; absent = LWW.
    if (dto.version !== undefined && dto.version !== current.version) {
      throw new AppError('VERSION_CONFLICT', 'Entity was modified by another writer', 409);
    }

    // Per-type metadata: validate the effective metadata. For a merge-patch we
    // validate the merged result; for replace we validate the incoming blob.
    if (dto.metadata !== undefined) {
      const effective =
        opts.metadataMode === 'replace'
          ? (dto.metadata as Record<string, unknown>)
          : this.mergePatch(current.metadata ?? {}, dto.metadata as Record<string, unknown>);
      this.validateMetadata(current.entityType, effective);
    }

    // Re-parent guard (cycle + allowed-parent-type, incl. un-parenting -> null).
    if (
      dto.parentEntityId !== undefined &&
      dto.parentEntityId !== current.parentEntityId
    ) {
      await this.assertReparentAllowed(tenantId, current, dto.parentEntityId ?? null);
    }

    try {
      return await this.repository.update(tenantId, id, dto, userId, {
        isAdmin: opts.isAdmin,
        metadataMode: opts.metadataMode,
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async remove(
    tenantId: string,
    id: string,
    userId: string,
    opts?: { hard?: boolean; cascade?: boolean },
  ): Promise<void> {
    const current = await this.repository.getById(tenantId, id);
    if (!current) {
      throw new NotFoundError(`Entity ${id} not found`);
    }
    if (current.isSystem) {
      throw new AppError('SYSTEM_PROTECTED', 'A system-protected entity cannot be deleted', 409);
    }

    try {
      if (opts?.hard) {
        if (!opts.cascade) {
          const childCount = await this.repository.countChildren(tenantId, id);
          if (childCount > 0) {
            throw new AppError(
              'HAS_CHILDREN',
              'Cannot hard-delete an entity with children without cascade=true',
              409,
            );
          }
        }
        await this.repository.hardDelete(tenantId, id, { cascade: opts.cascade });
        return;
      }
      await this.repository.softDelete(tenantId, id, userId);
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async restore(tenantId: string, id: string, userId: string): Promise<RegistryEntity> {
    try {
      return await this.repository.restore(tenantId, id, userId);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code;
      // A restore that would collide with a live (scope,type,key,parent) is a
      // unique-violation against the live partial index -> RESTORE_CONFLICT.
      if (code === '23505' || /unique|duplicate key/i.test(message)) {
        throw new AppError(
          'RESTORE_CONFLICT',
          'Restoring would collide with a live entity of the same (scope, type, key, parent)',
          409,
        );
      }
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // resolve / clone / revert / bulk-replace
  // ---------------------------------------------------------------------------

  async resolve(
    tenantId: string,
    customerId: string,
    opts?: ResolveOptions,
  ): Promise<ResolvedEntitiesResult> {
    const resolved: ResolvedEntities = await this.repository.resolve(tenantId, customerId, opts);
    return {
      source: resolved.source,
      version: computeVersion(resolved.roots),
      roots: resolved.roots,
    };
  }

  async clone(
    tenantId: string,
    customerId: string,
    userId: string,
  ): Promise<{ cloned: number; customerId: string }> {
    if (await this.repository.hasCustomerRows(tenantId, customerId)) {
      throw new AppError('ALREADY_CLONED', 'Customer already has its own entities', 409);
    }
    try {
      const { cloned } = await this.repository.clone(tenantId, customerId, userId);
      return { cloned, customerId };
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async revert(
    tenantId: string,
    customerId: string,
    userId: string,
  ): Promise<{ reverted: number; customerId: string }> {
    const { reverted } = await this.repository.revert(tenantId, customerId, userId);
    return { reverted, customerId };
  }

  /**
   * Atomic whole-subtree replace for `(customerId, entityType)` with
   * subtree-level optimistic concurrency. If an `If-Match` is supplied we
   * recompute the current `(customer, type)` version and reject a mismatch with
   * `409 VERSION_CONFLICT` (body carries `currentVersion`) before any write.
   */
  async bulkReplace(
    tenantId: string,
    customerId: string,
    entityType: string,
    body: BulkReplaceDTO,
    ifMatch: string | undefined,
    userId: string,
  ): Promise<{ version: string; source: 'customer'; replaced: number }> {
    // Per-type metadata validation for every node in the incoming forest. The
    // forest is multi-type (e.g. GROUP roots with PROFILE leaves), so validate
    // each node against ITS OWN type, defaulting to the query `entityType` when
    // a node omits it (single-type callers, RFC-0207).
    const validateNodes = (nodes: BulkReplaceDTO['roots']): void => {
      for (const node of nodes) {
        this.validateMetadata(node.entityType ?? entityType, (node.metadata ?? {}) as Record<string, unknown>);
        if (node.children?.length) validateNodes(node.children);
      }
    };
    validateNodes(body.roots);

    // Subtree-level optimistic concurrency: compare If-Match to the current
    // version of the customer's tree, restricted to this type.
    if (ifMatch !== undefined) {
      const current = await this.repository.resolve(tenantId, customerId, { deep: 'all', state: 'all' });
      const subtree = current.roots.filter((r) => r.entityType === entityType);
      const currentVersion = computeVersion(subtree);
      if (this.normalizeEtag(ifMatch) !== currentVersion) {
        const conflict = new AppError(
          'VERSION_CONFLICT',
          'Subtree was modified by another writer',
          409,
        ) as AppError & { details?: Record<string, unknown> };
        conflict.details = { currentVersion };
        throw conflict;
      }
    }

    let result: { replaced: number; roots: RegistryEntity[] };
    try {
      result = await this.repository.bulkReplace(tenantId, customerId, entityType, body, userId);
    } catch (err) {
      this.mapRepoError(err);
    }

    return {
      version: computeVersion(result!.roots),
      source: 'customer',
      replaced: result!.replaced,
    };
  }

  // ---------------------------------------------------------------------------
  // internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate a parent change for an existing entity: moving under a new parent
   * checks cycle + allowed-parent-type; un-parenting (`null`) is only allowed for
   * a root-eligible type (empty `allowedParentTypes` or the `''` root marker).
   * Extracted from `update` to keep that method's complexity in check.
   */
  private async assertReparentAllowed(
    tenantId: string,
    current: RegistryEntity,
    newParentId: string | null,
  ): Promise<void> {
    if (newParentId) {
      const cycles = await this.repository.wouldCreateCycle(tenantId, current.id, newParentId);
      if (cycles) {
        throw new AppError('ENTITY_CYCLE', 'Re-parenting would create a cycle', 400);
      }
      const parent = await this.repository.getById(tenantId, newParentId);
      if (!parent) {
        throw new NotFoundError(`Parent entity ${newParentId} not found`);
      }
      const type = await this.repository.getEntityType(tenantId, current.entityType);
      if (type) this.assertAllowedParentType(type, parent.entityType);
      return;
    }
    // Un-parenting (-> root): only allowed if the type may be a root.
    const type = await this.repository.getEntityType(tenantId, current.entityType);
    if (type && type.allowedParentTypes.length > 0 && !type.allowedParentTypes.includes('')) {
      throw new AppError(
        'INVALID_PARENT_TYPE',
        `Type ${current.entityType} requires a parent of: ${type.allowedParentTypes.join(', ')}`,
        400,
      );
    }
  }

  /** Throw 400 INVALID_PARENT_TYPE if `parentType` is not allowed for `type`. */
  private assertAllowedParentType(type: EntityType, parentType: string): void {
    if (!type.allowedParentTypes.includes(parentType)) {
      throw new AppError(
        'INVALID_PARENT_TYPE',
        `Type ${type.entityType} may not hang under a ${parentType}`,
        400,
      );
    }
  }

  /** Strip the optional surrounding double quotes from an ETag / If-Match token. */
  private normalizeEtag(value: string): string {
    return value.replace(/^"(.*)"$/, '$1');
  }

  /**
   * RFC-7396 top-level JSON Merge Patch: a `null` value on a key removes it,
   * any other value overwrites. Used to compute the effective metadata so the
   * per-type Zod schema validates what will actually be stored.
   */
  private mergePatch(
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
    return out;
  }
}

export const entityService = new EntityService();
