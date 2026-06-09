// RFC-0032 — Immutable installation revision log.

export type InstallationChangeType =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'image_added'
  | 'image_removed'
  | 'task_created'
  | 'task_completed';

export interface InstallationAudit {
  id: string;
  tenantId: string;
  installationId: string;
  /** Monotonic per-installation revision number (1, 2, 3, …). */
  revision: number;
  changeType: InstallationChangeType;
  changeDescription: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  changedBy: string;
  changedAt: string;
}
