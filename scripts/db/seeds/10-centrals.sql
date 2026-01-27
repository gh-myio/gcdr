-- =============================================================================
-- SEED: CENTRALS
-- =============================================================================
-- Mock data for centrals table
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_room1_id UUID := 'ffff4444-4444-4444-4444-444444444444'; -- Server Room
    v_building1_id UUID := 'ffff1111-1111-1111-1111-111111111111';
BEGIN
    -- NodeHub Central
    INSERT INTO centrals (id, tenant_id, customer_id, asset_id, name, display_name, serial_number, type, status, connection_status, firmware_version, software_version, last_update_at, config, stats, location, tags, metadata, version)
    VALUES (
        'ccc00001-0001-0001-0001-000000000001',
        v_tenant_id,
        v_company1_id,
        v_room1_id,
        'NodeHub Central SRV-01',
        'Central Principal Sala Servidores',
        'NH-2024-001-SP',
        'NODEHUB',
        'ACTIVE',
        'ONLINE',
        '2.5.0',
        '3.1.2',
        NOW() - INTERVAL '1 day',
        '{"mqttBroker": "mqtt://broker.local:1883", "dataRetention": 30, "syncInterval": 60, "maxDevices": 100}',
        '{"connectedDevices": 6, "messagesPerHour": 1200, "uptime": 864000, "lastRestart": "2024-01-01T00:00:00Z"}',
        '{"floor": "0", "room": "SRV-01", "rack": "A1"}',
        '["nodehub", "primary", "server-room"]',
        '{"installationDate": "2023-06-01", "maintenanceContact": "support@acmetech.com"}',
        1
    );

    -- Gateway Central
    INSERT INTO centrals (id, tenant_id, customer_id, asset_id, name, display_name, serial_number, type, status, connection_status, firmware_version, software_version, last_update_at, config, stats, location, tags, metadata, version)
    VALUES (
        'ccc00001-0001-0001-0001-000000000002',
        v_tenant_id,
        v_company1_id,
        v_building1_id,
        'Gateway Central HQ',
        'Gateway Principal Prédio',
        'GW-2024-001-SP',
        'GATEWAY',
        'ACTIVE',
        'ONLINE',
        '1.8.0',
        '2.0.1',
        NOW() - INTERVAL '3 days',
        '{"protocol": "MQTT", "bridgeMode": true, "upstreamBroker": "mqtt://cloud.gcdr.io:8883"}',
        '{"messagesForwarded": 50000, "uptime": 1728000}',
        '{"floor": "0", "position": "entrance"}',
        '["gateway", "bridge"]',
        '{"installationDate": "2023-05-15"}',
        1
    );

    -- Edge Controller (maintenance mode)
    INSERT INTO centrals (id, tenant_id, customer_id, asset_id, name, display_name, serial_number, type, status, connection_status, firmware_version, software_version, config, stats, location, tags, metadata, version)
    VALUES (
        'ccc00001-0001-0001-0001-000000000003',
        v_tenant_id,
        v_company1_id,
        v_room1_id,
        'Edge Controller SRV-02',
        'Controlador Edge Backup',
        'EC-2024-001-SP',
        'EDGE_CONTROLLER',
        'ACTIVE',
        'MAINTENANCE',
        '1.2.0',
        '1.5.0',
        '{"role": "backup", "failoverEnabled": true, "primaryCentral": "ccc00001-0001-0001-0001-000000000001"}',
        '{"uptime": 432000}',
        '{"floor": "0", "room": "SRV-01", "rack": "A2"}',
        '["edge", "backup"]',
        '{"installationDate": "2023-07-01"}',
        1
    );

    RAISE NOTICE 'Inserted 3 centrals';
END $$;

-- Verify
SELECT id, name, type, status, connection_status FROM centrals ORDER BY type, name;
