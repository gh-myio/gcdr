# RFC-0047 — Generic Entity Registry · Drizzle / SQL schema snippet

Data-model artifact for **RFC-0047** ([`RFC-0047-Generic-Entity-Registry.md`](./RFC-0047-Generic-Entity-Registry.md),
§"Reference-level explanation"). Two tables: the governed **type registry** and the **entities** forest, with
system-default vs per-customer-override scoping. Authoritative wire contract: `RFC-0047-Entity-API.md`.

| Table | Role |
| --- | --- |
| `entity_types` | governed type registry (`GROUP`/`PROFILE`/`EQUIPMENT`…) + `allowed_parent_types` |
| `entities` | the typed key/value forest; `customer_id NULL` = system default, set = customer override |

---

## SQL (migration `00NN_entities.sql`)

```sql
-- ── Type registry (seed-driven; new types added by admins) ──────────────────
CREATE TABLE entity_types (
  entity_type          TEXT NOT NULL,
  tenant_id            UUID NOT NULL,
  label                TEXT NOT NULL,
  description          TEXT,
  allowed_parent_types TEXT[] NOT NULL DEFAULT '{}',  -- '{}' = root-only
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_type)
);

-- ── Entities forest ─────────────────────────────────────────────────────────
CREATE TABLE entities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  customer_id      UUID,                              -- NULL = system default; set = customer override
  entity_type      TEXT NOT NULL,
  entity_key       TEXT NOT NULL,
  entity_value     TEXT,
  parent_entity_id UUID REFERENCES entities(id) ON DELETE RESTRICT,
  sort_order       INTEGER NOT NULL DEFAULT 0,        -- deterministic sibling order; system-locked on is_system rows
  clone_scope_key  TEXT NOT NULL DEFAULT '*',         -- v1 always '*'; reserves per-root-tree override
  is_system        BOOLEAN NOT NULL DEFAULT false,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  metadata         JSONB   NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT entities_type_fk
    FOREIGN KEY (tenant_id, entity_type) REFERENCES entity_types (tenant_id, entity_type),
  -- a system row is global (no customer); a customer row is never system
  CONSTRAINT entities_system_scope CHECK (is_system = false OR customer_id IS NULL),
  CONSTRAINT entities_no_self_parent CHECK (parent_entity_id IS NULL OR parent_entity_id <> id)
);

-- Uniqueness: separate system vs customer namespaces; soft-deleted rows excluded
-- so a key frees on delete and re-clone works. COALESCE folds the nullable parent
-- (NULLs are otherwise distinct in a UNIQUE index).
CREATE UNIQUE INDEX entities_system_uq ON entities
  (tenant_id, COALESCE(parent_entity_id,'00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_key)
  WHERE customer_id IS NULL AND is_deleted = false;

CREATE UNIQUE INDEX entities_customer_uq ON entities
  (tenant_id, customer_id, COALESCE(parent_entity_id,'00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_key)
  WHERE customer_id IS NOT NULL AND is_deleted = false;

CREATE INDEX entities_tenant_type_idx   ON entities (tenant_id, entity_type)      WHERE is_deleted = false;
CREATE INDEX entities_tenant_key_idx    ON entities (tenant_id, entity_key)       WHERE is_deleted = false;
CREATE INDEX entities_tenant_parent_idx ON entities (tenant_id, parent_entity_id, sort_order) WHERE is_deleted = false;
CREATE INDEX entities_customer_idx      ON entities (tenant_id, customer_id)      WHERE is_deleted = false;
-- GIN on metadata deferred (tiny volume); add when a containment filter gets hot:
-- CREATE INDEX entities_metadata_gin ON entities USING gin (metadata jsonb_path_ops);

-- ── is_system protection: the source of truth (service returns 409 SYSTEM_PROTECTED) ──
CREATE OR REPLACE FUNCTION entities_protect_system() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN RAISE EXCEPTION 'SYSTEM_PROTECTED' USING ERRCODE = 'raise_exception'; END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: block soft-delete / deactivate / mutation of a system row.
  -- (Admin-only edits bypass via a session GUC set by the service, e.g. app.is_admin.)
  IF OLD.is_system AND current_setting('app.is_admin', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'SYSTEM_PROTECTED' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entities_protect_system_trg
  BEFORE UPDATE OR DELETE ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_protect_system();
```

> Cycle prevention beyond self-parent, `allowed_parent_types` enforcement, the effective-config resolution,
> clone/revert, and the `RESTORE_CONFLICT`/`ALREADY_CLONED` translations live in the **service** layer
> (see the RFC §"Validation & correctness rules"). The trigger is the backstop for `is_system`.

---

## Drizzle (`src/infrastructure/database/drizzle/schema.ts`)

```typescript
import { pgTable, uuid, text, boolean, jsonb, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const entityTypes = pgTable('entity_types', {
  entityType: text('entity_type').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  allowedParentTypes: text('allowed_parent_types').array().notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.entityType] }) }));

export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id'),                       // null = system default
  entityType: text('entity_type').notNull(),
  entityKey: text('entity_key').notNull(),
  entityValue: text('entity_value'),
  parentEntityId: uuid('parent_entity_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  cloneScopeKey: text('clone_scope_key').notNull().default('*'),
  isSystem: boolean('is_system').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  isDeleted: boolean('is_deleted').notNull().default(false),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').notNull(),
  version: integer('version').notNull().default(1),
});
```

```typescript
// src/domain/entities/Entity.ts
export interface EntityType {
  entityType: string;
  label: string;
  description?: string | null;
  allowedParentTypes: string[];
  isActive: boolean;
}

export interface RegistryEntity {
  id: string;
  tenantId: string;
  customerId: string | null;        // null = system default
  entityType: string;
  entityKey: string;
  entityValue: string | null;
  parentEntityId: string | null;
  sortOrder: number;                // deterministic sibling order; system-locked on is_system rows
  cloneScopeKey: string;            // '*' in v1
  isSystem: boolean;
  isActive: boolean;
  isDeleted: boolean;
  metadata: Record<string, unknown>;
  createdAt: string; createdBy: string;
  updatedAt: string; updatedBy: string;
  version: number;
  children?: RegistryEntity[];      // present only when fetched deep≥1
}
```

---

## Seed (initial system defaults)

```sql
-- types
INSERT INTO entity_types (tenant_id, entity_type, label, allowed_parent_types) VALUES
  ('<tenant>', 'GROUP',     'Group',     '{}'),
  ('<tenant>', 'PROFILE',   'Profile',   '{GROUP}'),
  ('<tenant>', 'EQUIPMENT', 'Equipment', '{PROFILE}')
ON CONFLICT DO NOTHING;

-- example system-default taxonomy (customer_id NULL, is_system true)
-- GROUP energy-commonarea → PROFILE CHILLER / FANCOIL / HVAC, etc.
-- (inserted by the seed/migration with is_system = true; never deletable)

-- example consumer types — RFC-0207 device-classification tree (served by THIS registry,
-- no bespoke API). Roots per domain; descendants share one node type so the tree topology
-- stays arbitrary (depth = parent_entity_id; role lives in metadata.role).
INSERT INTO entity_types (tenant_id, entity_type, label, allowed_parent_types) VALUES
  ('<tenant>', 'CLASSIFICATION_ENERGY',      'Classification · Energy',      '{}'),
  ('<tenant>', 'CLASSIFICATION_WATER',       'Classification · Water',       '{}'),
  ('<tenant>', 'CLASSIFICATION_TEMPERATURE', 'Classification · Temperature', '{}'),
  ('<tenant>', 'CLASSIFICATION_NODE',        'Classification · Node',
     '{CLASSIFICATION_ENERGY,CLASSIFICATION_WATER,CLASSIFICATION_TEMPERATURE,CLASSIFICATION_NODE}')
ON CONFLICT DO NOTHING;
```

> **`metadata` shape is enforced in the SERVICE, not the DB.** The `metadata` column is plain
> `jsonb` (no DB-level shape). When a consumer stores structured fields there (e.g. RFC-0207's
> `label`/`icon`/`role`/`rules`/`formula` under the `CLASSIFICATION_*` types), the service applies a
> **per-`entity_type` Zod schema (`.strict()`)** on every write — the only guard against a malformed
> write silently corrupting a downstream classifier. The `bulk-replace` whole-subtree swap and the
> subtree-level `If-Match` version live in the service/repository too; see `RFC-0047-Entity-API.md`
> §2.5 and the RFC §"Validation & correctness rules" (#10).
