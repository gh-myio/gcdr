-- Migration 0070: RFC-0062 — Orchestrator-Devices (Phase 1 foundation)
--
-- Additive-only. Introduces the schema the orchestrator-devices worker needs:
--   * new device state columns (health, telemetry cursors, freshness policy ref)
--     and an explainable UNKNOWN via `unknown_reason`;
--   * new central probe-evidence columns + the per-gateway monitoring gate,
--     interval override and retry-policy ref;
--   * the worker's own operational tables (control / runs / checks) and the two
--     policy "books" (retry, freshness).
--
-- IMPORTANT (single-writer, RFC-0062 §2): connection_status / connectivity_status
-- / health_status are written ONLY by the orchestrator-devices worker after the
-- shadow→cutover (§9). The PR #19 GET reconcile is kept behind a flag until then.
-- This migration adds no writers; it only adds columns/tables.
--
-- Advisory-lock key namespace (RFC-0062 §1): the worker takes session-level
-- pg_try_advisory_lock on a DEDICATED (reserved) connection. Keys are the pair
-- (classid=0x4F44 'OD', objid) with objid: 1=centrals-monitor, 2=devices-monitor,
-- 3=os-monitor. Registered here so nothing else in the codebase collides.

-- ── New enum types ───────────────────────────────────────────────────────────
CREATE TYPE health_status AS ENUM ('HEALTHY', 'DEGRADED', 'CRITICAL', 'UNKNOWN');

-- Why UNKNOWN carries a reason (RFC-0062 §Glossary): a single grey "UNKNOWN"
-- is unactionable. The reason distinguishes "warming up" from "never seen" from
-- "we cannot observe it" — and CENTRAL_UNREACHABLE is also the cascade-
-- suppression marker (§8): a device whose parent central is offline is
-- unobservable, not independently offline, so it raises no device incident.
CREATE TYPE device_unknown_reason AS ENUM (
  'AWAITING_FIRST_SCAN',  -- monitor started, not yet swept
  'NEVER_OBSERVED',       -- registered but never reported (commissioning/data)
  'SCAN_FAILED',          -- should be observable, scan errored (5xx / parse-fail)
  'CENTRAL_UNREACHABLE',  -- parent central OFFLINE → suppressed (§8)
  'AUTH_ERROR',           -- probe got 401/403 (our credential, not the device)
  'CONFIG_ERROR'          -- NXDOMAIN / bad tunnel host
);

-- ── devices: health + telemetry state (written only by the worker) ───────────
ALTER TABLE devices ADD COLUMN health_status health_status NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE devices ADD COLUMN unknown_reason device_unknown_reason;
-- newest telemetry timestamp/value actually seen (Phase 2 telemetry pull); for
-- water this is the last CHANGE in the cumulative reading, not the last row.
ALTER TABLE devices ADD COLUMN last_timestamp_telemetry timestamptz;
ALTER TABLE devices ADD COLUMN last_value_telemetry numeric;
-- per-slave energy pull cursor (advances even on empty windows; never rewinds).
ALTER TABLE devices ADD COLUMN last_fetch_energy_telemetry timestamptz;
-- freshness policy name (nullable → env default); FK to the book below.
ALTER TABLE devices ADD COLUMN freshness_policy varchar(50);

-- ── centrals: per-gateway gate + probe evidence (NOT canonical status) ───────
-- monitoring_enabled defaults FALSE: monitoring is rolled out gateway-by-gateway
-- (opt-in), so a fresh central is never probed until ops enables it.
ALTER TABLE centrals ADD COLUMN monitoring_enabled boolean NOT NULL DEFAULT false;
-- per-central probe cadence override (nullable → env CENTRAL_CHECK_INTERVAL_SECONDS).
ALTER TABLE centrals ADD COLUMN check_interval_seconds integer;
-- retry-policy name override (nullable → env CENTRAL_DEFAULT_RETRY_POLICY).
ALTER TABLE centrals ADD COLUMN retry_policy varchar(50);
-- probe evidence — written by centrals-monitor. The CANONICAL connection_status
-- is written by devices-monitor from the same /v2/slaves payload (§2, resolves
-- the two-writer bug), NOT here.
ALTER TABLE centrals ADD COLUMN last_gateway_check_at timestamptz;
ALTER TABLE centrals ADD COLUMN last_gateway_check_latency_ms integer;
ALTER TABLE centrals ADD COLUMN probe_result varchar(40); -- OK|TIMEOUT|AUTH_ERROR|CONFIG_ERROR|HTTP_5XX|PARSE_FAIL

CREATE INDEX centrals_monitoring_due_idx
  ON centrals (monitoring_enabled, last_gateway_check_at);

-- ── Retry policy book (RFC-0062 §4) ──────────────────────────────────────────
CREATE TABLE orchestrator_retry_policies (
  name        varchar(50) PRIMARY KEY,
  attempts    jsonb NOT NULL,   -- ordered [{delay_ms, timeout_ms?}] backoff list
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO orchestrator_retry_policies (name, attempts, description) VALUES
  ('strict',  '[{"delay_ms":0}]',                                                              '1 attempt, no retry (wired gateway)'),
  ('default', '[{"delay_ms":0},{"delay_ms":5000},{"delay_ms":15000}]',                         '3 attempts (0, +5s, +15s)'),
  ('lenient', '[{"delay_ms":0},{"delay_ms":10000},{"delay_ms":30000},{"delay_ms":60000}]',     '4 attempts (flaky LTE/satellite)');

-- ── Freshness policy book (RFC-0062 §6) ──────────────────────────────────────
-- mode=arrival: stale when no data ARRIVED for offline_after_seconds (energy/temp)
-- mode=change:  stale when the cumulative reading did not CHANGE (water)
-- NB: the 24h/72h defaults are a HYPOTHESIS, validated in shadow before they gate.
CREATE TABLE orchestrator_freshness_policies (
  name                 varchar(50) PRIMARY KEY,
  mode                 varchar(10) NOT NULL CHECK (mode IN ('arrival','change')),
  offline_after_seconds integer NOT NULL,
  window               varchar(20),
  granularity          varchar(20),
  description          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO orchestrator_freshness_policies (name, mode, offline_after_seconds, window, granularity, description) VALUES
  ('default',      'arrival', 86400,  '1h',  'minute', 'energy/temperature — no arrival for 24h ⇒ OFFLINE (hypothesis)'),
  ('water-default','change',  259200, 'day', 'second', 'water — no reading CHANGE for 72h ⇒ stuck-or-offline (hypothesis)');

-- ── Worker control plane (RFC-0062 §1, §9, §10) ──────────────────────────────
-- One row per control scope. The worker reads MASTER + per-monitor at the top of
-- every tick; FLAGS carries the rollback switches (shadow/canonical/incident).
-- Ships SAFE: master OFF, shadow ON, canonical writes OFF, incident emission OFF
-- — so on first deploy the worker observes and shadows without touching canonical
-- columns or paging anyone until ops deliberately promotes it.
CREATE TABLE orchestrator_devices_control (
  scope       varchar(20) PRIMARY KEY,            -- MASTER | CENTRALS | DEVICES | OS | FLAGS
  enabled     boolean NOT NULL DEFAULT true,
  config      jsonb NOT NULL DEFAULT '{}',
  last_run_at timestamptz,                         -- worker heartbeat (who-watches-the-watchman)
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
INSERT INTO orchestrator_devices_control (scope, enabled, config) VALUES
  ('MASTER',   false, '{}'),
  ('CENTRALS', true,  '{}'),
  ('DEVICES',  true,  '{}'),
  ('OS',       false, '{}'),
  ('FLAGS',    true,  '{"shadow_mode":true,"canonical_writes_enabled":false,"incident_emission_enabled":false,"sanity_max_fleet_flip_pct":30,"incident_open_after_ticks":2}');

-- ── Per-scan run ledger (cockpit source; RFC-0062 §7/§12) ────────────────────
CREATE TABLE orchestrator_devices_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor     varchar(20) NOT NULL,               -- centrals | devices | os
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  scanned     integer NOT NULL DEFAULT 0,
  changed     integer NOT NULL DEFAULT 0,
  skipped     integer NOT NULL DEFAULT 0,
  deferred    integer NOT NULL DEFAULT 0,
  failures    integer NOT NULL DEFAULT 0,
  notes       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX orchestrator_devices_runs_monitor_idx ON orchestrator_devices_runs (monitor, started_at DESC);

-- ── Per-entity per-scan check detail + SHADOW LEDGER (RFC-0062 §7/§9) ─────────
-- High-frequency operational detail — bounded/retained, NEVER audit_logs (§13,
-- RFC-0060). Also the shadow ledger: `proposed_*` records what the worker WOULD
-- write while shadow_mode is on, so divergence vs the current value is measurable
-- before any canonical write (§9).
CREATE TABLE orchestrator_devices_checks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid REFERENCES orchestrator_devices_runs(id) ON DELETE CASCADE,
  monitor           varchar(20) NOT NULL,
  entity_type       varchar(20) NOT NULL,          -- central | device
  entity_id         uuid NOT NULL,
  central_id        uuid,
  input             jsonb,                          -- probe outcome, gateway status, freshness inputs
  computed_state    varchar(30),                    -- proposed connectivity/health
  proposed_write    jsonb,                          -- what it WOULD write (shadow); null when applied
  caused_transition boolean NOT NULL DEFAULT false,
  latency_ms        integer,
  policy            varchar(50),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orchestrator_devices_checks_entity_idx ON orchestrator_devices_checks (entity_type, entity_id, created_at DESC);
CREATE INDEX orchestrator_devices_checks_created_idx ON orchestrator_devices_checks (created_at);
