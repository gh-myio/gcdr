-- =============================================================================
-- INSERT Central for Moxuara
--
-- Central ID     : e982edf9-edb1-4aa6-8a14-4782465ae5a3
-- Customer       : Moxuara (84e0370e-636a-4741-9874-504b5e0b3577)
-- Asset          : Central_Asset_Moxuara (2a257caa-a184-4304-9561-adf8e21814ca)
-- Tenant         : 11111111-1111-1111-1111-111111111111
-- =============================================================================

INSERT INTO centrals (
    id,
    tenant_id,
    customer_id,
    asset_id,
    name,
    display_name,
    serial_number,
    type,
    status,
    connection_status,
    firmware_version,
    software_version,
    config,
    stats,
    location,
    tags,
    metadata,
    version
) VALUES (
    'e982edf9-edb1-4aa6-8a14-4782465ae5a3',
    '11111111-1111-1111-1111-111111111111',
    '84e0370e-636a-4741-9874-504b5e0b3577',   -- Moxuara
    '2a257caa-a184-4304-9561-adf8e21814ca',   -- Central_Asset_Moxuara
    'Central Shopping Moxuara',
    'Central Shopping Moxuara',
    'SCMXGATEWAY01',
    'GATEWAY',
    'ACTIVE',
    'OFFLINE',
    '1.0.0',
    '1.0.0',
    '{}',
    '{}',
    '{}',
    '[]',
    '{}',
    1
);

-- Verify
SELECT id, name, serial_number, type, status, connection_status
FROM centrals
WHERE id = 'e982edf9-edb1-4aa6-8a14-4782465ae5a3';
