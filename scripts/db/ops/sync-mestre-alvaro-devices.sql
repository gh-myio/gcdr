-- =============================================================================
-- Script: sync-mestre-alvaro-devices.sql
-- Purpose: Sync 381 ThingsBoard entities to GCDR devices for Mestre Álvaro
-- Source:  logs/entities_table_entities.csv
-- Date:    2026-02-28
-- Rows:    381
--
-- USAGE:
--   Run via psql or Admin DB UI:
--     psql $DATABASE_URL -f scripts/db/ops/sync-mestre-alvaro-devices.sql
--
--   Steps:
--     1. DIAGNOSTIC  - read-only, shows missing vs existing vs name conflicts
--     2. UPSERT      - inserts missing, updates changed name/label
--     3. ENRICHMENT  - outputs all 381 rows with gcdrDeviceId + gcdrAssetId
--
-- Centrals:
--   L1:   45250d44-bad0-4071-aaa0-8091cfb12691
--   L2:   d3202744-05dd-46d1-af33-495e9a2ecd52
--   L3L4: fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e
--
-- Customer: Mestre Álvaro
--   ID: 84e0370e-636a-4741-9874-504b5e0b3577
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Load CSV snapshot into temp table
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _csv_ma_devices (
  csv_name   TEXT NOT NULL,
  csv_label  TEXT,
  slave_id   SMALLINT NOT NULL,
  central_id UUID NOT NULL
);
TRUNCATE _csv_ma_devices;

INSERT INTO _csv_ma_devices (csv_name, csv_label, slave_id, central_id) VALUES
  ('3F 104ABCJKL', 'São Jose Super', 86, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F 106AB108AH', 'Allegria', 71, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F 115BCDD1E', 'Polo Wear', 45, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F 203DEFGHIN', 'PERNAMBUCANAS', 26, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F 305BCDEFG', 'Vila do Trigo', 120, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F 310ABCHIJ', 'Polo Club', 110, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F ELEV. SCMAL2ACEL2', 'Elevador 2', 85, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 01', 'ER 1', 90, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 02', 'ER 2', 187, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 03', 'ER 3', 92, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 04', 'ER 4', 93, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 05', 'ER 5', 94, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 06', 'ER 6', 95, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 07', 'ER 7', 96, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 08', 'ER 8', 130, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 09', 'ER 9', 131, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 10', 'ER 10', 132, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 11', 'ER 11', 133, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 12', 'ER 12', 188, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 13', 'ER 13', 189, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 14', 'ER 14', 190, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 15', 'ER 15', 191, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F ESRL. PF-Escada 16', 'ER 16', 192, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil 9', 'Fancoil 9 Está desativado', 158, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil1', 'Fancoil 1', 150, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil10', 'Fancoil 10', 159, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil11', 'Fancoil 11', 160, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil12', 'Fancoil 12', 161, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil13', 'Fancoil 13', 162, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil14', 'Fancoil 14', 163, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil15', 'Fancoil 15', 164, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil16', 'Fancoil 16', 165, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil17', 'Fancoil 17', 166, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil18', 'Fancoil 18', 167, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil19', 'Fancoil 19', 168, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil2', 'Fancoil 2', 151, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil20', 'Fancoil 20', 169, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil21', 'Fancoil 21', 170, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil22', 'Fancoil 22', 171, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil23', 'Fancoil 23', 172, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil24', 'Fancoil 24', 173, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil25', 'Fancoil 25', 174, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil3', 'Fancoil 3', 152, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil4', 'Fancoil 4', 153, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil5', 'Fancoil 5', 154, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil6', 'Fancoil 6', 155, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil7', 'Fancoil 7', 156, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACAC-Fancoil8', 'Fancoil 8', 157, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACCAGBAG-C 01', 'Bomba Condensada 1', 127, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACCAGBAG-C 02', 'Bomba Condensada 2', 128, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACCAGBAG-C R', 'Bomba Condensada 3', 129, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACCAGBAG-P 01', 'Bomba Primaria 1', 121, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACCAGBAG-P 02', 'Bomba Primária', 122, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACCAGBAG-P R', 'Bomba Primária 3', 123, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACCAGBAG-S 01', 'Bomba Secundária 1', 124, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACCAGBAG-S 02', 'Bomba Secundária 2', 125, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F MOTR. SCMAL2ACCAGBAG-S R', 'Bomba Secundária 3', 126, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMADPChiquinho_L1', 'CHIQUINHO DEPOSITO', 146, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL001ABodytech', 'Bodytech', 145, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L101A', 'FÓRMULA (instalado, pendente de ajuste no desenvolvimento)', 6, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L102A', 'Faculdade Mandic', 8, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L103C', 'MEDCONSULTA MESTRE ALVARO', 37, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1102A', 'Vivenda Do Camarão', 22, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1102B', 'Imperador Burguer', 21, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1102C', 'MC DONALD´S', 66, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1102HI', 'Maverick''s', 16, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1102JK', 'SEM LOJA COM CONSUMO - 102JK', 98, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1102L', 'Móveis Simonetti', 14, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1102N', 'Pet Shop', 18, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1103A', 'SEM LOJA - 103A', 117, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1103BC', 'Shopping do Imóvel', 99, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1103DEF', 'Correios', 79, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1103H', 'PHONE PRIME', 49, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1104', 'SEM NOME SCMAL0L1104', 10, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1104D', 'Pimenta Dance', 13, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1104G', 'Millennium Store', 11, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1104H', 'GO PLAY', 9, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1105C', 'Chicken Town', 23, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1105D', 'CHOPP BRAHMA', 93, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1106C', 'JOCA ESPHIRERIA', 43, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1107A', 'Pecado de Carne', 88, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1107B', 'Milky Moo', 112, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1107C', 'GREEN STATION', 96, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1107D', 'Grilleto', 76, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1107E', 'Divino Fogão', 46, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1109A', 'ORTOBOM', 116, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1109C', 'Casa Do Celular', 27, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1109D', 'Barbarella', 30, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1110BC', 'Smart Brasil', 80, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1110D', 'ICE CREAM ROLL 110D', 31, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1110E', 'PARAÍSO MAKEUP', 33, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1111', 'Bob´s', 2, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1112A', 'PRAÇA PET', 78, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1112DE', 'DEPOSITO CLUBE MELISSA', 48, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1112FG', 'FRAGRANCE', 125, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1112H', 'Paraíso Makeup', 12, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1112J', 'CHOP_Brahma', 7, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1113A', 'Choes', 20, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1113B', 'Patroni', 19, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1113CD', 'Burguer  king', 17, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1114A', 'Spoleto', 58, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1114B', 'Pastiola', 92, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1114C', 'Subway', 115, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1114D', 'Farinella', 124, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1115A', 'Cosechas', 25, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1115A_2', 'Don Burguer', 24, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1115H', 'Yaz', 35, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1115J', 'Pipocando', 34, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1115K', 'BEBEDOUROS E CIA', 29, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1116BC', 'Casas Bahia', 74, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1116F', 'Casa & Video', 95, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1116G', 'Multicoisa', 26, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1117A', 'Castorino', 32, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1DP01', 'Depósito Porto Vitória', 40, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1DP02', 'MBOX', 42, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1DP03', 'Depósito Metal Nobre', 15, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1DP06', 'Depósito cacau show', 36, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1DP07', 'Depósito Los Neto', 38, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1DP09', 'Depósito Baby Dino', 41, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1EP004', 'Imperio da sinuca', 39, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q101', 'BR MACHINE', 51, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q102A', 'PRESENTAÇO QUIOSQUE', 130, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q103', 'CHIQUINHOS SORVETES', 131, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q104', 'MD SUCESSO', 50, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q104A', 'CHAVE DO TESOURO', 81, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q104B', 'PLAY TOY PARK', 102, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q105', 'CHUTE CERTO', 119, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q107', 'MUNDO DE CHOCOLATE', 100, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q108', 'Raiz Tapiocaria Brasil', 52, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q109', 'SOLIV', 118, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q110F', 'PRIZE STATION', 133, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q113', 'ESPAÇO KIDS', 142, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q114', 'PORTO VITORIA ESPORTE', 127, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q115', 'CHUTE CERTO', 53, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL0L1Q116A', 'MESTRE DA EMPADA', 84, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F SCMAL2AC201B', 'Sem nome', 2, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC201C', 'Sipolatti', 22, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC201D', 'Loja (loja sobrando, excluir da dashboard)', 42, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC201EF', 'Paraíso Bijoux', 58, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC201GH', 'Cafeteria do Mestre', 57, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC201IJ', 'Santa Lolla', 3, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC201KLM', 'Claro', 24, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC201N', 'RESERVA', 43, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC201STUV', 'Loucic Uniformes', 44, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC202A', 'DAY CAMBIO', 60, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC202C', 'Barbearia Los Manos', 5, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC205BC', 'CLINICA HABILITAR', 21, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC205DEFG', 'FERRUGINE', 61, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC205HIJ', 'RI HAPPY', 41, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC205KL', 'EMPÓRIO MAIA', 6, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC205MN', 'LE BISCUIT', 27, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC206A', 'CIA DO TERNO', 46, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC206G', 'FIRE JUMP', 62, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC207B', 'Snap Board Shop', 29, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC207CDE', 'Indus', 47, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC207FGH', 'Bahamas', 63, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC207I', 'Gigante da Colina', 75, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC207J', 'Cris Lu', 9, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC208A', 'Mundo Tech', 30, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC208BC', 'sem nome', 48, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC208CDE', 'Jheny Acessorios', 64, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC208FGHI', 'Moveon Esportes', 10, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC208J', 'SEM LOJA - 208J', 31, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC209A', 'DEPOSITO PUKET ( remover da dashboard)', 49, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC209BCD', 'vivara', 65, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC209E', 'PUKET', 77, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC209F', 'MAGIA DO MAR', 11, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC209GH', 'FATTO A MANO', 32, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC210BC', 'SIMMONS COLCHOES', 50, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC210E', 'BM Store', 66, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC210G', 'PHOTO MANIA', 79, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC210J', 'CASE QUEEN', 12, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC212BCD', 'Rede Inova', 73, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC213A', 'Artesanato da Terra', 193, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2AC213BCD', 'Hering', 51, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACBOMBH1', 'Bomba hidráulica 1 (Verificar tipo de Bomba)', 103, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACBOMBH2', 'Bomba hidrúlica 2', 99, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACBOMBH3', 'Bomba hidraulica 3 (está desativado)', 100, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACBOMBH4', 'Bomba hidrúlica 4', 101, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACBOMBH5', 'Bomba hidrúlica 5', 102, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACBOMBH6', 'Bomba hidrúlica 6', 104, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACBOMBI1', 'Bomba de incendio 1 (entender tipo de bomba)', 97, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACBOMBI2', 'Bomba de incendio 2', 98, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACCAGC', 'Chiller 1', 120, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACCAGC2', 'Chiller 2', 119, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACD210D', 'Florenzza', 38, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACEL1', 'Elevador 1', 83, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACEL3', 'Elevador 3', 87, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACEL4', 'Elevador 4', 88, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACEL5', 'Elevador 5', 89, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACEL6', 'Elevador 6', 84, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACEL7', 'Elevador 7', 86, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ200A', 'Nena Quaresma', 13, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ201', 'BR Machine', 34, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ201W', 'Play Toy Park', 68, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ202', 'MC DONALD´S QUIOSQUE', 80, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ203', 'FUN PHOTO BOOTH', 14, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ203B', 'RAPID PRINT', 35, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ203C', 'Pandora', 53, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ205', 'Mini Power Car', 69, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ207A', 'Play toy Park', 81, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ210', 'Bob´s Quiosque', 15, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ211', 'World Case Quiosque', 54, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ211A', 'Praia Play', 70, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ213', 'MR Kids', 17, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL2ACQ213A', 'Mistery Box Play', 37, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F SCMAL3L4301E', 'VX case', 59, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4301F', 'Metal Nobre', 80, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4301G', 'L´occitane', 101, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4301H', 'Los Confort Shoes', 7, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4301JK', 'Los Kids', 38, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4301LMN', 'Los Neto', 60, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4302', 'Boticario', 1, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4302C', 'Chilli Beans', 102, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4302D', 'Espaço Laser', 8, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4302E', 'oticas Maya', 39, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4302F', 'Harmonize', 58, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4302GH', 'Constance', 85, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4303EFGHI', 'Leitura Express', 40, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4303J', 'Otica diniz', 61, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4303KL', 'Baggagio', 86, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4303MN', 'Carolina Baioco', 104, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4304DEFG', 'outback', 41, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4304F', 'oticas Diniz', 87, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4304H', 'visão Express', 13, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4304I', 'Depósito Cacau Show', 43, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4304J', 'Peticolé', 64, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4304KLMN', 'Super kids', 88, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4305A', 'SEM LOJA - 305A', 122, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4306B', 'Lolita', 65, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4306CD', 'WCOM Informatica', 89, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4306E', 'Natura', 107, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4306H', 'presença', 45, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4306IJ', 'vitória Ternos', 66, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4306KL', 'Los Sports', 90, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4306P', 'Borelli', 16, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4307AB', 'Euro Colchões', 46, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4307CDE', 'Carmen Steffens Outlet', 67, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4307F', 'First Class', 91, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4307G', 'Kopenhagen', 82, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4307H', 'Trifil', 18, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4307I', 'Let´s Esmalteria', 47, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4307J', 'Jah do Açai', 68, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4308ABCDE', 'Itapuã Calçados', 92, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4308F', 'coelhinho Sorveteria italiana', 33, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4308G', 'óticas carol', 19, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4308H', 'Konyk', 49, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4308IJ', 'Inovar', 70, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4309A', 'JACKLAYNE JOIAS', 84, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4309CD', 'Clube Melissa', 21, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4309EF', 'Vivo', 71, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4309GH', 'Baby Dino', 93, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4310D', 'Marques Joias', 22, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4310F', 'Cacau Show', 72, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4310G', 'Silverland', 94, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4311', 'Take Kids', 2, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4313A', '(Antigo Terra a vista )', 52, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4401', 'Vila Park Boliche', 5, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4EC002', 'PITT STOP', 119, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q303', 'WE PINK QUIOSQUE', 23, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q304A', 'Samsung Quiosque', 54, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q304B', 'Havaianas Quiosques', 74, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q304C', 'Pellucinhas', 95, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q305', 'Bob´s Quiosques', 112, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q306', 'Touti Perfurmes', 24, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q306A', 'Inplay VR', 75, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q306_2', 'Ale Pudim', 25, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q307', 'Mc café Quiosque', 96, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q308', 'Chave do tesouro Quiosque', 27, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q310', 'MBOX', 98, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q310A', 'Deboa', 115, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q310B', 'Game On', 28, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q311', 'Red Skull', 56, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q312', 'zé coxinha Quiosque', 77, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q313', 'Fini Balas', 99, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMAL3L4Q315', 'QUIOSQUE REALME', 117, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('3F SCMALinplayVR', 'InplayVR', 144, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('3F Trafo CAG 1', 'Trafo CAG 1', 185, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('3F Trafo CAG 2', 'Trafo CAG 2', 186, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. 104ABCJKL', 'são Jose Super', 85, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. 106AB108AH', 'Allegria', 72, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. 301BCPOPQ', 'C&A Modas', 30, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. 305BCDEFG', 'Vila do Trigo', 121, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL0L1101', 'Cine Araújo', 1, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1102A', 'vivenda do camarão', 69, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1102B', 'Imperador Burguer', 67, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1102CDE', 'Mc donalds', 122, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1102LM', 'Móveis Simonetti', 134, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1103B', 'Shopping do imovel', 55, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1104H', 'GO PLAY', 141, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1105AB', 'Don Burguer', 110, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1105C', 'Chicken Town', 70, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1107A', 'Pecada da Carne', 87, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1107B', 'Milky Moo', 111, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1107C', 'Green Station', 97, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1107D', 'Grilleto', 77, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1107E', 'Divino Fogão', 47, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1110A', 'Lojas Americanas', 89, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1110D', 'ICE ROLL 110D', 63, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1111', 'Bob´s', 3, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1112H', 'Paraiso Makeup', 65, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1112J', 'Chopp Brahma', 56, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1113A', 'Choe´s', 60, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1113B', 'Patroni Pizza', 68, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1113CD', 'Burguer  king', 73, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1114A', 'Spoleto', 57, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1114B', 'Pastiola', 90, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1114C', 'Subway', 114, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1114D', 'Farinella', 123, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1115', 'Polo Wear (RETIRAR DO DASHBOARD)', 5, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1115A', 'Cosechas', 61, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1115HI', 'Yaz Docerias', 59, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1115J', 'Pipocando', 64, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1116BC', 'Casas Bahia', 75, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1116G', 'Multcoisas', 62, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL0L1Q103', 'Chiquinhos Sorvetes Quiosque', 132, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('HIDR. SCMAL2AC201A', 'Avenida', 19, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC201C', 'Sipolatti', 23, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC201GH', 'Cafetria do Mestre', 56, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC201STUV', 'Loucic Uniformes', 45, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC203', 'Riachuelo', 1, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC205BC', 'Clinica Habilitar', 20, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC205HIJ', 'RI Happy', 40, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC205KL', 'EMPÓRIO MAIA', 7, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC205MN', 'Le Biscuit', 28, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC209E', 'Puket', 78, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2AC212BCD', 'Rede Inova', 74, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHICEBAL1', 'AC- Hidrometro Cesan Banheiros L1', 109, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHICEBAL2', 'AC- Hidrometro Cesan Banheiros L2', 112, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHICEBAL3', 'AC- Hidrometro Cesan Banheiros L3', 106, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHICI', 'AC- Hidrometro C.isterna (instalado, mas não há consumo de água suficiente)', 108, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHINABAL1', 'AC- Hidrometro  Nascente para banheiros L1', 105, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHINABAL2', 'AC- Hidrometro Nascente para banheiros L2', 115, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHINABAL3', 'AC- Hidrometro Nascente Banheiros L3', 110, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHINATORE', 'AC- Hidrometro Nascente T.orres Resfriamento (Precisa ser feito o mapeamento desse ponto)', 117, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHIPRNA', 'AC- Hidrometro Principal Nascente (Pendente de verificação tecnica)', 113, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHIPUÁGCOUR', 'AC- Hidrometro purga de água condensada UR01 (Precisa ser feito o mapeamento desse ponto)', 114, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHIPUÁGCOUR_2', 'AC- Hidrometro purga de água condensada UR02', 116, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHITA', 'AC- Hidrometro TAG', 107, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACACHITACETORE', 'AC- Hidrometro TAG Cesan para as t.orres de resfriamento', 111, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL2ACQ210', 'Bob´s Quiosque', 16, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('HIDR. SCMAL3L4301D', 'CHeirin Bão', 37, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4301G', 'L´occitane', 100, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4302AB', 'Boticario', 116, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4302D', 'Espaço Laser', 9, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4303J', 'Oticas Diniz', 62, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4304ABC', 'Marisa (água)', 12, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4304DEFG', 'outback', 42, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4306ANO', 'Renner', 31, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4306P', 'Borelli', 17, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4307G', 'Kopenhagen', 81, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4307I', 'Let´s Esmalteria', 48, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4308F', 'Coelhinho Sorveteria italiana', 32, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4308G', 'oticas carol', 20, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4309A', 'Jacklanyne Joias', 83, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4311', 'take Kids', 3, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4313A', 'Terra A vista', 53, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4401', 'vila Park Boliche', 4, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4EC002', 'PITT STOP', 118, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4Q305', 'Bob''s Q305', 113, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4Q307', 'MC Café Quiosque', 97, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4Q312', 'zé coxinha Quiosque', 78, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('HIDR. SCMAL3L4Q314', 'BURGUER KING QUIOSQUE', 34, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('Hidr. SCMAQ306_L3', 'Ale Pudim.', 126, 'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid),
  ('Q102 Oficial', 'Doutor Massagio', 147, '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid),
  ('TEMP. SCMAL2ACAC-Temp1', 'Temperatura 1 (frente ao Paraíso Bijoux 201D/E)', 134, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp10', 'Temperatura 10 (L1 - Correios)', 143, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp11', 'Temperatura 11 (frente à Move On 208I)', 144, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp12', 'Temperatura 12 (L3 PE)', 145, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp13', 'Temperatura 13 (frente a Le Biscuit)', 146, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp14', 'Temperatura 14 (L3 Cacau Show)', 147, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp15', 'Temperatura 15 (L1 - MC donalds)', 148, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp16', 'Temperatura 16 (L3 Outback - Claraboia)', 149, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp2', 'Temperatura L2 (frente à Pernambucanas 203K)', 135, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp3', 'Temperatura 3 (L1 Barbarela)', 136, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp4', 'Temperatura 4 (L - Mandic)', 137, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp5', 'Temperatura 5 (frente ao artesanato da terra 213A)', 138, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp6', 'Temperatura 6 (Passarela)', 139, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp7', 'Temperatura 7 (L3 - Leitura)', 140, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp8', 'Temperatura 8 (EXTERNA G7)', 141, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid),
  ('TEMP. SCMAL2ACAC-Temp9', 'Temperatura 9 (L1 - PA Griletto)', 142, 'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid);

SELECT 'Loaded ' || COUNT(*) || ' rows from CSV' AS info FROM _csv_ma_devices;

-- ---------------------------------------------------------------------------
-- STEP 0 — Sanity: confirm customer + centrals exist
-- ---------------------------------------------------------------------------
SELECT 'CUSTOMER' AS entity, id, name FROM customers
WHERE id = '84e0370e-636a-4741-9874-504b5e0b3577'
  AND tenant_id = '11111111-1111-1111-1111-111111111111';

SELECT 'CENTRAL' AS entity, id, name FROM centrals
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  AND id IN (
    '45250d44-bad0-4071-aaa0-8091cfb12691',
    'd3202744-05dd-46d1-af33-495e9a2ecd52',
    'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'
  );

-- ---------------------------------------------------------------------------
-- STEP 1 — DIAGNOSTIC: Status of each CSV row
--   OK            = already in GCDR (central_id + slave_id match)
--   MISSING       = not in GCDR at all
--   NAME_CONFLICT = a device with same name exists but different central/slave
-- ---------------------------------------------------------------------------
SELECT
  c.csv_name,
  c.csv_label,
  c.slave_id,
  c.central_id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM devices d
      WHERE d.tenant_id   = '11111111-1111-1111-1111-111111111111'
        AND d.central_id  = c.central_id
        AND d.slave_id    = c.slave_id
    ) THEN 'OK'
    WHEN EXISTS (
      SELECT 1 FROM devices d
      WHERE d.tenant_id   = '11111111-1111-1111-1111-111111111111'
        AND d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
        AND d.name        = c.csv_name
    ) THEN 'NAME_CONFLICT'
    ELSE 'MISSING'
  END AS status
FROM _csv_ma_devices c
ORDER BY
  CASE
    WHEN EXISTS (SELECT 1 FROM devices d
      WHERE d.tenant_id = '11111111-1111-1111-1111-111111111111'
        AND d.central_id = c.central_id AND d.slave_id = c.slave_id)
    THEN 2
    ELSE 1
  END,
  c.central_id, c.slave_id;

-- Summary
SELECT
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM devices d
    WHERE d.tenant_id = '11111111-1111-1111-1111-111111111111'
      AND d.central_id = c.central_id AND d.slave_id = c.slave_id
  )) AS existing_count,
  COUNT(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM devices d
    WHERE d.tenant_id = '11111111-1111-1111-1111-111111111111'
      AND d.central_id = c.central_id AND d.slave_id = c.slave_id
  )) AS missing_count,
  COUNT(*) AS total_csv
FROM _csv_ma_devices c;

-- ---------------------------------------------------------------------------
-- STEP 2a — Build asset_id map per central
--   Uses existing Mestre Álvaro devices as reference, or first asset fallback
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _central_asset_map AS
SELECT
  central_id,
  COALESCE(
    (
      SELECT d.asset_id FROM devices d
      WHERE d.tenant_id   = '11111111-1111-1111-1111-111111111111'
        AND d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
        AND d.central_id  = c.central_id
      ORDER BY d.created_at
      LIMIT 1
    ),
    (
      SELECT a.id FROM assets a
      WHERE a.tenant_id   = '11111111-1111-1111-1111-111111111111'
        AND a.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
      ORDER BY a.created_at
      LIMIT 1
    )
  ) AS asset_id
FROM (SELECT DISTINCT central_id FROM _csv_ma_devices) c;

SELECT 'Asset map per central:' AS info;
SELECT central_id, asset_id FROM _central_asset_map;

-- ---------------------------------------------------------------------------
-- STEP 2b — INSERT: devices MISSING from GCDR
--   Skips rows with NAME_CONFLICT (must be resolved manually)
-- ---------------------------------------------------------------------------
WITH inserted AS (
  INSERT INTO devices (
    id, tenant_id, asset_id, customer_id,
    name, display_name, label, code,
    type, serial_number,
    slave_id, central_id,
    status, created_at, updated_at, version,
    tags, metadata, attributes, specs
  )
  SELECT
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    m.asset_id,
    '84e0370e-636a-4741-9874-504b5e0b3577'::uuid,
    c.csv_name,
    c.csv_label,
    c.csv_label,
    c.csv_name,
    CASE
      WHEN c.csv_name ILIKE 'TEMP%'                      THEN 'SENSOR'::device_type
      WHEN c.csv_name ILIKE 'HIDR%'                      THEN 'METER'::device_type
      WHEN c.csv_name ILIKE '%ACEL%'
        OR c.csv_name ILIKE '%ELEV%'                     THEN 'CONTROLLER'::device_type
      WHEN c.csv_name ILIKE '%ESRL%'                     THEN 'CONTROLLER'::device_type
      WHEN c.csv_name ILIKE '%MOTR%'                     THEN 'ACTUATOR'::device_type
      ELSE                                                    'METER'::device_type
    END,
    'SN-' || c.central_id::text || '-' || c.slave_id::text,
    c.slave_id,
    c.central_id,
    'ACTIVE',
    NOW(), NOW(), 1,
    '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  FROM _csv_ma_devices c
  JOIN _central_asset_map m USING (central_id)
  WHERE
    -- Not already in GCDR by central+slave (primary key)
    NOT EXISTS (
      SELECT 1 FROM devices d
      WHERE d.tenant_id  = '11111111-1111-1111-1111-111111111111'
        AND d.central_id = c.central_id
        AND d.slave_id   = c.slave_id
    )
    -- No name collision with a different device
    AND NOT EXISTS (
      SELECT 1 FROM devices d
      WHERE d.tenant_id   = '11111111-1111-1111-1111-111111111111'
        AND d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
        AND d.name        = c.csv_name
    )
  RETURNING id, name, slave_id, central_id
)
SELECT 'Inserted ' || COUNT(*) || ' new devices' AS result FROM inserted;

-- ---------------------------------------------------------------------------
-- STEP 2c — UPDATE: sync name/label for devices that already exist
-- ---------------------------------------------------------------------------
WITH updated AS (
  UPDATE devices d
  SET
    name         = c.csv_name,
    display_name = c.csv_label,
    label        = c.csv_label,
    updated_at   = NOW()
  FROM _csv_ma_devices c
  WHERE d.tenant_id   = '11111111-1111-1111-1111-111111111111'
    AND d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
    AND d.central_id  = c.central_id
    AND d.slave_id    = c.slave_id
    AND (
      d.name        IS DISTINCT FROM c.csv_name
      OR d.display_name IS DISTINCT FROM c.csv_label
      OR d.label        IS DISTINCT FROM c.csv_label
    )
  RETURNING d.id, d.name, d.slave_id, d.central_id
)
SELECT 'Updated ' || COUNT(*) || ' existing devices' AS result FROM updated;

-- ---------------------------------------------------------------------------
-- STEP 3 — ENRICHMENT: All CSV rows with gcdrDeviceId + gcdrAssetId
--   Use this result to generate an enriched CSV
-- ---------------------------------------------------------------------------
SELECT
  c.csv_name                                            AS "Name",
  c.csv_label                                           AS "Label",
  c.slave_id::int                                       AS "slaveId",
  c.central_id::text                                    AS "centralId",
  COALESCE(d.id::text, 'NOT_FOUND')                    AS "gcdrDeviceId",
  COALESCE(d.asset_id::text, 'NOT_FOUND')              AS "gcdrAssetId",
  CASE WHEN d.id IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS "syncStatus"
FROM _csv_ma_devices c
LEFT JOIN devices d ON (
  d.tenant_id  = '11111111-1111-1111-1111-111111111111'
  AND d.central_id = c.central_id
  AND d.slave_id   = c.slave_id
)
ORDER BY c.central_id, c.slave_id;

-- Final summary
SELECT
  COUNT(*)                          AS total_csv,
  COUNT(d.id)                       AS synced,
  COUNT(*) - COUNT(d.id)            AS still_missing
FROM _csv_ma_devices c
LEFT JOIN devices d ON (
  d.tenant_id  = '11111111-1111-1111-1111-111111111111'
  AND d.central_id = c.central_id
  AND d.slave_id   = c.slave_id
);
