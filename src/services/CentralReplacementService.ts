// =============================================================================
// RFC-0005: Gateway (Central) Hardware Replacement — service layer
// =============================================================================
//
// Thin orchestration over CentralReplacementRepository.replace(), which owns
// the single database transaction (lock → validate → archive → create →
// repoint → ledger event). This layer holds the input-shape invariants that
// need no database, so they are unit-testable with a mocked repository.

import {
  ReplaceCentralDTO,
  ReplaceCentralResult,
} from '../dto/request/CentralReplacementDTO';
import {
  CentralReplacementRepository,
  ReplaceActorContext,
  ReplaceOutcome,
  centralReplacementRepository,
} from '../repositories/CentralReplacementRepository';
import { ValidationError } from '../shared/errors/AppError';
import { alarmBundleService, InvalidationMeta } from './AlarmBundleService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BundleCacheInvalidator = (tenantId: string, customerId: string, meta: InvalidationMeta) => void;

export class CentralReplacementService {
  private repository: Pick<CentralReplacementRepository, 'replace'>;
  private invalidateBundleCache: BundleCacheInvalidator;

  constructor(
    repository?: Pick<CentralReplacementRepository, 'replace'>,
    invalidateBundleCache?: BundleCacheInvalidator,
  ) {
    this.repository = repository ?? centralReplacementRepository;
    this.invalidateBundleCache =
      invalidateBundleCache ?? ((t, c, m) => alarmBundleService.invalidateCache(t, c, m));
  }

  /**
   * Replace the central's hardware identity. Returns the RFC-0005 response;
   * idempotent on `replacementId` (a repeat call with the same id and same
   * old→new pair replays the stored result without redoing any work).
   */
  async replace(
    tenantId: string,
    oldUuid: string,
    data: ReplaceCentralDTO,
    actor: ReplaceActorContext,
  ): Promise<ReplaceCentralResult> {
    if (!UUID_REGEX.test(oldUuid)) {
      throw new ValidationError('oldUuid path parameter must be a valid UUID');
    }
    if (oldUuid.toLowerCase() === data.newUuid.toLowerCase()) {
      throw new ValidationError('newUuid must differ from the central being replaced');
    }

    const outcome: ReplaceOutcome = await this.repository.replace(tenantId, oldUuid, data, actor);

    // RFC-0065: the devices were repointed to the new central inside the
    // (already committed) transaction, so any cached alarm bundle still carries
    // the OLD centralId until its TTL expires. A replay changed nothing.
    if (!outcome.replayed) {
      this.invalidateBundleCache(tenantId, outcome.result.newCentral.customerId, {
        reason: 'central_replaced',
        entityType: 'central',
        entityId: outcome.result.newCentral.id,
        userId: actor.userId,
      });
    }
    return outcome.result;
  }
}

export const centralReplacementService = new CentralReplacementService();
