/**
 * RFC-0061 M8 — single-flight lease + live/shadow gate (J4).
 *
 * The pull claims a persisted 3-minute lease atomically; a held lease means
 * 409 (ConflictError) on the manual trigger. ?live=true is refused without
 * env INV_SYNC_LIVE=true. The lease is always released with the run report —
 * success, PARCIAL or ERRO.
 */

import { ConflictError, ValidationError, AppError } from '../../../src/shared/errors/AppError';
import {
  InventoryExternalSyncService,
  SYNC_LEASE_MS,
} from '../../../src/services/inventory/InventoryExternalSyncService';
import {
  TENANT,
  CODE,
  makeProduct,
  makeSyncHarness,
  makeSyncStateRow,
  withLiveEnv,
  clearLiveEnv,
} from './m8-helpers';

beforeEach(() => {
  jest.clearAllMocks();
  clearLiveEnv();
});

afterAll(() => clearLiveEnv());

describe('M8 lease (single-flight, §M8)', () => {
  it('claims a 3-minute lease before pulling', async () => {
    const h = makeSyncHarness([]);
    await h.service.runPull(TENANT);
    expect(h.repository.claimLease).toHaveBeenCalledWith(TENANT, SYNC_LEASE_MS);
    expect(SYNC_LEASE_MS).toBe(180_000);
  });

  it('throws ConflictError (→ 409) when the lease is held elsewhere', async () => {
    const h = makeSyncHarness([]);
    h.repository.claimLease.mockResolvedValue(null); // claim refused — active lease

    await expect(h.service.runPull(TENANT)).rejects.toBeInstanceOf(ConflictError);
    expect(h.client.listProducts).not.toHaveBeenCalled();
    expect(h.repository.releaseLease).not.toHaveBeenCalled(); // never releases a lease it does not hold
  });

  it('an expired lease is claimable again (repository claim contract)', async () => {
    // The atomic claim (UPDATE … WHERE lease_until IS NULL OR < now()) is the
    // repository's; at the service level an expired lease simply claims.
    const h = makeSyncHarness([]);
    h.repository.claimLease.mockResolvedValue(
      makeSyncStateRow({ leaseUntil: new Date(Date.now() + SYNC_LEASE_MS) }),
    );
    const report = await h.service.runPull(TENANT);
    expect(report.ok).toBe(true);
    expect(h.repository.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('releases the lease even when the run blows up mid-flight', async () => {
    const h = makeSyncHarness([makeProduct({ code: CODE })]);
    h.homologRepository.findRegistryByValues.mockRejectedValue(new Error('db down'));

    const report = await h.service.runPull(TENANT);

    expect(report.ok).toBe(false);
    expect(h.repository.releaseLease).toHaveBeenCalledWith(TENANT, expect.objectContaining({ status: 'ERRO' }));
  });
});

describe('M8 live/shadow gate (J4)', () => {
  it('refuses ?live=true without INV_SYNC_LIVE=true (400, before the lease)', async () => {
    const h = makeSyncHarness([]);
    await expect(h.service.runPull(TENANT, { live: true })).rejects.toBeInstanceOf(ValidationError);
    expect(h.repository.claimLease).not.toHaveBeenCalled();
  });

  it('runs shadow by default (report.live=false)', async () => {
    const h = makeSyncHarness([]);
    const report = await h.service.runPull(TENANT);
    expect(report.live).toBe(false);
  });

  it('accepts live with INV_SYNC_LIVE=true', async () => {
    withLiveEnv();
    const h = makeSyncHarness([]);
    const report = await h.service.runPull(TENANT, { live: true });
    expect(report.live).toBe(true);
  });

  it('the cron path (no opts) follows the env', async () => {
    withLiveEnv();
    const h = makeSyncHarness([]);
    const report = await h.service.runPull(TENANT);
    expect(report.live).toBe(true);
  });
});

describe('M8 client configuration', () => {
  it('throws 503 INV_EXTERNAL_NOT_CONFIGURED when no client is available', async () => {
    const service = new InventoryExternalSyncService({ clientProvider: () => null });
    const err = await service.runPull(TENANT).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(503);
    expect((err as AppError).code).toBe('INV_EXTERNAL_NOT_CONFIGURED');
  });
});

describe('M8 sync status response', () => {
  it('reports leaseActive from lease_until vs now + outbox counters + mode', async () => {
    const h = makeSyncHarness([]);
    h.repository.getSyncState.mockResolvedValue(
      makeSyncStateRow({ leaseUntil: new Date(Date.now() + 60_000), lastStatus: 'OK', totalItems: 42 }),
    );
    h.repository.outboxCounters.mockResolvedValue({ pending: 2, retryable: 1, dead: 0, done: 9 });

    const status = await h.service.getStatus(TENANT);

    expect(status.syncState?.leaseActive).toBe(true);
    expect(status.syncState?.lastStatus).toBe('OK');
    expect(status.outbox).toEqual({ pending: 2, retryable: 1, dead: 0, done: 9 });
    expect(status.mode).toEqual({ live: false, shadow: true });
  });

  it('an expired lease shows leaseActive=false', async () => {
    const h = makeSyncHarness([]);
    h.repository.getSyncState.mockResolvedValue(makeSyncStateRow({ leaseUntil: new Date(Date.now() - 1000) }));
    const status = await h.service.getStatus(TENANT);
    expect(status.syncState?.leaseActive).toBe(false);
  });
});
