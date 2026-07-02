-- Migration 0052: central_restore_jobs — tracks a restore of a central from one
-- of its OWN backups (field-swap: the replacement hardware adopts the same
-- serial+UUID, so source backup and target central share the central id).
--
-- gcdr does NOT run pg_restore — the CENTRAL does it on its embedded Postgres.
-- gcdr creates the job (QUEUED), hands the central a presigned download URL for
-- the backup, and the central reports phase progress back (PATCH). So the job
-- is a state machine driven by the central's reports, not a gcdr-side worker.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

CREATE TYPE "central_restore_job_status" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED');
CREATE TYPE "central_restore_job_phase" AS ENUM ('QUEUED', 'DOWNLOAD', 'VERIFY', 'STOP_SERVICES', 'RESTORE_DB', 'START_SERVICES', 'DONE');

CREATE TABLE "central_restore_jobs" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL,
  "central_id"       uuid NOT NULL REFERENCES "centrals"("id"),
  "source_backup_id" uuid NOT NULL REFERENCES "central_backups"("id"),
  "status"           "central_restore_job_status" NOT NULL DEFAULT 'QUEUED',
  "current_phase"    "central_restore_job_phase"  NOT NULL DEFAULT 'QUEUED',
  "dry_run"          boolean NOT NULL DEFAULT false,
  "log_entries"      jsonb NOT NULL DEFAULT '[]',
  "error_message"    text,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  "completed_at"     timestamptz,
  "created_by"       uuid
);

CREATE INDEX "central_restore_jobs_tenant_central_idx" ON "central_restore_jobs" ("tenant_id", "central_id", "created_at" DESC);
CREATE INDEX "central_restore_jobs_tenant_status_idx" ON "central_restore_jobs" ("tenant_id", "status");
-- CR-S5: cross-tenant stalled-job sweep (status='RUNNING' AND updated_at < cutoff).
CREATE INDEX "central_restore_jobs_status_updated_idx" ON "central_restore_jobs" ("status", "updated_at");
-- At most one in-flight restore per central: the race-proof backstop for the
-- active-job guard in CentralRestoreService.startRestore (an operator retry must
-- not enqueue a second job that runs a second pg_restore back-to-back).
CREATE UNIQUE INDEX "central_restore_jobs_one_active_per_central"
  ON "central_restore_jobs" ("central_id")
  WHERE "status" IN ('QUEUED', 'RUNNING');
