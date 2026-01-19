import { CustomerService } from '../../../src/services/CustomerService';
import { ICustomerRepository, CustomerTreeNode } from '../../../src/repositories/interfaces/ICustomerRepository';
import { Customer } from '../../../src/domain/entities/Customer';
import { CreateCustomerDTO, UpdateCustomerDTO, ListCustomersParams } from '../../../src/dto/request/CustomerDTO';
import { PaginatedResult } from '../../../src/shared/types';
import { AppError } from '../../../src/shared/errors/AppError';

// Helper to check error type by code
const expectErrorWithCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toThrow();
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
};

// Mock EventService
jest.mock('../../../src/infrastructure/events/EventService', () => ({
  eventService: {
    publish: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('CustomerService', () => {
  let service: CustomerService;
  let mockRepository: jest.Mocked<ICustomerRepository>;

  const tenantId = 'tenant-test';
  const userId = 'user-test';

  const mockCustomer: Customer = {
    id: 'cust-001',
    tenantId,
    parentCustomerId: null,
    path: `/${tenantId}/cust-001`,
    depth: 0,
    name: 'Test Customer',
    displayName: 'Test Customer',
    code: 'TEST-001',
    type: 'COMPANY',
    email: 'test@example.com',
    settings: {
      timezone: 'America/Sao_Paulo',
      locale: 'pt-BR',
      currency: 'BRL',
      inheritFromParent: false,
    },
    metadata: {},
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: userId,
  };

  beforeEach(() => {
    mockRepository = {
      create: jest.fn(),
      getById: jest.fn(),
      getByCode: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
      listWithFilters: jest.fn(),
      getChildren: jest.fn(),
      getDescendants: jest.fn(),
      getAncestors: jest.fn(),
      getTree: jest.fn(),
      move: jest.fn(),
      updatePath: jest.fn(),
    };

    service = new CustomerService(mockRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createDto: CreateCustomerDTO = {
      name: 'New Customer',
      type: 'COMPANY',
    };

    it('should create a customer successfully', async () => {
      mockRepository.getByCode.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue(mockCustomer);

      const result = await service.create(tenantId, createDto, userId);

      expect(result).toEqual(mockCustomer);
      expect(mockRepository.create).toHaveBeenCalledWith(tenantId, createDto, userId);
    });

    it('should throw ConflictError if code already exists', async () => {
      const dtoWithCode: CreateCustomerDTO = { ...createDto, code: 'EXISTING-CODE' };
      mockRepository.getByCode.mockResolvedValue(mockCustomer);

      await expect(service.create(tenantId, dtoWithCode, userId)).rejects.toMatchObject({
        code: 'CONFLICT',
        statusCode: 409,
      });
    });
  });

  describe('getById', () => {
    it('should return customer when found', async () => {
      mockRepository.getById.mockResolvedValue(mockCustomer);

      const result = await service.getById(tenantId, 'cust-001');

      expect(result).toEqual(mockCustomer);
      expect(mockRepository.getById).toHaveBeenCalledWith(tenantId, 'cust-001');
    });

    it('should throw NotFoundError when customer not found', async () => {
      mockRepository.getById.mockResolvedValue(null);

      await expect(service.getById(tenantId, 'non-existent')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      });
    });
  });

  describe('update', () => {
    const updateDto: UpdateCustomerDTO = {
      name: 'Updated Customer',
    };

    it('should update customer successfully', async () => {
      const updatedCustomer = { ...mockCustomer, name: 'Updated Customer' };
      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.update.mockResolvedValue(updatedCustomer);

      const result = await service.update(tenantId, 'cust-001', updateDto, userId);

      expect(result.name).toBe('Updated Customer');
      expect(mockRepository.update).toHaveBeenCalledWith(tenantId, 'cust-001', updateDto, userId);
    });

    it('should throw NotFoundError when customer not found', async () => {
      mockRepository.getById.mockResolvedValue(null);

      await expect(service.update(tenantId, 'non-existent', updateDto, userId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      });
    });

    it('should throw ConflictError when updating to existing code', async () => {
      const dtoWithCode: UpdateCustomerDTO = { code: 'EXISTING-CODE' };
      const existingCustomer = { ...mockCustomer, id: 'cust-002' };

      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getByCode.mockResolvedValue(existingCustomer);

      await expect(service.update(tenantId, 'cust-001', dtoWithCode, userId)).rejects.toMatchObject({
        code: 'CONFLICT',
        statusCode: 409,
      });
    });
  });

  describe('delete', () => {
    it('should delete customer successfully', async () => {
      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getChildren.mockResolvedValue([]);
      mockRepository.delete.mockResolvedValue(undefined);

      await service.delete(tenantId, 'cust-001', userId);

      expect(mockRepository.delete).toHaveBeenCalledWith(tenantId, 'cust-001');
    });

    it('should throw NotFoundError when customer not found', async () => {
      mockRepository.getById.mockResolvedValue(null);

      await expect(service.delete(tenantId, 'non-existent', userId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      });
    });

    it('should throw ValidationError when customer has children', async () => {
      const childCustomer = { ...mockCustomer, id: 'cust-002', parentCustomerId: 'cust-001' };
      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getChildren.mockResolvedValue([childCustomer]);

      await expect(service.delete(tenantId, 'cust-001', userId)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });
  });

  describe('list', () => {
    it('should return paginated list of customers', async () => {
      const paginatedResult: PaginatedResult<Customer> = {
        items: [mockCustomer],
        pagination: { hasMore: false },
      };
      mockRepository.listWithFilters.mockResolvedValue(paginatedResult);

      const params: ListCustomersParams = { limit: 10 };
      const result = await service.list(tenantId, params);

      expect(result.items).toHaveLength(1);
      expect(mockRepository.listWithFilters).toHaveBeenCalledWith(tenantId, params);
    });
  });

  describe('getChildren', () => {
    it('should return children of a customer', async () => {
      const childCustomer = { ...mockCustomer, id: 'cust-002', parentCustomerId: 'cust-001' };
      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getChildren.mockResolvedValue([childCustomer]);

      const result = await service.getChildren(tenantId, 'cust-001');

      expect(result).toHaveLength(1);
      expect(result[0].parentCustomerId).toBe('cust-001');
    });
  });

  describe('getDescendants', () => {
    it('should return descendants of a customer', async () => {
      const child = { ...mockCustomer, id: 'cust-002', parentCustomerId: 'cust-001', depth: 1 };
      const grandchild = { ...mockCustomer, id: 'cust-003', parentCustomerId: 'cust-002', depth: 2 };

      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getDescendants.mockResolvedValue([child, grandchild]);

      const result = await service.getDescendants(tenantId, 'cust-001');

      expect(result).toHaveLength(2);
    });

    it('should respect maxDepth parameter', async () => {
      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getDescendants.mockResolvedValue([]);

      await service.getDescendants(tenantId, 'cust-001', { maxDepth: 1 });

      expect(mockRepository.getDescendants).toHaveBeenCalledWith(tenantId, 'cust-001', 1);
    });
  });

  describe('move', () => {
    const childCustomer: Customer = {
      ...mockCustomer,
      id: 'cust-002',
      parentCustomerId: 'cust-001',
      path: `/${tenantId}/cust-001/cust-002`,
      depth: 1,
    };

    it('should move customer to new parent', async () => {
      const newParent = { ...mockCustomer, id: 'cust-003' };
      const movedCustomer = { ...childCustomer, parentCustomerId: 'cust-003' };

      mockRepository.getById
        .mockResolvedValueOnce(childCustomer) // getById for child
        .mockResolvedValueOnce(newParent); // getById for new parent
      mockRepository.getDescendants.mockResolvedValue([]);
      mockRepository.move.mockResolvedValue(movedCustomer);

      const result = await service.move(
        tenantId,
        'cust-002',
        { newParentCustomerId: 'cust-003' },
        userId
      );

      expect(result.parentCustomerId).toBe('cust-003');
    });

    it('should throw ValidationError when moving to self', async () => {
      mockRepository.getById.mockResolvedValue(mockCustomer);

      await expect(
        service.move(tenantId, 'cust-001', { newParentCustomerId: 'cust-001' }, userId)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    it('should throw ValidationError when moving to descendant', async () => {
      const descendant = { ...mockCustomer, id: 'cust-002', parentCustomerId: 'cust-001' };

      mockRepository.getById
        .mockResolvedValueOnce(mockCustomer)
        .mockResolvedValueOnce(descendant);
      mockRepository.getDescendants.mockResolvedValue([descendant]);

      await expect(
        service.move(tenantId, 'cust-001', { newParentCustomerId: 'cust-002' }, userId)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });
  });

  describe('getTree', () => {
    it('should return customer tree', async () => {
      const tree: CustomerTreeNode[] = [
        {
          ...mockCustomer,
          children: [
            {
              ...mockCustomer,
              id: 'cust-002',
              parentCustomerId: 'cust-001',
              children: [],
            },
          ],
        },
      ];

      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getTree.mockResolvedValue(tree);

      const result = await service.getTree(tenantId, 'cust-001');

      expect(result).toHaveLength(1);
      expect(result[0].children).toHaveLength(1);
    });
  });
});
