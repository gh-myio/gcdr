import {
  customerIntegrationRepository,
  CustomerIntegrationRepository,
} from '../repositories/CustomerIntegrationRepository';
import {
  IntegrationStateSchema,
  CentralsIntegrationStateSchema,
  CentralEntrySchema,
  RecordSyncInput,
  IntegrationState,
  CentralsIntegrationState,
  CentralEntry,
  stripCredentialsForAudit,
} from '../dto/request/CustomerIntegrationDTO';
import { IntegrationKey } from '../domain/integrations/IntegrationKey';
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
