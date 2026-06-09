import { Installation, InstallationStatus, TcType } from '../../domain/entities/wo/Installation';
import { InstallationAudit } from '../../domain/entities/wo/InstallationAudit';
import { InstallationImage } from '../../domain/entities/wo/InstallationImage';
import { IInstallationRepository } from '../../repositories/interfaces/wo/IInstallationRepository';
import { IInstallationImageRepository } from '../../repositories/interfaces/wo/IInstallationImageRepository';
import { IInstallationAuditRepository } from '../../repositories/interfaces/wo/IInstallationAuditRepository';
import { IDeviceRepository } from '../../repositories/interfaces/IDeviceRepository';
import { installationRepository } from '../../repositories/wo/InstallationRepository';
import { installationImageRepository } from '../../repositories/wo/InstallationImageRepository';
import { installationAuditRepository } from '../../repositories/wo/InstallationAuditRepository';
import { DeviceRepository } from '../../repositories/DeviceRepository';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/AppError';

export interface InstallByDeviceInput {
  customerId:        string;
  deviceId:          string;
  position:          string;
  tcType?:           TcType | null;
  status?:           InstallationStatus;
  obs?:              string | null;
  currentMultiplier?: number | null;
  voltageMultiplier?: number | null;
}

export interface InstallByAddressInput {
  customerId:        string;
  addrLow:           number;
  addrHigh:          number;
  position:          string;
  tcType?:           TcType | null;
  status?:           InstallationStatus;
  obs?:              string | null;
  currentMultiplier?: number | null;
  voltageMultiplier?: number | null;
}

export type InstallInput = InstallByDeviceInput | InstallByAddressInput;

const MAX_IMAGES_PER_INSTALLATION = 20;

export class InstallationService {
  constructor(
    private readonly repo: IInstallationRepository = installationRepository,
    private readonly imageRepo: IInstallationImageRepository = installationImageRepository,
    private readonly auditRepo: IInstallationAuditRepository = installationAuditRepository,
    private readonly deviceRepo: IDeviceRepository = new DeviceRepository(),
  ) {}

  /**
   * Idempotent: if an installation already exists for the resolved
   * device, the call is treated as an update.
   */
  async install(tenantId: string, input: InstallInput, installedBy: string): Promise<Installation> {
    const deviceId = await this.resolveDeviceId(tenantId, input);

    const device = await this.deviceRepo.getById(tenantId, deviceId);
    if (!device) throw new NotFoundError(`Device ${deviceId} not found`);
    if (device.customerId !== input.customerId) {
      throw new ValidationError('Device customer mismatch');
    }

    const existing = await this.repo.getByDeviceId(tenantId, deviceId);
    if (existing) {
      // Update in place (admin or operator re-install)
      const updated = await this.repo.update(tenantId, existing.id, {
        position:          input.position,
        tcType:            input.tcType ?? null,
        status:            input.status ?? existing.status,
        obs:               input.obs ?? null,
        currentMultiplier: input.currentMultiplier ?? null,
        voltageMultiplier: input.voltageMultiplier ?? null,
      });
      await this.auditRepo.append(tenantId, existing.id, {
        changeType:        'updated',
        changeDescription: 'Installation updated via /install',
        oldValue:          { ...existing },
        newValue:          { ...updated },
        changedBy:         installedBy,
      });
      return updated;
    }

    const created = await this.repo.create(tenantId, {
      deviceId,
      customerId:        input.customerId,
      position:          input.position,
      tcType:            input.tcType ?? null,
      status:            input.status ?? 'instalado',
      obs:               input.obs ?? null,
      currentMultiplier: input.currentMultiplier ?? null,
      voltageMultiplier: input.voltageMultiplier ?? null,
      installedBy,
    });
    await this.auditRepo.append(tenantId, created.id, {
      changeType:        'created',
      changeDescription: 'Installation created',
      oldValue:          null,
      newValue:          { ...created },
      changedBy:         installedBy,
    });
    return created;
  }

  async update(
    tenantId: string,
    id: string,
    patch: {
      position?:          string;
      tcType?:            TcType | null;
      status?:            InstallationStatus;
      obs?:               string | null;
      currentMultiplier?: number | null;
      voltageMultiplier?: number | null;
    },
    updatedBy: string,
  ): Promise<Installation> {
    const before = await this.repo.getById(tenantId, id);
    if (!before) throw new NotFoundError(`Installation ${id} not found`);

    const updated = await this.repo.update(tenantId, id, patch);
    await this.auditRepo.append(tenantId, id, {
      changeType:        'updated',
      changeDescription: 'Installation patched',
      oldValue:          { ...before },
      newValue:          { ...updated },
      changedBy:         updatedBy,
    });
    return updated;
  }

  async getById(tenantId: string, id: string): Promise<Installation> {
    const i = await this.repo.getById(tenantId, id);
    if (!i) throw new NotFoundError(`Installation ${id} not found`);
    return i;
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<Installation[]> {
    return this.repo.listByCustomer(tenantId, customerId);
  }

  async softDelete(tenantId: string, id: string, deletedBy: string): Promise<void> {
    const before = await this.repo.getById(tenantId, id);
    if (!before) throw new NotFoundError(`Installation ${id} not found`);

    await this.repo.softDelete(tenantId, id);
    await this.auditRepo.append(tenantId, id, {
      changeType:        'deleted',
      changeDescription: 'Installation soft-deleted',
      oldValue:          { ...before },
      newValue:          null,
      changedBy:         deletedBy,
    });
  }

  // ─── Audit ────────────────────────────────────────────────────────────────
  async listAudit(tenantId: string, id: string): Promise<InstallationAudit[]> {
    return this.auditRepo.listByInstallation(tenantId, id);
  }

  // ─── Images ───────────────────────────────────────────────────────────────
  /**
   * Attach an already-uploaded file_assets row as an installation image.
   * The controller is responsible for first uploading to FileAssetService
   * with `ownerType: 'wo_installation'` and `ownerId: installationId`.
   */
  async attachImage(
    tenantId: string,
    installationId: string,
    fileAssetId: string,
    options: { caption?: string | null; imageOrder?: number } | undefined,
    addedBy: string,
  ): Promise<InstallationImage> {
    const inst = await this.repo.getById(tenantId, installationId);
    if (!inst) throw new NotFoundError(`Installation ${installationId} not found`);

    const count = await this.imageRepo.countByInstallation(tenantId, installationId);
    if (count >= MAX_IMAGES_PER_INSTALLATION) {
      throw new ConflictError(
        `Limit reached: at most ${MAX_IMAGES_PER_INSTALLATION} images per installation`,
      );
    }

    const order = options?.imageOrder ?? await this.imageRepo.nextImageOrder(tenantId, installationId);
    const created = await this.imageRepo.create(tenantId, installationId, {
      fileAssetId,
      imageOrder: order,
      caption:    options?.caption ?? null,
    });

    await this.auditRepo.append(tenantId, installationId, {
      changeType:        'image_added',
      changeDescription: `Image attached (order=${order})`,
      oldValue:          null,
      newValue:          { id: created.id, fileAssetId, imageOrder: order },
      changedBy:         addedBy,
    });

    return created;
  }

  async listImages(tenantId: string, installationId: string): Promise<InstallationImage[]> {
    return this.imageRepo.listByInstallation(tenantId, installationId);
  }

  async updateImage(
    tenantId: string,
    imageId: string,
    patch: { imageOrder?: number; caption?: string | null },
  ): Promise<InstallationImage> {
    return this.imageRepo.update(tenantId, imageId, patch);
  }

  async detachImage(tenantId: string, imageId: string, removedBy: string): Promise<void> {
    const img = await this.imageRepo.getById(tenantId, imageId);
    if (!img) throw new NotFoundError(`Image ${imageId} not found`);

    await this.imageRepo.delete(tenantId, imageId);
    await this.auditRepo.append(tenantId, img.installationId, {
      changeType:        'image_removed',
      changeDescription: `Image removed`,
      oldValue:          { id: img.id, fileAssetId: img.fileAssetId, imageOrder: img.imageOrder },
      newValue:          null,
      changedBy:         removedBy,
    });
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────
  private async resolveDeviceId(tenantId: string, input: InstallInput): Promise<string> {
    if ('deviceId' in input) return input.deviceId;

    // Lookup by (addrLow, addrHigh, customerId). The fields were added on
    // migration 0025 — devices.wo_addr_low / wo_addr_high.
    const { addrLow, addrHigh, customerId } = input;
    const device = await this.deviceRepo.findByWoAddress(tenantId, customerId, addrLow, addrHigh);
    if (!device) {
      throw new NotFoundError(
        `No device for customer ${customerId} matching addrLow=${addrLow} addrHigh=${addrHigh}`,
      );
    }
    return device.id;
  }
}

export const installationService = new InstallationService();
