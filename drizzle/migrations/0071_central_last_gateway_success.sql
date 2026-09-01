-- Migration 0071: RFC-0062 — track last SUCCESSFUL gateway sync on centrals.
--
-- Additive-only. `last_gateway_check_at` records the last probe ATTEMPT (written on
-- every scan, success or failure). This adds `last_gateway_success_check_at`, written
-- ONLY when a probe succeeds — so the cockpit can show "last successful sync" distinct
-- from "last attempt", and the worker can hold a central in DEGRADED (warning) for a
-- grace window before proposing OFFLINE (ORCH_DEVICES_OFFLINE_GRACE_MIN, default 5m):
--   probe OK                      -> ONLINE  (+ stamp success)
--   first failure within grace    -> DEGRADED (warning)
--   no success for >= grace       -> OFFLINE
--
-- Single-writer unchanged: only the orchestrator-devices worker (and the cockpit's
-- manual recheck) write these evidence columns; canonical status writes stay gated.

ALTER TABLE centrals ADD COLUMN IF NOT EXISTS last_gateway_success_check_at timestamptz;
