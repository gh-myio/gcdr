import { WoCustomerSettingsService } from '../../../../src/services/wo/WoCustomerSettingsService';
import { IWoCustomerSettingsRepository } from '../../../../src/repositories/interfaces/wo/IWoCustomerSettingsRepository';
import { ICustomerRepository } from '../../../../src/repositories/interfaces/ICustomerRepository';
import { WoCustomerSettings } from '../../../../src/domain/entities/wo/CustomerSettings';
import { Customer } from '../../../../src/domain/entities/Customer';
import { NotFoundError } from '../../../../src/shared/errors/AppError';

describe('WoCustomerSettingsService', () => {
  const tenantId   = 't-1';
  const customerId = 'c-1';
  const userId     = 'user-1';

  let settingsRepo: jest.Mocked<IWoCustomerSettingsRepository>;
  let customerRepo: jest.Mocked<ICustomerRepository>;
  let service: WoCustomerSettingsService;

  const mockCustomer = { id: customerId, tenantId } as unknown as Customer;
  const mockSettings: WoCustomerSettings = {
    customerId,
    tenantId,
    viewerPasswordHash: null,
    defaultCentralId:   null,
    woMetadata:        {},
    createdBy:          userId,
    createdAt:          '2026-04-29T10:00:00Z',
    updatedAt:          '2026-04-29T10:00:00Z',
  };

  beforeEach(() => {
    settingsRepo = {
      enable: jest.fn(),
      getByCustomerId: jest.fn(),
      update: jest.fn(),
      disable: jest.fn(),
      listEnabled: jest.fn(),
    };
    customerRepo = {
      create: jest.fn(),
      getById: jest.fn().mockResolvedValue(mockCustomer),
      getByCode: jest.fn(),
      getByExternalId: jest.fn(),
      getChildren: jest.fn(),
      getDescendants: jest.fn(),
      getAncestors: jest.fn(),
      getTree: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
      listWithFilters: jest.fn(),
      move: jest.fn(),
      updatePath: jest.fn(),
      forceDelete: jest.fn(),
      listWoEnabledForUser: jest.fn(),
    };
    service = new WoCustomerSettingsService(settingsRepo, customerRepo);
  });

  describe('enable', () => {
    it('hashes the viewer password (bcrypt) and calls the repo', async () => {
      settingsRepo.enable.mockResolvedValue(mockSettings);

      await service.enable(tenantId, customerId, {
        viewerPassword: 'shopper-2026',
        defaultCentralId: 'central-1',
        woMetadata: { foo: 'bar' },
      }, userId);

      expect(settingsRepo.enable).toHaveBeenCalledWith(
        tenantId, customerId,
        expect.objectContaining({
          // bcrypt hash starts with $2 (a/b/y) and is at least 60 chars
          viewerPasswordHash: expect.stringMatching(/^\$2[aby]\$.{56,}$/),
          defaultCentralId:   'central-1',
          woMetadata:        { foo: 'bar' },
        }),
        userId,
      );
    });

    it('passes null viewerPasswordHash when no password is given', async () => {
      settingsRepo.enable.mockResolvedValue(mockSettings);
      await service.enable(tenantId, customerId, {}, userId);
      expect(settingsRepo.enable).toHaveBeenCalledWith(
        tenantId, customerId,
        expect.objectContaining({ viewerPasswordHash: null, defaultCentralId: null, woMetadata: {} }),
        userId,
      );
    });

    it('throws NotFoundError when the customer does not exist', async () => {
      customerRepo.getById.mockResolvedValue(null);
      await expect(service.enable(tenantId, 'missing', {}, userId)).rejects.toThrow(NotFoundError);
      expect(settingsRepo.enable).not.toHaveBeenCalled();
    });
  });

  describe('verifyViewerPassword', () => {
    it('returns true on a matching password (bcrypt verifies)', async () => {
      // Use the real service.enable to produce a real hash, then verify via the same service.
      settingsRepo.enable.mockImplementation(async (_t, _c, data) => ({
        ...mockSettings,
        viewerPasswordHash: data.viewerPasswordHash,
      }));
      await service.enable(tenantId, customerId, { viewerPassword: 'top-secret' }, userId);
      const written = settingsRepo.enable.mock.calls[0]?.[2];
      const writtenHash = written?.viewerPasswordHash ?? null;

      settingsRepo.getByCustomerId.mockResolvedValue({
        ...mockSettings, viewerPasswordHash: writtenHash,
      });

      await expect(service.verifyViewerPassword(tenantId, customerId, 'top-secret')).resolves.toBe(true);
      await expect(service.verifyViewerPassword(tenantId, customerId, 'wrong')).resolves.toBe(false);
    });

    it('returns false when settings have no password hash', async () => {
      settingsRepo.getByCustomerId.mockResolvedValue({ ...mockSettings, viewerPasswordHash: null });
      await expect(service.verifyViewerPassword(tenantId, customerId, 'whatever')).resolves.toBe(false);
    });

    it('returns false when the customer is not QR-enabled', async () => {
      settingsRepo.getByCustomerId.mockResolvedValue(null);
      await expect(service.verifyViewerPassword(tenantId, customerId, 'whatever')).resolves.toBe(false);
    });
  });

  describe('update', () => {
    it('hashes a new viewer password before persisting', async () => {
      settingsRepo.update.mockResolvedValue(mockSettings);
      await service.update(tenantId, customerId, { viewerPassword: 'rotated' });
      expect(settingsRepo.update).toHaveBeenCalledWith(
        tenantId, customerId,
        expect.objectContaining({ viewerPasswordHash: expect.stringMatching(/^\$2[aby]\$/) }),
      );
    });

    it('passes null when viewerPassword is explicitly nulled', async () => {
      settingsRepo.update.mockResolvedValue(mockSettings);
      await service.update(tenantId, customerId, { viewerPassword: null });
      expect(settingsRepo.update).toHaveBeenCalledWith(
        tenantId, customerId,
        expect.objectContaining({ viewerPasswordHash: null }),
      );
    });

    it('does NOT include viewerPasswordHash when only metadata changes', async () => {
      settingsRepo.update.mockResolvedValue(mockSettings);
      await service.update(tenantId, customerId, { woMetadata: { x: 1 } });
      const patch = settingsRepo.update.mock.calls[0]?.[2];
      expect(patch).not.toHaveProperty('viewerPasswordHash');
      expect(patch).toEqual({ woMetadata: { x: 1 } });
    });
  });

  describe('disable', () => {
    it('drops the settings row', async () => {
      await service.disable(tenantId, customerId);
      expect(settingsRepo.disable).toHaveBeenCalledWith(tenantId, customerId);
    });
  });
});
