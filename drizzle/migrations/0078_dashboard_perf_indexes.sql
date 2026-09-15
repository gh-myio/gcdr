-- Dashboard performance (GET /api/v1/dashboard) — supporting indexes.
--
-- The dashboard summary aggregates audit_logs over four nested time windows
-- (24h/72h/week/month), grouped by event_category and by action, plus a device
-- connectivity roll-up. The query layer was rewritten to a single month-window
-- scan per metric (see AuditLogRepository.getDashboardAuditSummary); these
-- composite indexes let those grouped scans stay on the index and skip most heap
-- fetches.
--
-- NOTE: these are plain (non-concurrent) CREATE INDEX statements because the
-- migration runner wraps every migration in a transaction (CREATE INDEX
-- CONCURRENTLY cannot run inside one). On a very large prod audit_logs table the
-- build briefly locks writes; if that is a concern, a DBA may instead create the
-- same indexes CONCURRENTLY out-of-band and then baseline this migration.

-- Covering the audit GROUP BY event_category over a created_at range.
CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_category_idx
  ON audit_logs (tenant_id, created_at, event_category);

-- Covering the audit GROUP BY action over a created_at range.
CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_action_idx
  ON audit_logs (tenant_id, created_at, action);

-- Device connectivity roll-up: filter tenant_id + deleted_at IS NULL, group by
-- connectivity_status. Partial index keeps it small (excludes soft-deleted rows).
CREATE INDEX IF NOT EXISTS devices_tenant_connectivity_active_idx
  ON devices (tenant_id, connectivity_status)
  WHERE deleted_at IS NULL;
