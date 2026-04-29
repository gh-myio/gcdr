import { VisitaService } from '../../../../src/services/qrc/VisitaService';
import { IVisitaRepository } from '../../../../src/repositories/interfaces/qrc/IVisitaRepository';
import {
  IVisitaAmbienteRepository,
  IVisitaAmbienteImageRepository,
} from '../../../../src/repositories/interfaces/qrc/IVisitaAmbienteRepository';
import {
  IVisitaProductRepository,
  IVisitaProductImageRepository,
} from '../../../../src/repositories/interfaces/qrc/IVisitaProductRepository';
import { IVisitaObservationRepository } from '../../../../src/repositories/interfaces/qrc/IVisitaObservationRepository';
import { IVisitaAuditRepository } from '../../../../src/repositories/interfaces/qrc/IVisitaAuditRepository';
import { Visita } from '../../../../src/domain/entities/qrc/Visita';
import { VisitaAmbiente } from '../../../../src/domain/entities/qrc/VisitaAmbiente';
import { VisitaProduct } from '../../../../src/domain/entities/qrc/VisitaProduct';
import { ConflictError, NotFoundError } from '../../../../src/shared/errors/AppError';

describe('VisitaService', () => {
  const tenantId   = 't-1';
  const visitaId   = 'visita-1';
  const ambienteId = 'amb-1';
  const productId  = 'prod-1';
  const userId     = 'user-1';

  let repo: jest.Mocked<IVisitaRepository>;
  let ambienteRepo: jest.Mocked<IVisitaAmbienteRepository>;
  let ambienteImageRepo: jest.Mocked<IVisitaAmbienteImageRepository>;
  let productRepo: jest.Mocked<IVisitaProductRepository>;
  let productImageRepo: jest.Mocked<IVisitaProductImageRepository>;
  let observationRepo: jest.Mocked<IVisitaObservationRepository>;
  let auditRepo: jest.Mocked<IVisitaAuditRepository>;
  let service: VisitaService;

  const mockVisita: Visita = {
    id: visitaId, tenantId, customerId: null,
    name: 'V1', observation: null, status: 'pending',
    createdBy: userId, createdAt: '2026-04-29T10:00:00Z',
    updatedAt: '2026-04-29T10:00:00Z', deletedAt: null,
  };

  const mockAmbiente: VisitaAmbiente = {
    id: ambienteId, tenantId, visitaId,
    name: 'Sala 1', observation: null,
    acQuantity: null, productQuantity: null, productType: null,
    createdBy: userId,
    createdAt: '2026-04-29T10:00:00Z', updatedAt: '2026-04-29T10:00:00Z',
  };

  const mockProduct: VisitaProduct = {
    id: productId, tenantId, ambienteId,
    productType: 'AC', description: null, quantity: 1,
    createdBy: userId, createdAt: '2026-04-29T10:00:00Z',
  };

  beforeEach(() => {
    repo = {
      create: jest.fn(), getById: jest.fn().mockResolvedValue(mockVisita),
      list: jest.fn(), update: jest.fn(), softDelete: jest.fn(),
    };
    ambienteRepo = {
      create: jest.fn().mockResolvedValue(mockAmbiente),
      getById: jest.fn().mockResolvedValue(mockAmbiente),
      listByVisita: jest.fn(),
      update: jest.fn(), delete: jest.fn(),
    };
    ambienteImageRepo = {
      create: jest.fn(),
      listByAmbiente: jest.fn(),
      countByAmbiente: jest.fn(),
      nextImageOrder: jest.fn(),
      update: jest.fn(), delete: jest.fn(),
    };
    productRepo = {
      create: jest.fn().mockResolvedValue(mockProduct),
      getById: jest.fn().mockResolvedValue(mockProduct),
      listByAmbiente: jest.fn(),
      update: jest.fn(), delete: jest.fn(),
    };
    productImageRepo = {
      create: jest.fn(),
      listByProduct: jest.fn(),
      countByProduct: jest.fn(),
      nextImageOrder: jest.fn(),
      delete: jest.fn(),
    };
    observationRepo = {
      create: jest.fn(),
      listByVisita: jest.fn(),
      delete: jest.fn(),
    };
    auditRepo = {
      append: jest.fn().mockResolvedValue({} as never),
      listByVisita: jest.fn(),
    };
    service = new VisitaService(
      repo, ambienteRepo, ambienteImageRepo,
      productRepo, productImageRepo, observationRepo, auditRepo,
    );
  });

  describe('create / update / softDelete emit audit', () => {
    it('create emits a created audit row', async () => {
      repo.create.mockResolvedValue(mockVisita);
      await service.create(tenantId, { customerId: null, name: 'V1', observation: null }, userId);
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, visitaId, expect.objectContaining({
        changeType: 'created',
      }));
    });

    it('update emits an updated audit row with old/new', async () => {
      repo.getById.mockResolvedValue(mockVisita);
      repo.update.mockResolvedValue({ ...mockVisita, status: 'in_progress' });
      await service.update(tenantId, visitaId, { status: 'in_progress' }, userId);
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, visitaId, expect.objectContaining({
        changeType: 'updated',
        oldValue:   expect.objectContaining({ status: 'pending' }),
        newValue:   expect.objectContaining({ status: 'in_progress' }),
      }));
    });

    it('softDelete emits a deleted audit row', async () => {
      repo.getById.mockResolvedValue(mockVisita);
      await service.softDelete(tenantId, visitaId, userId);
      expect(repo.softDelete).toHaveBeenCalledWith(tenantId, visitaId);
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, visitaId, expect.objectContaining({
        changeType: 'deleted', newValue: null,
      }));
    });
  });

  describe('attachAmbienteImage (50-cap)', () => {
    it('writes the join + emits ambiente_image_added when below cap', async () => {
      ambienteImageRepo.countByAmbiente.mockResolvedValue(10);
      ambienteImageRepo.nextImageOrder.mockResolvedValue(10);
      ambienteImageRepo.create.mockResolvedValue({
        id: 'img-1', tenantId, ambienteId,
        fileAssetId: 'asset-1', imageOrder: 10, caption: null,
        createdAt: '2026-04-29T10:00:00Z',
      });

      await service.attachAmbienteImage(tenantId, ambienteId, 'asset-1', undefined, userId);

      expect(ambienteImageRepo.create).toHaveBeenCalled();
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, visitaId, expect.objectContaining({
        ambienteId, changeType: 'ambiente_image_added',
      }));
    });

    it('throws ConflictError at exactly 50 images', async () => {
      ambienteImageRepo.countByAmbiente.mockResolvedValue(50);

      await expect(service.attachAmbienteImage(tenantId, ambienteId, 'asset-x', undefined, userId))
        .rejects.toThrow(ConflictError);
      expect(ambienteImageRepo.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when ambiente is missing', async () => {
      ambienteRepo.getById.mockResolvedValue(null);
      await expect(service.attachAmbienteImage(tenantId, 'missing', 'asset-x', undefined, userId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('attachProductImage (5-cap)', () => {
    it('writes when below cap', async () => {
      productImageRepo.countByProduct.mockResolvedValue(2);
      productImageRepo.nextImageOrder.mockResolvedValue(2);
      productImageRepo.create.mockResolvedValue({
        id: 'pimg-1', tenantId, productId,
        fileAssetId: 'asset-1', imageOrder: 2,
        createdAt: '2026-04-29T10:00:00Z',
      });

      await service.attachProductImage(tenantId, productId, 'asset-1');
      expect(productImageRepo.create).toHaveBeenCalledWith(tenantId, productId, {
        fileAssetId: 'asset-1', imageOrder: 2,
      });
    });

    it('throws ConflictError at exactly 5 images', async () => {
      productImageRepo.countByProduct.mockResolvedValue(5);
      await expect(service.attachProductImage(tenantId, productId, 'asset-x'))
        .rejects.toThrow(ConflictError);
      expect(productImageRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('ambiente CRUD audit emission', () => {
    it('createAmbiente emits ambiente_created with ambienteId', async () => {
      await service.createAmbiente(tenantId, visitaId, {
        name: 'Sala 1', observation: null,
        acQuantity: null, productQuantity: null, productType: null,
      }, userId);
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, visitaId, expect.objectContaining({
        ambienteId, changeType: 'ambiente_created',
      }));
    });

    it('updateAmbiente emits ambiente_updated', async () => {
      ambienteRepo.update.mockResolvedValue({ ...mockAmbiente, name: 'Sala 2' });
      await service.updateAmbiente(tenantId, ambienteId, { name: 'Sala 2' }, userId);
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, visitaId, expect.objectContaining({
        ambienteId, changeType: 'ambiente_updated',
      }));
    });

    it('deleteAmbiente emits ambiente_deleted', async () => {
      await service.deleteAmbiente(tenantId, ambienteId, userId);
      expect(ambienteRepo.delete).toHaveBeenCalledWith(tenantId, ambienteId);
      expect(auditRepo.append).toHaveBeenCalledWith(tenantId, visitaId, expect.objectContaining({
        ambienteId, changeType: 'ambiente_deleted', newValue: null,
      }));
    });
  });
});
