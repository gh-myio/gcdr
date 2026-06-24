import { RegistryEntity, EntityType } from '../../domain/entities/Entity';
import {
  CreateEntityDTO,
  UpdateEntityDTO,
  ListEntitiesQueryDTO,
  BulkReplaceDTO,
} from '../../dto/request/EntityDTO';
import { PaginatedResult } from '../../shared/types';

// =============================================================================
// RFC-0047 — Generic Entity Registry · repository port
// =============================================================================
// Tenant-scoped data-access contract for `entities` + `entity_types`. The
// service layer (uniqueness, parent-type rules, cycle prevention, per-type
// metadata Zod, SYSTEM_PROTECTED/RESTORE_CONFLICT/ALREADY_CLONED, optimistic
// `version`, subtree `If-Match`) sits ON TOP of this port; the impl is plain
// Drizzle. This interface is the keystone other agents mock — keep signatures
// stable. See docs/rfcs/RFC-0047-*.

/** Result of resolving a customer's effective config (whole-config). */
export interface ResolvedEntities {
  source: 'customer' | 'system';
  roots: RegistryEntity[];
}

/** Options for a `deep` subtree fetch (0 = node only; 'all' = bounded full). */
export interface DeepOptions {
  deep: number | 'all';
  state?: 'active' | 'inactive' | 'all';
  includeDeleted?: boolean;
}

/** A node in a bulk-replace insert plan, parent already remapped to a new id. */
export interface ResolveOptions {
  state?: 'active' | 'inactive' | 'all';
  deep?: number | 'all';
}

export interface IEntityRepository {
  // ---- entity_types registry ------------------------------------------------
  listEntityTypes(tenantId: string): Promise<EntityType[]>;
  getEntityType(tenantId: string, entityType: string): Promise<EntityType | null>;
  createEntityType(
    tenantId: string,
    data: { entityType: string; label: string; description?: string | null; allowedParentTypes: string[] },
  ): Promise<EntityType>;

  // ---- entities CRUD --------------------------------------------------------
  create(tenantId: string, data: CreateEntityDTO, createdBy: string): Promise<RegistryEntity>;

  /** Fetch one node; `deep` embeds children (bounded by ENTITY_MAX_DEPTH). */
  getById(tenantId: string, id: string, options?: DeepOptions): Promise<RegistryEntity | null>;

  /**
   * Update a node. `isAdmin` lets the impl set the `app.is_admin` GUC so the
   * is_system protection trigger is bypassed for admin-only edits. The service
   * has already validated metadata + optimistic `version`.
   */
  update(
    tenantId: string,
    id: string,
    data: UpdateEntityDTO,
    updatedBy: string,
    options?: { isAdmin?: boolean; metadataMode?: 'merge' | 'replace' },
  ): Promise<RegistryEntity>;

  /** Soft delete (default). `hard` removes the row; `cascade` allows children. */
  softDelete(tenantId: string, id: string, updatedBy: string): Promise<void>;
  hardDelete(tenantId: string, id: string, options?: { cascade?: boolean }): Promise<void>;
  restore(tenantId: string, id: string, updatedBy: string): Promise<RegistryEntity>;

  // ---- list / traversal -----------------------------------------------------
  list(tenantId: string, params: ListEntitiesQueryDTO): Promise<PaginatedResult<RegistryEntity>>;

  /** Direct children (or a bounded subtree) of one node, ordered deterministically. */
  getChildren(tenantId: string, parentId: string, options?: DeepOptions): Promise<RegistryEntity[]>;

  /**
   * Effective config for a customer: the customer's own forest if it has any
   * non-deleted rows, else the system-default forest. No per-node merge.
   */
  resolve(tenantId: string, customerId: string, options?: ResolveOptions): Promise<ResolvedEntities>;

  // ---- clone / revert / bulk-replace ---------------------------------------
  /** Materialize the whole system tree under a customer (id/parent remap). */
  clone(tenantId: string, customerId: string, createdBy: string): Promise<{ cloned: number }>;

  /** Soft-delete ALL of a customer's rows -> resolution falls back to system. */
  revert(tenantId: string, customerId: string, updatedBy: string): Promise<{ reverted: number }>;

  /**
   * Atomic whole-subtree replace for a (customerId, entityType): soft-delete
   * the customer's existing rows for that type, insert the new forest in
   * topological order — one transaction. The subtree-level `If-Match` version
   * check is the service's responsibility (recomputed inside this tx).
   */
  bulkReplace(
    tenantId: string,
    customerId: string,
    entityType: string,
    data: BulkReplaceDTO,
    actorId: string,
  ): Promise<{ replaced: number; roots: RegistryEntity[] }>;

  // ---- helpers the service calls (cycle / scope) ---------------------------
  /** Whether a customer has >=1 non-deleted row (drives resolve's source). */
  hasCustomerRows(tenantId: string, customerId: string): Promise<boolean>;

  /** Ancestor id chain of a node (root-first), used for synchronous cycle checks. */
  getAncestorIds(tenantId: string, id: string): Promise<string[]>;

  /**
   * Whether re-parenting `id` under `newParentId` would create a cycle
   * (i.e. newParentId is `id` or a descendant of `id`).
   */
  wouldCreateCycle(tenantId: string, id: string, newParentId: string | null): Promise<boolean>;

  /** Count non-deleted direct children — used to gate hard delete (HAS_CHILDREN). */
  countChildren(tenantId: string, id: string): Promise<number>;
}
