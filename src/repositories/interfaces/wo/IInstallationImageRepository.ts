import { InstallationImage } from '../../../domain/entities/wo/InstallationImage';

export interface IInstallationImageRepository {
  create(
    tenantId: string,
    installationId: string,
    data: { fileAssetId: string; imageOrder: number; caption: string | null },
  ): Promise<InstallationImage>;

  getById(tenantId: string, id: string): Promise<InstallationImage | null>;

  listByInstallation(tenantId: string, installationId: string): Promise<InstallationImage[]>;

  countByInstallation(tenantId: string, installationId: string): Promise<number>;

  update(
    tenantId: string,
    id: string,
    patch: { imageOrder?: number; caption?: string | null },
  ): Promise<InstallationImage>;

  delete(tenantId: string, id: string): Promise<void>;

  /** Returns the next available imageOrder for an installation. */
  nextImageOrder(tenantId: string, installationId: string): Promise<number>;
}
