// RFC-0042 — typo-tolerant matching for customer name/code (ported from
// qrcode-check.git src/mcp/utils/fuzzy-match.ts, adapted to multiple keys).

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient over character bigrams (0..1). */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/**
 * Resolve `query` against `items`. Precedence: exact key → key includes query →
 * best Dice score ≥ threshold across all keys. Returns null when nothing fits.
 */
export function fuzzyMatch<T>(
  query: string,
  items: T[],
  keys: Array<(item: T) => string | null | undefined>,
  threshold = 0.5,
): T | null {
  const q = normalize(query);
  if (!q) return null;

  const keyVals = (item: T) => keys.map((k) => normalize(k(item) ?? '')).filter(Boolean);

  // 1) exact
  for (const item of items) {
    if (keyVals(item).some((v) => v === q)) return item;
  }
  // 2) substring (either direction)
  for (const item of items) {
    if (keyVals(item).some((v) => v.includes(q) || q.includes(v))) return item;
  }
  // 3) fuzzy
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = Math.max(0, ...keyVals(item).map((v) => dice(q, v)));
    if (score >= threshold && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}
