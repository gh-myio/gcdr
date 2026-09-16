-- Add CENTRAL_OFFLINE to the rule_type enum so a "central offline" alerting rule
-- is a first-class rule: insertable, and retrievable via the GCDR API by
-- (customerId + type) or by id (GET /rules?type=CENTRAL_OFFLINE, GET /rules/:id).
-- Mirrors DEVICE_OFFLINE but for gateway/central connectivity (the CENTRAL_OFFLINE
-- episode kind emitted by the orchestrator-devices worker, RFC-0036).
--
-- Additive and idempotent. ALTER TYPE ... ADD VALUE runs fine inside the runner's
-- transaction because the new value is not USED in this same migration (only
-- declared); it is consumed by later inserts/queries.
ALTER TYPE rule_type ADD VALUE IF NOT EXISTS 'CENTRAL_OFFLINE';
