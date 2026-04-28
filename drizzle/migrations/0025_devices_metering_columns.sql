-- Migration 0025: RFC-0032 — extend devices with QR Checker metering fields
--
-- Additive only — three nullable columns. Existing rows are unaffected.
-- The QR scanner produces (addr_low, addr_high, identifier) which the field
-- app POSTs to /api/v1/qrc/install; the install handler resolves the device
-- via the partial index below.

ALTER TABLE "devices"
  ADD COLUMN IF NOT EXISTS "qrc_addr_low"   smallint,
  ADD COLUMN IF NOT EXISTS "qrc_addr_high"  smallint,
  ADD COLUMN IF NOT EXISTS "qrc_identifier" text;

-- Partial index keyed on (tenant_id, addr_low, addr_high) — used by the
-- install handler when the field client passes addr_low/high from the QR
-- payload but no explicit device_id.
CREATE INDEX IF NOT EXISTS "idx_devices_qrc_addr"
  ON "devices" ("tenant_id", "qrc_addr_low", "qrc_addr_high")
  WHERE "qrc_addr_low" IS NOT NULL;
