import { customerRepository, CustomerRepository } from '../repositories/CustomerRepository';
import {
  Customer,
  CustomerConfig,
  FeatureButtons,
  FeatureGroupFlags,
  createDefaultFeatureButtons,
} from '../domain/entities/Customer';
import { UpdateCustomerDTO } from '../dto/request/CustomerDTO';
import {
  CustomerConfigWriteDTO,
  CustomerConfigPatchDTO,
  CustomerConfigReadModel,
  CustomerConfigSecretsRevealed,
  SecretsWriteDTO,
  MASKED_SECRET,
} from '../dto/request/CustomerConfigDTO';
import { NotFoundError, ValidationError } from '../shared/errors/AppError';
import { encryptSecret, decryptSecret } from '../shared/utils/secretEnvelope';
import { logAuditEvent } from '../middleware/audit';
import { EventType, ActorType } from '../shared/types/audit.types';

// =============================================================================
// RFC-0057 — Customer Config Document (service)
//
// Assembles a normalized read model from customers.{settings,theme,config,
// metadata}, fills defaults (DEC-5) so nothing is ever undefined, and masks
// secrets. Writes go to customers.config (config sections) and customers.metadata
// (metadata), always preserving `bundle` and the at-rest secret envelopes
// (DEC-6/DEC-7). Secrets are written/read only through the dedicated secrets
// methods (secretEnvelope at rest). Every write emits an audit event (DEC-12).
// =============================================================================

export const CONFIG_VERSION = 1;

const DEFAULT_ALARMS = { notificationsEnabled: true, showOffline: false, showInternalSupport: false } as const;
const DEFAULT_TICKETS = { enabled: false, onlyToMyio: true } as const;
const DEFAULT_TEMPERATURE = { min: 18, max: 27, clampMin: 15, clampMax: 40 } as const;
const DEFAULT_METADATA = { inaugurationDate: null, obs: '' } as const;

export interface CustomerConfigActor {
  userId?: string;
  userEmail?: string;
  actorType?: ActorType;
  requestId?: string;
}

/** Returns dotted leaf paths of a nested plain object (for audit changedPaths). */
export function leafPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = leafPaths(value, path);
      out.push(...(nested.length > 0 ? nested : [path]));
    } else {
      out.push(path);
    }
  }
  return out;
}

/** Deep-merge a partial feature matrix onto a base, per group key (DEC-6). */
function mergeFeatureButtons(
  base: FeatureButtons,
  patch?: Partial<{ demandPeak: Partial<FeatureGroupFlags>; instantTelemetry: Partial<FeatureGroupFlags> }>,
): FeatureButtons {
  if (!patch) return base;
  return {
    demandPeak: { ...base.demandPeak, ...(patch.demandPeak ?? {}) },
    instantTelemetry: { ...base.instantTelemetry, ...(patch.instantTelemetry ?? {}) },
  };
}

export class CustomerConfigService {
  constructor(private readonly repo: CustomerRepository = customerRepository) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async getConfig(tenantId: string, customerId: string): Promise<CustomerConfigReadModel> {
    const customer = await this.mustGet(tenantId, customerId);
    return this.buildReadModel(customer);
  }

  // ---------------------------------------------------------------------------
  // Write — PUT (full replace of writable sections; omitted → default, DEC-9)
  // ---------------------------------------------------------------------------

  async putConfig(
    tenantId: string,
    customerId: string,
    dto: CustomerConfigWriteDTO,
    actor: CustomerConfigActor = {},
  ): Promise<CustomerConfigReadModel> {
    const customer = await this.mustGet(tenantId, customerId);
    const existing = customer.config ?? {};

    // Start from a blank writable config; carry over only bundle + at-rest
    // secrets. Any section the caller omits stays absent → read model returns
    // its default (that IS the "reset to default" semantics for PUT).
    const nextConfig: CustomerConfig = this.preserveNonWritable(existing);

    if (dto.featureButtons !== undefined) nextConfig.featureButtons = dto.featureButtons as FeatureButtons;
    if (dto.alarms !== undefined) nextConfig.alarms = dto.alarms;
    if (dto.tickets !== undefined) nextConfig.tickets = dto.tickets;
    if (dto.temperature !== undefined) nextConfig.temperature = dto.temperature;
    if (dto.display !== undefined) nextConfig.display = dto.display;
    if (dto.defaultDashboard !== undefined) nextConfig.defaultDashboard = dto.defaultDashboard;
    if (dto.classificationProfile !== undefined) nextConfig.classificationProfile = dto.classificationProfile;
    if (dto.ingestion?.clientId !== undefined) {
      nextConfig.ingestion = { ...(nextConfig.ingestion ?? {}), clientId: dto.ingestion.clientId };
    }

    const updated = await this.persist(tenantId, customerId, nextConfig, dto.metadata, actor);
    await this.emitConfigUpdated(tenantId, customerId, 'PUT', leafPaths(dto), actor);
    return this.buildReadModel(updated);
  }

  // ---------------------------------------------------------------------------
  // Write — PATCH (deep-merge; featureButtons per-group merge, DEC-6/DEC-9)
  // ---------------------------------------------------------------------------

  async patchConfig(
    tenantId: string,
    customerId: string,
    dto: CustomerConfigPatchDTO,
    actor: CustomerConfigActor = {},
  ): Promise<CustomerConfigReadModel> {
    const customer = await this.mustGet(tenantId, customerId);
    const existing = customer.config ?? {};
    const nextConfig: CustomerConfig = { ...existing };

    if (dto.featureButtons !== undefined) {
      const base = existing.featureButtons ?? createDefaultFeatureButtons();
      nextConfig.featureButtons = mergeFeatureButtons(base, dto.featureButtons);
    }
    if (dto.alarms !== undefined) nextConfig.alarms = { ...(existing.alarms ?? {}), ...dto.alarms };
    if (dto.tickets !== undefined) nextConfig.tickets = { ...(existing.tickets ?? {}), ...dto.tickets };
    if (dto.temperature !== undefined) nextConfig.temperature = { ...(existing.temperature ?? {}), ...dto.temperature };
    if (dto.display !== undefined) nextConfig.display = { ...(existing.display ?? {}), ...dto.display };
    if (dto.defaultDashboard !== undefined) {
      nextConfig.defaultDashboard = { ...(existing.defaultDashboard ?? {}), ...dto.defaultDashboard };
    }
    if (dto.classificationProfile !== undefined) nextConfig.classificationProfile = dto.classificationProfile;
    if (dto.ingestion?.clientId !== undefined) {
      nextConfig.ingestion = { ...(existing.ingestion ?? {}), clientId: dto.ingestion.clientId };
    }

    const updated = await this.persist(tenantId, customerId, nextConfig, dto.metadata, actor);
    await this.emitConfigUpdated(tenantId, customerId, 'PATCH', leafPaths(dto), actor);
    return this.buildReadModel(updated);
  }

  // ---------------------------------------------------------------------------
  // Write — DELETE (reset writable sections to defaults; preserve
  // settings/theme/bundle AND the at-rest secrets, DEC-9 / acceptance #10)
  // ---------------------------------------------------------------------------

  async deleteConfig(
    tenantId: string,
    customerId: string,
    actor: CustomerConfigActor = {},
  ): Promise<CustomerConfigReadModel> {
    const customer = await this.mustGet(tenantId, customerId);
    const existing = customer.config ?? {};

    // Only bundle + secrets survive; every non-secret writable section is
    // dropped so the read model returns defaults again.
    const nextConfig: CustomerConfig = this.preserveNonWritable(existing);

    const updated = await this.persist(tenantId, customerId, nextConfig, undefined, actor);
    await this.emitConfigUpdated(tenantId, customerId, 'DELETE', ['*'], actor);
    return this.buildReadModel(updated);
  }

  // ---------------------------------------------------------------------------
  // Secrets — reveal (audited) & write (envelope at rest), DEC-7
  // ---------------------------------------------------------------------------

  async getSecrets(
    tenantId: string,
    customerId: string,
    actor: CustomerConfigActor = {},
  ): Promise<CustomerConfigSecretsRevealed> {
    const customer = await this.mustGet(tenantId, customerId);
    const config = customer.config ?? {};

    const clientSecret = config.ingestion?.clientSecret;
    const masterAdminPassword = config.security?.masterAdminPassword;

    await this.emitSecretEvent(
      tenantId,
      customerId,
      EventType.CUSTOMER_CONFIG_SECRET_REVEALED,
      {
        fields: [
          ...(clientSecret ? ['ingestion.clientSecret'] : []),
          ...(masterAdminPassword ? ['security.masterAdminPassword'] : []),
        ],
      },
      actor,
    );

    return {
      ingestion: { clientSecret: clientSecret ? decryptSecret(clientSecret) : null },
      security: { masterAdminPassword: masterAdminPassword ? decryptSecret(masterAdminPassword) : null },
    };
  }

  async putSecrets(
    tenantId: string,
    customerId: string,
    body: SecretsWriteDTO,
    actor: CustomerConfigActor = {},
  ): Promise<CustomerConfigReadModel> {
    const customer = await this.mustGet(tenantId, customerId);
    const existing = customer.config ?? {};
    const nextConfig: CustomerConfig = { ...existing };
    const changed: string[] = [];

    if (body.ingestion && 'clientSecret' in body.ingestion) {
      const value = body.ingestion.clientSecret;
      // Defense in depth — the DTO already rejects the masked sentinel.
      if (value === MASKED_SECRET) {
        throw new ValidationError(`the masked value "${MASKED_SECRET}" cannot be persisted as a secret`);
      }
      const ingestion = { ...(nextConfig.ingestion ?? {}) };
      if (value === null) {
        delete ingestion.clientSecret;
      } else if (value !== undefined) {
        ingestion.clientSecret = encryptSecret(value);
      }
      nextConfig.ingestion = ingestion;
      changed.push('ingestion.clientSecret');
    }

    if (body.security && 'masterAdminPassword' in body.security) {
      const value = body.security.masterAdminPassword;
      if (value === MASKED_SECRET) {
        throw new ValidationError(`the masked value "${MASKED_SECRET}" cannot be persisted as a secret`);
      }
      const security = { ...(nextConfig.security ?? {}) };
      if (value === null) {
        delete security.masterAdminPassword;
      } else if (value !== undefined) {
        security.masterAdminPassword = encryptSecret(value);
      }
      nextConfig.security = security;
      changed.push('security.masterAdminPassword');
    }

    const updated = await this.persist(tenantId, customerId, nextConfig, undefined, actor);
    await this.emitSecretEvent(
      tenantId,
      customerId,
      EventType.CUSTOMER_CONFIG_SECRET_UPDATED,
      { changedPaths: changed },
      actor,
    );
    return this.buildReadModel(updated);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async mustGet(tenantId: string, customerId: string): Promise<Customer> {
    const customer = await this.repo.getById(tenantId, customerId);
    if (!customer) {
      // 404 (not 403) for unknown OR cross-tenant — no existence oracle (DEC-8).
      throw new NotFoundError(`Customer "${customerId}" not found`);
    }
    return customer;
  }

  /** Keep only the sections the /config write path must never clobber. */
  private preserveNonWritable(existing: CustomerConfig): CustomerConfig {
    const preserved: CustomerConfig = {};
    if (existing.bundle !== undefined) preserved.bundle = existing.bundle;
    if (existing.ingestion?.clientSecret !== undefined) {
      preserved.ingestion = { clientSecret: existing.ingestion.clientSecret };
    }
    if (existing.security?.masterAdminPassword !== undefined) {
      preserved.security = { masterAdminPassword: existing.security.masterAdminPassword };
    }
    return preserved;
  }

  private async persist(
    tenantId: string,
    customerId: string,
    config: CustomerConfig,
    metadata: Record<string, unknown> | undefined,
    actor: CustomerConfigActor,
  ): Promise<Customer> {
    const payload = { config, ...(metadata !== undefined ? { metadata } : {}) } as unknown as UpdateCustomerDTO;
    return this.repo.update(tenantId, customerId, payload, actor.userId ?? 'system');
  }

  private buildReadModel(customer: Customer): CustomerConfigReadModel {
    const config = customer.config ?? {};
    const settings = customer.settings;
    const theme = customer.theme;

    return {
      version: CONFIG_VERSION,
      featureButtons: mergeFeatureButtons(createDefaultFeatureButtons(), config.featureButtons),
      alarms: { ...DEFAULT_ALARMS, ...(config.alarms ?? {}) },
      tickets: { ...DEFAULT_TICKETS, ...(config.tickets ?? {}) },
      temperature: { ...DEFAULT_TEMPERATURE, ...(config.temperature ?? {}) },
      display: {
        measurementDisplaySettings: config.display?.measurementDisplaySettings ?? null,
        mapInstantaneousPower: config.display?.mapInstantaneousPower ?? null,
      },
      defaultDashboard: {
        id: config.defaultDashboard?.id ?? null,
        cfg: config.defaultDashboard?.cfg ?? null,
      },
      classificationProfile: config.classificationProfile ?? null,
      locale: {
        timezone: settings?.timezone ?? 'America/Sao_Paulo',
        locale: settings?.locale ?? 'pt-BR',
        currency: settings?.currency ?? 'BRL',
      },
      theme: {
        primaryColor: theme?.primaryColor ?? null,
        secondaryColor: theme?.secondaryColor ?? null,
      },
      // Secrets are ALWAYS masked here — never round-trip real material (DEC-7).
      ingestion: { clientId: config.ingestion?.clientId ?? null, clientSecret: MASKED_SECRET },
      security: { masterAdminPassword: MASKED_SECRET },
      metadata: { ...DEFAULT_METADATA, ...(customer.metadata ?? {}) },
    };
  }

  private async emitConfigUpdated(
    tenantId: string,
    customerId: string,
    method: 'PUT' | 'PATCH' | 'DELETE',
    changedPaths: string[],
    actor: CustomerConfigActor,
  ): Promise<void> {
    await this.emit(tenantId, customerId, EventType.CUSTOMER_CONFIG_UPDATED, actor, {
      method,
      version: CONFIG_VERSION,
      changedPaths,
    });
  }

  private async emitSecretEvent(
    tenantId: string,
    customerId: string,
    eventType: EventType,
    metadata: Record<string, unknown>,
    actor: CustomerConfigActor,
  ): Promise<void> {
    // Secret values are NEVER included in the metadata passed here.
    await this.emit(tenantId, customerId, eventType, actor, metadata);
  }

  private async emit(
    tenantId: string,
    customerId: string,
    eventType: EventType,
    actor: CustomerConfigActor,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await logAuditEvent(tenantId, eventType, {
        entityType: 'customer.config',
        entityId: customerId,
        customerId,
        userId: actor.userId,
        userEmail: actor.userEmail,
        actorType: actor.actorType ?? ActorType.SYSTEM,
        description: `${eventType} ${customerId}`,
        metadata,
        requestId: actor.requestId,
      });
    } catch (err) {
      // Audit failures must never break the write path.
      // eslint-disable-next-line no-console
      console.error('[CustomerConfigService] audit emit failed:', (err as Error)?.message);
    }
  }
}

export const customerConfigService = new CustomerConfigService();
