-- =============================================================================
-- audit-tenant-email-collisions.sql
-- RFC-0059 / RFC-0060 (Fase 0, subtask 0.1) — audita colisões de email entre
-- tenants antes da migração para Auth0.
--
-- GCDR garante unicidade de email só por tenant
-- (uniqueIndex('users_tenant_email_unique').on(tenantId, email), schema.ts:254).
-- Auth0 exige email único dentro de uma Database Connection. Este script lista
-- todo email (normalizado em minúsculas) que existe em mais de um tenant, para
-- decidir entre RFC-0059 §1 opção (a) uma Connection por tenant vs. opção (b)
-- uma Connection só com email globalmente único.
--
-- Read-only, prod-safe (só SELECT).
--
-- Uso:  npm run db:ops scripts/db/ops/audit-tenant-email-collisions.sql
-- =============================================================================

SELECT
  LOWER(email)                              AS email_normalized,
  COUNT(DISTINCT tenant_id)                 AS tenant_count,
  array_agg(DISTINCT tenant_id)             AS tenant_ids,
  array_agg(id ORDER BY created_at)         AS user_ids,
  array_agg(status ORDER BY created_at)     AS statuses,
  array_agg(type ORDER BY created_at)       AS types,
  array_agg(created_at ORDER BY created_at) AS created_ats
FROM users
GROUP BY LOWER(email)
HAVING COUNT(DISTINCT tenant_id) > 1
ORDER BY tenant_count DESC, email_normalized;
