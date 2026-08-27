// =============================================================================
// RFC-0061 M8 — Push-outbox drain worker (DEC-6/W3).
//
// The domain services (M6 today; M7 install toggles are a standing wave-3
// follow-up — no enqueue points landed with M7) enqueue
// inv_external_push_outbox rows in the SAME transaction as the domain write.
// This worker drains them:
//
//   - CLAIM: `SELECT … FOR UPDATE SKIP LOCKED` (InventoryExternalRepository.
//     claimOutboxBatchQuery) — safe under side-by-side instances during
//     Dokploy deploys — with per-QR FIFO: a row is only eligible when NO older
//     live row shares any of its qr_codes, so a backoff on "tecnico" can never
//     let a later "cliente" push overtake it.
//   - DISPATCH: one PATCH /api/public/products/:code per code. Enqueue points
//     already expand boxes into unit QRs (M6 resolves box scans to unit values
//     before enqueueing), but the worker defensively re-expands any code that
//     is a registered BOX QR via the M5 repos. The PATCH body always carries
//     location/technician/client_name (nulls included, clearing stale values);
//     the row's `status` column is the OUTBOX lifecycle (PENDING/FAILED/DONE),
//     not the product status.
//   - RESULT: full success → DONE + dispatched_at. Any failure → FAILED,
//     attempts+1, exponential backoff (30s · 2^(attempts−1), capped 15 min).
//     After OUTBOX_MAX_ATTEMPTS (6) the row is DEAD-LETTERED: next_attempt_at
//     NULL, keeps last_error, stops draining AND stops blocking its QRs (the
//     pull-sync reconciliation is the safety net; a younger push for the same
//     QR carries newer state anyway).
//
// Rows stay locked while the PATCHes run (claim tx = drain tx) — accepted
// trade-off: batches are small, the platform timeout is bounded, and SKIP
// LOCKED means a concurrent drainer simply claims other rows.
// =============================================================================

import {
  InventoryExternalRepository,
  inventoryExternalRepository,
  InvExternalPushOutboxRow,
  OUTBOX_MAX_ATTEMPTS,
} from '../../repositories/inventory/InventoryExternalRepository';
import {
  InventoryHomologationRepository,
  inventoryHomologationRepository,
} from '../../repositories/inventory/InventoryHomologationRepository';
import { ExternalPlatformClient, externalPlatformClientFromEnv } from './ExternalPlatformClient';
import { normalizeQrInput } from './InventoryQrService';

export const OUTBOX_BATCH_SIZE = 20;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;

/** Exponential backoff for the Nth failed attempt (1-based). */
export function outboxBackoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
}

export interface DrainResult {
  claimed: number;
  dispatched: number;
  failed: number;
  dead: number;
}

export type IOutboxRepository = Pick<
  InventoryExternalRepository,
  'withTransaction' | 'claimOutboxBatch' | 'markOutboxDispatched' | 'markOutboxFailed'
>;

export type IOutboxHomologRepository = Pick<
  InventoryHomologationRepository,
  'findRegistryByValues' | 'findBoxesByQrValues' | 'unitsByHomologationIds'
>;

export interface InventoryOutboxWorkerDeps {
  repository?: IOutboxRepository;
  homologRepository?: IOutboxHomologRepository;
  clientProvider?: () => ExternalPlatformClient | null;
  now?: () => Date;
}

/** Unwrap DrizzleQueryError — real SQLSTATE/message live in err.cause. */
function errMessage(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause;
  if (cause instanceof Error && cause.message) return cause.message;
  return err instanceof Error ? err.message : String(err);
}

export class InventoryOutboxWorker {
  private repository: IOutboxRepository;
  private homologRepository: IOutboxHomologRepository;
  private clientProvider: () => ExternalPlatformClient | null;
  private now: () => Date;

  constructor(deps: InventoryOutboxWorkerDeps = {}) {
    this.repository = deps.repository ?? inventoryExternalRepository;
    this.homologRepository = deps.homologRepository ?? inventoryHomologationRepository;
    this.clientProvider = deps.clientProvider ?? externalPlatformClientFromEnv;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * One drain pass: claim a batch (SKIP LOCKED + per-QR FIFO) and dispatch it.
   * No-op when the external client is not configured.
   */
  async drainOnce(batchSize: number = OUTBOX_BATCH_SIZE): Promise<DrainResult> {
    const result: DrainResult = { claimed: 0, dispatched: 0, failed: 0, dead: 0 };
    const client = this.clientProvider();
    if (!client) return result;

    await this.repository.withTransaction(async (tx) => {
      const rows = await this.repository.claimOutboxBatch(batchSize, tx);
      result.claimed = rows.length;

      for (const row of rows) {
        try {
          const codes = await this.expandCodes(row);
          for (const code of codes) {
            await client.patchProduct(code, {
              location: row.location ?? undefined,
              technician: row.technician,
              client_name: row.clientName,
            });
          }
          await this.repository.markOutboxDispatched([row.id], tx);
          result.dispatched += 1;
        } catch (err) {
          const attempts = row.attempts + 1;
          const dead = attempts >= OUTBOX_MAX_ATTEMPTS;
          const nextAttemptAt = dead ? null : new Date(this.now().getTime() + outboxBackoffMs(attempts));
          await this.repository.markOutboxFailed(row.id, attempts, nextAttemptAt, errMessage(err), tx);
          if (dead) {
            result.dead += 1;
            // eslint-disable-next-line no-console -- operators need the dead letter
            console.error(
              `[inv-outbox] linha ${row.id} morta após ${attempts} tentativas: ${errMessage(err)}`,
            );
          } else {
            result.failed += 1;
          }
        }
      }
    });

    return result;
  }

  /**
   * Bare PATCH codes for one outbox row. Enqueued values are unit QR
   * spellings (bare or full URL); a value registered as a BOX QR is expanded
   * to its units' codes (defensive — M6 already expands at enqueue time).
   */
  private async expandCodes(row: InvExternalPushOutboxRow): Promise<string[]> {
    const normalized = row.qrCodes.map((qr) => normalizeQrInput(qr));
    const allCandidates = [...new Set(normalized.flatMap((n) => n.candidates))];
    const registry = await this.homologRepository.findRegistryByValues(row.tenantId, allCandidates);
    const boxValues = new Set(registry.filter((r) => r.kind === 'BOX').map((r) => r.qrValue));

    const codes = new Set<string>();
    const boxCandidates: string[] = [];
    for (const n of normalized) {
      if (n.candidates.some((c) => boxValues.has(c))) {
        boxCandidates.push(...n.candidates);
      } else {
        codes.add(n.code);
      }
    }

    if (boxCandidates.length > 0) {
      const boxes = await this.homologRepository.findBoxesByQrValues(row.tenantId, boxCandidates);
      const units = await this.homologRepository.unitsByHomologationIds(
        row.tenantId,
        boxes.map((b) => b.id),
      );
      for (const u of units) codes.add(normalizeQrInput(u.qrValue).code);
    }

    return [...codes];
  }
}

export const inventoryOutboxWorker = new InventoryOutboxWorker();
