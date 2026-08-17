import { customerApiKeyService } from './CustomerApiKeyService';
import { centralRepository } from '../repositories/CentralRepository';
import { consumeIfAllowed } from '../middleware/rateLimit';
import { logAuditEvent } from '../middleware/audit';
import { EventType, ActorType } from '../shared/types/audit.types';
import { AppError, ConflictError } from '../shared/errors/AppError';
import { ApiKeyScope } from '../domain/entities/CustomerApiKey';
import { CreateCustomerApiKeyDTO } from '../dto/request/CustomerApiKeyDTO';
import { CentralBootstrapIdentity } from '../middleware/centralPreKeyAuth';
 
// =============================================================================
// RFC-0056 — Central API Key Bootstrap: TOFU mint/reveal of the INITIAL key.
//
// DEC-4: each central carries `centrals.config.provisioningState`
// (`awaiting_provisioning` → `provisioned`). While `awaiting_provisioning`,
// this service mints the INITIAL key on the first call and idempotently
// reveals the SAME cached key on every subsequent call (tolerates firmware
// retries). Once `provisioned` (a full CENTRAL_API_KEY has been bound —
// DEC-6), it is reset-gated: `getOrCreateInitialKey` throws ConflictError
// (409) until an explicit operator reset (see centrals.controller.ts
// `POST /:id/reset-provisioning`) reopens the window.
//
// DEC-8: the INITIAL key is minted under a fixed owner — customer
// CENTRAL_INITIAL_KEY_CUSTOMER_ID (default MYIO), tenant DEFAULT_TENANT_ID
// (the same env-var-with-fallback pattern auth.ts already uses for the
// master-API-key / DISABLE_AUTH dev-bypass default tenant — RFC-0056 doesn't
// define a separate tenant env var, and this repo already treats
// DEFAULT_TENANT_ID as "the" tenant when one isn't otherwise supplied).
// =============================================================================
 
const DEFAULT_TENANT_ID_FALLBACK = '11111111-1111-1111-1111-111111111111';
const CENTRAL_INITIAL_KEY_CUSTOMER_ID_FALLBACK = '56614a70-326f-11ef-ad2c-53aeabe7d3fa';
// All-zero UUID sentinel for system-initiated writes with no human actor —
// same convention as simulator-admin.controller.ts's `effectiveUserId` fallback.
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';
 
// Typed against the DTO's (narrower, Zod-derived) scopes type — not the
// domain ApiKeyScope union, which is a superset (also covers simulator:*) and
// isn't directly assignable into CreateCustomerApiKeyDTO['scopes']. Still
// assignable to ApiKeyScope[] on the way out (BootstrapResult.scopes) since
// that's a widening, not a narrowing.
const INITIAL_KEY_SCOPES: CreateCustomerApiKeyDTO['scopes'] = [
  'central-state:read',
  'central-environment:read',
  'central-environment:write',
];
 
// DEC-5 "successful reveal count per uuid" — conservative pre-check, consumed
// BEFORE we know whether this call will end up minting/revealing successfully,
// trading a little precision (a call that later 409s still spends budget) for
// avoiding unnecessary DB round-trips under abuse. Documented as a deliberate
// simplification in RFC-0056 v5.
const REVEAL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const REVEAL_MAX_PER_UUID = 5;
 
// Exported so centrals.controller.ts's reset-provisioning route (which
// revokes keys minted under this same fixed tenant/customer, not the
// central's own tenant) can address them without duplicating the fallback.
export function defaultTenantId(): string {
  return process.env.DEFAULT_TENANT_ID || DEFAULT_TENANT_ID_FALLBACK;
}
 
export function initialKeyCustomerId(): string {
  return process.env.CENTRAL_INITIAL_KEY_CUSTOMER_ID || CENTRAL_INITIAL_KEY_CUSTOMER_ID_FALLBACK;
}
 
export interface BootstrapResult {
  apiKey: string;
  scopes: ApiKeyScope[];
  customerId: string;
  cached: boolean;
}
 
export class CentralInitialKeyService {
  /**
   * Mint (first call) or idempotently reveal (subsequent calls) the
   * per-central INITIAL key, while the central is `awaiting_provisioning`.
   * `central` is the identity already resolved by `centralPreKeyAuth`.
   */
  async getOrCreateInitialKey(
    uuid: string,
    central: CentralBootstrapIdentity,
    clientIp: string,
  ): Promise<BootstrapResult> {
    const revealCheck = consumeIfAllowed('central-bootstrap-reveal', uuid, {
      windowMs: REVEAL_WINDOW_MS,
      max: REVEAL_MAX_PER_UUID,
    });
    if (!revealCheck.allowed) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many bootstrap reveals for this central; wait before retrying',
        429,
      );
    }
 
    const provisioningState = (central.config.provisioningState as string | undefined)
      ?? 'awaiting_provisioning';
 
    if (provisioningState === 'provisioned') {
      await this.audit(EventType.CENTRAL_BOOTSTRAP_FAILED, central, uuid, clientIp, {
        reason: 'already_provisioned',
      });
      throw new ConflictError('Central already provisioned; bootstrap window closed');
    }
 
    const cachedKeyId = central.config.centralInitialApiKeyId as string | undefined;
 
    if (cachedKeyId) {
      const plaintextKey = await customerApiKeyService.revealApiKey(defaultTenantId(), cachedKeyId);
      await this.audit(EventType.CENTRAL_BOOTSTRAP_ISSUED, central, uuid, clientIp, { cached: true });
      return {
        apiKey: plaintextKey,
        scopes: INITIAL_KEY_SCOPES,
        customerId: initialKeyCustomerId(),
        cached: true,
      };
    }
 
    const { plaintextKey, apiKey } = await customerApiKeyService.createApiKey(
      defaultTenantId(),
      initialKeyCustomerId(),
      {
        name: `Central Initial Key — ${uuid}`,
        scopes: INITIAL_KEY_SCOPES,
        hierarchyAccess: 'SELF',
      },
      SYSTEM_ACTOR_ID,
    );
 
    await centralRepository.patchConfig(central.tenantId, central.centralId, {
      provisioningState: 'awaiting_provisioning',
      centralInitialApiKeyId: apiKey.id,
    });
 
    await this.audit(EventType.CENTRAL_BOOTSTRAP_ISSUED, central, uuid, clientIp, { cached: false });
 
    return {
      apiKey: plaintextKey,
      scopes: INITIAL_KEY_SCOPES,
      customerId: initialKeyCustomerId(),
      cached: false,
    };
  }
 
  /** DEC-5: audit carries IP/uuid/outcome — never plaintext. */
  private async audit(
    eventType: EventType,
    central: CentralBootstrapIdentity,
    uuid: string,
    clientIp: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await logAuditEvent(central.tenantId, eventType, {
      entityType: 'central',
      entityId: central.centralId,
      actorType: ActorType.SYSTEM,
      description: `Bootstrap ${eventType === EventType.CENTRAL_BOOTSTRAP_ISSUED ? 'succeeded' : 'failed'} for central ${uuid}`,
      metadata: { uuid, ip: clientIp, ...metadata },
    });
  }
}
 
export const centralInitialKeyService = new CentralInitialKeyService();
 