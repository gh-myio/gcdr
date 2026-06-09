import { MaintenanceTask, MaintenanceTaskStatus } from '../../../domain/entities/wo/MaintenanceTask';

export interface IMaintenanceTaskRepository {
  create(
    tenantId: string,
    installationId: string,
    data: { description: string; createdBy: string },
  ): Promise<MaintenanceTask>;

  getById(tenantId: string, id: string): Promise<MaintenanceTask | null>;

  listByInstallation(tenantId: string, installationId: string): Promise<MaintenanceTask[]>;

  update(
    tenantId: string,
    id: string,
    patch: {
      description?:    string;
      status?:         MaintenanceTaskStatus;
      completedNotes?: string | null;
      completedBy?:    string;
      reviewedBy?:     string;
    },
  ): Promise<MaintenanceTask>;

  delete(tenantId: string, id: string): Promise<void>;
}
