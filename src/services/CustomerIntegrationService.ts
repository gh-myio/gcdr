import {
  customerIntegrationRepository,
  CustomerIntegrationRepository,
} from '../repositories/CustomerIntegrationRepository';
import {
  IntegrationStateSchema,
  CentralsIntegrationStateSchema,
  CentralEntrySchema,
  RecordSyncInput,
  ReplaceCentralsItemsInput,
  IntegrationState,
  CentralsIntegrationState,
  CentralEntry,
  stripCredentialsForAudit,
} from '../dto/request/CustomerIntegrationDTO';
import { NotFoundError } from '../shared/errors/AppError';
import { IntegrationKey } from '../domain/integrations/IntegrationKey';
import { CentralMqttIntegrationId } from '../domain/integrations/CentralMqttIntegrationId';
import { logAuditEvent } from '../middleware/audit';
import { EventType, ActorType } from '../shared/types/audit.types';

// =============================================================================
// RFC-0033 — Customer Integration Sync State (service)
// =============================================================================

export interface CustomerIntegrationActor {
  userId?: string;
  userEmail?: string;
  actorType?: ActorType;
  requestId?: string;
}

const EMPTY_STATE: IntegrationState = {
  status:        'IDLE',
  version:       null,
  lastSyncAt:    null,
  lastSuccessAt: null,
  lastError:     null,
  syncCount:     0,
  failureCount:  0,
  payload:       {},
};

function emptyStateForKey(key: IntegrationKey): IntegrationState | CentralsIntegrationState {
  if (key === 'centrals') {
    return { ...EMPTY_STATE, items: [] as CentralEntry[] };
  }
  return { ...EMPTY_STATE };
}

function parseExistingState(
  key: IntegrationKey,
  raw: Record<string, unknown> | null,
): IntegrationState | CentralsIntegrationState {
  if (!raw) return emptyStateForKey(key);
  if (key === 'centrals') {
    return CentralsIntegrationStateSchema.parse(raw);
  }
  return IntegrationStateSchema.parse(raw);
}

export class CustomerIntegrationService {
  constructor(private readonly repo: CustomerIntegrationRepository = customerIntegrationRepository) {}

  /**
   * Read the full integrations map for one customer. Returns the raw
   * map (no masking applied) — the controller is responsible for
   * applying read masking before serialising.
   */
  async list(tenantId: string, customerId: string): Promise<Record<string, unknown>> {
    const row = await this.repo.getAll(tenantId, customerId);
    return row.integrations;
  }

  /**
   * Read one integration's state. Returns null when the key is absent.
   */
  async get(
    tenantId: string,
    customerId: string,
    key: IntegrationKey,
  ): Promise<IntegrationState | CentralsIntegrationState | null> {
    const raw = await this.repo.getOne(tenantId, customerId, key);
    if (!raw) return null;
    return parseExistingState(key, raw);
  }

  /**
   * Append a sync event. Updates the live state per RFC-0033 §6 table
   * and emits one CUSTOMER_INTEGRATION_SYNC audit row whose metadata
   * carries the input minus any plaintext credentials.
   */
  async recordSync(
    tenantId: string,
    customerId: string,
    key: IntegrationKey,
    input: RecordSyncInput,
    actor: CustomerIntegrationActor = {},
  ): Promise<IntegrationState | CentralsIntegrationState> {
    const previous = parseExistingState(key, await this.repo.getOne(tenantId, customerId, key));

    const nowIso = new Date().toISOString();
    const isOk    = input.status === 'OK';
    const isFail  = input.status === 'FAILED' || input.status === 'DEGRADED';

    const next: IntegrationState | CentralsIntegrationState = {
      ...previous,
      status:        input.status,
      version:       input.version !== undefined ? input.version : previous.version,
      lastSyncAt:    nowIso,
      lastSuccessAt: isOk ? nowIso : previous.lastSuccessAt,
      lastError:     isFail
        ? (input.error ?? previous.lastError ?? 'unknown error')
        : (isOk ? null : previous.lastError),
      syncCount:     previous.syncCount + 1,
      failureCount:  isOk ? 0 : (isFail ? previous.failureCount + 1 : previous.failureCount),
      payload:       input.payload !== undefined ? input.payload : previous.payload,
    };

    // The `centrals` integration also accepts a full replacement of the
    // items[] array. Each entry is validated via Zod (so a malformed
    // entry rejects the whole call) and the password is held verbatim
    // in JSONB — that risk is acknowledged in RFC-0033 Security.
    if (key === 'centrals') {
      const incomingItems = input.items;
      if (incomingItems !== undefined) {
        (next as CentralsIntegrationState).items = incomingItems.map((e) =>
          CentralEntrySchema.parse(e),
        );
      } else if ((next as CentralsIntegrationState).items === undefined) {
        (next as CentralsIntegrationState).items = (previous as CentralsIntegrationState).items ?? [];
      }
    }

    await this.repo.setIntegration(tenantId, customerId, key, next as unknown as Record<string, unknown>);

    await this.emitAudit(tenantId, customerId, key, EventType.CUSTOMER_INTEGRATION_SYNC, actor, {
      status:    input.status,
      version:   input.version,
      actor:     input.actor,
      note:      input.note,
      // strip mqttPassword from any items that ride along — audit log
      // must NEVER carry the plaintext credential.
      next:      stripCredentialsForAudit(key, next),
      previousVersion: previous.version,
    });

    return next;
  }

  /**
   * Mark an integration DISABLED. Does not clear payload or items.
   */
  async disable(
    tenantId: string,
    customerId: string,
    key: IntegrationKey,
    actor: CustomerIntegrationActor & { actorLabel: string; note?: string },
  ): Promise<IntegrationState | CentralsIntegrationState> {
    const previous = parseExistingState(key, await this.repo.getOne(tenantId, customerId, key));

    const next = { ...previous, status: 'DISABLED' as const, lastSyncAt: new Date().toISOString() };
    await this.repo.setIntegration(tenantId, customerId, key, next as unknown as Record<string, unknown>);

    await this.emitAudit(tenantId, customerId, key, EventType.CUSTOMER_INTEGRATION_DISABLED, actor, {
      actor:    actor.actorLabel,
      note:     actor.note,
      previous: stripCredentialsForAudit(key, previous),
    });

    return next;
  }

  /**
   * Admin replacement of `centrals.items[]` (RFC-0035 shape). Each entry
   * is keyed by uuid; the per-integration password map is merged per-id:
   *   - id present with non-empty value  → overwrites stored value
   *   - id present with empty value      → keeps stored value
   *   - id missing                       → keeps stored value
   * (To remove a password entirely use `DELETE /centrals/:id/mqtt-passwords/:integrationId`.)
   */
  async replaceCentralsItems(
    tenantId: string,
    customerId: string,
    input: ReplaceCentralsItemsInput,
    actor: CustomerIntegrationActor & { actorLabel: string },
  ): Promise<CentralsIntegrationState> {
    const raw = await this.repo.getOne(tenantId, customerId, 'centrals');
    const previous = parseExistingState('centrals', raw) as CentralsIntegrationState;

    const previousByUuid = new Map(previous.items.map((e) => [e.uuid, e]));

    const mergedItems: CentralEntry[] = input.items.map((incoming) => {
      const existing = previousByUuid.get(incoming.uuid);
      const existingPwds = existing?.mqttPasswords ?? {};
      const mergedPwds: Record<string, string> = { ...existingPwds };

      for (const [id, value] of Object.entries(incoming.mqttPasswords ?? {})) {
        if (typeof value === 'string' && value.length > 0) {
          mergedPwds[id] = value;
        }
        // empty string or missing → keep stored
      }

      return CentralEntrySchema.parse({
        uuid:          incoming.uuid,
        mqttPasswords: mergedPwds,
      });
    });

    const next: CentralsIntegrationState = {
      ...previous,
      items: mergedItems,
    };

    await this.repo.setIntegration(
      tenantId,
      customerId,
      'centrals',
      next as unknown as Record<string, unknown>,
    );

    await this.emitAudit(
      tenantId,
      customerId,
      'centrals',
      EventType.CUSTOMER_INTEGRATION_ITEMS_UPDATED,
      actor,
      {
        actor:           actor.actorLabel,
        note:            input.note,
        itemsCount:      mergedItems.length,
        previousCount:   previous.items.length,
        // Both snapshots have credentials stripped — audit never carries plaintext.
        previous:        stripCredentialsForAudit('centrals', previous),
        next:            stripCredentialsForAudit('centrals', next),
      },
    );

    return next;
  }

  /**
   * Set or clear one (uuid, integrationId) password. Used by RFC-0035
   * `PUT/DELETE /centrals/:id/mqtt-passwords/:integrationId`.
   * `password = undefined` clears the key entirely; non-empty string sets it.
   * Creates the items[] entry if absent for the given uuid.
   */
  async upsertCentralPassword(
    tenantId: string,
    customerId: string,
    centralUuid: string,
    integrationId: CentralMqttIntegrationId,
    password: string | undefined,
    actor: CustomerIntegrationActor & { actorLabel: string },
  ): Promise<CentralEntry> {
    const raw = await this.repo.getOne(tenantId, customerId, 'centrals');
    const state = parseExistingState('centrals', raw) as CentralsIntegrationState;

    const idx = state.items.findIndex((e) => e.uuid === centralUuid);
    const existing = idx >= 0 ? state.items[idx]! : { uuid: centralUuid, mqttPasswords: {} as Record<string, string> };

    const mergedPwds: Record<string, string> = { ...(existing.mqttPasswords ?? {}) };
    if (typeof password === 'string' && password.length > 0) {
      mergedPwds[integrationId] = password;
    } else {
      delete mergedPwds[integrationId];
    }

    const merged: CentralEntry = CentralEntrySchema.parse({
      uuid:          centralUuid,
      mqttPasswords: mergedPwds,
    });

    const nextItems = [...state.items];
    if (idx >= 0) {
      nextItems[idx] = merged;
    } else {
      nextItems.push(merged);
    }
    const next: CentralsIntegrationState = { ...state, items: nextItems };

    await this.repo.setIntegration(
      tenantId,
      customerId,
      'centrals',
      next as unknown as Record<string, unknown>,
    );

    await this.emitAudit(
      tenantId,
      customerId,
      'centrals',
      EventType.CUSTOMER_INTEGRATION_ITEMS_UPDATED,
      actor,
      {
        actor:           actor.actorLabel,
        itemUuid:        centralUuid,
        integrationId,
        operation:       (typeof password === 'string' && password.length > 0) ? 'set' : 'clear',
      },
    );

    return merged;
  }

  /**
   * Reveal one (uuid, integrationId) plaintext MQTT password. Sensitive
   * operation — emits an audit event on every call, tagged with integrationId
   * so abuse is traceable per integration. Throws NotFoundError if neither
   * the entry nor the integration password exists.
   */
  async revealCentralPassword(
    tenantId: string,
    customerId: string,
    itemUuid: string,
    integrationId: CentralMqttIntegrationId,
    actor: CustomerIntegrationActor & { actorLabel: string },
  ): Promise<{ password: string }> {
    const raw = await this.repo.getOne(tenantId, customerId, 'centrals');
    const state = parseExistingState('centrals', raw) as CentralsIntegrationState;

    const item = state.items.find((e) => e.uuid === itemUuid);
    if (!item) {
      throw new NotFoundError(
        `Central item ${itemUuid} not found in customer ${customerId}`,
      );
    }
    const password = item.mqttPasswords?.[integrationId];
    if (typeof password !== 'string' || password.length === 0) {
      throw new NotFoundError(
        `No "${integrationId}" password configured for central ${itemUuid} in customer ${customerId}`,
      );
    }

    await this.emitAudit(
      tenantId,
      customerId,
      'centrals',
      EventType.CUSTOMER_INTEGRATION_CREDENTIALS_REVEALED,
      actor,
      {
        actor:    actor.actorLabel,
        itemUuid,
        integrationId,
        // Audit MUST NOT carry the plaintext value.
      },
    );

    return { password };
  }

  /**
   * Remove the integration's state entirely (back to "never synchronised").
   * The audit row preserves the previous state for forensic recovery
   * (with credentials stripped).
   */
  async reset(
    tenantId: string,
    customerId: string,
    key: IntegrationKey,
    actor: CustomerIntegrationActor & { actorLabel: string },
  ): Promise<void> {
    const previous = parseExistingState(key, await this.repo.getOne(tenantId, customerId, key));

    await this.repo.clearIntegration(tenantId, customerId, key);

    await this.emitAudit(tenantId, customerId, key, EventType.CUSTOMER_INTEGRATION_RESET, actor, {
      actor:    actor.actorLabel,
      previous: stripCredentialsForAudit(key, previous),
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async emitAudit(
    tenantId: string,
    customerId: string,
    key: IntegrationKey,
    eventType: EventType,
    actor: CustomerIntegrationActor,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await logAuditEvent(tenantId, eventType, {
        entityType: 'customer.integration',
        entityId:   `${customerId}:${key}`,
        customerId,
        userId:     actor.userId,
        userEmail:  actor.userEmail,
        actorType:  actor.actorType ?? ActorType.SYSTEM,
        description: `${eventType} ${customerId}:${key}`,
        metadata,
        requestId:  actor.requestId,
      });
    } catch (err) {
      // Audit failures must never break the write path. The audit
      // middleware itself logs the cause; we just swallow here.
      // eslint-disable-next-line no-console
      console.error('[CustomerIntegrationService] audit emit failed:', (err as Error)?.message);
    }
  }
}

export const customerIntegrationService = new CustomerIntegrationService();
