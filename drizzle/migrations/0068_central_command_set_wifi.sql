-- Migration 0068: add SET_WIFI to central_command_type.
--
-- SET_WIFI lets an operator push a WiFi network (ssid/password/country) to a
-- CM4 central, which applies it via myio-wifi-set. Gated CM4-only in the app
-- (the OPi fleet has no myio-wifi-set).
--
-- Postgres forbids USING a newly-added enum value in the same transaction that
-- ADDs it, and the runner wraps each file in its own transaction — so this
-- ADD VALUE stands ALONE (the payload column that the SET_WIFI path uses lands
-- in 0069). IF NOT EXISTS keeps it idempotent.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

ALTER TYPE "central_command_type" ADD VALUE IF NOT EXISTS 'SET_WIFI';
