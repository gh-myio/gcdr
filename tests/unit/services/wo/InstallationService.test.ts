import { InstallationService } from '../../../../src/services/wo/InstallationService';
import { IInstallationRepository } from '../../../../src/repositories/interfaces/wo/IInstallationRepository';
import { IInstallationImageRepository } from '../../../../src/repositories/interfaces/wo/IInstallationImageRepository';
import { IInstallationAuditRepository } from '../../../../src/repositories/interfaces/wo/IInstallationAuditRepository';
import { IDeviceRepository } from '../../../../src/repositories/interfaces/IDeviceRepository';
import { Installation } from '../../../../src/domain/entities/wo/Installation';
import { InstallationImage } from '../../../../src/domain/entities/wo/InstallationImage';
import { InstallationAudit } from '../../../../src/domain/entities/wo/InstallationAudit';
import { Device } from '../../../../src/domain/entities/Device';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/shared/errors/AppError';

describe('InstallationService', () => {
  const tenantId   = '11111111-1111-1111-1111-111111111111';
  const customerId = '33333333-3333-3333-3333-333333333333';
  const deviceId   = '44444444-4444-4444-4444-444444444444';
  const userId     = '55555555-5555-5555-5555-555555555555';

  let repo: jest.Mocked<IInstallationRepository>;
  let imageRepo: jest.Mocked<IInstallationImageRepository>;
  let auditRepo: jest.Mocked<IInstallationAuditRepository>;
  let deviceRepo: jest.Mocked<IDeviceRepository>;
  let service: InstallationService;

  const mockInstallation: Installation = {
    id:                'inst-1',
    tenantId,
    deviceId,
    customerId,
    position:          'Térreo - QGBT',
    tcType:            '100A',
    status:            'instalado',
    obs:               null,
    currentMultiplier: null,
    voltageMultiplier: null,
    installedBy:       userId,
    installedAt:       '2026-04-29T10:00:00Z',
    updatedAt:         '2026-04-29T10:00:00Z',
    deletedAt:         null,
  };

  const mockDevice = {
    id: deviceId, tenantId, customerId, name: 'Dev', status: 'ACTIVE',
  } as unknown as Device;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      getById: jest.fn(),
      getByDeviceId: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      listByCustomer: jest.fn(),
      countByStatusForCustomer: jest.fn(),
    };
    imageRepo = {
      create: jest.fn(),
      getById: jest.fn(),
      listByInstallation: jest.fn(),
      countByInstallation: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      nextImageOrder: jest.fn(),
    };
    auditRepo = {
      append: jest.fn().mockResolvedValue({} as InstallationAudit),
      listByInstallation: jest.fn(),
      listByUser: jest.fn(),
    };
    deviceRepo = {
      create: jest.fn(),
      getById: jest.fn().mockResolvedValue(mockDevice),
      getBySerialNumber: jest.fn(),
      getByExternalId: jest.fn(),
      findByIdentifier: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
      listByAsset: jest.fn(),
      listByCustomer: jest.fn(),
      findBySlaveId: jest.fn(),
      findByWoAddress: jest.fn(),
      updateConnectivityStatus: jest.fn(),
      move: jest.fn(),
      countByAsset: jest.fn(),
      countByCustomer: jest.fn(),
      countByName: jest.fn(),
    };
    service = new InstallationService(repo, imageRepo, auditRepo, deviceRepo);
  });

  describe('install (idempotent)', () => {
    it('creates a new installation when none exists for the device', async () => {
      repo.getByDeviceId.mockResolvedValue(null);
      repo.create.mockResolvedValue(mockInstallation);

      const result = await service.install(tenantId, {
        customerId, deviceId, position: 'Térreo', tcType: '100A',
      }, userId);

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.update).not.toHaveBeenCalled();
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, mockInstallation.id, expect.objectContaining({
        changeType: 'created',
        changedBy:  userId,
      }));
      expect(result).toBe(mockInstallation);
    });

    it('updates in place when an installation already exists for the device (idempotent)', async () => {
      repo.getByDeviceId.mockResolvedValue(mockInstallation);
      const updated: Installation = { ...mockInstallation, position: 'Sub-loja 304', status: 'impedimento' };
      repo.update.mockResolvedValue(updated);

      const result = await service.install(tenantId, {
        customerId, deviceId, position: 'Sub-loja 304', status: 'impedimento',
      }, userId);

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, mockInstallation.id, expect.objectContaining({
        changeType: 'updated',
        oldValue:   expect.objectContaining({ position: 'Térreo - QGBT' }),
        newValue:   expect.objectContaining({ position: 'Sub-loja 304' }),
      }));
      expect(result).toBe(updated);
    });

    it('rejects when the resolved device belongs to a different customer', async () => {
      deviceRepo.getById.mockResolvedValue({ ...mockDevice, customerId: 'other-customer' } as unknown as Device);

      await expect(service.install(tenantId, {
        customerId, deviceId, position: 'Térreo',
      }, userId)).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError when the device does not exist', async () => {
      deviceRepo.getById.mockResolvedValue(null);

      await expect(service.install(tenantId, {
        customerId, deviceId, position: 'Térreo',
      }, userId)).rejects.toThrow(NotFoundError);
    });

    it('resolves device by (addrLow, addrHigh) when deviceId is not provided', async () => {
      deviceRepo.findByWoAddress.mockResolvedValue(mockDevice);
      repo.getByDeviceId.mockResolvedValue(null);
      repo.create.mockResolvedValue(mockInstallation);

      await service.install(tenantId, {
        customerId, addrLow: 12, addrHigh: 7, position: 'Térreo',
      }, userId);

      expect(deviceRepo.findByWoAddress).toHaveBeenCalledWith(tenantId, customerId, 12, 7);
      expect(repo.create).toHaveBeenCalledWith(tenantId, expect.objectContaining({ deviceId }));
    });

    it('throws NotFoundError when QR address does not match a device', async () => {
      deviceRepo.findByWoAddress.mockResolvedValue(null);

      await expect(service.install(tenantId, {
        customerId, addrLow: 99, addrHigh: 99, position: 'Térreo',
      }, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('update', () => {
    it('emits an updated audit row with old/new snapshots', async () => {
      repo.getById.mockResolvedValue(mockInstallation);
      const updated: Installation = { ...mockInstallation, status: 'defeito' };
      repo.update.mockResolvedValue(updated);

      await service.update(tenantId, 'inst-1', { status: 'defeito' }, userId);

      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, 'inst-1', expect.objectContaining({
        changeType: 'updated',
        oldValue:   expect.objectContaining({ status: 'instalado' }),
        newValue:   expect.objectContaining({ status: 'defeito' }),
      }));
    });

    it('throws NotFoundError when installation is missing', async () => {
      repo.getById.mockResolvedValue(null);
      await expect(service.update(tenantId, 'missing', {}, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('attachImage (20-image cap)', () => {
    it('writes the join row + emits image_added audit', async () => {
      repo.getById.mockResolvedValue(mockInstallation);
      imageRepo.countByInstallation.mockResolvedValue(0);
      imageRepo.nextImageOrder.mockResolvedValue(0);
      const join: InstallationImage = {
        id: 'img-1', tenantId, installationId: 'inst-1',
        fileAssetId: 'asset-1', imageOrder: 0, caption: 'QGBT',
        createdAt: '2026-04-29T10:00:00Z',
      };
      imageRepo.create.mockResolvedValue(join);

      const result = await service.attachImage(tenantId, 'inst-1', 'asset-1', { caption: 'QGBT' }, userId);

      expect(imageRepo.create).toHaveBeenCalledWith(tenantId, 'inst-1', {
        fileAssetId: 'asset-1', imageOrder: 0, caption: 'QGBT',
      });
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, 'inst-1', expect.objectContaining({
        changeType: 'image_added',
      }));
      expect(result).toBe(join);
    });

    it('throws ConflictError when the 20-image cap is reached', async () => {
      repo.getById.mockResolvedValue(mockInstallation);
      imageRepo.countByInstallation.mockResolvedValue(20);

      await expect(service.attachImage(tenantId, 'inst-1', 'asset-1', undefined, userId))
        .rejects.toThrow(ConflictError);
      expect(imageRepo.create).not.toHaveBeenCalled();
    });

    it('passes through any caller-provided imageOrder', async () => {
      repo.getById.mockResolvedValue(mockInstallation);
      imageRepo.countByInstallation.mockResolvedValue(3);
      const join = {
        id: 'img-3', tenantId, installationId: 'inst-1',
        fileAssetId: 'asset-3', imageOrder: 5, caption: null,
        createdAt: '2026-04-29T10:00:00Z',
      } as InstallationImage;
      imageRepo.create.mockResolvedValue(join);

      await service.attachImage(tenantId, 'inst-1', 'asset-3', { imageOrder: 5 }, userId);

      expect(imageRepo.nextImageOrder).not.toHaveBeenCalled();
      expect(imageRepo.create).toHaveBeenCalledWith(tenantId, 'inst-1', expect.objectContaining({ imageOrder: 5 }));
    });
  });

  describe('detachImage', () => {
    it('emits an image_removed audit row carrying the join-row snapshot', async () => {
      const img: InstallationImage = {
        id: 'img-7', tenantId, installationId: 'inst-1',
        fileAssetId: 'asset-7', imageOrder: 4, caption: 'top',
        createdAt: '2026-04-29T10:00:00Z',
      };
      imageRepo.getById.mockResolvedValue(img);

      await service.detachImage(tenantId, 'img-7', userId);

      expect(imageRepo.delete).toHaveBeenCalledWith(tenantId, 'img-7');
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, 'inst-1', expect.objectContaining({
        changeType: 'image_removed',
        oldValue:   expect.objectContaining({ id: 'img-7', fileAssetId: 'asset-7' }),
      }));
    });
  });

  describe('softDelete', () => {
    it('marks deleted_at and emits a deleted audit row', async () => {
      repo.getById.mockResolvedValue(mockInstallation);

      await service.softDelete(tenantId, 'inst-1', userId);

      expect(repo.softDelete).toHaveBeenCalledWith(tenantId, 'inst-1');
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, 'inst-1', expect.objectContaining({
        changeType: 'deleted',
        newValue:   null,
      }));
    });
  });
});
