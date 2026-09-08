-- Add centrals.hardware_id — the UUID that identifies the central's HARDWARE for the
-- tunnel/probe host ({id}.y.myio.com.br, RFC-0062 §5). Nullable: when NULL the probe
-- falls back to centrals.id (today's behavior). Lets a central whose tunnel was
-- provisioned under a different UUID (e.g. after a hardware swap) keep working
-- without renaming the row's primary key.
-- Idempotent (safe to re-run).

ALTER TABLE centrals ADD COLUMN IF NOT EXISTS hardware_id uuid;

COMMENT ON COLUMN centrals.hardware_id IS
  'UUID of the physical hardware used to build the tunnel probe host ({id}.y.myio.com.br). NULL = fall back to centrals.id.';
