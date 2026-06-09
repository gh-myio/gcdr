import { Installation, InstallationStatus, TcType } from '../../../domain/entities/wo/Installation';

export interface InstallationCreateInput {
  deviceId:          string;
  customerId:        string;
  position:          string;
  tcType?:           TcType | null;
  status?:           InstallationStatus;
  obs?:              string | null;
  currentMultiplier?: number | null;
  voltageMultiplier?: number | null;
  installedBy:       string;
}

export interface InstallationUpdateInput {
  position?:          string;
  tcType?:            TcType | null;
  status?:            InstallationStatus;
  obs?:               string | null;
  currentMultiplier?: number | null;
  voltageMultiplier?: number | null;
}

export interface IInstallationRepository {
  create(tenantId: string, data: InstallationCreateInput): Promise<Installation>;
  getById(tenantId: string, id: string): Promise<Installation | null>;
  getByDeviceId(tenantId: string, deviceId: string): Promise<Installation | null>;

  /** Patch an installation. Returns the updated row; throws NOT_FOUND if missing. */
  update(tenantId: string, id: string, patch: InstallationUpdateInput): Promise<Installation>;

  /** Soft-delete (sets deleted_at). Installations are never hard-deleted. */
  softDelete(tenantId: string, id: string): Promise<void>;

  listByCustomer(tenantId: string, customerId: string): Promise<Installation[]>;

  /** Aggregate counts per status for a customer (for /report). */
  countByStatusForCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<Record<InstallationStatus, number>>;
}
