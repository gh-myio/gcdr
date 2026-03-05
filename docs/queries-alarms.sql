SELECT id, name, metadata->>'tbId' AS tb_id FROM customers WHERE metadata->>'tbId' IS NOT NULL AND external_id IS NULL;
id	name	tb_id
84e0370e-636a-4741-9874-504b5e0b3577	Moxuara	5085bf40-b4dd-11f0-be7f-e760d1498268


A tabela rules usa scope_type + scope_entity_id. Uma rule se aplica a um device se:
  - scope_type = 'DEVICE' e scope_entity_id = device.id, ou
  - scope_type = 'ASSET' e scope_entity_id = device.asset_id, ou
  - scope_type = 'CUSTOMER' e scope_entity_id = device.customer_id

  Duas queries úteis:

  1. Quantos devices a Moxuara tem no total:
  SELECT COUNT(*)
  FROM devices
  WHERE customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
    AND tenant_id   = '11111111-1111-1111-1111-111111111111';

  2. Devices que têm pelo menos uma rule aplicada (qualquer scope):
  SELECT DISTINCT d.id, d.name, d.asset_id
  FROM devices d
  WHERE d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
    AND d.tenant_id   = '11111111-1111-1111-1111-111111111111'
    AND EXISTS (
      SELECT 1 FROM rules r
      WHERE r.enabled = true
        AND (
          (r.scope_type = 'DEVICE'   AND r.scope_entity_id = d.id)
          OR (r.scope_type = 'ASSET'    AND r.scope_entity_id = d.asset_id)
          OR (r.scope_type = 'CUSTOMER' AND r.scope_entity_id = d.customer_id)
        )
    );

  Se a query 1 retornar 0, Moxuara não tem devices cadastrados ainda. Se retornar > 0 mas a query 2 retornar 0, os devices existem mas nenhum tem
   rule — o filterOnlyDevicesWithRules=1 está correto em retornar vazio.
   
   
--- # new asset

DO $$                                                                                                                                            DECLARE                                                                                                                                              v_asset_id UUID := gen_random_uuid();                                                                                                        BEGIN                                                                                                                                          
      INSERT INTO assets (
          id, tenant_id, customer_id, parent_asset_id,
          path, depth,
          name, display_name, code, type,
          location, specs, tags, metadata,
          status, version
      ) VALUES (
          v_asset_id,
          '11111111-1111-1111-1111-111111111111',
          '84e0370e-636a-4741-9874-504b5e0b3577',   -- Moxuara
          NULL,
          '/11111111-1111-1111-1111-111111111111'
              || '/84e0370e-636a-4741-9874-504b5e0b3577'
              || '/' || v_asset_id,
          0,
          'Central_Asset_Moxuara',
          'Central Asset Moxuara',
          'CENTRAL-ASSET-MOXUARA',
          'OTHER',
          '{}', '{}', '[]', '{}',
          'ACTIVE', 1
      );

      RAISE NOTICE 'Asset criado. ID = %', v_asset_id;
  END $$;
  
  SELECT id, name, path FROM assets WHERE code = 'CENTRAL-ASSET-MOXUARA'
    AND customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'; -- 2a257caa-a184-4304-9561-adf8e21814ca
	
	
--- new central

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

---

SELECT id, name, serial_number, type, status, connection_status
FROM centrals
WHERE id = 'e982edf9-edb1-4aa6-8a14-4782465ae5a3';


UPDATE rules                                                                                                                                     
SET alarm_config = jsonb_set(jsonb_set(alarm_config, '{duration}', '1200000'), '{value}', '110')
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'                                                                                       
    AND name ILIKE '%Elevador%'
    AND (alarm_config->>'duration')::int = 901000                                                                                                    
	AND (alarm_config->>'value')::int = 210; 
	
	
UPDATE rules                                                                                                                                     
SET alarm_config = jsonb_set(alarm_config, '{value}', '205')
WHERE id IN (                                                                                                                                  
      'bbbb0001-0001-0001-0001-000000000023',
      'bbbb0001-0001-0001-0001-000000000024');
UPDATE rules                                                                                                                                     
SET alarm_config = jsonb_set(jsonb_set(alarm_config, '{duration}', '1200000'), '{value}', '110')
  WHERE id IN (                                                                                                                                  
      'bbbb0001-0001-0001-0001-000000000023',
      'bbbb0001-0001-0001-0001-000000000024' );
	  
	  
---


   -- ==========================================================================
    -- ELEVATOR OFFLINE - Frozen Power (all days)
    -- operator: UNCHANGED — triggers when metric value stays exactly the same
    -- for the full duration window (requires UNCHANGED support in alarms-backend)
    -- ==========================================================================
    -- Duration: 12h 21min = 44460000 ms
    INSERT INTO rules (id, tenant_id, customer_id, name, description, type, priority, scope_type, scope_entity_id, scope_inherited, alarm_config, notification_channels, tags, status, enabled, version)
    VALUES (
        'bbbb0001-0001-0001-0001-000000000026',
        v_tenant_id,
        v_dimension_id,
        'Elevador OFFLINE - Potência Congelada - Todos os dias',
        'Alerta quando a potência do elevador permanece exatamente igual por 12h21min — indica sensor congelado ou elevador offline',
        'ALARM_THRESHOLD',
        'HIGH',
        'DEVICE',
        '22220001-0001-0001-0001-000000000005', -- 3F Geral (template device)
        false,
        '{"metric": "power", "operator": "UNCHANGED", "value": 0, "duration": 44460000, "aggregation": "LAST", "startAt": "00:00", "endAt": "23:59", "daysOfWeek": [0, 1, 2, 3, 4, 5, 6], "keyMulti": 1, "dedup": {"enabled": true, "ttlSeconds": 600}, "cooldown": {"enabled": true, "seconds": 300, "perChannel": false}, "hysteresisGuard": {"enabled": false, "windowSeconds": 180, "maxTransitions": 3}, "digest": {"enabled": false, "windowSeconds": 600, "threshold": 5}}',
        '[{"type": "EMAIL", "config": {"to": ["energia@dimension.com.br"]}, "enabled": true}]',
        '["elevator", "power", "frozen", "offline", "unchanged"]',
        'ACTIVE',
        true,
        1
    );
	
	
---


-- =============================================================================
-- INSERT Rule: "Elevador OFFLINE - Potência Congelada - Todos os dias"
-- + Associate to all Moxuara elevator devices via scope_entity_ids
--
-- Customer       : Moxuara (84e0370e-636a-4741-9874-504b5e0b3577)
-- Tenant         : 11111111-1111-1111-1111-111111111111
-- Rule ID        : bbbb0001-0001-0001-0001-000000000026
-- Duration       : 12h 21min = 44460000 ms
-- Operator       : UNCHANGED (triggers when metric stays exactly the same)
-- =============================================================================

-- STEP 1: INSERT the rule scoped to Moxuara's elevator devices
INSERT INTO rules (
    id,
    tenant_id,
    customer_id,
    name,
    description,
    type,
    priority,
    scope_type,
    scope_entity_ids,
    scope_inherited,
    alarm_config,
    notification_channels,
    tags,
    status,
    enabled,
    version
)
VALUES (
    'bbbb0001-0001-0001-0001-000000000026',
    '11111111-1111-1111-1111-111111111111',
    '84e0370e-636a-4741-9874-504b5e0b3577',   -- Moxuara
    'Elevador OFFLINE - Potência Congelada - Todos os dias',
    'Alerta quando a potência do elevador permanece exatamente igual por 12h21min — indica sensor congelado ou elevador offline',
    'ALARM_THRESHOLD',
    'HIGH',
    'DEVICE',
    (
        SELECT ARRAY_AGG(id)
        FROM devices
        WHERE customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
          AND tenant_id   = '11111111-1111-1111-1111-111111111111'
          AND UPPER(name) LIKE '%ELEVADOR%'
    ),
    false,
    '{"metric": "power", "operator": "UNCHANGED", "value": 0, "duration": 44460000, "aggregation": "LAST", "startAt": "00:00", "endAt": "23:59", "daysOfWeek": [0, 1, 2, 3, 4, 5, 6], "keyMulti": 1, "dedup": {"enabled": true, "ttlSeconds": 600}, "cooldown": {"enabled": true, "seconds": 300, "perChannel": false}, "hysteresisGuard": {"enabled": false, "windowSeconds": 180, "maxTransitions": 3}, "digest": {"enabled": false, "windowSeconds": 600, "threshold": 5}}',
    '[{"type": "EMAIL", "config": {"to": ["operacoes@moxuara.com.br"]}, "enabled": true}]',
    '["elevator", "power", "frozen", "offline", "unchanged"]',
    'ACTIVE',
    true,
    1
);

-- STEP 2: Verify rule created and devices associated
SELECT
    r.id,
    r.name,
    r.priority,
    array_length(r.scope_entity_ids, 1) AS devices_count,
    r.alarm_config->>'operator'  AS operator,
    r.alarm_config->>'duration'  AS duration_ms,
    r.alarm_config->>'metric'    AS metric
FROM rules r
WHERE r.id = 'bbbb0001-0001-0001-0001-000000000026';

-- STEP 3: List all elevator devices associated
SELECT d.id, d.name
FROM devices d
WHERE d.id = ANY(
    SELECT unnest(scope_entity_ids) FROM rules
    WHERE id = 'bbbb0001-0001-0001-0001-000000000026'
)
ORDER BY d.name;


----
com esses dados já cadastrados no banco GCDR
rule 
bbbb0001-0001-0001-0001-000000000026
devices
9264f262-6b5c-4f7e-ac12-5760fc225e33
7e3aaf6a-31e7-4c45-a70d-f978bcfe0a46
cb29bc74-6531-460c-abca-98c678112388
a83ebc33-25ac-4792-99ca-08a2cc86aff1
463a38ed-e5b3-4aac-a4d0-f86a35cfbb77
e9dce3c5-efa0-4df3-8352-8d09e60a1ea7
f3d80c84-c2b0-4325-b73a-d48d2f8f8c0f
customer
84e0370e-636a-4741-9874-504b5e0b3577
Central
e982edf9-edb1-4aa6-8a14-4782465ae5a3
preciso de um script de criaçào de alarmes já trigados
para o dia 15-02-2026
com dados randomicos
dos 7 Devices
1 device  trigando esse alarme em 4 momentos do dia
2 devices trigando esse alarme em 6 momentos do dia
etc
quero um script para rodar em produção para criar esses alarmes
e um script para remover esses alarmes também caso precise

----


-- quero um select de alguma rule que tem channelId definido no alarmConfig

SELECT id, name, customer_id,                                                                                                                                                               scope_type,
         scope_entity_id,                                                                                                                                                                     alarm_config->>'channelId' AS channel_id,
         alarm_config                                                                                                                                                                
    FROM rules
   WHERE alarm_config->>'channelId' IS NOT NULL
   LIMIT 10;

----

devices tem coluna metadata (JSONB) e external_id. Query:                                                                                                                               
                                                                                                                                                                                          
  -- Devices com tbId no metadata                                                                                                                                                         
  SELECT
    d.id,
    d.name,
    d.display_name,
    d.external_id,
    d.metadata->>'tbId' AS tb_id,
    d.customer_id,
    c.name AS customer_name
  FROM devices d
  JOIN customers c ON c.id = d.customer_id
  WHERE d.metadata->>'tbId' IS NOT NULL
  ORDER BY c.name, d.name;

  Se quiser cruzar com os que já têm external_id vs. os que ainda não têm (para saber quais precisam de sync):

  -- Devices com tbId no metadata mas sem external_id (precisam de sync)
  SELECT
    d.id,
    d.name,
    d.metadata->>'tbId' AS tb_id,
    d.external_id,
    c.name AS customer_name
  FROM devices d
  JOIN customers c ON c.id = d.customer_id
  WHERE d.metadata->>'tbId' IS NOT NULL
    AND d.external_id IS NULL
  ORDER BY c.name, d.name;