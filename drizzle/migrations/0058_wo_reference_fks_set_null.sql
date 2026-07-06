-- Migration 0058: WO references must not block asset/device lifecycle.
--
-- Work orders are SOFT-deleted (deleted_at), so their rows — and their event
-- rows — stay in the database forever. With plain FKs that means any asset or
-- device ever referenced by a WO can never be physically deleted (e.g. the
-- presetup "apply diff" asset removal failing with
-- work_orders_root_asset_id_fkey).
--
-- History references become ON DELETE SET NULL: the event payload keeps the
-- names/ids as data, the FK column is only a filter index. Deleting an asset
-- that an ACTIVE work order uses as root is still blocked — but at the
-- service layer with a clear 409, not by a raw constraint error.
--
-- work_orders_devices.device_id keeps RESTRICT on purpose: it is the LIVE
-- scope of a non-deleted WO. WorkOrderService.delete now clears the junction;
-- the retroactive cleanup below removes the orphans left by deletes made
-- before that fix.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

ALTER TABLE "work_orders" DROP CONSTRAINT IF EXISTS "work_orders_root_asset_id_fkey";
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_root_asset_id_fkey"
  FOREIGN KEY ("root_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL;

ALTER TABLE "work_orders_events" DROP CONSTRAINT IF EXISTS "work_orders_events_asset_id_fkey";
ALTER TABLE "work_orders_events" ADD CONSTRAINT "work_orders_events_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL;

ALTER TABLE "work_orders_events" DROP CONSTRAINT IF EXISTS "work_orders_events_device_id_fkey";
ALTER TABLE "work_orders_events" ADD CONSTRAINT "work_orders_events_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL;

-- Retroactive cleanup: device-scope rows left behind by WOs soft-deleted
-- before WorkOrderService.delete started clearing the junction.
DELETE FROM "work_orders_devices" wod
USING "work_orders" wo
WHERE wo."id" = wod."work_order_id"
  AND wo."deleted_at" IS NOT NULL;
