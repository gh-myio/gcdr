-- Drop check constraint that prevented DEVICE scope with empty entityIds.
-- A rule may have type=DEVICE with entityIds=[] as a valid intermediate state
-- (e.g. the user cleared all devices but intends to add new ones).
ALTER TABLE "rules" DROP CONSTRAINT IF EXISTS "valid_scope_entity";
