-- =============================================================================
-- SEED: RULES
-- =============================================================================
-- Mock data for rules table (tests CHECK constraints)
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_room1_id UUID := 'ffff4444-4444-4444-4444-444444444444'; -- Server Room
    v_temp_device_id UUID := '11110001-0001-0001-0001-000000000001';
BEGIN
    -- ALARM_THRESHOLD rule: High Temperature
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000001',
        v_tenant_id,
        v_company1_id,
        'High Temperature Alert',
        'Alerts when server room temperature exceeds 28°C',
        'ALARM_THRESHOLD',
        'HIGH',
        'ASSET',
        v_room1_id,
        false,
        '{"metric": "temperature", "operator": "GT", "value": 28, "unit": "°C", "duration": 300, "aggregation": "AVG", "aggregationWindow": 60}',
        '[{"type": "EMAIL", "config": {"to": ["ops@acmetech.com"]}, "enabled": true}, {"type": "SLACK", "config": {"channel": "#alerts"}, "enabled": true}]',
        '["temperature", "critical", "server-room"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Low Temperature
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000002',
        v_tenant_id,
        v_company1_id,
        'Low Temperature Alert',
        'Alerts when server room temperature falls below 18°C',
        'ALARM_THRESHOLD',
        'MEDIUM',
        'ASSET',
        v_room1_id,
        false,
        '{"metric": "temperature", "operator": "LTE", "value": 18, "unit": "°C", "duration": 300, "aggregation": "AVG", "aggregationWindow": 60}',
        '[{"type": "EMAIL", "config": {"to": ["ops@acmetech.com"]}, "enabled": true}]',
        '["temperature", "server-room"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: High Humidity
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000003',
        v_tenant_id,
        v_company1_id,
        'High Humidity Alert',
        'Alerts when humidity exceeds 60%',
        'ALARM_THRESHOLD',
        'MEDIUM',
        'DEVICE',
        v_temp_device_id,
        false,
        '{"metric": "humidity", "operator": "GT", "value": 60, "unit": "%", "hysteresis": 5, "hysteresisType": "PERCENTAGE"}',
        '[{"type": "EMAIL", "config": {"to": ["ops@acmetech.com"]}, "enabled": true}]',
        '["humidity", "server-room"]',
        'ACTIVE',
        true,
        1
    );

    -- SLA rule: Temperature SLA
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, sla_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000004',
        v_tenant_id,
        v_company1_id,
        'Temperature SLA',
        'SLA for maintaining temperature within acceptable range',
        'SLA',
        'HIGH',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "temperature_compliance", "target": 99.5, "unit": "%", "period": "MONTHLY", "calculationMethod": "AVAILABILITY", "excludeMaintenanceWindows": true, "breachNotification": true, "warningThreshold": 95}',
        '[{"type": "EMAIL", "config": {"to": ["sla@acmetech.com", "management@acmetech.com"]}, "enabled": true}]',
        '["sla", "temperature", "compliance"]',
        'ACTIVE',
        true,
        1
    );

    -- SLA rule: Uptime SLA
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, sla_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000005',
        v_tenant_id,
        v_company1_id,
        'System Uptime SLA',
        'SLA for system availability',
        'SLA',
        'CRITICAL',
        'GLOBAL',
        NULL,
        false,
        '{"metric": "uptime", "target": 99.9, "unit": "%", "period": "MONTHLY", "calculationMethod": "AVAILABILITY", "excludeMaintenanceWindows": true, "breachNotification": true, "warningThreshold": 99}',
        '[{"type": "EMAIL", "config": {"to": ["sla@acmetech.com"]}, "enabled": true}, {"type": "PAGERDUTY", "config": {"serviceKey": "pd-key-123"}, "enabled": true}]',
        '["sla", "uptime", "critical"]',
        'ACTIVE',
        true,
        1
    );

    -- ESCALATION rule
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, escalation_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000006',
        v_tenant_id,
        v_company1_id,
        'Critical Alert Escalation',
        'Escalation policy for critical alerts',
        'ESCALATION',
        'CRITICAL',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"levels": [{"level": 1, "delayMinutes": 0, "notifyChannels": ["email"], "notifyUsers": ["bbbb2222-2222-2222-2222-222222222222"], "repeatInterval": 15, "maxRepeats": 3}, {"level": 2, "delayMinutes": 30, "notifyChannels": ["email", "sms"], "notifyUsers": ["bbbb1111-1111-1111-1111-111111111111"], "repeatInterval": 30, "maxRepeats": 2}, {"level": 3, "delayMinutes": 60, "notifyChannels": ["email", "sms", "phone"], "notifyGroups": ["management"], "autoAcknowledge": false}], "autoResolveAfterMinutes": 240, "businessHoursOnly": false}',
        '[]',
        '["escalation", "critical"]',
        'ACTIVE',
        true,
        1
    );

    -- MAINTENANCE_WINDOW rule: Weekly Maintenance
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, maintenance_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000007',
        v_tenant_id,
        v_company1_id,
        'Weekly Maintenance Window',
        'Weekly maintenance window on Sundays 02:00-06:00',
        'MAINTENANCE_WINDOW',
        'LOW',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"startTime": "02:00", "endTime": "06:00", "duration": 240, "recurrence": "WEEKLY", "recurrenceDays": [0], "timezone": "America/Sao_Paulo", "suppressAlarms": true, "suppressNotifications": false}',
        '[{"type": "EMAIL", "config": {"to": ["ops@acmetech.com"]}, "enabled": true}]',
        '["maintenance", "weekly"]',
        'ACTIVE',
        true,
        1
    );

    -- MAINTENANCE_WINDOW rule: One-time Maintenance
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, maintenance_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000008',
        v_tenant_id,
        v_company1_id,
        'Scheduled Server Upgrade',
        'One-time maintenance for server upgrade',
        'MAINTENANCE_WINDOW',
        'MEDIUM',
        'ASSET',
        v_room1_id,
        false,
        '{"startTime": "2025-02-01T02:00:00Z", "endTime": "2025-02-01T06:00:00Z", "recurrence": "ONCE", "timezone": "America/Sao_Paulo", "suppressAlarms": true, "suppressNotifications": true, "affectedRules": ["aaaa0001-0001-0001-0001-000000000001", "aaaa0001-0001-0001-0001-000000000002"]}',
        '[{"type": "EMAIL", "config": {"to": ["ops@acmetech.com", "tech@acmetech.com"]}, "enabled": true}]',
        '["maintenance", "upgrade", "one-time"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: High Energy Consumption (Business Hours)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000010',
        v_tenant_id,
        v_company1_id,
        'High Energy Consumption Alert',
        'Alerts when energy consumption exceeds 950 kWh during business hours (Mon-Fri 08:00-18:00)',
        'ALARM_THRESHOLD',
        'HIGH',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "energy_consumption", "operator": "GT", "value": 950, "unit": "kWh", "duration": 300, "aggregation": "AVG", "startAt": "08:00", "endAt": "18:00", "daysOfWeek": [1, 2, 3, 4, 5]}',
        '[{"type": "EMAIL", "config": {"to": ["energy@acmetech.com", "ops@acmetech.com"]}, "enabled": true}]',
        '["energy", "consumption", "business-hours"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Maximum Temperature 26°C
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000011',
        v_tenant_id,
        v_company1_id,
        'Maximum Temperature Alert',
        'Alerts when ambient temperature exceeds 26°C for comfort control',
        'ALARM_THRESHOLD',
        'MEDIUM',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "temperature", "operator": "GT", "value": 26, "unit": "°C", "duration": 600, "aggregation": "AVG", "aggregationWindow": 300}',
        '[{"type": "EMAIL", "config": {"to": ["facilities@acmetech.com"]}, "enabled": true}]',
        '["temperature", "comfort", "hvac"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Low Water Tank Level
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000012',
        v_tenant_id,
        v_company1_id,
        'Low Water Tank Level Alert',
        'Alerts when water tank level falls below 15%',
        'ALARM_THRESHOLD',
        'CRITICAL',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "water_level", "operator": "LT", "value": 15, "unit": "%", "duration": 60, "hysteresis": 5, "hysteresisType": "ABSOLUTE"}',
        '[{"type": "EMAIL", "config": {"to": ["facilities@acmetech.com", "emergency@acmetech.com"]}, "enabled": true}, {"type": "SMS", "config": {"to": ["+5511999999999"]}, "enabled": true}]',
        '["water", "tank", "critical", "level"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Night Water Usage (Leak Detection)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000013',
        v_tenant_id,
        v_company1_id,
        'Night Water Usage Alert',
        'Alerts when water flow exceeds 10 liters during night hours (22:00-06:00) - possible leak detection',
        'ALARM_THRESHOLD',
        'HIGH',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "water_flow", "operator": "GT", "value": 10, "unit": "L", "duration": 300, "aggregation": "SUM", "aggregationWindow": 300, "startAt": "22:00", "endAt": "06:00", "daysOfWeek": [0, 1, 2, 3, 4, 5, 6]}',
        '[{"type": "EMAIL", "config": {"to": ["facilities@acmetech.com", "security@acmetech.com"]}, "enabled": true}]',
        '["water", "leak", "night", "security"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: High Instantaneous Power
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000014',
        v_tenant_id,
        v_company1_id,
        'High Instantaneous Power Alert',
        'Alerts when instantaneous power exceeds 500W for more than 5 minutes',
        'ALARM_THRESHOLD',
        'HIGH',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "instantaneous_power", "operator": "GT", "value": 500, "unit": "W", "duration": 5, "aggregation": "AVG", "aggregationWindow": 60}',
        '[{"type": "EMAIL", "config": {"to": ["energy@acmetech.com"]}, "enabled": true}]',
        '["power", "instantaneous", "high"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Power Surge Detection
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000015',
        v_tenant_id,
        v_company1_id,
        'Power Surge Alert',
        'Alerts immediately when instantaneous power exceeds 800W - possible surge',
        'ALARM_THRESHOLD',
        'CRITICAL',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "instantaneous_power", "operator": "GTE", "value": 800, "unit": "W", "duration": 0, "aggregation": "LAST"}',
        '[{"type": "EMAIL", "config": {"to": ["energy@acmetech.com", "emergency@acmetech.com"]}, "enabled": true}, {"type": "SMS", "config": {"to": ["+5511999999999"]}, "enabled": true}]',
        '["power", "surge", "critical", "instantaneous"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Low Power (Equipment Off Detection)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000016',
        v_tenant_id,
        v_company1_id,
        'Low Power Alert',
        'Alerts when instantaneous power falls below 50W during business hours - equipment may be off',
        'ALARM_THRESHOLD',
        'MEDIUM',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "instantaneous_power", "operator": "LTE", "value": 50, "unit": "W", "duration": 10, "aggregation": "AVG", "aggregationWindow": 120, "startAt": "08:00", "endAt": "18:00", "daysOfWeek": [1, 2, 3, 4, 5]}',
        '[{"type": "EMAIL", "config": {"to": ["facilities@acmetech.com"]}, "enabled": true}]',
        '["power", "low", "equipment", "business-hours"]',
        'ACTIVE',
        true,
        1
    );

    -- Disabled rule
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000009',
        v_tenant_id,
        v_company1_id,
        'Power Consumption Alert (Disabled)',
        'Alerts when power consumption is too high - currently disabled',
        'ALARM_THRESHOLD',
        'LOW',
        'DEVICE',
        '11110001-0001-0001-0001-000000000003', -- Power Meter
        false,
        '{"metric": "power", "operator": "GT", "value": 80, "unit": "kW"}',
        '[{"type": "EMAIL", "config": {"to": ["ops@acmetech.com"]}, "enabled": true}]',
        '["power", "disabled"]',
        'ACTIVE',
        false,
        1
    );

    -- ==========================================================================
    -- RANGE RULES (BETWEEN / OUTSIDE) - Examples with valueHigh
    -- ==========================================================================

    -- ALARM_THRESHOLD rule: Temperature Comfort Zone (BETWEEN)
    -- Alerts when temperature is WITHIN the comfort zone (18-26°C) - for monitoring
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000020',
        v_tenant_id,
        v_company1_id,
        'Temperature in Comfort Zone',
        'Monitors when temperature is within comfort zone (18-26°C)',
        'ALARM_THRESHOLD',
        'LOW',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "temperature", "operator": "BETWEEN", "value": 18, "valueHigh": 26, "unit": "°C", "duration": 300, "aggregation": "AVG", "aggregationWindow": 60}',
        '[{"type": "WEBHOOK", "config": {"url": "https://api.example.com/comfort-status"}, "enabled": true}]',
        '["temperature", "comfort", "range", "between"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Temperature Outside Safe Range (OUTSIDE)
    -- Alerts when temperature is OUTSIDE the safe range (15-30°C)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000021',
        v_tenant_id,
        v_company1_id,
        'Temperature Outside Safe Range',
        'Alerts when temperature is outside safe range (below 15°C or above 30°C)',
        'ALARM_THRESHOLD',
        'HIGH',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "temperature", "operator": "OUTSIDE", "value": 15, "valueHigh": 30, "unit": "°C", "duration": 120, "aggregation": "AVG", "aggregationWindow": 60, "hysteresis": 2, "hysteresisType": "ABSOLUTE"}',
        '[{"type": "EMAIL", "config": {"to": ["facilities@acmetech.com", "emergency@acmetech.com"]}, "enabled": true}, {"type": "SMS", "config": {"to": ["+5511999999999"]}, "enabled": true}]',
        '["temperature", "safety", "range", "outside", "critical"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Power Normal Operating Range (BETWEEN)
    -- Monitors when power is within normal operating range (100-400W)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000022',
        v_tenant_id,
        v_company1_id,
        'Power in Normal Range',
        'Monitors when instantaneous power is within normal operating range (100-400W)',
        'ALARM_THRESHOLD',
        'LOW',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "instantaneous_power", "operator": "BETWEEN", "value": 100, "valueHigh": 400, "unit": "W", "duration": 300, "aggregation": "AVG", "aggregationWindow": 60}',
        '[{"type": "WEBHOOK", "config": {"url": "https://api.example.com/power-status"}, "enabled": true}]',
        '["power", "normal", "range", "between"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Power Anomaly Detection (OUTSIDE)
    -- Alerts when power is OUTSIDE normal range (below 50W or above 600W)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000023',
        v_tenant_id,
        v_company1_id,
        'Power Anomaly Alert',
        'Alerts when instantaneous power is outside normal range (below 50W equipment off, or above 600W overload)',
        'ALARM_THRESHOLD',
        'HIGH',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "instantaneous_power", "operator": "OUTSIDE", "value": 50, "valueHigh": 600, "unit": "W", "duration": 5, "aggregation": "AVG", "aggregationWindow": 60, "hysteresis": 10, "hysteresisType": "ABSOLUTE"}',
        '[{"type": "EMAIL", "config": {"to": ["energy@acmetech.com", "facilities@acmetech.com"]}, "enabled": true}]',
        '["power", "anomaly", "range", "outside"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Server Room Temperature Critical Range (OUTSIDE)
    -- For server room: alerts when temperature is outside 18-28°C
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000024',
        v_tenant_id,
        v_company1_id,
        'Server Room Temperature Critical',
        'Critical alert when server room temperature is outside safe range (18-28°C)',
        'ALARM_THRESHOLD',
        'CRITICAL',
        'ASSET',
        v_room1_id,
        false,
        '{"metric": "temperature", "operator": "OUTSIDE", "value": 18, "valueHigh": 28, "unit": "°C", "duration": 60, "aggregation": "AVG", "aggregationWindow": 30, "hysteresis": 1, "hysteresisType": "ABSOLUTE"}',
        '[{"type": "EMAIL", "config": {"to": ["ops@acmetech.com", "emergency@acmetech.com"]}, "enabled": true}, {"type": "SMS", "config": {"to": ["+5511999999999"]}, "enabled": true}, {"type": "PAGERDUTY", "config": {"serviceKey": "pd-key-123"}, "enabled": true}]',
        '["temperature", "server-room", "critical", "outside", "range"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Minimum Temperature (LT)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000025',
        v_tenant_id,
        v_company1_id,
        'Minimum Temperature Alert',
        'Alerts when temperature falls below minimum threshold of 15°C',
        'ALARM_THRESHOLD',
        'MEDIUM',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "temperature", "operator": "LT", "value": 15, "unit": "°C", "duration": 300, "aggregation": "AVG", "aggregationWindow": 60}',
        '[{"type": "EMAIL", "config": {"to": ["facilities@acmetech.com"]}, "enabled": true}]',
        '["temperature", "minimum", "cold"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Maximum Temperature (GT)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000026',
        v_tenant_id,
        v_company1_id,
        'Maximum Temperature Alert',
        'Alerts when temperature exceeds maximum threshold of 32°C',
        'ALARM_THRESHOLD',
        'HIGH',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "temperature", "operator": "GT", "value": 32, "unit": "°C", "duration": 120, "aggregation": "AVG", "aggregationWindow": 60}',
        '[{"type": "EMAIL", "config": {"to": ["facilities@acmetech.com", "emergency@acmetech.com"]}, "enabled": true}]',
        '["temperature", "maximum", "hot"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Minimum Power (Equipment Off)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000027',
        v_tenant_id,
        v_company1_id,
        'Minimum Power Alert',
        'Alerts when instantaneous power is below 30W - equipment may be off',
        'ALARM_THRESHOLD',
        'MEDIUM',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "instantaneous_power", "operator": "LT", "value": 30, "unit": "W", "duration": 10, "aggregation": "AVG", "aggregationWindow": 120, "startAt": "08:00", "endAt": "20:00", "daysOfWeek": [1, 2, 3, 4, 5]}',
        '[{"type": "EMAIL", "config": {"to": ["facilities@acmetech.com"]}, "enabled": true}]',
        '["power", "minimum", "equipment-off"]',
        'ACTIVE',
        true,
        1
    );

    -- ALARM_THRESHOLD rule: Maximum Power (Overload)
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'aaaa0001-0001-0001-0001-000000000028',
        v_tenant_id,
        v_company1_id,
        'Maximum Power Overload Alert',
        'Alerts when instantaneous power exceeds 750W - potential overload',
        'ALARM_THRESHOLD',
        'CRITICAL',
        'CUSTOMER',
        v_company1_id,
        true,
        '{"metric": "instantaneous_power", "operator": "GT", "value": 750, "unit": "W", "duration": 1, "aggregation": "LAST"}',
        '[{"type": "EMAIL", "config": {"to": ["energy@acmetech.com", "emergency@acmetech.com"]}, "enabled": true}, {"type": "SMS", "config": {"to": ["+5511999999999"]}, "enabled": true}]',
        '["power", "maximum", "overload", "critical"]',
        'ACTIVE',
        true,
        1
    );

    RAISE NOTICE 'Inserted 25 rules (including 9 new range/min/max examples)';
END $$;

-- Verify
SELECT id, name, type, priority, scope_type, enabled, status FROM rules ORDER BY type, priority DESC;
