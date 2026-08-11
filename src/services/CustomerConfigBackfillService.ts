import { customerRepository, CustomerRepository } from '../repositories/CustomerRepository';
import {
  CustomerConfig,
  FeatureButtons,
  createDefaultFeatureButtons,
} from '../domain/entities/Customer';
import { UpdateCustomerDTO } from '../dto/request/CustomerDTO';
import { NotFoundError } from '../shared/errors/AppError';

// =============================================================================
// RFC-0057 DEC-14 (feedback-pre-merge P1.3) — TB SERVER_SCOPE → GCDR backfill.
//
// This is a DATA migration (no schema change). It is TB-source-agnostic: the
// caller supplies the already-read SERVER_SCOPE attributes (flat and/or nested
// `integration_setup`, reconciled per RFC-0229 §3.3) as a plain object; this
// service maps them to the consolidated `customers.config` document (DEC-2),
// computes a per-customer diff, and applies it idempotently.
//
//   - dry-run: compute the diff, do NOT write.
//   - idempotent: re-running after a successful apply yields an empty diff.
//   - the legacy `canShowDemandButtons` maps to the 2×3 matrix (AC #11):
//       true  → all groups true (both features)
//       false → all groups false (both features)
//       unset → { entrada:true, areacomum:true, lojas:false } (both features)
//
// Secrets (`client_secret`, `master_admin_password`) are intentionally NOT
// handled here — they must go through the audited secrets endpoint / a dedicated
// secret-backfill so ciphertext idempotency and access control are preserved.
// =============================================================================

export interface TbAttributeSource {
  [key: string]: unknown;
}

export interface ConfigDiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

export interface BackfillResult {
  customerId: string;
  changed: boolean;
  applied: boolean;
  dryRun: boolean;
  diff: ConfigDiffEntry[];
}

// ---- coercion helpers (TB SERVER_SCOPE values are frequently strings) --------

function coerceBool(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/**
 * Legacy `canShowDemandButtons` → the 2×3 matrix (AC #11). Pure & exported so
 * it can be unit-tested in isolation for the three canonical cases.
 */
export function mapCanShowDemandButtons(value: unknown): FeatureButtons {
  const b = coerceBool(value);
  if (b === true) {
    return {
      demandPeak: { entrada: true, areacomum: true, lojas: true },
      instantTelemetry: { entrada: true, areacomum: true, lojas: true },
    };
  }
  if (b === false) {
    return {
      demandPeak: { entrada: false, areacomum: false, lojas: false },
      instantTelemetry: { entrada: false, areacomum: false, lojas: false },
    };
  }
  // unset (or unrecognised) → canonical default (both features)
  return createDefaultFeatureButtons();
}

/** Assign coerced values onto `target` for the given (destKey, coercedValue) pairs. */
function assignDefined<T extends object>(
  target: T,
  pairs: Array<[keyof T & string, unknown]>,
): T {
  for (const [key, value] of pairs) {
    if (value !== undefined) (target as Record<string, unknown>)[key] = value;
  }
  return target;
}

function mapAlarms(attrs: TbAttributeSource): CustomerConfig['alarms'] | undefined {
  const alarms = assignDefined({} as NonNullable<CustomerConfig['alarms']>, [
    ['notificationsEnabled', coerceBool(attrs.alarmNotificationsEnabled)],
    ['showOffline', coerceBool(attrs.showOfflineAlarms)],
    ['showInternalSupport', coerceBool(attrs.isInternalSupportRule)],
  ]);
  return Object.keys(alarms).length > 0 ? alarms : undefined;
}

function mapTickets(attrs: TbAttributeSource): CustomerConfig['tickets'] | undefined {
  const tickets = assignDefined({} as NonNullable<CustomerConfig['tickets']>, [
    ['enabled', coerceBool(attrs.tickets_enabled)],
    ['onlyToMyio', coerceBool(attrs.tickets_only_to_myio)],
  ]);
  return Object.keys(tickets).length > 0 ? tickets : undefined;
}

function mapTemperature(attrs: TbAttributeSource): CustomerConfig['temperature'] | undefined {
  const temperature = assignDefined({} as NonNullable<CustomerConfig['temperature']>, [
    ['min', coerceNumber(attrs.minTemperature)],
    ['max', coerceNumber(attrs.maxTemperature)],
    ['clampMin', coerceNumber(attrs.temperatureClampMin)],
    ['clampMax', coerceNumber(attrs.temperatureClampMax)],
  ]);
  return Object.keys(temperature).length > 0 ? temperature : undefined;
}

function mapDisplay(attrs: TbAttributeSource): CustomerConfig['display'] | undefined {
  const display = assignDefined({} as NonNullable<CustomerConfig['display']>, [
    ['measurementDisplaySettings', attrs.measurementDisplaySettings],
    ['mapInstantaneousPower', attrs.mapInstantaneousPower],
  ]);
  return Object.keys(display).length > 0 ? display : undefined;
}

function mapDefaultDashboard(attrs: TbAttributeSource): CustomerConfig['defaultDashboard'] | undefined {
  const raw = attrs.customerDefaultDashboard;
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') return { id: raw, cfg: null };
  if (isPlainObject(raw)) {
    return { id: typeof raw.id === 'string' ? raw.id : null, cfg: raw.cfg ?? null };
  }
  return undefined;
}

function mapMetadata(attrs: TbAttributeSource): Record<string, unknown> {
  return assignDefined({} as Record<string, unknown>, [
    ['inaugurationDate', attrs.inauguration_date],
    ['obs', attrs.obs],
  ]);
}

/**
 * Map TB attributes to the writable GCDR config sections (DEC-2, non-secret).
 * Only keys actually present in the source are emitted, except `featureButtons`
 * which is always derived from `canShowDemandButtons` (including its unset
 * default) since the backfill's job is to establish that matrix.
 */
export function mapTbAttributesToConfig(attrs: TbAttributeSource): {
  config: Partial<CustomerConfig>;
  metadata: Record<string, unknown>;
} {
  const config: Partial<CustomerConfig> = {
    // featureButtons — always derived (DEC-3 / AC #11).
    featureButtons: mapCanShowDemandButtons(attrs.canShowDemandButtons),
  };

  const alarms = mapAlarms(attrs);
  if (alarms) config.alarms = alarms;
  const tickets = mapTickets(attrs);
  if (tickets) config.tickets = tickets;
  const temperature = mapTemperature(attrs);
  if (temperature) config.temperature = temperature;
  const display = mapDisplay(attrs);
  if (display) config.display = display;
  const defaultDashboard = mapDefaultDashboard(attrs);
  if (defaultDashboard) config.defaultDashboard = defaultDashboard;

  // classificationProfile (RFC-0207 opaque shape)
  if (attrs.deviceClassificationProfile !== undefined) {
    config.classificationProfile = attrs.deviceClassificationProfile;
  }

  // ingestion.clientId (secret client_secret handled elsewhere)
  if (typeof attrs.client_id === 'string' && attrs.client_id.length > 0) {
    config.ingestion = { clientId: attrs.client_id };
  }

  return { config, metadata: mapMetadata(attrs) };
}

// ---- deep merge + diff -------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge `patch` onto `base` (arrays/scalars replace; objects merge). */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

/** Path-level diff of leaf values between two objects. */
export function diffConfig(before: unknown, after: unknown, prefix = ''): ConfigDiffEntry[] {
  const out: ConfigDiffEntry[] = [];
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      out.push(...diffConfig(before[k], after[k], prefix ? `${prefix}.${k}` : k));
    }
    return out;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    out.push({ path: prefix, from: before, to: after });
  }
  return out;
}

export class CustomerConfigBackfillService {
  constructor(private readonly repo: CustomerRepository = customerRepository) {}

  /**
   * Backfill one customer from TB attributes. Idempotent: a successful apply
   * followed by a re-run produces `changed:false` with an empty diff.
   */
  async backfillCustomer(
    tenantId: string,
    customerId: string,
    attrs: TbAttributeSource,
    options: { dryRun?: boolean; actorId?: string } = {},
  ): Promise<BackfillResult> {
    const dryRun = options.dryRun ?? false;
    const customer = await this.repo.getById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundError(`Customer "${customerId}" not found`);
    }

    const { config: mapped, metadata: mappedMetadata } = mapTbAttributesToConfig(attrs);
    const existing = customer.config ?? {};
    const nextConfig = deepMerge(existing, mapped) as CustomerConfig;

    // Diff only over the config document + the mapped metadata keys.
    const diff = [
      ...diffConfig(existing, nextConfig, 'config'),
      ...diffConfig(
        pick(customer.metadata ?? {}, Object.keys(mappedMetadata)),
        mappedMetadata,
        'metadata',
      ),
    ];
    const changed = diff.length > 0;

    let applied = false;
    if (changed && !dryRun) {
      const payload = {
        config: nextConfig,
        ...(Object.keys(mappedMetadata).length > 0 ? { metadata: mappedMetadata } : {}),
      } as unknown as UpdateCustomerDTO;
      await this.repo.update(tenantId, customerId, payload, options.actorId ?? 'backfill');
      applied = true;
    }

    return { customerId, changed, applied, dryRun, diff };
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in obj) out[k] = obj[k];
  }
  return out;
}

export const customerConfigBackfillService = new CustomerConfigBackfillService();
