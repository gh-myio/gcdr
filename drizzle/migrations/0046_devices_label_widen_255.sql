-- Migration 0046: widen devices.label to varchar(255) to match display_name.
--
-- Direction of RFC-0040 (deprecate Device.displayName, make `label` canonical):
-- label must be able to hold the full display_name when it is backfilled, so its
-- length is raised from 100 to 255 (same as display_name). Widening a varchar
-- length in PostgreSQL is a catalog-only change — no table rewrite, instant, safe.
--
-- (Number 0046, not 0045: 0045 is reserved by the RFC-0045 email-ingestion
-- migration on its feature branch — skipping avoids a merge collision.)
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

ALTER TABLE "devices" ALTER COLUMN "label" TYPE varchar(255);
