-- Migration 0033: extend file_assets.owner_type for RFC-0036/0037 owners
--
-- The RFC-0037 event model attaches evidence to work orders and the RFC-0036
-- annotations module attaches files to annotations/responses, but the CHECK
-- installed by 0026 only accepts the legacy QR Checker owner types. Without
-- this, every upload from the new /os UI fails the constraint.
--
-- Legacy wo_* values stay in the IN-list: rows uploaded by the old module
-- still carry them.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction and
-- rejects explicit transaction-control statements.
--
-- Companion: docs/RFC-0036-Device-Annotations-Migration.md,
--            docs/RFC-0037-Work-Orders-Event-Model.md

ALTER TABLE "file_assets" DROP CONSTRAINT IF EXISTS "file_assets_owner_type_check";

ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_owner_type_check"
  CHECK ("owner_type" IN (
    'wiki_page', 'wiki_pdf', 'free',
    'wo_installation', 'wo_customer_observation',
    'wo_visita_ambiente', 'wo_visita_product', 'wo_visita_observation',
    'work_order', 'work_order_event',
    'annotation', 'annotation_response'
  ));
