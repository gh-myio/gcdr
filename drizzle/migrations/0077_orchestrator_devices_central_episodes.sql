-- RFC-0036 (ED-1233) — persistent CENTRAL_OFFLINE episode tracking for the
-- orchestrator-devices worker. One row per central with an OPEN (or pending-
-- recovery) CENTRAL_OFFLINE episode against the ALARMS /incidents/episodes API.
--
-- Why persist (vs. emit only on the down→online edge): a recover() that fails
-- must be RETRIED on later ticks and must survive a worker restart, otherwise an
-- episode stays open forever after the central is back online. This table is the
-- worker's durable intent; ALARMS remains the source of truth for the episode.
--
--   phase  = DOWN     → central is (or was) offline; keep the episode alive by
--                       re-posting each tick, then recover once it is back online.
--            RECOVER  → central is back online; recover the open episode (retry
--                       until ALARMS confirms), then the row is deleted.
--   observed_at = the producer stamp of the CURRENT pending observation. On an
--                 HTTP RETRY of the SAME observation it is PRESERVED (never
--                 recomputed to "now") — `synced=false` means the last attempt
--                 for this observation failed and must be retried as-is.
CREATE TABLE IF NOT EXISTS orchestrator_devices_central_episodes (
  central_id        uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  customer_id       uuid,
  kind              varchar(30) NOT NULL DEFAULT 'CENTRAL_OFFLINE',
  episode_id        text,                                  -- from ALARMS; null until the first down POST succeeds
  phase             varchar(20) NOT NULL DEFAULT 'DOWN',   -- DOWN | RECOVER
  observed_at       timestamptz NOT NULL,                  -- stamp of the current pending observation (preserved on retry)
  last_heartbeat_at timestamptz,                           -- last successful sync before the silence (write-once on open)
  synced            boolean NOT NULL DEFAULT false,        -- true once the network action for observed_at was accepted
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orchestrator_devices_central_episodes_phase_idx
  ON orchestrator_devices_central_episodes (phase);
