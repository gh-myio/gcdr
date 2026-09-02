// =============================================================================
// orchestrator-devices — bounded-concurrency map (pure, no IO)
//
// Runs `fn` over `items` with at most `limit` in flight at once, preserving the
// input order in the returned results. Used to probe due centrals concurrently
// (RFC-0062 hardening) instead of serially — a fleet sweep with many unreachable
// gateways otherwise serializes dozens of ~retry-timeouts into many minutes.
//
// Contract preserved by callers: the per-item work (processCentral) still owns
// its own per-central timeout and writes its own evidence; this only changes HOW
// MANY run at once. Results are merged in input order by the caller, so counters
// and the ledger are identical to the old sequential loop.
//
// Errors propagate (Promise.all semantics): if an item's fn rejects, the whole
// map rejects — same failure surface as the old `for … await` loop, which also
// aborted the sweep on the first throw.
// =============================================================================

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  const results: R[] = new Array(n);
  if (n === 0) return results;
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, n));
  let next = 0;

  async function runner(): Promise<void> {
    // Pull the next index atomically (single-threaded event loop → no lock needed).
    for (let i = next++; i < n; i = next++) {
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => runner()));
  return results;
}
