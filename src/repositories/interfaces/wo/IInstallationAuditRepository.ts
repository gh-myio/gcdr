import { InstallationAudit, InstallationChangeType } from '../../../domain/entities/wo/InstallationAudit';

export interface IInstallationAuditRepository {
  /**
   * Append a new audit row. Revision is auto-assigned monotonically per
   * installationId — caller does not pass it.
   */
  append(
    tenantId: string,
    installationId: string,
    data: {
      changeType:        InstallationChangeType;
      changeDescription: string | null;
      oldValue:          Record<string, unknown> | null;
      newValue:          Record<string, unknown> | null;
      changedBy:         string;
    },
  ): Promise<InstallationAudit>;

  listByInstallation(tenantId: string, installationId: string): Promise<InstallationAudit[]>;

  /** Audit entries authored by a given user — drives /admin/users/:id/history. */
  listByUser(
    tenantId: string,
    userId: string,
    params?: { limit?: number; offset?: number },
  ): Promise<{ items: InstallationAudit[]; total: number }>;
}
