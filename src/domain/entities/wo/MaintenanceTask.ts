// RFC-0032 — Maintenance task tied to an installation.

export type MaintenanceTaskStatus =
  | 'pending'
  | 'pending_review'
  | 'resolved'
  | 'removido';

export interface MaintenanceTask {
  id: string;
  tenantId: string;
  installationId: string;
  description: string;
  status: MaintenanceTaskStatus;
  createdBy: string;
  createdAt: string;
  completedBy: string | null;
  completedAt: string | null;
  completedNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}
