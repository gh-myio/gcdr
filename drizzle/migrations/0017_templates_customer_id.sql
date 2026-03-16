-- RFC-0021 v2: Add customer_id to templates for per-customer template overrides
-- Resolution order: customer → parent chain → tenant default (customer_id IS NULL)

ALTER TABLE "templates"
  ADD COLUMN "customer_id" uuid REFERENCES customers(id) ON DELETE CASCADE;

-- Drop old single unique index (was per tenant)
DROP INDEX IF EXISTS "tmpl_slug_tenant_unique";

-- Tenant-level templates: one per type per tenant (customer_id IS NULL)
CREATE UNIQUE INDEX "tmpl_tenant_type_unique"
  ON "templates" ("tenant_id", "type")
  WHERE "customer_id" IS NULL;

-- Customer-level templates: one per type per customer
CREATE UNIQUE INDEX "tmpl_customer_type_unique"
  ON "templates" ("tenant_id", "customer_id", "type")
  WHERE "customer_id" IS NOT NULL;

-- Slug uniqueness scoped to tenant + customer
CREATE UNIQUE INDEX "tmpl_slug_tenant_null_unique"
  ON "templates" ("slug", "tenant_id")
  WHERE "customer_id" IS NULL;

CREATE UNIQUE INDEX "tmpl_slug_tenant_customer_unique"
  ON "templates" ("slug", "tenant_id", "customer_id")
  WHERE "customer_id" IS NOT NULL;
