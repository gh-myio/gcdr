// =============================================================================
// RFC-0009: Audit Infrastructure Setup
// =============================================================================

import { setAuditLogWriter } from '../../middleware/audit';
import { auditLogRepository } from '../../repositories/AuditLogRepository';
import { CreateAuditLogInput } from '../../shared/types/audit.types';

/**
 * Initialize audit logging infrastructure
 * Connects the middleware to the repository
 */
export function initializeAuditLogging(): void {
  // Set the audit log writer to use the repository
  setAuditLogWriter(async (log: CreateAuditLogInput) => {
    await auditLogRepository.create(log);
  });

  console.log('[AUDIT] Audit logging initialized');
}
