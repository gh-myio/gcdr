/**
 * RFC-0061 M8 — push-outbox drain (DEC-6/W3).
 *
 * Two layers, no DB and no network:
 *  - SQL shape of the claim (InventoryExternalRepository.claimOutboxBatchQuery):
 *    FOR UPDATE SKIP LOCKED, per-QR FIFO via NOT EXISTS + array overlap (&&),
 *    oldest-first ordering, attempts ceiling.
 *  - Worker behavior (mocked repo + client): PATCH per code, DONE on success,
 *    FAILED + exponential backoff on failure, dead letter after
 *    OUTBOX_MAX_ATTEMPTS, FIFO order preserved when an older row fails.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import {
  InventoryExternalRepository,
  OUTBOX_MAX_ATTEMPTS,
} from '../../../src/repositories/inventory/InventoryExternalRepository';
import { InventoryOutboxWorker, outboxBackoffMs } from '../../../src/services/inventory/InventoryOutboxWorker';
import {
  CODE,
  CODE_2,
  BOX_QR,
  TENANT,
  makeOutboxRow,
  makeOutboxHarness,
  makeRegistryRow,
  makeHomologation,
  makeHomologationUnit,
} from './m8-helpers';

const dialect = new PgDialect();

beforeEach(() => jest.clearAllMocks());

// -----------------------------------------------------------------------------
// Claim SQL shape (W3)
// -----------------------------------------------------------------------------

describe('claimOutboxBatchQuery SQL shape (SKIP LOCKED + per-QR FIFO)', () => {
  const repo = new InventoryExternalRepository();
  const { sql, params } = dialect.sqlToQuery(repo.claimOutboxBatchQuery(20));

  it('locks with FOR UPDATE SKIP LOCKED (deploy-safe under side-by-side instances)', () => {
    expect(sql).toMatch(/FOR UPDATE OF o SKIP LOCKED/i);
  });

  it('claims oldest-first (created_at, id)', () => {
    expect(sql).toMatch(/ORDER BY o\.created_at ASC, o\.id ASC/i);
  });

  it('enforces per-QR FIFO: NOT EXISTS older live row sharing qr_codes (&& overlap)', () => {
    expect(sql).toMatch(/NOT EXISTS/i);
    expect(sql).toMatch(/older\.qr_codes && o\.qr_codes/);
    expect(sql).toMatch(/older\.created_at < o\.created_at/);
    expect(sql).toMatch(/older\.id < o\.id/); // stable tiebreak on equal timestamps
    expect(sql).toMatch(/older\.tenant_id = o\.tenant_id/);
  });

  it('only claims live rows due now (status, attempts ceiling, next_attempt_at)', () => {
    expect(sql).toMatch(/o\.status IN \('PENDING','FAILED'\)/);
    expect(sql).toMatch(/o\.attempts </);
    expect(sql).toMatch(/o\.next_attempt_at IS NULL OR o\.next_attempt_at <= now\(\)/);
    expect(params).toEqual(expect.arrayContaining([OUTBOX_MAX_ATTEMPTS, 20]));
  });

  it('the blocking predicate ALSO honors the attempts ceiling — a dead letter stops blocking', () => {
    // Both the claim filter and the NOT EXISTS use attempts < max: an
    // exhausted row neither drains nor wedges younger pushes for its QRs
    // (the pull-sync reconciliation is the safety net for those).
    const matches = sql.match(/attempts </g) ?? [];
    expect(matches.length).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// Backoff
// -----------------------------------------------------------------------------

describe('outboxBackoffMs (exponential, capped)', () => {
  it('doubles from 30s and caps at 15 minutes', () => {
    expect(outboxBackoffMs(1)).toBe(30_000);
    expect(outboxBackoffMs(2)).toBe(60_000);
    expect(outboxBackoffMs(3)).toBe(120_000);
    expect(outboxBackoffMs(5)).toBe(480_000);
    expect(outboxBackoffMs(10)).toBe(900_000); // cap
  });
});

// -----------------------------------------------------------------------------
// Worker behavior
// -----------------------------------------------------------------------------

describe('InventoryOutboxWorker.drainOnce', () => {
  it('is a no-op when the client is not configured', async () => {
    const h = makeOutboxHarness([[makeOutboxRow()]]);
    const worker = new InventoryOutboxWorker({
      repository: h.repository,
      homologRepository: h.homologRepository,
      clientProvider: () => null,
    });
    const result = await worker.drainOnce();
    expect(result).toEqual({ claimed: 0, dispatched: 0, failed: 0, dead: 0 });
    expect(h.repository.claimOutboxBatch).not.toHaveBeenCalled();
  });

  it('PATCHes each bare code and marks the row DONE', async () => {
    const row = makeOutboxRow({
      qrCodes: [`https://produto.myio.com.br/${CODE}`, CODE_2],
      location: 'transporte',
      technician: 'Transportadora',
      clientName: null,
    });
    const h = makeOutboxHarness([[row]]);

    const result = await h.worker.drainOnce();

    expect(result).toEqual({ claimed: 1, dispatched: 1, failed: 0, dead: 0 });
    expect(h.client.patchProduct).toHaveBeenCalledTimes(2);
    expect(h.client.patchProduct).toHaveBeenCalledWith(CODE, {
      location: 'transporte',
      technician: 'Transportadora',
      client_name: null,
    });
    expect(h.client.patchProduct).toHaveBeenCalledWith(CODE_2, expect.objectContaining({ location: 'transporte' }));
    expect(h.repository.markOutboxDispatched).toHaveBeenCalledWith([row.id], expect.anything());
  });

  it('expands a BOX QR into its unit codes before PATCHing (defensive)', async () => {
    const row = makeOutboxRow({ qrCodes: [BOX_QR], location: 'expedicao' });
    const h = makeOutboxHarness([[row]]);
    const box = makeHomologation({ boxSize: 10, boxQr: BOX_QR });
    h.homologRepository.findRegistryByValues.mockResolvedValue([
      makeRegistryRow({ qrValue: BOX_QR, kind: 'BOX' }),
    ]);
    h.homologRepository.findBoxesByQrValues.mockResolvedValue([box]);
    h.homologRepository.unitsByHomologationIds.mockResolvedValue([
      makeHomologationUnit({ qrValue: CODE, homologationId: box.id }),
      makeHomologationUnit({ id: 'ffffffff-7777-4777-8777-777777777772', qrValue: CODE_2, homologationId: box.id }),
    ]);

    await h.worker.drainOnce();

    expect(h.client.patchProduct).toHaveBeenCalledTimes(2);
    expect(h.client.patchProduct).toHaveBeenCalledWith(CODE, expect.anything());
    expect(h.client.patchProduct).toHaveBeenCalledWith(CODE_2, expect.anything());
  });

  it('failure → FAILED with attempts+1 and the exponential backoff', async () => {
    const row = makeOutboxRow({ attempts: 1 });
    const h = makeOutboxHarness([[row]]);
    h.client.patchProduct.mockRejectedValue(new Error('HTTP 500'));

    const result = await h.worker.drainOnce();

    expect(result).toEqual({ claimed: 1, dispatched: 0, failed: 1, dead: 0 });
    expect(h.repository.markOutboxDispatched).not.toHaveBeenCalled();
    const [id, attempts, nextAttemptAt, lastError] = h.repository.markOutboxFailed.mock.calls[0];
    expect(id).toBe(row.id);
    expect(attempts).toBe(2);
    expect(nextAttemptAt).toBeInstanceOf(Date);
    expect(lastError).toContain('HTTP 500');
  });

  it('dead-letters after OUTBOX_MAX_ATTEMPTS: next_attempt_at NULL, keeps last_error', async () => {
    const row = makeOutboxRow({ attempts: OUTBOX_MAX_ATTEMPTS - 1, status: 'FAILED' });
    const h = makeOutboxHarness([[row]]);
    h.client.patchProduct.mockRejectedValue(new Error('still down'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await h.worker.drainOnce();

      expect(result).toEqual({ claimed: 1, dispatched: 0, failed: 0, dead: 1 });
      const [, attempts, nextAttemptAt, lastError] = h.repository.markOutboxFailed.mock.calls[0];
      expect(attempts).toBe(OUTBOX_MAX_ATTEMPTS);
      expect(nextAttemptAt).toBeNull();
      expect(lastError).toContain('still down');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('FIFO preserved on failure: the failing older row is marked FAILED, later same-QR rows are NOT in the batch (claim contract) and the rest of the batch still drains', async () => {
    // The claim already excluded the younger same-QR row (NOT EXISTS) — the
    // batch carries the older failing row plus an unrelated row.
    const older = makeOutboxRow({ qrCodes: [CODE], location: 'tecnico' });
    const unrelated = makeOutboxRow({ qrCodes: ['777777_777777'], location: 'cliente' });
    const h = makeOutboxHarness([[older, unrelated]]);
    h.client.patchProduct.mockImplementation(async (code: string) => {
      if (code === CODE) throw new Error('tecnico push down');
    });

    const result = await h.worker.drainOnce();

    expect(result).toEqual({ claimed: 2, dispatched: 1, failed: 1, dead: 0 });
    expect(h.repository.markOutboxFailed).toHaveBeenCalledWith(
      older.id,
      1,
      expect.any(Date),
      expect.stringContaining('tecnico push down'),
      expect.anything(),
    );
    expect(h.repository.markOutboxDispatched).toHaveBeenCalledWith([unrelated.id], expect.anything());
  });

  it('a partially-PATCHed multi-code row is retried whole (fails as one unit)', async () => {
    const row = makeOutboxRow({ qrCodes: [CODE, CODE_2] });
    const h = makeOutboxHarness([[row]]);
    h.client.patchProduct.mockImplementation(async (code: string) => {
      if (code === CODE_2) throw new Error('second code failed');
    });

    const result = await h.worker.drainOnce();

    expect(result.failed).toBe(1);
    expect(h.repository.markOutboxDispatched).not.toHaveBeenCalled();
  });

  it('claims within the drain transaction (claim tx = dispatch tx)', async () => {
    const h = makeOutboxHarness([[makeOutboxRow()]]);
    await h.worker.drainOnce();
    expect(h.repository.withTransaction).toHaveBeenCalledTimes(1);
    expect(h.repository.claimOutboxBatch).toHaveBeenCalledWith(20, expect.anything());
  });

  it('rows for any tenant drain through the single env client (v1)', async () => {
    const row = makeOutboxRow({ tenantId: TENANT });
    const other = makeOutboxRow({ tenantId: '22222222-2222-4222-8222-222222222222', qrCodes: ['888888_888888'] });
    const h = makeOutboxHarness([[row, other]]);

    const result = await h.worker.drainOnce();

    expect(result.dispatched).toBe(2);
  });
});
