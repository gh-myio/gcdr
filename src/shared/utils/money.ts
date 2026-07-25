// =============================================================================
// RFC-0054 (DEC-8) — backend-authoritative money arithmetic.
//
// Money is computed with exact fixed-point BigInt math (never float64) and
// serialized as a decimal string. The single rounding boundary is half-up to
// centavos, applied ONCE per node from its full-precision raw. A consumer that
// re-sums must honor these rules; the golden vectors in the RFC are the oracle.
// =============================================================================

/** Parse a non-negative-or-signed decimal string to a BigInt scaled by 10^scaleExp. */
export function parseScaled(decimal: string, scaleExp: number): bigint {
  const neg = decimal.startsWith('-');
  const s = neg ? decimal.slice(1) : decimal;
  const [intPart, fracPart = ''] = s.split('.');
  const frac = (fracPart + '0'.repeat(scaleExp)).slice(0, scaleExp);
  const scaled = BigInt((intPart || '0') + frac);
  return neg ? -scaled : scaled;
}

/**
 * Half-up division for non-negative numerators: round(numerator / denominator)
 * with ties going away from zero. `denominator` must be > 0.
 */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  const q = numerator / denominator;
  const r = numerator % denominator;
  return r * 2n >= denominator ? q + 1n : q;
}

/** Render integer centavos as a 2-decimal string: 64400n → "644.00", 5n → "0.05". */
export function centsToDecimalString(cents: bigint): string {
  const neg = cents < 0n;
  const s = (neg ? -cents : cents).toString().padStart(3, '0');
  const body = `${s.slice(0, -2)}.${s.slice(-2)}`;
  return neg ? `-${body}` : body;
}

// -----------------------------------------------------------------------------
// Money accumulator — sums (quantity × price × marginFactor) exactly, rounds
// once at the boundary.
//
//   quantity  scaled 10^6  (QTY_SCALE)
//   price     scaled 10^6  (PRICE_SCALE)
//   margin    factor = (10000 + m2) / 10000, m2 = round(marginPct × 100)
//   raw R$    = Σ(qtyScaled × priceScaled × factorNum) / 10^16
//   centavos  = roundHalfUp(rawNumerator / 10^14)
// -----------------------------------------------------------------------------
export const QTY_SCALE = 6;
export const PRICE_SCALE = 6;
const MARGIN_DEN = 10000n;             // 100.00 %
const CENTS_DIVISOR = 10n ** 14n;      // 10^(6+6) × 10000 / 100

/** margin pct (2 dp, may be null) → integer factor numerator over MARGIN_DEN. */
export function marginFactorNum(marginPct: number | null): bigint {
  if (marginPct === null || marginPct === undefined) return MARGIN_DEN;
  return MARGIN_DEN + BigInt(Math.round(marginPct * 100));
}

/** Accumulates raw money numerators (adjusted and raw) and rounds to a string. */
export class MoneyAccumulator {
  private adjusted = 0n; // Σ qtyScaled × priceScaled × factorNum
  private raw = 0n;      // Σ qtyScaled × priceScaled × MARGIN_DEN (no margin)

  /** Add one (quantity, price) contribution under the given margin factor. */
  add(qtyScaled: bigint, priceScaled: bigint, factorNum: bigint): void {
    const base = qtyScaled * priceScaled;
    this.adjusted += base * factorNum;
    this.raw += base * MARGIN_DEN;
  }

  /** Fold another accumulator in (for parent = Σ children full-precision raws). */
  merge(other: MoneyAccumulator): void {
    this.adjusted += other.adjusted;
    this.raw += other.raw;
  }

  monetaryValue(): string {
    return centsToDecimalString(roundHalfUpDiv(this.adjusted, CENTS_DIVISOR));
  }
  monetaryRawValue(): string {
    return centsToDecimalString(roundHalfUpDiv(this.raw, CENTS_DIVISOR));
  }
}
