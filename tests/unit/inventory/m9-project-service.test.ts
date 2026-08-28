// RFC-0061 M9 — InventoryProjectService unit tests (repos mocked).
import { InventoryProjectService } from '../../../src/services/inventory/InventoryProjectService';
import { IInventoryProjectRepository } from '../../../src/repositories/inventory/InventoryProjectRepository';
import { ICustomerRepository } from '../../../src/repositories/interfaces/ICustomerRepository';
import { InvProjectResponse } from '../../../src/dto/response/InventoryResponseDTO';
import { Customer } from '../../../src/domain/entities/Customer';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../src/shared/errors/AppError';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';

const project: InvProjectResponse = {
  id: PROJECT_ID,
  name: 'Projeto Moxuara',
  description: null,
  customerId: null,
  legacyClientName: null,
  legacyClientCnpj: null,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

/** A Drizzle-style wrapped Postgres error: SQLSTATE lives on `.cause`, not `.code`. */
function drizzleFkError(): Error {
  const err = new Error('Failed query: delete from "inv_projects" where ...');
  (err as Error & { cause: unknown }).cause = {
    code: '23503',
    message:
      'update or delete on table "inv_projects" violates foreign key constraint ' +
      '"inv_purchase_orders_project_id_inv_projects_id_fk" on table "inv_purchase_orders"',
  };
  return err;
}

describe('InventoryProjectService', () => {
  let projectRepo: jest.Mocked<IInventoryProjectRepository>;
  let customerRepo: jest.Mocked<ICustomerRepository>;
  let service: InventoryProjectService;

  beforeEach(() => {
    projectRepo = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<IInventoryProjectRepository>;
    customerRepo = { getById: jest.fn() } as unknown as jest.Mocked<ICustomerRepository>;
    service = new InventoryProjectService(projectRepo, customerRepo);
  });

  describe('listProjects', () => {
    it('returns the paginated envelope with total/totalPages', async () => {
      projectRepo.list.mockResolvedValue({ items: [project], total: 41 });

      const result = await service.listProjects(TENANT, { page: 2, pageSize: 20 });

      expect(projectRepo.list).toHaveBeenCalledWith(TENANT, { page: 2, pageSize: 20 });
      expect(result).toEqual({
        items: [project],
        page: 2,
        pageSize: 20,
        total: 41,
        totalPages: 3,
      });
    });

    it('reports totalPages 0 for an empty tenant', async () => {
      projectRepo.list.mockResolvedValue({ items: [], total: 0 });

      const result = await service.listProjects(TENANT, { page: 1, pageSize: 20 });

      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });

  describe('createProject', () => {
    it('creates without touching the customer repo when customerId is absent', async () => {
      projectRepo.create.mockResolvedValue(project);

      const result = await service.createProject(TENANT, { name: 'Projeto Moxuara' }, 'user-1');

      expect(customerRepo.getById).not.toHaveBeenCalled();
      expect(projectRepo.create).toHaveBeenCalledWith(TENANT, { name: 'Projeto Moxuara' }, 'user-1');
      expect(result).toEqual(project);
    });

    it('validates the customer exists in the tenant when customerId is provided', async () => {
      customerRepo.getById.mockResolvedValue({ id: CUSTOMER_ID } as unknown as Customer);
      projectRepo.create.mockResolvedValue({ ...project, customerId: CUSTOMER_ID });

      await service.createProject(TENANT, { name: 'P', customerId: CUSTOMER_ID }, 'user-1');

      expect(customerRepo.getById).toHaveBeenCalledWith(TENANT, CUSTOMER_ID);
      expect(projectRepo.create).toHaveBeenCalled();
    });

    it('rejects with 400 when the referenced customer does not exist', async () => {
      customerRepo.getById.mockResolvedValue(null);

      await expect(
        service.createProject(TENANT, { name: 'P', customerId: CUSTOMER_ID }, 'user-1'),
      ).rejects.toThrow(ValidationError);
      expect(projectRepo.create).not.toHaveBeenCalled();
    });

    it('accepts an explicit customerId: null without a customer lookup', async () => {
      projectRepo.create.mockResolvedValue(project);

      await service.createProject(TENANT, { name: 'P', customerId: null }, 'user-1');

      expect(customerRepo.getById).not.toHaveBeenCalled();
    });
  });

  describe('updateProject', () => {
    it('updates and returns the row', async () => {
      projectRepo.update.mockResolvedValue({ ...project, name: 'Novo nome' });

      const result = await service.updateProject(TENANT, PROJECT_ID, { name: 'Novo nome' }, 'user-1');

      expect(projectRepo.update).toHaveBeenCalledWith(TENANT, PROJECT_ID, { name: 'Novo nome' }, 'user-1');
      expect(result.name).toBe('Novo nome');
    });

    it('throws NotFoundError when the project does not exist', async () => {
      projectRepo.update.mockResolvedValue(null);

      await expect(
        service.updateProject(TENANT, PROJECT_ID, { name: 'X' }, 'user-1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('validates a newly linked customer on update', async () => {
      customerRepo.getById.mockResolvedValue(null);

      await expect(
        service.updateProject(TENANT, PROJECT_ID, { customerId: CUSTOMER_ID }, 'user-1'),
      ).rejects.toThrow(ValidationError);
      expect(projectRepo.update).not.toHaveBeenCalled();
    });

    it('allows unlinking the customer (customerId: null) without a lookup', async () => {
      projectRepo.update.mockResolvedValue({ ...project, customerId: null });

      await service.updateProject(TENANT, PROJECT_ID, { customerId: null }, 'user-1');

      expect(customerRepo.getById).not.toHaveBeenCalled();
    });
  });

  describe('deleteProject', () => {
    it('deletes an existing project', async () => {
      projectRepo.delete.mockResolvedValue(true);

      await expect(service.deleteProject(TENANT, PROJECT_ID)).resolves.toBeUndefined();
      expect(projectRepo.delete).toHaveBeenCalledWith(TENANT, PROJECT_ID);
    });

    it('throws NotFoundError when nothing was deleted', async () => {
      projectRepo.delete.mockResolvedValue(false);

      await expect(service.deleteProject(TENANT, PROJECT_ID)).rejects.toThrow(NotFoundError);
    });

    it('maps a Drizzle-wrapped FK 23503 (code on err.cause) to a friendly 409', async () => {
      projectRepo.delete.mockRejectedValue(drizzleFkError());

      const err: unknown = await service.deleteProject(TENANT, PROJECT_ID).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).statusCode).toBe(409);
      expect((err as ConflictError).message).toContain('pedidos');
    });

    it('maps a bare postgres 23503 (code top-level) to 409 as well', async () => {
      const bare = Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
      projectRepo.delete.mockRejectedValue(bare);

      await expect(service.deleteProject(TENANT, PROJECT_ID)).rejects.toThrow(ConflictError);
    });

    it('re-throws unrelated repo errors unchanged', async () => {
      projectRepo.delete.mockRejectedValue(new Error('connection refused'));

      await expect(service.deleteProject(TENANT, PROJECT_ID)).rejects.toThrow('connection refused');
    });
  });
});
