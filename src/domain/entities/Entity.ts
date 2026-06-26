// =============================================================================
// RFC-0047 — Generic Entity Registry · domain types
// =============================================================================
// A typed key/value node in a forest (`entities`), governed by a small type
// registry (`entity_types`) with system defaults (customerId === null) and
// per-customer overrides. See docs/rfcs/RFC-0047-*.
//
// Standalone interfaces (not `extends BaseEntity`): RFC-0047 requires non-null
// `createdBy`/`updatedBy` and adds registry-specific fields (customerId scope,
// sortOrder, cloneScopeKey, isSystem, isDeleted), so these mirror the schema
// snapshot directly rather than the looser shared BaseEntity.

/**
 * The governed type registry. `entityType` (e.g. `GROUP`, `PROFILE`,
 * `EQUIPMENT`, `CLASSIFICATION_*`) is the natural key consumed across the API;
 * `allowedParentTypes` encodes which types may parent a node of this type
 * (`[]` = root-only). Creating a type is admin-only.
 */
export interface EntityType {
  entityType: string;
  label: string;
  description?: string | null;
  allowedParentTypes: string[];
  isActive: boolean;
}

/**
 * A node in the entity forest. `customerId === null` is a system default
 * inherited by every customer; a set `customerId` is that customer's own
 * override (a cloned tree a MYIO operator edits). `isSystem` rows are
 * protected — never deletable/deactivatable, mutable only via the admin path.
 */
export interface RegistryEntity {
  id: string;
  tenantId: string;
  customerId: string | null;        // null = system default
  entityType: string;
  entityKey: string;
  entityValue: string | null;
  parentEntityId: string | null;    // null = root
  sortOrder: number;                // deterministic sibling order; system-locked on is_system rows
  cloneScopeKey: string;            // '*' in v1
  isSystem: boolean;
  isActive: boolean;
  isDeleted: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  children?: RegistryEntity[];      // present only when fetched deep>=1
  truncated?: boolean;              // present on a cut parent when deep traversal hit ENTITY_MAX_DEPTH
}
