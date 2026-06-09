import { Visita, VisitaStatus } from '../../domain/entities/wo/Visita';
import { VisitaAmbiente } from '../../domain/entities/wo/VisitaAmbiente';
import { VisitaAmbienteImage } from '../../domain/entities/wo/VisitaAmbienteImage';
import { VisitaProduct } from '../../domain/entities/wo/VisitaProduct';
import { VisitaProductImage } from '../../domain/entities/wo/VisitaProductImage';
import { VisitaObservation } from '../../domain/entities/wo/VisitaObservation';
import { VisitaAudit } from '../../domain/entities/wo/VisitaAudit';

import { IVisitaRepository } from '../../repositories/interfaces/wo/IVisitaRepository';
import {
  IVisitaAmbienteRepository,
  IVisitaAmbienteImageRepository,
} from '../../repositories/interfaces/wo/IVisitaAmbienteRepository';
import {
  IVisitaProductRepository,
  IVisitaProductImageRepository,
} from '../../repositories/interfaces/wo/IVisitaProductRepository';
import { IVisitaObservationRepository } from '../../repositories/interfaces/wo/IVisitaObservationRepository';
import { IVisitaAuditRepository } from '../../repositories/interfaces/wo/IVisitaAuditRepository';

import { visitaRepository } from '../../repositories/wo/VisitaRepository';
import {
  visitaAmbienteRepository,
  visitaAmbienteImageRepository,
} from '../../repositories/wo/VisitaAmbienteRepository';
import {
  visitaProductRepository,
  visitaProductImageRepository,
} from '../../repositories/wo/VisitaProductRepository';
import { visitaObservationRepository } from '../../repositories/wo/VisitaObservationRepository';
import { visitaAuditRepository } from '../../repositories/wo/VisitaAuditRepository';

import { ConflictError, NotFoundError } from '../../shared/errors/AppError';

const MAX_IMAGES_PER_AMBIENTE = 50;
const MAX_IMAGES_PER_PRODUCT  = 5;

export class VisitaService {
  constructor(
    private readonly repo: IVisitaRepository = visitaRepository,
    private readonly ambienteRepo: IVisitaAmbienteRepository = visitaAmbienteRepository,
    private readonly ambienteImageRepo: IVisitaAmbienteImageRepository = visitaAmbienteImageRepository,
    private readonly productRepo: IVisitaProductRepository = visitaProductRepository,
    private readonly productImageRepo: IVisitaProductImageRepository = visitaProductImageRepository,
    private readonly observationRepo: IVisitaObservationRepository = visitaObservationRepository,
    private readonly auditRepo: IVisitaAuditRepository = visitaAuditRepository,
  ) {}

  // ─── Visita root ─────────────────────────────────────────────────────────
  async create(
    tenantId: string,
    data: { customerId: string | null; name: string; observation: string | null },
    createdBy: string,
  ): Promise<Visita> {
    const v = await this.repo.create(tenantId, { ...data, createdBy });
    await this.auditRepo.append(tenantId, v.id, {
      ambienteId:        null,
      changeType:        'created',
      changeDescription: 'Visita created',
      oldValue:          null,
      newValue:          { ...v },
      changedBy:         createdBy,
    });
    return v;
  }

  async getById(tenantId: string, id: string): Promise<Visita> {
    const v = await this.repo.getById(tenantId, id);
    if (!v) throw new NotFoundError(`Visita ${id} not found`);
    return v;
  }

  async list(
    tenantId: string,
    params?: { customerId?: string; status?: VisitaStatus; limit?: number; offset?: number },
  ): Promise<{ items: Visita[]; total: number }> {
    return this.repo.list(tenantId, params);
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<{
      customerId:  string | null;
      name:        string;
      observation: string | null;
      status:      VisitaStatus;
    }>,
    updatedBy: string,
  ): Promise<Visita> {
    const before = await this.repo.getById(tenantId, id);
    if (!before) throw new NotFoundError(`Visita ${id} not found`);

    const updated = await this.repo.update(tenantId, id, patch);
    await this.auditRepo.append(tenantId, id, {
      ambienteId:        null,
      changeType:        'updated',
      changeDescription: 'Visita patched',
      oldValue:          { ...before },
      newValue:          { ...updated },
      changedBy:         updatedBy,
    });
    return updated;
  }

  async softDelete(tenantId: string, id: string, deletedBy: string): Promise<void> {
    const before = await this.repo.getById(tenantId, id);
    if (!before) throw new NotFoundError(`Visita ${id} not found`);

    await this.repo.softDelete(tenantId, id);
    await this.auditRepo.append(tenantId, id, {
      ambienteId:        null,
      changeType:        'deleted',
      changeDescription: 'Visita soft-deleted',
      oldValue:          { ...before },
      newValue:          null,
      changedBy:         deletedBy,
    });
  }

  async listAudit(tenantId: string, id: string): Promise<VisitaAudit[]> {
    return this.auditRepo.listByVisita(tenantId, id);
  }

  // ─── Ambientes ───────────────────────────────────────────────────────────
  async createAmbiente(
    tenantId: string,
    visitaId: string,
    data: {
      name:            string;
      observation:     string | null;
      acQuantity:      number | null;
      productQuantity: number | null;
      productType:     string | null;
    },
    createdBy: string,
  ): Promise<VisitaAmbiente> {
    await this.assertVisitaExists(tenantId, visitaId);
    const a = await this.ambienteRepo.create(tenantId, visitaId, { ...data, createdBy });
    await this.auditRepo.append(tenantId, visitaId, {
      ambienteId:        a.id,
      changeType:        'ambiente_created',
      changeDescription: `Ambiente "${a.name}" created`,
      oldValue:          null,
      newValue:          { ...a },
      changedBy:         createdBy,
    });
    return a;
  }

  async listAmbientes(tenantId: string, visitaId: string): Promise<VisitaAmbiente[]> {
    return this.ambienteRepo.listByVisita(tenantId, visitaId);
  }

  async getAmbiente(tenantId: string, id: string): Promise<VisitaAmbiente> {
    const a = await this.ambienteRepo.getById(tenantId, id);
    if (!a) throw new NotFoundError(`Ambiente ${id} not found`);
    return a;
  }

  async updateAmbiente(
    tenantId: string,
    id: string,
    patch: Partial<{
      name:            string;
      observation:     string | null;
      acQuantity:      number | null;
      productQuantity: number | null;
      productType:     string | null;
    }>,
    updatedBy: string,
  ): Promise<VisitaAmbiente> {
    const before = await this.ambienteRepo.getById(tenantId, id);
    if (!before) throw new NotFoundError(`Ambiente ${id} not found`);

    const updated = await this.ambienteRepo.update(tenantId, id, patch);
    await this.auditRepo.append(tenantId, before.visitaId, {
      ambienteId:        id,
      changeType:        'ambiente_updated',
      changeDescription: 'Ambiente patched',
      oldValue:          { ...before },
      newValue:          { ...updated },
      changedBy:         updatedBy,
    });
    return updated;
  }

  async deleteAmbiente(tenantId: string, id: string, deletedBy: string): Promise<void> {
    const before = await this.ambienteRepo.getById(tenantId, id);
    if (!before) throw new NotFoundError(`Ambiente ${id} not found`);

    await this.ambienteRepo.delete(tenantId, id);
    await this.auditRepo.append(tenantId, before.visitaId, {
      ambienteId:        id,
      changeType:        'ambiente_deleted',
      changeDescription: 'Ambiente deleted',
      oldValue:          { ...before },
      newValue:          null,
      changedBy:         deletedBy,
    });
  }

  // ─── Ambiente images ─────────────────────────────────────────────────────
  async attachAmbienteImage(
    tenantId: string,
    ambienteId: string,
    fileAssetId: string,
    options: { caption?: string | null; imageOrder?: number } | undefined,
    addedBy: string,
  ): Promise<VisitaAmbienteImage> {
    const ambiente = await this.ambienteRepo.getById(tenantId, ambienteId);
    if (!ambiente) throw new NotFoundError(`Ambiente ${ambienteId} not found`);

    const count = await this.ambienteImageRepo.countByAmbiente(tenantId, ambienteId);
    if (count >= MAX_IMAGES_PER_AMBIENTE) {
      throw new ConflictError(`Limit reached: at most ${MAX_IMAGES_PER_AMBIENTE} images per ambiente`);
    }

    const order = options?.imageOrder ?? await this.ambienteImageRepo.nextImageOrder(tenantId, ambienteId);
    const created = await this.ambienteImageRepo.create(tenantId, ambienteId, {
      fileAssetId,
      imageOrder: order,
      caption:    options?.caption ?? null,
    });

    await this.auditRepo.append(tenantId, ambiente.visitaId, {
      ambienteId,
      changeType:        'ambiente_image_added',
      changeDescription: `Ambiente image attached (order=${order})`,
      oldValue:          null,
      newValue:          { id: created.id, fileAssetId, imageOrder: order },
      changedBy:         addedBy,
    });

    return created;
  }

  async listAmbienteImages(tenantId: string, ambienteId: string): Promise<VisitaAmbienteImage[]> {
    return this.ambienteImageRepo.listByAmbiente(tenantId, ambienteId);
  }

  async updateAmbienteImage(
    tenantId: string,
    imageId: string,
    patch: { imageOrder?: number; caption?: string | null },
  ): Promise<VisitaAmbienteImage> {
    return this.ambienteImageRepo.update(tenantId, imageId, patch);
  }

  async deleteAmbienteImage(tenantId: string, imageId: string): Promise<void> {
    return this.ambienteImageRepo.delete(tenantId, imageId);
  }

  // ─── Products ────────────────────────────────────────────────────────────
  async createProduct(
    tenantId: string,
    ambienteId: string,
    data: { productType: string; description: string | null; quantity: number },
    createdBy: string,
  ): Promise<VisitaProduct> {
    const ambiente = await this.ambienteRepo.getById(tenantId, ambienteId);
    if (!ambiente) throw new NotFoundError(`Ambiente ${ambienteId} not found`);
    return this.productRepo.create(tenantId, ambienteId, { ...data, createdBy });
  }

  async listProducts(tenantId: string, ambienteId: string): Promise<VisitaProduct[]> {
    return this.productRepo.listByAmbiente(tenantId, ambienteId);
  }

  async updateProduct(
    tenantId: string,
    id: string,
    patch: Partial<{ productType: string; description: string | null; quantity: number }>,
  ): Promise<VisitaProduct> {
    return this.productRepo.update(tenantId, id, patch);
  }

  async deleteProduct(tenantId: string, id: string): Promise<void> {
    return this.productRepo.delete(tenantId, id);
  }

  // ─── Product images ──────────────────────────────────────────────────────
  async attachProductImage(
    tenantId: string,
    productId: string,
    fileAssetId: string,
  ): Promise<VisitaProductImage> {
    const product = await this.productRepo.getById(tenantId, productId);
    if (!product) throw new NotFoundError(`Product ${productId} not found`);

    const count = await this.productImageRepo.countByProduct(tenantId, productId);
    if (count >= MAX_IMAGES_PER_PRODUCT) {
      throw new ConflictError(`Limit reached: at most ${MAX_IMAGES_PER_PRODUCT} images per product`);
    }

    const order = await this.productImageRepo.nextImageOrder(tenantId, productId);
    return this.productImageRepo.create(tenantId, productId, { fileAssetId, imageOrder: order });
  }

  async listProductImages(tenantId: string, productId: string): Promise<VisitaProductImage[]> {
    return this.productImageRepo.listByProduct(tenantId, productId);
  }

  async deleteProductImage(tenantId: string, id: string): Promise<void> {
    return this.productImageRepo.delete(tenantId, id);
  }

  // ─── Visita-level observations ───────────────────────────────────────────
  async createObservation(
    tenantId: string,
    visitaId: string,
    observation: string,
    fileAssetId: string | null,
    createdBy: string,
  ): Promise<VisitaObservation> {
    await this.assertVisitaExists(tenantId, visitaId);
    return this.observationRepo.create(tenantId, visitaId, { observation, fileAssetId, createdBy });
  }

  async listObservations(tenantId: string, visitaId: string): Promise<VisitaObservation[]> {
    return this.observationRepo.listByVisita(tenantId, visitaId);
  }

  async deleteObservation(tenantId: string, id: string): Promise<void> {
    return this.observationRepo.delete(tenantId, id);
  }

  // ─── Internal ────────────────────────────────────────────────────────────
  private async assertVisitaExists(tenantId: string, visitaId: string): Promise<void> {
    const v = await this.repo.getById(tenantId, visitaId);
    if (!v) throw new NotFoundError(`Visita ${visitaId} not found`);
  }
}

export const visitaService = new VisitaService();
