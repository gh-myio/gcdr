import { MaintenanceTaskService } from '../../../../src/services/qrc/MaintenanceTaskService';
import { IMaintenanceTaskRepository } from '../../../../src/repositories/interfaces/qrc/IMaintenanceTaskRepository';
import { IInstallationAuditRepository } from '../../../../src/repositories/interfaces/qrc/IInstallationAuditRepository';
import { IInstallationRepository } from '../../../../src/repositories/interfaces/qrc/IInstallationRepository';
import { MaintenanceTask } from '../../../../src/domain/entities/qrc/MaintenanceTask';
import { Installation } from '../../../../src/domain/entities/qrc/Installation';
import { NotFoundError } from '../../../../src/shared/errors/AppError';

describe('MaintenanceTaskService', () => {
  const tenantId       = 't-1';
  const installationId = 'inst-1';
  const userId         = 'user-1';
  const taskId         = 'task-1';

  let repo: jest.Mocked<IMaintenanceTaskRepository>;
  let auditRepo: jest.Mocked<IInstallationAuditRepository>;
  let installationRepo: jest.Mocked<IInstallationRepository>;
  let service: MaintenanceTaskService;

  const mockTask: MaintenanceTask = {
    id:              taskId,
    tenantId,
    installationId,
    description:     'Trocar disjuntor',
    status:          'pending',
    createdBy:       userId,
    createdAt:       '2026-04-29T10:00:00Z',
    completedBy:     null,
    completedAt:     null,
    completedNotes:  null,
    reviewedBy:      null,
    reviewedAt:      null,
  };

  const mockInstallation = { id: installationId, tenantId } as Installation;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      getById: jest.fn(),
      listByInstallation: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    auditRepo = {
      append: jest.fn().mockResolvedValue({} as never),
      listByInstallation: jest.fn(),
      listByUser: jest.fn(),
    };
    installationRepo = {
      create: jest.fn(),
      getById: jest.fn().mockResolvedValue(mockInstallation),
      getByDeviceId: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      listByCustomer: jest.fn(),
      countByStatusForCustomer: jest.fn(),
    };
    service = new MaintenanceTaskService(repo, auditRepo, installationRepo);
  });

  describe('create', () => {
    it('creates a task and emits a task_created audit row', async () => {
      repo.create.mockResolvedValue(mockTask);

      const result = await service.create(tenantId, installationId, 'Trocar disjuntor', userId);

      expect(repo.create).toHaveBeenCalledWith(tenantId, installationId, {
        description: 'Trocar disjuntor', createdBy: userId,
      });
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, installationId, expect.objectContaining({
        changeType: 'task_created',
        newValue:   expect.objectContaining({ id: taskId }),
        changedBy:  userId,
      }));
      expect(result).toBe(mockTask);
    });

    it('throws NotFoundError when the installation does not exist', async () => {
      installationRepo.getById.mockResolvedValue(null);
      await expect(service.create(tenantId, installationId, 'x', userId))
        .rejects.toThrow(NotFoundError);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update — status transitions', () => {
    it('emits task_completed audit when status moves pending → resolved', async () => {
      repo.getById.mockResolvedValue(mockTask);
      const resolved: MaintenanceTask = {
        ...mockTask,
        status: 'resolved',
        completedBy: userId,
        completedAt: '2026-04-29T11:00:00Z',
        reviewedBy: userId,
        reviewedAt: '2026-04-29T11:00:00Z',
      };
      repo.update.mockResolvedValue(resolved);

      await service.update(tenantId, taskId, { status: 'resolved' }, userId);

      // The repo patch should set completedBy AND reviewedBy when transitioning to resolved
      expect(repo.update).toHaveBeenCalledWith(tenantId, taskId, expect.objectContaining({
        status: 'resolved',
        completedBy: userId,
        reviewedBy:  userId,
      }));
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, installationId, expect.objectContaining({
        changeType:        'task_completed',
        oldValue:          { status: 'pending' },
        newValue:          { status: 'resolved' },
      }));
    });

    it('emits task_completed audit when status moves to pending_review', async () => {
      repo.getById.mockResolvedValue(mockTask);
      repo.update.mockResolvedValue({ ...mockTask, status: 'pending_review' });

      await service.update(tenantId, taskId, { status: 'pending_review' }, userId);

      expect(repo.update).toHaveBeenCalledWith(tenantId, taskId, expect.objectContaining({
        status: 'pending_review',
        completedBy: userId,
      }));
      // Did NOT set reviewedBy — pending_review still requires admin review
      expect(repo.update).toHaveBeenCalledWith(tenantId, taskId, expect.not.objectContaining({
        reviewedBy: expect.anything(),
      }));
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, installationId, expect.objectContaining({
        changeType: 'task_completed',
      }));
    });

    it('does NOT emit audit when description changes but status stays the same', async () => {
      repo.getById.mockResolvedValue(mockTask);
      repo.update.mockResolvedValue({ ...mockTask, description: 'updated text' });

      await service.update(tenantId, taskId, { description: 'updated text' }, userId);

      expect(auditRepo.append).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the task is missing', async () => {
      repo.getById.mockResolvedValue(null);
      await expect(service.update(tenantId, 'missing', { status: 'resolved' }, userId))
        .rejects.toThrow(NotFoundError);
    });
  });
});
