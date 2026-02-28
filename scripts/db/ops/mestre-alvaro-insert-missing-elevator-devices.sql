-- =============================================================================
-- INSERT: Devices de Elevadores faltantes — Mestre Álvaro
--
-- Asset escolhido : c0b728be-de68-49a3-8328-29e660c03a7b
--                   "Elevadores Shopping Mestre Álvaro"
-- Customer        : e04046d4-baa4-44e9-a378-4dfebe4140f1
-- Tenant          : 11111111-1111-1111-1111-111111111111
-- Central L2      : d3202744-05dd-46d1-af33-495e9a2ecd52
--
-- Elevador 4 (slave 88) já existe → só corrige display_name e asset_id
-- Elevadores 1,3,6a,6b,7 → INSERT
-- =============================================================================

-- PASSO 1: Corrigir o device existente (Elevador 4, slave_id=88)
UPDATE devices SET
  display_name = 'Elevador 4',
  asset_id     = 'c0b728be-de68-49a3-8328-29e660c03a7b',
  updated_at   = NOW(),
  version      = version + 1
WHERE id = '816fe09a-bde1-404d-8bde-18cb4988d553'
  AND tenant_id = '11111111-1111-1111-1111-111111111111';

-- PASSO 2: INSERT dos 5 elevadores faltantes
INSERT INTO devices (
  id,
  tenant_id,
  customer_id,
  asset_id,
  central_id,
  name,
  display_name,
  type,
  serial_number,
  identifier,
  slave_id,
  status,
  metadata,
  tags,
  specs,
  attributes,
  connectivity_status,
  version,
  created_at,
  updated_at
) VALUES

-- Elevador 1 — slave 83
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  'e04046d4-baa4-44e9-a378-4dfebe4140f1',
  'c0b728be-de68-49a3-8328-29e660c03a7b',
  'd3202744-05dd-46d1-af33-495e9a2ecd52',
  'Elevador 1', 'Elevador 1',
  'SENSOR', '3F SCMAL2ACEL1', '3F SCMAL2ACEL1', 83,
  'ACTIVE',
  '{"tbEntityType":"DEVICE","tbId":"aa7f5240-9011-11f0-a06d-e9509531b1d5","tbType":"Elevadores","tbName":"3F SCMAL2ACEL1"}',
  '[]', '{}', '{}', 'UNKNOWN', 1, NOW(), NOW()
),

-- Elevador 3 — slave 87
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  'e04046d4-baa4-44e9-a378-4dfebe4140f1',
  'c0b728be-de68-49a3-8328-29e660c03a7b',
  'd3202744-05dd-46d1-af33-495e9a2ecd52',
  'Elevador 3', 'Elevador 3',
  'SENSOR', '3F SCMAL2ACEL3', '3F SCMAL2ACEL3', 87,
  'ACTIVE',
  '{"tbEntityType":"DEVICE","tbId":"ac8cfc90-9011-11f0-a06d-e9509531b1d5","tbType":"Elevadores","tbName":"3F SCMAL2ACEL3"}',
  '[]', '{}', '{}', 'UNKNOWN', 1, NOW(), NOW()
),

-- Elevador 6 (slave 89) — SCMAL2ACEL5
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  'e04046d4-baa4-44e9-a378-4dfebe4140f1',
  'c0b728be-de68-49a3-8328-29e660c03a7b',
  'd3202744-05dd-46d1-af33-495e9a2ecd52',
  'Elevador 6', 'Elevador 6',
  'SENSOR', '3F SCMAL2ACEL5', '3F SCMAL2ACEL5', 89,
  'ACTIVE',
  '{"tbEntityType":"DEVICE","tbId":"ad93e540-9011-11f0-a06d-e9509531b1d5","tbType":"Elevadores","tbName":"3F SCMAL2ACEL5"}',
  '[]', '{}', '{}', 'UNKNOWN', 1, NOW(), NOW()
),

-- Elevador 6 (slave 84) — SCMAL2ACEL6
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  'e04046d4-baa4-44e9-a378-4dfebe4140f1',
  'c0b728be-de68-49a3-8328-29e660c03a7b',
  'd3202744-05dd-46d1-af33-495e9a2ecd52',
  'Elevador 6B', 'Elevador 6B',
  'SENSOR', '3F SCMAL2ACEL6', '3F SCMAL2ACEL6', 84,
  'ACTIVE',
  '{"tbEntityType":"DEVICE","tbId":"aaff57b0-9011-11f0-a06d-e9509531b1d5","tbType":"Elevadores","tbName":"3F SCMAL2ACEL6"}',
  '[]', '{}', '{}', 'UNKNOWN', 1, NOW(), NOW()
),

-- Elevador 7 — slave 86
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  'e04046d4-baa4-44e9-a378-4dfebe4140f1',
  'c0b728be-de68-49a3-8328-29e660c03a7b',
  'd3202744-05dd-46d1-af33-495e9a2ecd52',
  'Elevador 7', 'Elevador 7',
  'SENSOR', '3F SCMAL2ACEL7', '3F SCMAL2ACEL7', 86,
  'ACTIVE',
  '{"tbEntityType":"DEVICE","tbId":"ac04e0d0-9011-11f0-a06d-e9509531b1d5","tbType":"Elevadores","tbName":"3F SCMAL2ACEL7"}',
  '[]', '{}', '{}', 'UNKNOWN', 1, NOW(), NOW()
)

ON CONFLICT (tenant_id, identifier) DO UPDATE SET
  asset_id     = EXCLUDED.asset_id,
  central_id   = EXCLUDED.central_id,
  slave_id     = EXCLUDED.slave_id,
  display_name = EXCLUDED.display_name,
  metadata     = EXCLUDED.metadata,
  updated_at   = NOW(),
  version      = devices.version + 1;

-- PASSO 3: Verificação final
SELECT
  id,
  name,
  display_name,
  slave_id,
  asset_id,
  status,
  metadata->>'tbId' AS tb_id
FROM devices
WHERE tenant_id   = '11111111-1111-1111-1111-111111111111'
  AND customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
  AND asset_id    = 'c0b728be-de68-49a3-8328-29e660c03a7b'
ORDER BY slave_id;
