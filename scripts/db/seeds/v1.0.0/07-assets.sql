-- =============================================================================
-- SEED: ASSETS
-- =============================================================================
-- Mock data for assets table (hierarchical structure)
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_building1_id UUID := 'ffff1111-1111-1111-1111-111111111111';
    v_floor1_id UUID := 'ffff2222-2222-2222-2222-222222222222';
    v_floor2_id UUID := 'ffff3333-3333-3333-3333-333333333333';
    v_room1_id UUID := 'ffff4444-4444-4444-4444-444444444444';
    v_room2_id UUID := 'ffff5555-5555-5555-5555-555555555555';
    v_equipment1_id UUID := 'ffff6666-6666-6666-6666-666666666666';
    -- Dimension customer assets
    v_dimension_id UUID := '77777777-7777-7777-7777-777777777777';
    v_dim_building_id UUID := 'dddd1111-1111-1111-1111-111111111111';
    v_dim_lab_id UUID := 'dddd2222-2222-2222-2222-222222222222';
    v_dim_entrada_id UUID := 'dddd3333-3333-3333-3333-333333333333';
BEGIN
    -- Building (root asset)
    INSERT INTO assets (id, tenant_id, customer_id, parent_asset_id, path, depth, name, display_name, code, type, description, location, specs, tags, metadata, status, version)
    VALUES (
        v_building1_id,
        v_tenant_id,
        v_company1_id,
        NULL,
        '/' || v_tenant_id || '/' || v_company1_id || '/' || v_building1_id,
        0,
        'Headquarters Building',
        'ACME Tech HQ',
        'HQ-MAIN',
        'BUILDING',
        'Main headquarters building with 10 floors',
        '{"address": "Rua Augusta, 500", "city": "São Paulo", "state": "SP", "country": "Brazil", "postalCode": "01304-000", "coordinates": {"lat": -23.5505, "lng": -46.6333}}',
        '{"area": 15000, "floors": 10, "builtYear": 2015, "parkingSpaces": 200}',
        '["headquarters", "main-office"]',
        '{"buildingType": "commercial", "energyClass": "A"}',
        'ACTIVE',
        1
    );

    -- Floor 1 (child of building)
    INSERT INTO assets (id, tenant_id, customer_id, parent_asset_id, path, depth, name, display_name, code, type, description, location, specs, tags, metadata, status, version)
    VALUES (
        v_floor1_id,
        v_tenant_id,
        v_company1_id,
        v_building1_id,
        '/' || v_tenant_id || '/' || v_company1_id || '/' || v_building1_id || '/' || v_floor1_id,
        1,
        'Ground Floor',
        'Térreo - Recepção',
        'HQ-FL-00',
        'FLOOR',
        'Ground floor with reception and common areas',
        '{"floor": "0", "zone": "reception"}',
        '{"area": 1500, "capacity": 100}',
        '["ground-floor", "reception"]',
        '{"floorType": "reception", "accessControl": true}',
        'ACTIVE',
        1
    );

    -- Floor 2 (child of building)
    INSERT INTO assets (id, tenant_id, customer_id, parent_asset_id, path, depth, name, display_name, code, type, description, location, specs, tags, metadata, status, version)
    VALUES (
        v_floor2_id,
        v_tenant_id,
        v_company1_id,
        v_building1_id,
        '/' || v_tenant_id || '/' || v_company1_id || '/' || v_building1_id || '/' || v_floor2_id,
        1,
        'First Floor',
        '1º Andar - Escritórios',
        'HQ-FL-01',
        'FLOOR',
        'First floor with office spaces',
        '{"floor": "1", "zone": "offices"}',
        '{"area": 1500, "capacity": 80, "workstations": 60}',
        '["first-floor", "offices"]',
        '{"floorType": "office", "accessControl": true}',
        'ACTIVE',
        1
    );

    -- Room 1 (child of floor 1)
    INSERT INTO assets (id, tenant_id, customer_id, parent_asset_id, path, depth, name, display_name, code, type, description, location, specs, tags, metadata, status, version)
    VALUES (
        v_room1_id,
        v_tenant_id,
        v_company1_id,
        v_floor1_id,
        '/' || v_tenant_id || '/' || v_company1_id || '/' || v_building1_id || '/' || v_floor1_id || '/' || v_room1_id,
        2,
        'Server Room',
        'Sala de Servidores',
        'HQ-FL00-SRV',
        'ROOM',
        'Main data center and server room',
        '{"floor": "0", "room": "SRV-01"}',
        '{"area": 50, "rackCapacity": 10, "powerCapacity": 100}',
        '["server-room", "data-center", "critical"]',
        '{"roomType": "data-center", "coolingSystem": "precision-AC", "ups": true}',
        'ACTIVE',
        1
    );

    -- Room 2 (child of floor 2)
    INSERT INTO assets (id, tenant_id, customer_id, parent_asset_id, path, depth, name, display_name, code, type, description, location, specs, tags, metadata, status, version)
    VALUES (
        v_room2_id,
        v_tenant_id,
        v_company1_id,
        v_floor2_id,
        '/' || v_tenant_id || '/' || v_company1_id || '/' || v_building1_id || '/' || v_floor2_id || '/' || v_room2_id,
        2,
        'Meeting Room A',
        'Sala de Reuniões A',
        'HQ-FL01-MTA',
        'ROOM',
        'Large meeting room with video conference',
        '{"floor": "1", "room": "MT-A"}',
        '{"area": 30, "capacity": 20, "videoConference": true}',
        '["meeting-room", "video-conference"]',
        '{"roomType": "meeting", "equipment": ["projector", "whiteboard", "video-conf"]}',
        'ACTIVE',
        1
    );

    -- Equipment (child of room 1)
    INSERT INTO assets (id, tenant_id, customer_id, parent_asset_id, path, depth, name, display_name, code, type, description, location, specs, tags, metadata, status, version)
    VALUES (
        v_equipment1_id,
        v_tenant_id,
        v_company1_id,
        v_room1_id,
        '/' || v_tenant_id || '/' || v_company1_id || '/' || v_building1_id || '/' || v_floor1_id || '/' || v_room1_id || '/' || v_equipment1_id,
        3,
        'AC Unit 1',
        'Ar Condicionado Precisão #1',
        'HQ-SRV-AC01',
        'EQUIPMENT',
        'Precision air conditioning unit for server room',
        '{"floor": "0", "room": "SRV-01", "position": "north"}',
        '{"powerRating": 30, "voltage": 380, "manufacturer": "Carrier", "model": "30XA-302", "installationDate": "2020-03-15"}',
        '["hvac", "precision-ac", "critical"]',
        '{"equipmentType": "hvac", "maintenanceInterval": 90, "warrantyExpiration": "2025-03-15"}',
        'ACTIVE',
        1
    );

    -- ==========================================================================
    -- Dimension Customer Assets
    -- ==========================================================================

    -- Dimension Building (root asset)
    INSERT INTO assets (id, tenant_id, customer_id, parent_asset_id, path, depth, name, display_name, code, type, description, location, specs, tags, metadata, status, version)
    VALUES (
        v_dim_building_id,
        v_tenant_id,
        v_dimension_id,
        NULL,
        '/' || v_tenant_id || '/' || v_dimension_id || '/' || v_dim_building_id,
        0,
        'Dimension Building',
        'Prédio Dimension',
        'DIM-MAIN',
        'BUILDING',
        'Main Dimension engineering building',
        '{"address": "Av. Brigadeiro Faria Lima, 2000", "city": "São Paulo", "state": "SP", "country": "Brazil", "postalCode": "01451-000"}',
        '{"area": 5000, "floors": 3}',
        '["headquarters", "engineering"]',
        '{"buildingType": "commercial", "energyClass": "B"}',
        'ACTIVE',
        1
    );

    -- Dimension Laboratório (room)
    INSERT INTO assets (id, tenant_id, customer_id, parent_asset_id, path, depth, name, display_name, code, type, description, location, specs, tags, metadata, status, version)
    VALUES (
        v_dim_lab_id,
        v_tenant_id,
        v_dimension_id,
        v_dim_building_id,
        '/' || v_tenant_id || '/' || v_dimension_id || '/' || v_dim_building_id || '/' || v_dim_lab_id,
        1,
        'Laboratório',
        'Laboratório de Engenharia',
        'DIM-LAB',
        'ROOM',
        'Engineering laboratory',
        '{"floor": "1", "room": "LAB-01"}',
        '{"area": 100, "capacity": 20}',
        '["laboratory", "engineering"]',
        '{"roomType": "laboratory"}',
        'ACTIVE',
        1
    );

    -- Dimension Entrada (zone)
    INSERT INTO assets (id, tenant_id, customer_id, parent_asset_id, path, depth, name, display_name, code, type, description, location, specs, tags, metadata, status, version)
    VALUES (
        v_dim_entrada_id,
        v_tenant_id,
        v_dimension_id,
        v_dim_building_id,
        '/' || v_tenant_id || '/' || v_dimension_id || '/' || v_dim_building_id || '/' || v_dim_entrada_id,
        1,
        'Entrada',
        'Entrada Principal',
        'DIM-ENT',
        'ZONE',
        'Main entrance area',
        '{"floor": "0", "zone": "entrance"}',
        '{"area": 50}',
        '["entrance", "reception"]',
        '{"zoneType": "entrance", "accessControl": true}',
        'ACTIVE',
        1
    );

    RAISE NOTICE 'Inserted 9 assets';
END $$;

-- Verify
SELECT id, name, code, type, depth, status FROM assets ORDER BY depth, name;
