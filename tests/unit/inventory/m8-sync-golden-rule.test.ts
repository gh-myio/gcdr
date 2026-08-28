/**
 * RFC-0061 M8 — golden rule + mirror upsert + run report.
 *
 * Only codes whose QR exists in the M5 registry/homologation_units are
 * considered; everything else is ignored (counted, never mirrored). Orphan
 * mirror rows (codes no longer eligible) are deleted. The mirror upsert only
 * bumps last_change_at when the observable state changed, and the run report
 * {ok,total,ignored,changed,corrections,problems} is persisted on release.
 */

import {
  TENANT,
  CODE,
  CODE_2,
  QR_URL,
  makeProduct,
  makeRegistryRow,
  makeStateRow,
  makeSyncHarness,
  clearLiveEnv,
} from './m8-helpers';

beforeEach(() => {
  jest.clearAllMocks();
  clearLiveEnv();
});

describe('M8 golden rule (§M8)', () => {
  it('ignores codes not present in the registry and never mirrors them', async () => {
    const h = makeSyncHarness([
      makeProduct({ code: CODE }),
      makeProduct({ code: '999999_999999' }), // not homologated in GCDR
    ]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);

    const report = await h.service.runPull(TENANT);

    expect(report.total).toBe(2);
    expect(report.ignored).toBe(1);
    expect(h.repository.upsertState).toHaveBeenCalledTimes(1);
    expect(h.repository.upsertState).toHaveBeenCalledWith(expect.objectContaining({ code: CODE }));
  });

  it('matches the registry by any QR spelling (bare code or full URL)', async () => {
    const h = makeSyncHarness([makeProduct({ code: CODE })]);
    // Registry stored the FULL URL spelling (camera-scan homologation).
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: QR_URL })]);

    const report = await h.service.runPull(TENANT);

    expect(report.ignored).toBe(0);
    expect(h.repository.upsertState).toHaveBeenCalledWith(
      expect.objectContaining({ code: CODE, qrValue: QR_URL }),
    );
  });

  it('deletes orphan mirror rows — codes no longer eligible', async () => {
    const h = makeSyncHarness([makeProduct({ code: CODE })]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);
    h.repository.deleteStatesNotIn.mockResolvedValue(3);

    const report = await h.service.runPull(TENANT);

    expect(h.repository.deleteStatesNotIn).toHaveBeenCalledWith(TENANT, [CODE]);
    expect(report.orphansDeleted).toBe(3);
  });

  it('caps a run at 1000 items and flags the cap as a problem (PARCIAL)', async () => {
    const products = Array.from({ length: 1001 }, (_, i) => makeProduct({ code: `1_${i}` }));
    const h = makeSyncHarness(products);
    h.homologRepository.findRegistryByValues.mockResolvedValue([]);

    const report = await h.service.runPull(TENANT);

    expect(report.total).toBe(1001);
    expect(report.ignored).toBe(1000); // only the capped slice was considered
    expect(report.problems.some((p) => p.includes('cap'))).toBe(true);
    expect(h.repository.releaseLease).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ status: 'PARCIAL', totalItems: 1001 }),
    );
  });
});

describe('M8 mirror upsert + last_change_at', () => {
  it('keeps last_change_at when the observable state did not change', async () => {
    const prior = makeStateRow({ code: CODE, location: 'estoque', status: 'parado' });
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'estoque', status: 'parado' })]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);
    h.repository.allStates.mockResolvedValue([prior]);

    const report = await h.service.runPull(TENANT);

    expect(report.changed).toBe(0);
    expect(h.repository.upsertState).toHaveBeenCalledWith(
      expect.objectContaining({ code: CODE, lastChangeAt: prior.lastChangeAt }),
    );
  });

  it('bumps last_change_at and counts the change when the state moved', async () => {
    const prior = makeStateRow({ code: CODE, location: 'estoque', status: 'parado' });
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'transporte', status: 'parado' })]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);
    h.repository.allStates.mockResolvedValue([prior]);

    const report = await h.service.runPull(TENANT);

    expect(report.changed).toBe(1);
    const arg = h.repository.upsertState.mock.calls[0][0];
    expect(arg.lastChangeAt).not.toEqual(prior.lastChangeAt);
  });

  it('stores the raw platform payload on the mirror row', async () => {
    const raw = { code: CODE, extra: 'anything the platform sends' };
    const h = makeSyncHarness([makeProduct({ code: CODE, raw })]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);

    await h.service.runPull(TENANT);

    expect(h.repository.upsertState).toHaveBeenCalledWith(expect.objectContaining({ payload: raw }));
  });
});

describe('M8 run report persistence (§M8 step 9)', () => {
  it('persists OK with the JSON report and total on a clean run', async () => {
    const h = makeSyncHarness([makeProduct({ code: CODE })]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);

    const report = await h.service.runPull(TENANT);

    expect(report.ok).toBe(true);
    expect(h.repository.releaseLease).toHaveBeenCalledTimes(1);
    const [, persisted] = h.repository.releaseLease.mock.calls[0];
    expect(persisted.status).toBe('OK');
    expect(persisted.totalItems).toBe(1);
    const parsed = JSON.parse(persisted.message) as { ok: boolean; corrections: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.corrections)).toBe(true);
  });

  it('persists ERRO and releases the lease when the platform fetch fails', async () => {
    const h = makeSyncHarness();
    h.client.listProducts.mockRejectedValue(new Error('ECONNREFUSED'));

    const report = await h.service.runPull(TENANT);

    expect(report.ok).toBe(false);
    expect(report.problems[0]).toContain('ECONNREFUSED');
    expect(h.repository.releaseLease).toHaveBeenCalledWith(TENANT, expect.objectContaining({ status: 'ERRO' }));
  });

  it('unwraps err.cause (Drizzle gotcha) into the problems list', async () => {
    const h = makeSyncHarness([makeProduct({ code: CODE }), makeProduct({ code: CODE_2 })]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([
      makeRegistryRow({ qrValue: CODE }),
      makeRegistryRow({ qrValue: CODE_2 }),
    ]);
    const wrapped = new Error('DrizzleQueryError: query failed');
    (wrapped as { cause?: Error }).cause = new Error('duplicate key value violates unique constraint (23505)');
    h.repository.upsertState.mockRejectedValueOnce(wrapped);

    const report = await h.service.runPull(TENANT);

    expect(report.problems.some((p) => p.includes('23505'))).toBe(true);
    expect(h.repository.releaseLease).toHaveBeenCalledWith(TENANT, expect.objectContaining({ status: 'PARCIAL' }));
  });
});
