-- =============================================================================
-- OPS: registrar migrations 0070–0075 no ledger `schema_migrations` (prod)
-- =============================================================================
-- Uso: depois de rodar as migrations NA MÃO (DB Admin/psql), o runner custom
-- (`npm run db:mig:status` / `db:mig:up`) não sabe que elas foram aplicadas.
-- Este script insere os registros com o sha256 do CONTEÚDO ATUAL de cada
-- arquivo (checksums calculados dos blobs do git em 2026-09-08 — commit da
-- branch feat/rfc-0062-rules-monitor-shadow / PR #59).
--
-- Idempotente: ON CONFLICT atualiza só o checksum (mantém applied_at original)
-- — cobre o caso do 0070, que já constava no ledger com checksum antigo
-- ("CHANGED"): como a re-execução usou o arquivo atual, o checksum atual é o
-- registro fiel.
-- Rodar no DB Admin (allow write) ou psql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    text        PRIMARY KEY,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text
);

INSERT INTO schema_migrations (filename, checksum, applied_by) VALUES
 ('0070_orchestrator_devices.sql',                '8d06ae82204da8631900bca5de1be5c0d321e99e35fab9522d821665989ae3ca', 'manual-db-admin'),
 ('0071_central_last_gateway_success.sql',        '947dade2ee6f138ab2ab0f29433eb993f77f2b1a88434643a54c433986c425d1', 'manual-db-admin'),
 ('0072_orchestrator_devices_status_history.sql', '32ffc690119f842b3f030e9666621fad9e053e52c19861d3b60f61d83c357464', 'manual-db-admin'),
 ('0073_orchestrator_rule_mutes.sql',             'e9f706f930bd83d4165264d7b6aa690281a86de635f87f4867ff2faccb40dc83', 'manual-db-admin'),
 ('0074_customer_ingestion_customer_id.sql',      '62d59274b47b4af997b6e3258777885034be5fb50836cacf803aec2f95fb6187', 'manual-db-admin'),
 ('0075_centrals_hardware_id.sql',                '892543db78a4c935c0b8da84e3ed466847807c7843497aafa32b7d9fc076d3f9', 'manual-db-admin')
ON CONFLICT (filename) DO UPDATE
  SET checksum = EXCLUDED.checksum,
      applied_by = COALESCE(schema_migrations.applied_by, EXCLUDED.applied_by);

-- ── Conferência ──────────────────────────────────────────────────────────────
SELECT filename, left(checksum, 12) AS checksum12, applied_at, applied_by
FROM schema_migrations
WHERE filename >= '0070'
ORDER BY filename;
