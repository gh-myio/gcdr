import { MaintenanceTask, MaintenanceTaskStatus } from '../../domain/entities/wo/MaintenanceTask';
import { IMaintenanceTaskRepository } from '../../repositories/interfaces/wo/IMaintenanceTaskRepository';
import { IInstallationAuditRepository } from '../../repositories/interfaces/wo/IInstallationAuditRepository';
import { IInstallationRepository } from '../../repositories/interfaces/wo/IInstallationRepository';
import { maintenanceTaskRepository } from '../../repositories/wo/MaintenanceTaskRepository';
import { installationAuditRepository } from '../../repositories/wo/InstallationAuditRepository';
import { installationRepository } from '../../repositories/wo/InstallationRepository';
import { NotFoundError } from '../../shared/errors/AppError';

export class MaintenanceTaskService {
  constructor(
    private readonly repo: IMaintenanceTaskRepository = maintenanceTaskRepository,
    private readonly auditRepo: IInstallationAuditRepository = installationAuditRepository,
    private readonly installationRepo: IInstallationRepository = installationRepository,
  ) {}

  async create(
    tenantId: string,
    installationId: string,
    description: string,
    createdBy: string,
  ): Promise<MaintenanceTask> {
    const inst = await this.installationRepo.getById(tenantId, installationId);
    if (!inst) throw new NotFoundError(`Installation ${installationId} not found`);

    const task = await this.repo.create(tenantId, installationId, { description, createdBy });
    await this.auditRepo.append(tenantId, installationId, {
      changeType:        'task_created',
      changeDescription: `Task created: ${description.slice(0, 80)}`,
      oldValue:          null,
      newValue:          { id: task.id, description: task.description, status: task.status },
      changedBy:         createdBy,
    });
    return task;
  }

  async list(tenantId: string, installationId: string): Promise<MaintenanceTask[]> {
    return this.repo.listByInstallation(tenantId, installationId);
  }

  async update(
    tenantId: string,
    id: string,
    patch: {
      description?:    string;
      status?:         MaintenanceTaskStatus;
      completedNotes?: string | null;
    },
    updatedBy: string,
  ): Promise<MaintenanceTask> {
    const before = await this.repo.getById(tenantId, id);
    if (!before) throw new NotFoundError(`Task ${id} not found`);

    // Audit emission piggy-backs on installation audit so the technician
    // history view sees task activity without extra plumbing.
    const repoPatch: Parameters<IMaintenanceTaskRepository['update']>[2] = {
      description:    patch.description,
      status:         patch.status,
      completedNotes: patch.completedNotes,
    };
    if (patch.status === 'pending_review' || patch.status === 'resolved') {
      repoPatch.completedBy = updatedBy;
    }
    if (patch.status === 'resolved') {
      repoPatch.reviewedBy = updatedBy;
    }

    const updated = await this.repo.update(tenantId, id, repoPatch);

    if (patch.status && patch.status !== before.status) {
      const isCompletion = patch.status === 'pending_review' || patch.status === 'resolved';
      await this.auditRepo.append(tenantId, before.installationId, {
        changeType:        isCompletion ? 'task_completed' : 'updated',
        changeDescription: `Task ${id} → ${patch.status}`,
        oldValue:          { status: before.status },
        newValue:          { status: patch.status },
        changedBy:         updatedBy,
      });
    }

    return updated;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    return this.repo.delete(tenantId, id);
  }
}

export const maintenanceTaskService = new MaintenanceTaskService();
