-- Migration 0069: central_commands.payload — the SET_WIFI command carries the
-- target network { ssid, password, country } the central applies via
-- myio-wifi-set. Null for the payload-less commands (reboot / restart). Written
-- for the central to consume; the API strips it from operator-facing responses
-- so the WiFi password is never echoed back.
--
-- Separate file from 0068: this uses no enum value, and keeping the ADD VALUE
-- alone in 0068 avoids the "new enum value used in the same transaction" error.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

ALTER TABLE "central_commands" ADD COLUMN "payload" jsonb;
