-- =============================================================================
-- SEED: ENTITY REGISTRY (RFC-0047 — Generic Entity Registry)
-- =============================================================================
-- Seeds the governed `entity_types` registry + a small system-default taxonomy
-- in `entities` (customer_id NULL, is_system = true — never deletable).
--
-- Types:
--   GROUP / PROFILE / EQUIPMENT                 — the telemetry-grouping shape
--   CLASSIFICATION_ENERGY|WATER|TEMPERATURE     — RFC-0207 domain roots
--   CLASSIFICATION_NODE                         — every classification descendant
--
-- Idempotent via ON CONFLICT DO NOTHING. Canonical dev tenant.
-- Companion: drizzle/migrations/0049_entities.sql, 0050_entities_triggers.sql,
--            docs/rfcs/RFC-0047-*.
-- =============================================================================

DO $$
DECLARE
    v_tenant_id  UUID := '11111111-1111-1111-1111-111111111111';
    v_system_by  UUID := '11111111-1111-1111-1111-111111111111';  -- system actor for audit cols
    -- stable ids for the example system-default taxonomy roots/children
    v_group_energy_ca   UUID := 'e0470001-0000-4000-8000-000000000001';
    v_profile_chiller   UUID := 'e0470001-0000-4000-8000-000000000002';
    v_profile_fancoil   UUID := 'e0470001-0000-4000-8000-000000000003';
    v_profile_hvac      UUID := 'e0470001-0000-4000-8000-000000000004';
BEGIN
    -- =========================================================================
    -- 1) Type registry
    -- =========================================================================

    -- Telemetry-grouping types (Shape A: taxonomy lives in entity_key).
    INSERT INTO entity_types (tenant_id, entity_type, label, description, allowed_parent_types) VALUES
      (v_tenant_id, 'GROUP',     'Group',     'Top-level telemetry grouping (root-only).', '{}'),
      (v_tenant_id, 'PROFILE',   'Profile',   'A profile under a group (e.g. CHILLER, FANCOIL).', '{GROUP}'),
      (v_tenant_id, 'EQUIPMENT', 'Equipment', 'An equipment node under a profile.', '{PROFILE}')
    ON CONFLICT DO NOTHING;

    -- RFC-0207 device-classification types. Domain roots are root-only;
    -- CLASSIFICATION_NODE may hang under any classification type (arbitrary
    -- topology — role lives in metadata.role, not in the type).
    INSERT INTO entity_types (tenant_id, entity_type, label, description, allowed_parent_types) VALUES
      (v_tenant_id, 'CLASSIFICATION_ENERGY',      'Classification · Energy',      'RFC-0207 energy classification root.',      '{}'),
      (v_tenant_id, 'CLASSIFICATION_WATER',       'Classification · Water',       'RFC-0207 water classification root.',       '{}'),
      (v_tenant_id, 'CLASSIFICATION_TEMPERATURE', 'Classification · Temperature', 'RFC-0207 temperature classification root.', '{}'),
      (v_tenant_id, 'CLASSIFICATION_NODE',        'Classification · Node',        'RFC-0207 classification descendant (any depth).',
         '{CLASSIFICATION_ENERGY,CLASSIFICATION_WATER,CLASSIFICATION_TEMPERATURE,CLASSIFICATION_NODE}')
    ON CONFLICT DO NOTHING;

    -- =========================================================================
    -- 2) Example system-default taxonomy (customer_id NULL, is_system = true)
    --    GROUP energy-commonarea -> PROFILE CHILLER / FANCOIL / HVAC
    -- =========================================================================

    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (v_group_energy_ca, v_tenant_id, NULL, 'GROUP', 'energy-commonarea', 'Energy · Common Area',
       NULL, 10, true, true, v_system_by, v_system_by),
      (v_profile_chiller, v_tenant_id, NULL, 'PROFILE', 'CHILLER', 'Chiller',
       v_group_energy_ca, 10, true, true, v_system_by, v_system_by),
      (v_profile_fancoil, v_tenant_id, NULL, 'PROFILE', 'FANCOIL', 'Fancoil',
       v_group_energy_ca, 20, true, true, v_system_by, v_system_by),
      (v_profile_hvac,    v_tenant_id, NULL, 'PROFILE', 'HVAC', 'HVAC',
       v_group_energy_ca, 30, true, true, v_system_by, v_system_by)
    ON CONFLICT DO NOTHING;

END $$;
