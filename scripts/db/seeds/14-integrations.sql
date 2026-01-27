-- =============================================================================
-- SEED: INTEGRATION PACKAGES & SUBSCRIPTIONS
-- =============================================================================
-- Mock data for integration_packages and package_subscriptions tables
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_partner1_id UUID := 'aaaa1111-1111-1111-1111-111111111111';
    v_pkg1_id UUID := 'abc00001-0001-0001-0001-000000000001';
    v_pkg2_id UUID := 'abc00001-0001-0001-0001-000000000002';
    v_pkg3_id UUID := 'abc00001-0001-0001-0001-000000000003';
BEGIN
    -- Integration Package 1: ThingsBoard Connector
    INSERT INTO integration_packages (id, tenant_id, name, slug, description, long_description, category, tags, icon_url, documentation_url, type, status, current_version, versions, publisher_id, publisher_name, verified, scopes, capabilities, endpoints, events, auth, rate_limits, pricing, subscriber_count, published_at, version)
    VALUES (
        v_pkg1_id,
        v_tenant_id,
        'ThingsBoard Connector',
        'thingsboard-connector',
        'Bi-directional integration with ThingsBoard IoT platform',
        'Full integration with ThingsBoard including device synchronization, telemetry forwarding, and alarm bridging. Supports both cloud and on-premise ThingsBoard installations.',
        'iot_platform',
        '["iot", "thingsboard", "telemetry", "devices"]',
        'https://cdn.gcdr.io/packages/thingsboard/icon.png',
        'https://docs.gcdr.io/integrations/thingsboard',
        'BIDIRECTIONAL',
        'PUBLISHED',
        '2.1.0',
        '[{"version": "2.1.0", "releaseDate": "2024-01-15", "releaseNotes": "Added support for TB 3.6", "breaking": false}, {"version": "2.0.0", "releaseDate": "2023-10-01", "releaseNotes": "Major rewrite with improved performance", "breaking": true}]',
        v_partner1_id,
        'TechPartner Solutions',
        true,
        '["devices:sync", "telemetry:forward", "alarms:bridge"]',
        '[{"id": "device-sync", "name": "Device Synchronization", "description": "Sync devices between GCDR and ThingsBoard", "requiredScopes": ["devices:sync"]}, {"id": "telemetry-forward", "name": "Telemetry Forwarding", "description": "Forward telemetry data to ThingsBoard", "requiredScopes": ["telemetry:forward"]}]',
        '[{"id": "sync-devices", "method": "POST", "path": "/api/v1/thingsboard/sync", "description": "Trigger device synchronization"}, {"id": "get-status", "method": "GET", "path": "/api/v1/thingsboard/status", "description": "Get integration status"}]',
        '[{"eventType": "device.synced", "description": "Emitted when a device is synchronized", "payloadSchema": {"deviceId": "string", "tbDeviceId": "string"}}]',
        '{"type": "oauth2", "config": {"authUrl": "https://thingsboard.io/oauth2/authorize", "tokenUrl": "https://thingsboard.io/oauth2/token"}}',
        '{"requestsPerMinute": 100, "requestsPerDay": 10000}',
        '{"model": "MONTHLY", "price": 99.00, "currency": "USD", "includedRequests": 50000, "overagePrice": 0.001}',
        25,
        NOW() - INTERVAL '90 days',
        1
    );

    -- Integration Package 2: Slack Notifications
    INSERT INTO integration_packages (id, tenant_id, name, slug, description, long_description, category, tags, icon_url, documentation_url, type, status, current_version, versions, publisher_id, publisher_name, verified, scopes, capabilities, endpoints, events, auth, rate_limits, pricing, subscriber_count, published_at, version)
    VALUES (
        v_pkg2_id,
        v_tenant_id,
        'Slack Notifications',
        'slack-notifications',
        'Send alarm and event notifications to Slack channels',
        'Integration to send real-time notifications to Slack. Supports custom message formatting, channel routing based on alarm severity, and interactive alarm acknowledgment.',
        'notifications',
        '["slack", "notifications", "alerts", "chat"]',
        'https://cdn.gcdr.io/packages/slack/icon.png',
        'https://docs.gcdr.io/integrations/slack',
        'OUTBOUND',
        'PUBLISHED',
        '1.5.0',
        '[{"version": "1.5.0", "releaseDate": "2024-01-01", "releaseNotes": "Added interactive buttons", "breaking": false}]',
        v_partner1_id,
        'TechPartner Solutions',
        true,
        '["notifications:send", "alarms:read"]',
        '[{"id": "send-notification", "name": "Send Notification", "description": "Send notifications to Slack channels", "requiredScopes": ["notifications:send"]}]',
        '[{"id": "send-message", "method": "POST", "path": "/api/v1/slack/send", "description": "Send a message to Slack"}]',
        '[{"eventType": "notification.sent", "description": "Emitted when a notification is sent"}]',
        '{"type": "oauth2", "config": {"authUrl": "https://slack.com/oauth/v2/authorize"}}',
        '{"requestsPerMinute": 50, "requestsPerDay": 5000}',
        '{"model": "FREE"}',
        89,
        NOW() - INTERVAL '180 days',
        1
    );

    -- Integration Package 3: Draft Package
    INSERT INTO integration_packages (id, tenant_id, name, slug, description, category, tags, type, status, current_version, versions, publisher_id, publisher_name, verified, scopes, capabilities, auth, pricing, subscriber_count, version)
    VALUES (
        v_pkg3_id,
        v_tenant_id,
        'Power BI Analytics',
        'powerbi-analytics',
        'Export data to Power BI for advanced analytics and reporting',
        'analytics',
        '["analytics", "powerbi", "reporting", "bi"]',
        'OUTBOUND',
        'DRAFT',
        '0.1.0',
        '[{"version": "0.1.0", "releaseDate": "2024-01-20", "releaseNotes": "Initial draft", "breaking": false}]',
        v_partner1_id,
        'TechPartner Solutions',
        false,
        '["data:export", "reports:read"]',
        '[{"id": "export-data", "name": "Export Data", "description": "Export data to Power BI datasets", "requiredScopes": ["data:export"]}]',
        '{"type": "oauth2"}',
        '{"model": "MONTHLY", "price": 49.00, "currency": "USD"}',
        0,
        1
    );

    RAISE NOTICE 'Inserted 3 integration packages';

    -- Subscription 1: Company 1 subscribed to ThingsBoard
    INSERT INTO package_subscriptions (id, tenant_id, package_id, package_version, subscriber_id, subscriber_type, status, subscribed_at, config, usage_stats)
    VALUES (
        'ddd00001-0001-0001-0001-000000000001',
        v_tenant_id,
        v_pkg1_id,
        '2.1.0',
        v_company1_id,
        'customer',
        'ACTIVE',
        NOW() - INTERVAL '60 days',
        '{"thingsboardUrl": "https://tb.acmetech.com", "syncInterval": 300}',
        '{"totalRequests": 45230, "lastSync": "2024-01-20T10:30:00Z", "devicesSync": 45}'
    );

    -- Subscription 2: Company 1 subscribed to Slack
    INSERT INTO package_subscriptions (id, tenant_id, package_id, package_version, subscriber_id, subscriber_type, status, subscribed_at, config, usage_stats)
    VALUES (
        'ddd00001-0001-0001-0001-000000000002',
        v_tenant_id,
        v_pkg2_id,
        '1.5.0',
        v_company1_id,
        'customer',
        'ACTIVE',
        NOW() - INTERVAL '30 days',
        '{"defaultChannel": "#alerts", "criticalChannel": "#critical-alerts"}',
        '{"totalNotifications": 1250, "lastNotification": "2024-01-20T14:25:00Z"}'
    );

    -- Subscription 3: Suspended subscription
    INSERT INTO package_subscriptions (id, tenant_id, package_id, package_version, subscriber_id, subscriber_type, status, subscribed_at, config, usage_stats)
    VALUES (
        'ddd00001-0001-0001-0001-000000000003',
        v_tenant_id,
        v_pkg1_id,
        '2.0.0',
        '44444444-4444-4444-4444-444444444444', -- Company 2
        'customer',
        'SUSPENDED',
        NOW() - INTERVAL '120 days',
        '{"thingsboardUrl": "https://tb.acmeind.com"}',
        '{"totalRequests": 8500, "suspendedReason": "Payment overdue"}'
    );

    RAISE NOTICE 'Inserted 3 package subscriptions';
END $$;

-- Verify packages
SELECT id, name, slug, status, subscriber_count FROM integration_packages ORDER BY status, name;

-- Verify subscriptions
SELECT ps.id, ip.name as package, ps.subscriber_type, ps.status
FROM package_subscriptions ps
JOIN integration_packages ip ON ps.package_id = ip.id
ORDER BY ps.status, ip.name;
