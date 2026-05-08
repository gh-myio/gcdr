import { CustomerService } from '../../../src/services/CustomerService';
import { ICustomerRepository, CustomerTreeNode } from '../../../src/repositories/interfaces/ICustomerRepository';
import { IAssetRepository } from '../../../src/repositories/interfaces/IAssetRepository';
import { IDeviceRepository } from '../../../src/repositories/interfaces/IDeviceRepository';
import { IRuleRepository } from '../../../src/repositories/interfaces/IRuleRepository';
import { ICentralRepository } from '../../../src/repositories/interfaces/ICentralRepository';
import { Customer } from '../../../src/domain/entities/Customer';
import { Asset } from '../../../src/domain/entities/Asset';
import { Device } from '../../../src/domain/entities/Device';
import { Central } from '../../../src/domain/entities/Central';
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

// CustomerService.delete() calls userService.clearDefaultCustomerForAll
// (RFC: customer-default-customer cleanup). Stub it so this unit test
// doesn't hit the real DB.
jest.mock('../../../src/services/UserService', () => ({
  userService: {
    clearDefaultCustomerForAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// alarmBundleService.invalidateCache is fire-and-forget and tries to
// read the live tenant cache; stub it for deterministic unit tests.
jest.mock('../../../src/services/AlarmBundleService', () => ({
  alarmBundleService: {
    invalidateCache: jest.fn(),
  },
}));

describe('CustomerService', () => {
  let service: CustomerService;
  let mockRepository: jest.Mocked<ICustomerRepository>;
  let mockAssetRepository: jest.Mocked<IAssetRepository>;
  let mockDeviceRepository: jest.Mocked<IDeviceRepository>;
  let mockRuleRepository: jest.Mocked<IRuleRepository>;
  let mockCentralRepository: jest.Mocked<ICentralRepository>;

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
      getByExternalId: jest.fn(),
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
      forceDelete: jest.fn(),
      listQrcEnabledForUser: jest.fn(),
    };

    // getEnrichedTree consumes listByCustomer on these three repos. Other
    // methods aren't exercised by this suite — partial mock cast to satisfy TS.
    mockAssetRepository = {
      listByCustomer: jest.fn(),
    } as unknown as jest.Mocked<IAssetRepository>;
    mockDeviceRepository = {
      listByCustomer: jest.fn(),
    } as unknown as jest.Mocked<IDeviceRepository>;
    mockCentralRepository = {
      listByCustomer: jest.fn(),
    } as unknown as jest.Mocked<ICentralRepository>;
    mockRuleRepository = {} as unknown as jest.Mocked<IRuleRepository>;

    service = new CustomerService(
      mockRepository,
      mockAssetRepository,
      mockDeviceRepository,
      mockRuleRepository,
      mockCentralRepository,
    );
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

  describe('getEnrichedTree', () => {
    const childCustomer: Customer = {
      ...mockCustomer,
      id: 'cust-002',
      parentCustomerId: 'cust-001',
      path: `/${tenantId}/cust-001/cust-002`,
      depth: 1,
    };

    const asset = { id: 'asset-1', customerId: 'cust-001', name: 'Site A' } as unknown as Asset;
    const device = { id: 'dev-1', customerId: 'cust-001', assetId: 'asset-1', name: 'Meter 1' } as unknown as Device;
    const central = { id: 'central-1', customerId: 'cust-001', assetId: 'asset-1', name: 'GW-1' } as unknown as Central;

    const emptyAssets: PaginatedResult<Asset> = { items: [], pagination: { hasMore: false } };
    const emptyDevices: PaginatedResult<Device> = { items: [], pagination: { hasMore: false } };

    it('should enrich a leaf customer with its assets, centrals and devices', async () => {
      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getChildren.mockResolvedValue([]);
      mockAssetRepository.listByCustomer.mockResolvedValue({ items: [asset], pagination: { hasMore: false } });
      mockCentralRepository.listByCustomer.mockResolvedValue([central]);
      mockDeviceRepository.listByCustomer.mockResolvedValue({ items: [device], pagination: { hasMore: false } });

      const result = await service.getEnrichedTree(tenantId, 'cust-001');

      expect(result.customer.id).toBe('cust-001');
      expect(result.assets).toEqual([asset]);
      expect(result.centrals).toEqual([central]);
      expect(result.devices).toEqual([device]);
      expect(result.children).toBeUndefined();
      expect(mockAssetRepository.listByCustomer).toHaveBeenCalledWith(tenantId, 'cust-001', { limit: 1000 });
      expect(mockCentralRepository.listByCustomer).toHaveBeenCalledWith(tenantId, 'cust-001');
      expect(mockDeviceRepository.listByCustomer).toHaveBeenCalledWith(tenantId, 'cust-001', { limit: 1000 });
    });

    it('should recursively enrich descendants', async () => {
      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getChildren
        .mockResolvedValueOnce([childCustomer]) // children of cust-001
        .mockResolvedValueOnce([]);             // children of cust-002
      mockAssetRepository.listByCustomer.mockResolvedValue(emptyAssets);
      mockCentralRepository.listByCustomer.mockResolvedValue([]);
      mockDeviceRepository.listByCustomer.mockResolvedValue(emptyDevices);

      const result = await service.getEnrichedTree(tenantId, 'cust-001');

      expect(result.customer.id).toBe('cust-001');
      expect(result.children).toHaveLength(1);
      expect(result.children![0].customer.id).toBe('cust-002');
      expect(result.children![0].children).toBeUndefined();
      // Each customer (root + child) triggers one fetch per repo.
      expect(mockAssetRepository.listByCustomer).toHaveBeenCalledTimes(2);
      expect(mockCentralRepository.listByCustomer).toHaveBeenCalledTimes(2);
      expect(mockDeviceRepository.listByCustomer).toHaveBeenCalledTimes(2);
      expect(mockRepository.getChildren).toHaveBeenCalledWith(tenantId, 'cust-001');
      expect(mockRepository.getChildren).toHaveBeenCalledWith(tenantId, 'cust-002');
    });

    it('should throw NotFoundError when root customer does not exist', async () => {
      mockRepository.getById.mockResolvedValue(null);

      await expect(service.getEnrichedTree(tenantId, 'missing')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      });
      expect(mockAssetRepository.listByCustomer).not.toHaveBeenCalled();
      expect(mockCentralRepository.listByCustomer).not.toHaveBeenCalled();
      expect(mockDeviceRepository.listByCustomer).not.toHaveBeenCalled();
    });

    it('should return empty arrays when customer has no assets/centrals/devices', async () => {
      mockRepository.getById.mockResolvedValue(mockCustomer);
      mockRepository.getChildren.mockResolvedValue([]);
      mockAssetRepository.listByCustomer.mockResolvedValue(emptyAssets);
      mockCentralRepository.listByCustomer.mockResolvedValue([]);
      mockDeviceRepository.listByCustomer.mockResolvedValue(emptyDevices);

      const result = await service.getEnrichedTree(tenantId, 'cust-001');

      expect(result.assets).toEqual([]);
      expect(result.centrals).toEqual([]);
      expect(result.devices).toEqual([]);
      expect(result.children).toBeUndefined();
    });
  });
});
