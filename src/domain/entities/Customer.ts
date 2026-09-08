import { BaseEntity, CustomerType, EntityStatus } from '../../shared/types';

export interface CustomerSettings {
  timezone: string;
  locale: string;
  currency: string;
  inheritFromParent: boolean;
}

export interface CustomerTheme {
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  faviconUrl?: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  coordinates?: { lat: number; lng: number };
}

export interface Customer extends BaseEntity {
  parentCustomerId: string | null;
  path: string;
  depth: number;

  // External integration
  externalId?: string;              // ThingsBoard customer id (tbId)
  ingestionCustomerId?: string;     // customer id in the INGESTION system (distinct from externalId)

  // Basic Info
  name: string;
  displayName: string;
  code: string;
  type: CustomerType;

  // Contact
  email?: string;
  phone?: string;
  address?: Address;

  // Configuration
  settings: CustomerSettings;
  theme?: CustomerTheme;
  metadata: Record<string, unknown>;
  config?: CustomerConfig;

  // Status
  status: EntityStatus;
  deletedAt?: string;
}

export interface CustomerBundleConfig {
  checkVersion?: boolean;  // default true — false = always return full bundle
}

// =============================================================================
// RFC-0057 — Customer Config Document
//
// The consolidated, governed per-customer configuration. New sections live in
// the existing `customers.config` jsonb (DEC-6, no schema migration). Secrets
// (`ingestion.clientSecret`, `security.masterAdminPassword`) are stored here as
// encrypted `secretEnvelope` strings at rest and are NEVER writable through the
// general /config write path — only via the dedicated secrets endpoint (DEC-7).
// =============================================================================

/** RFC-0057 DEC-3 — the three independent visibility groups. */
export type FeatureGroup = 'entrada' | 'areacomum' | 'lojas';

/** Three independent toggles for one feature (2×3 matrix row). */
export type FeatureGroupFlags = Record<FeatureGroup, boolean>;

/** RFC-0057 DEC-3 — 2×3 checkbox matrix (2 features × 3 groups). */
export interface FeatureButtons {
  demandPeak: FeatureGroupFlags;
  instantTelemetry: FeatureGroupFlags;
}

export interface CustomerAlarmsConfig {
  notificationsEnabled?: boolean;
  showOffline?: boolean;
  showInternalSupport?: boolean;
}

export interface CustomerTicketsConfig {
  enabled?: boolean;
  onlyToMyio?: boolean;
}

export interface CustomerTemperatureConfig {
  min?: number;
  max?: number;
  clampMin?: number;
  clampMax?: number;
}

export interface CustomerDisplayConfig {
  measurementDisplaySettings?: unknown;
  mapInstantaneousPower?: unknown;
}

export interface CustomerDefaultDashboardConfig {
  id?: string | null;
  cfg?: unknown;
}

/** `clientSecret` (when present) is an encrypted secretEnvelope string at rest. */
export interface CustomerIngestionConfig {
  clientId?: string;
  clientSecret?: string;
}

/** `masterAdminPassword` (when present) is an encrypted secretEnvelope at rest. */
export interface CustomerSecurityConfig {
  masterAdminPassword?: string;
}

export interface CustomerConfig {
  bundle?: CustomerBundleConfig;                       // existing — never touched by /config
  featureButtons?: FeatureButtons;                     // DEC-3
  alarms?: CustomerAlarmsConfig;
  tickets?: CustomerTicketsConfig;
  temperature?: CustomerTemperatureConfig;
  display?: CustomerDisplayConfig;
  defaultDashboard?: CustomerDefaultDashboardConfig;
  classificationProfile?: unknown;                     // RFC-0207 shape
  ingestion?: CustomerIngestionConfig;                 // clientSecret = envelope at rest (secrets endpoint only)
  security?: CustomerSecurityConfig;                   // masterAdminPassword = envelope at rest (secrets endpoint only)
}

/**
 * RFC-0057 DEC-3/DEC-5 — the single canonical default `featureButtons`
 * (the "unset" row): Entrada/Área Comum on, Lojas off, for both features.
 */
export function createDefaultFeatureButtons(): FeatureButtons {
  return {
    demandPeak: { entrada: true, areacomum: true, lojas: false },
    instantTelemetry: { entrada: true, areacomum: true, lojas: false },
  };
}

// Single source of truth for auto-generated customer codes — the service uses it
// for the duplicate check and passes the result to the repository, so the value
// checked is always the value inserted (codes column is varchar(50)).
export function generateCustomerCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50)
    .replace(/^-|-$/g, '');
}

export function createDefaultCustomerSettings(): CustomerSettings {
  return {
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    currency: 'BRL',
    inheritFromParent: true,
  };
}
