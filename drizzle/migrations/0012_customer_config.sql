-- RFC-0019: Customer Config — per-customer feature flags
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "config" jsonb;
