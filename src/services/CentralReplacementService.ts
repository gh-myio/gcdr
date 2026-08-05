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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CentralReplacementService {
  private repository: Pick<CentralReplacementRepository, 'replace'>;

  constructor(repository?: Pick<CentralReplacementRepository, 'replace'>) {
    this.repository = repository ?? centralReplacementRepository;
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
    return outcome.result;
  }
}

export const centralReplacementService = new CentralReplacementService();
