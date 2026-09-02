import { mapWithConcurrency } from '../../../src/workers/orchestrator-devices/concurrency';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const items = [30, 5, 20, 1, 10];
    const out = await mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms * 2;
    });
    expect(out).toEqual([60, 10, 40, 2, 20]); // same order as input, not completion
  });

  it('passes the index to fn', async () => {
    const out = await mapWithConcurrency(['a', 'b', 'c'], 2, async (v, i) => `${i}:${v}`);
    expect(out).toEqual(['0:a', '1:b', '2:c']);
  });

  it('never runs more than `limit` at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // actually ran concurrently
  });

  it('caps workers at item count when limit > n', async () => {
    let inFlight = 0, peak = 0;
    await mapWithConcurrency([1, 2], 100, async () => { inFlight++; peak = Math.max(peak, inFlight); await tick(); inFlight--; });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it('runs at least one at a time for a non-positive limit', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 0, async (v) => v + 1);
    expect(out).toEqual([2, 3, 4]);
  });

  it('propagates a rejection (same failure surface as the old for-await loop)', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (v) => { if (v === 2) throw new Error('boom'); return v; }),
    ).rejects.toThrow('boom');
  });
});
