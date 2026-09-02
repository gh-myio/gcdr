import { evaluateSanityGate } from '../../../src/workers/orchestrator-devices/sanityGate';

describe('orchestrator-devices sanity gate (RFC-0062 §7)', () => {
  it('below threshold → allowed', () => {
    const r = evaluateSanityGate({ totalInScope: 100, flippingToDown: 10, maxPct: 30 });
    expect(r.allowed).toBe(true);
    expect(r.held).toBe(false);
    expect(r.flippedPct).toBeCloseTo(10);
  });

  it('above threshold → held (blocks canonical writes, loud)', () => {
    const r = evaluateSanityGate({ totalInScope: 100, flippingToDown: 45, maxPct: 30 });
    expect(r.allowed).toBe(false);
    expect(r.held).toBe(true);
    expect(r.reason).toMatch(/held for review/);
  });

  it('exactly at threshold → allowed (only strictly greater trips)', () => {
    const r = evaluateSanityGate({ totalInScope: 100, flippingToDown: 30, maxPct: 30 });
    expect(r.held).toBe(false);
  });

  it('no down-flips → allowed', () => {
    expect(evaluateSanityGate({ totalInScope: 100, flippingToDown: 0, maxPct: 30 }).allowed).toBe(true);
  });

  it('empty scope → allowed (no division by zero)', () => {
    expect(evaluateSanityGate({ totalInScope: 0, flippingToDown: 0, maxPct: 30 }).allowed).toBe(true);
  });
});
