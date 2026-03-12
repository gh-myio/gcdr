-- RFC-0023: Device Sync Jobs — async pipeline for syncing TB devices into GCDR

CREATE TYPE "device_sync_job_status" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'PARTIAL', 'FAILED');
CREATE TYPE "device_sync_job_phase" AS ENUM ('QUEUED', 'CHECK', 'ACTION_PLAN', 'DETECT_RELOCATIONS', 'RELOCATE', 'APPLY_UPDATES', 'CONSOLIDATE_CREATES', 'DONE');

CREATE TABLE IF NOT EXISTS "device_sync_jobs" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"      uuid NOT NULL,
  "customer_id"    uuid NOT NULL,
  "status"         "device_sync_job_status" NOT NULL DEFAULT 'QUEUED',
  "current_phase"  "device_sync_job_phase"  NOT NULL DEFAULT 'QUEUED',
  "dry_run"        boolean NOT NULL DEFAULT false,
  "input_config"   jsonb NOT NULL DEFAULT '{}',
  "input_files"    jsonb NOT NULL DEFAULT '[]',
  "phases_summary" jsonb NOT NULL DEFAULT '{}',
  "log_entries"    jsonb NOT NULL DEFAULT '[]',
  "error_message"  text,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"   timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "device_sync_jobs_tenant_customer_idx" ON "device_sync_jobs" ("tenant_id", "customer_id");
CREATE INDEX IF NOT EXISTS "device_sync_jobs_tenant_status_idx"   ON "device_sync_jobs" ("tenant_id", "status");
