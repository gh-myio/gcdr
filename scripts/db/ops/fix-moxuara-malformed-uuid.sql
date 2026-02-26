-- =============================================================================
-- FIX: Malformed UUID with trailing '"' in Moxuara rules
--
-- Root cause: double-serialization bug when saving rules via API caused one
--             or more scope_entity_id values to include a trailing double-quote
--             character.  PostgreSQL stores/accepts the raw bytes in text-like
--             columns; Drizzle then forwards the malformed string as a query
--             parameter, and Postgres uuid casting throws:
--
--   ERROR: invalid input syntax for type uuid:
--          "e9dce3c5-efa0-4df3-8352-8d09e60a1ea7""
--
-- Customer : Moxuara  (84e0370e-636a-4741-9874-504b5e0b3577)
-- Tenant   : 11111111-1111-1111-1111-111111111111
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1: Diagnose – find rules with malformed scope_entity_id
-- ---------------------------------------------------------------------------
SELECT
    id,
    name,
    scope_entity_id::text AS scope_entity_id_raw
FROM rules
WHERE scope_entity_id::text LIKE '%"';

-- ---------------------------------------------------------------------------
-- STEP 2: Diagnose – find rules with malformed value inside scope_entity_ids
--         array (cast to text for inspection; if column is true uuid[] each
--         element appears without surrounding quotes in the array literal)
-- ---------------------------------------------------------------------------
SELECT
    id,
    name,
    scope_entity_ids::text AS scope_entity_ids_raw
FROM rules
WHERE scope_entity_ids::text LIKE '%"%';

-- ---------------------------------------------------------------------------
-- STEP 3: FIX – trim trailing '"' from scope_entity_id
-- ---------------------------------------------------------------------------
-- DRY-RUN first (uncomment UPDATE after confirming STEP 1 returns rows):
/*
UPDATE rules
SET scope_entity_id = RTRIM(scope_entity_id::text, '"')::uuid
WHERE scope_entity_id::text LIKE '%"';
*/

-- ---------------------------------------------------------------------------
-- STEP 4: FIX – trim trailing '"' from every element in scope_entity_ids
--         (only needed if STEP 2 returned rows)
-- ---------------------------------------------------------------------------
/*
UPDATE rules
SET scope_entity_ids = ARRAY(
    SELECT RTRIM(elem::text, '"')::uuid
    FROM unnest(scope_entity_ids) AS elem
)
WHERE scope_entity_ids::text LIKE '%"%';
*/

-- ---------------------------------------------------------------------------
-- STEP 5: Verify – all Moxuara rules look clean
-- ---------------------------------------------------------------------------
SELECT
    id,
    name,
    scope_entity_id::text,
    scope_entity_ids::text
FROM rules
WHERE customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
ORDER BY name;

-- ---------------------------------------------------------------------------
-- AFTER THE FIX: invalidate the bundle cache so the next /bundle/simple
-- request is regenerated without the error.
--
-- curl -X DELETE \
--   https://gcdr-api.a.myio-bas.com/api/v1/customers/84e0370e-636a-4741-9874-504b5e0b3577/alarm-rules/bundle/cache \
--   -H "X-API-Key: gcdr_alarm_integration_key_2026"
-- ---------------------------------------------------------------------------
