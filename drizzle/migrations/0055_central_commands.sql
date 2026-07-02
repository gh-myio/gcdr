-- Migration 0055: central_commands — one-shot operational commands the operator
-- sends to a central (reboot the box, restart the erlang/myio-core service, or
-- restart the myioapi service).
--
-- Same broker model as central_restore_jobs: gcdr does NOT reach the central. It
-- creates the command (QUEUED); the central's myio-gcdr-agent polls
-- GET /central-agent/commands/next, claims it (QUEUED -> RUNNING), runs it, and
-- PATCHes the result back (exit_code + stdout + stderr). So this is a state
-- machine driven by the central's report, not a gcdr-side worker.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

CREATE TYPE "central_command_type"   AS ENUM ('REBOOT', 'RESTART_ERLANG', 'RESTART_MYIOAPI');
CREATE TYPE "central_command_status" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "central_commands" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid NOT NULL,
  "central_id"    uuid NOT NULL REFERENCES "centrals"("id"),
  "type"          "central_command_type"   NOT NULL,
  "status"        "central_command_status" NOT NULL DEFAULT 'QUEUED',
  "exit_code"     integer,
  "stdout"        text,
  "stderr"        text,
  "error_message" text,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  "claimed_at"    timestamptz,
  "completed_at"  timestamptz,
  "created_by"    uuid
);

CREATE INDEX "central_commands_tenant_central_idx" ON "central_commands" ("tenant_id", "central_id", "created_at" DESC);
CREATE INDEX "central_commands_tenant_status_idx"  ON "central_commands" ("tenant_id", "status");
-- Stalled-command sweep (status='RUNNING' AND updated_at < cutoff): a central
-- that dies mid-command stops reporting, so the row ages out and is failed.
CREATE INDEX "central_commands_status_updated_idx" ON "central_commands" ("status", "updated_at");
-- At most one in-flight command per central. The app-level findActiveByCentral
-- check gives the friendly message for the common (sequential) case; this index
-- is the race-proof backstop for two truly-concurrent submits (mirrors
-- central_restore_jobs_one_active_per_central in the restore migration).
CREATE UNIQUE INDEX "central_commands_one_active_per_central"
  ON "central_commands" ("central_id")
  WHERE "status" IN ('QUEUED', 'RUNNING');
