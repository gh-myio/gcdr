-- Add unique constraint: device name must be unique per (tenant, customer)
CREATE UNIQUE INDEX "devices_tenant_customer_name_unique"
  ON "devices" ("tenant_id", "customer_id", "name");
