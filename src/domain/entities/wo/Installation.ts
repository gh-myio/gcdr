// RFC-0032 — Installation: record that a device was deployed in the field.

export type InstallationStatus =
  | 'instalado'
  | 'impedimento'
  | 'removido'
  | 'defeito';

export type TcType = '50A' | '100A' | '400A' | '1000A' | '2000A';

export const ALL_INSTALLATION_STATUSES: readonly InstallationStatus[] = [
  'instalado', 'impedimento', 'removido', 'defeito',
] as const;

export const ALL_TC_TYPES: readonly TcType[] = [
  '50A', '100A', '400A', '1000A', '2000A',
] as const;

export interface Installation {
  id: string;
  tenantId: string;
  /** FK to devices.id — the physical device this installation describes. */
  deviceId: string;
  /** Denormalised from device.customer_id for fast filtering. */
  customerId: string;
  /** Free-text description of where the device sits (e.g. "Sub-loja 304 quadro QF"). */
  position: string;
  /** Current Transformer rating selected by the technician at install time. */
  tcType: TcType | null;
  /** Lifecycle state. `impedimento_text` in DB; renamed for clarity. */
  status: InstallationStatus;
  obs: string | null;
  /** Calibration scale factor for current readings (e.g. `1` or `0.5`). */
  currentMultiplier: number | null;
  /** Calibration scale factor for voltage readings. */
  voltageMultiplier: number | null;
  /** users.id of the technician who recorded the install. */
  installedBy: string;
  installedAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
