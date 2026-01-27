-- =============================================================================
-- SEED: DEVICES
-- =============================================================================
-- Mock data for devices table
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_room1_id UUID := 'ffff4444-4444-4444-4444-444444444444'; -- Server Room
    v_room2_id UUID := 'ffff5555-5555-5555-5555-555555555555'; -- Meeting Room
    v_equipment1_id UUID := 'ffff6666-6666-6666-6666-666666666666'; -- AC Unit
    v_central1_id UUID := 'eeee1111-1111-1111-1111-111111111111'; -- Central 1
BEGIN
    -- Temperature Sensor in Server Room (with RFC-0008 fields)
    INSERT INTO devices (
        id, tenant_id, asset_id, customer_id, name, display_name, label, type, description,
        serial_number, external_id, specs, connectivity_status, last_connected_at,
        credentials, telemetry_config, tags, metadata, attributes, status, version,
        -- RFC-0008 fields
        slave_id, central_id, identifier, device_profile, device_type,
        ingestion_id, ingestion_gateway_id, last_activity_time
    )
    VALUES (
        '11110001-0001-0001-0001-000000000001',
        v_tenant_id,
        v_room1_id,
        v_company1_id,
        'Temperature Sensor SRV-01',
        'Sensor Temp. Sala Servidores',
        'TEMP-SRV-01',
        'SENSOR',
        'High-precision temperature sensor for server room monitoring',
        'SN-TEMP-001-2023',
        'tb-device-temp-001',
        '{"manufacturer": "Sensirion", "model": "SHT40", "firmwareVersion": "2.1.0", "serialNumber": "SN-TEMP-001-2023", "protocol": "MQTT", "accuracy": 0.2, "addrLow": 100, "addrHigh": 110, "frequency": 30}',
        'ONLINE',
        NOW() - INTERVAL '5 minutes',
        '{"type": "ACCESS_TOKEN", "accessToken": "temp001_access_token_xyz"}',
        '{"reportingInterval": 30, "telemetryKeys": ["temperature", "humidity"], "attributeKeys": ["firmware", "battery"]}',
        '["temperature", "sensor", "critical", "server-room"]',
        '{"installationDate": "2023-06-15", "calibrationDate": "2024-01-10"}',
        '{"firmware": "2.1.0", "battery": 95, "lastCalibration": "2024-01-10"}',
        'ACTIVE',
        1,
        -- RFC-0008 fields
        1,                                              -- slave_id (Modbus)
        v_central1_id,                                  -- central_id
        'TEMP_SENSOR_SERVER_ROOM_01',                   -- identifier
        'SENSOR_TEMP_AMBIENTE',                         -- device_profile
        'SHT40_TEMP_HUMIDITY',                          -- device_type
        'ce6a7e51-e642-4562-8d3d-8f492929d4df',        -- ingestion_id
        'd3202744-05dd-46d1-af33-495e9a2ecd52',        -- ingestion_gateway_id
        NOW() - INTERVAL '5 minutes'                    -- last_activity_time
    );

    -- Humidity Sensor in Server Room (with RFC-0008 fields)
    INSERT INTO devices (
        id, tenant_id, asset_id, customer_id, name, display_name, label, type, description,
        serial_number, external_id, specs, connectivity_status, last_connected_at,
        credentials, telemetry_config, tags, metadata, attributes, status, version,
        -- RFC-0008 fields
        slave_id, central_id, identifier, device_profile, device_type
    )
    VALUES (
        '11110001-0001-0001-0001-000000000002',
        v_tenant_id,
        v_room1_id,
        v_company1_id,
        'Humidity Sensor SRV-01',
        'Sensor Umidade Sala Servidores',
        'HUM-SRV-01',
        'SENSOR',
        'Humidity sensor for server room environment monitoring',
        'SN-HUM-001-2023',
        'tb-device-hum-001',
        '{"manufacturer": "Sensirion", "model": "SHT40", "firmwareVersion": "2.1.0", "serialNumber": "SN-HUM-001-2023", "protocol": "MQTT"}',
        'ONLINE',
        NOW() - INTERVAL '5 minutes',
        '{"type": "ACCESS_TOKEN", "accessToken": "hum001_access_token_xyz"}',
        '{"reportingInterval": 30, "telemetryKeys": ["humidity", "temperature"], "attributeKeys": ["firmware"]}',
        '["humidity", "sensor", "server-room"]',
        '{"installationDate": "2023-06-15"}',
        '{"firmware": "2.1.0"}',
        'ACTIVE',
        1,
        -- RFC-0008 fields
        3,                                              -- slave_id (Modbus)
        v_central1_id,                                  -- central_id
        'HUMIDITY_SENSOR_SERVER_ROOM_01',               -- identifier
        'SENSOR_HUMIDITY_AMBIENTE',                     -- device_profile
        'SHT40_HUMIDITY'                                -- device_type
    );

    -- Power Meter in Server Room (with RFC-0008 Modbus fields)
    INSERT INTO devices (
        id, tenant_id, asset_id, customer_id, name, display_name, label, type, description,
        serial_number, external_id, specs, connectivity_status, last_connected_at,
        credentials, telemetry_config, tags, metadata, attributes, status, version,
        -- RFC-0008 fields
        slave_id, central_id, identifier, device_profile, device_type,
        ingestion_id, ingestion_gateway_id, last_activity_time
    )
    VALUES (
        '11110001-0001-0001-0001-000000000003',
        v_tenant_id,
        v_room1_id,
        v_company1_id,
        'Power Meter SRV-01',
        'Medidor de Energia Sala Servidores',
        'PWR-SRV-01',
        'METER',
        'Smart power meter for server room energy monitoring',
        'SN-PWR-001-2023',
        'tb-device-pwr-001',
        '{"manufacturer": "Schneider", "model": "PM5560", "firmwareVersion": "3.0.1", "serialNumber": "SN-PWR-001-2023", "protocol": "MODBUS", "addrLow": 0, "addrHigh": 50, "frequency": 60}',
        'ONLINE',
        NOW() - INTERVAL '1 minute',
        '{"type": "MQTT_BASIC", "username": "pwr001", "password": "encrypted_password"}',
        '{"reportingInterval": 60, "telemetryKeys": ["power", "voltage", "current", "powerFactor", "energy"], "attributeKeys": ["firmware"]}',
        '["power", "meter", "energy", "server-room"]',
        '{"installationDate": "2023-06-15", "maxLoad": 100}',
        '{"firmware": "3.0.1", "totalEnergy": 125430.5}',
        'ACTIVE',
        1,
        -- RFC-0008 fields
        2,                                              -- slave_id (Modbus address 2)
        v_central1_id,                                  -- central_id
        'POWER_METER_SERVER_ROOM_01',                   -- identifier
        '3F_MEDIDOR',                                   -- device_profile
        'PM5560_POWER_METER',                           -- device_type
        'bf7a8c31-d542-4562-9e3f-7a592929e5ef',        -- ingestion_id
        'd3202744-05dd-46d1-af33-495e9a2ecd52',        -- ingestion_gateway_id
        NOW() - INTERVAL '1 minute'                     -- last_activity_time
    );

    -- Camera in Meeting Room (with RFC-0008 fields)
    INSERT INTO devices (
        id, tenant_id, asset_id, customer_id, name, display_name, label, type, description,
        serial_number, external_id, specs, connectivity_status, last_connected_at,
        credentials, telemetry_config, tags, metadata, attributes, status, version,
        -- RFC-0008 fields
        slave_id, central_id, identifier, device_profile, device_type
    )
    VALUES (
        '11110001-0001-0001-0001-000000000004',
        v_tenant_id,
        v_room2_id,
        v_company1_id,
        'PTZ Camera MT-A',
        'Câmera PTZ Sala Reuniões A',
        'CAM-MTA-01',
        'CAMERA',
        'PTZ camera for meeting room video conferencing',
        'SN-CAM-001-2023',
        'tb-device-cam-001',
        '{"manufacturer": "Axis", "model": "P5655-E", "firmwareVersion": "10.12.0", "serialNumber": "SN-CAM-001-2023", "protocol": "HTTP", "resolution": "1080p"}',
        'ONLINE',
        NOW() - INTERVAL '30 seconds',
        '{"type": "BASIC", "username": "admin"}',
        '{"reportingInterval": 300, "telemetryKeys": ["status", "streamActive"], "attributeKeys": ["firmware", "resolution"]}',
        '["camera", "video", "meeting-room"]',
        '{"installationDate": "2023-08-20"}',
        '{"firmware": "10.12.0", "resolution": "1080p", "ptzEnabled": true}',
        'ACTIVE',
        1,
        -- RFC-0008 fields
        10,                                             -- slave_id
        v_central1_id,                                  -- central_id
        'PTZ_CAMERA_MEETING_ROOM_A',                    -- identifier
        'CAMERA_IP_PTZ',                                -- device_profile
        'P5655E_PTZ'                                    -- device_type
    );

    -- AC Controller (with RFC-0008 fields)
    INSERT INTO devices (
        id, tenant_id, asset_id, customer_id, name, display_name, label, type, description,
        serial_number, external_id, specs, connectivity_status, last_connected_at,
        credentials, telemetry_config, tags, metadata, attributes, status, version,
        -- RFC-0008 fields
        slave_id, central_id, identifier, device_profile, device_type
    )
    VALUES (
        '11110001-0001-0001-0001-000000000005',
        v_tenant_id,
        v_equipment1_id,
        v_company1_id,
        'AC Controller SRV-AC01',
        'Controlador AC Precisão #1',
        'CTRL-AC-01',
        'CONTROLLER',
        'Controller for precision AC unit in server room',
        'SN-CTRL-001-2023',
        'tb-device-ctrl-001',
        '{"manufacturer": "Carrier", "model": "i-Vu", "firmwareVersion": "8.0.2", "serialNumber": "SN-CTRL-001-2023", "protocol": "BACNET"}',
        'ONLINE',
        NOW() - INTERVAL '2 minutes',
        '{"type": "ACCESS_TOKEN", "accessToken": "ctrl001_access_token"}',
        '{"reportingInterval": 60, "telemetryKeys": ["setpoint", "supplyTemp", "returnTemp", "fanSpeed", "compressorStatus"], "attributeKeys": ["firmware", "mode"]}',
        '["controller", "hvac", "ac", "critical"]',
        '{"installationDate": "2020-03-15"}',
        '{"firmware": "8.0.2", "mode": "cooling", "setpoint": 22}',
        'ACTIVE',
        1,
        -- RFC-0008 fields
        5,                                              -- slave_id
        v_central1_id,                                  -- central_id
        'AC_CONTROLLER_SERVER_ROOM_01',                 -- identifier
        'HVAC_PRECISION_AC',                            -- device_profile
        'IVU_AC_CONTROLLER'                             -- device_type
    );

    -- Gateway device (with RFC-0008 fields)
    INSERT INTO devices (
        id, tenant_id, asset_id, customer_id, name, display_name, label, type, description,
        serial_number, external_id, specs, connectivity_status, last_connected_at,
        credentials, telemetry_config, tags, metadata, attributes, status, version,
        -- RFC-0008 fields
        slave_id, central_id, identifier, device_profile, device_type
    )
    VALUES (
        '11110001-0001-0001-0001-000000000006',
        v_tenant_id,
        v_room1_id,
        v_company1_id,
        'IoT Gateway SRV-01',
        'Gateway IoT Sala Servidores',
        'GW-SRV-01',
        'GATEWAY',
        'Main IoT gateway for server room devices',
        'SN-GW-001-2023',
        'tb-device-gw-001',
        '{"manufacturer": "Advantech", "model": "UNO-2484G", "firmwareVersion": "1.5.0", "serialNumber": "SN-GW-001-2023", "protocol": "MQTT", "macAddress": "00:1A:2B:3C:4D:5E", "ipAddress": "192.168.1.100"}',
        'ONLINE',
        NOW() - INTERVAL '10 seconds',
        '{"type": "X509_CERTIFICATE", "certificateFingerprint": "AB:CD:EF:12:34:56"}',
        '{"reportingInterval": 30, "telemetryKeys": ["cpuUsage", "memoryUsage", "diskUsage", "connectedDevices"], "attributeKeys": ["firmware", "uptime"]}',
        '["gateway", "edge", "server-room"]',
        '{"installationDate": "2023-06-01"}',
        '{"firmware": "1.5.0", "uptime": 864000, "connectedDevices": 5}',
        'ACTIVE',
        1,
        -- RFC-0008 fields (Gateway uses high slave_id)
        247,                                            -- slave_id (247 for gateway/master)
        v_central1_id,                                  -- central_id
        'IOT_GATEWAY_SERVER_ROOM_01',                   -- identifier
        'GATEWAY_EDGE',                                 -- device_profile
        'UNO2484G_GATEWAY'                              -- device_type
    );

    -- Offline device example (with RFC-0008 fields)
    INSERT INTO devices (
        id, tenant_id, asset_id, customer_id, name, display_name, label, type, description,
        serial_number, external_id, specs, connectivity_status, last_connected_at, last_disconnected_at,
        credentials, telemetry_config, tags, metadata, attributes, status, version,
        -- RFC-0008 fields
        slave_id, central_id, identifier, device_profile, device_type
    )
    VALUES (
        '11110001-0001-0001-0001-000000000007',
        v_tenant_id,
        v_room1_id,
        v_company1_id,
        'Smoke Detector SRV-01',
        'Detector Fumaça Sala Servidores',
        'SMOKE-SRV-01',
        'SENSOR',
        'Smoke detector for server room fire safety',
        'SN-SMOKE-001-2023',
        'tb-device-smoke-001',
        '{"manufacturer": "Honeywell", "model": "5808W3", "firmwareVersion": "1.0.0", "serialNumber": "SN-SMOKE-001-2023", "protocol": "ZIGBEE"}',
        'OFFLINE',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '1 day',
        '{"type": "ACCESS_TOKEN", "accessToken": "smoke001_token"}',
        '{"reportingInterval": 300, "telemetryKeys": ["smokeLevel", "batteryLevel"], "attributeKeys": ["firmware", "battery"]}',
        '["smoke", "sensor", "safety", "server-room"]',
        '{"installationDate": "2023-06-15"}',
        '{"firmware": "1.0.0", "battery": 15}',
        'ACTIVE',
        1,
        -- RFC-0008 fields
        15,                                             -- slave_id
        v_central1_id,                                  -- central_id
        'SMOKE_DETECTOR_SERVER_ROOM_01',                -- identifier
        'SENSOR_SMOKE_FIRE',                            -- device_profile
        '5808W3_SMOKE'                                  -- device_type
    );

    RAISE NOTICE 'Inserted 7 devices';
END $$;

-- Verify
SELECT id, name, label, type, connectivity_status, status, slave_id, identifier, device_profile, device_type FROM devices ORDER BY type, name;
