// =============================================================================
// RFC-0054 Phase 2 (DEC-5/6/8) — money overlay for QUANTITY goals.
//
// Pure computation: given a DEVICE-granular goal's hour rows, the devices'
// tariff categories, and a price resolver, produce per-node monetaryValue /
// monetaryRawValue (decimal strings) and the coverage `money` block.
//
// Rulings encoded:
//  - money = Σ over (device, hour) WITH a resolvable price of
//            adjustedQty(device,hour) × tariff(device.category, hour)     [DEC-5]
//  - zero is only the additive identity of the COVERED sum; an uncategorized
//    device or a missing category tariff is EXCLUDED and reported, never
//    multiplied by a presumed 0.                                          [DEC-5]
//  - one rounding boundary, half-up, per node from its full-precision raw;
//    a parent is round(Σ its own device-hour raws), not Σ rounded children.[DEC-8]
//  - totalHours / pricedHours are DEVICE-HOURS; coverageComplete ⇔ equal.
// =============================================================================

import { daysInMonth } from '../dto/request/GoalsDTO';
import type { TariffCategory } from '../dto/request/TariffsDTO';
import {
  MoneyAccumulator,
  marginFactorNum,
  parseScaled,
  QTY_SCALE,
  PRICE_SCALE,
} from '../shared/utils/money';

export interface MoneyRow {
  deviceId: string | null;
  month: number;
  day: number;
  hour: number;
  value: string; // quantity, decimal string
}
export interface MoneyDevice {
  id: string;
  code: string | null;
  label: string | null;
  tariffCategory: TariffCategory | null;
}
export type PriceAt = (category: TariffCategory, month: number, day: number, hour: number) => string | null;

export interface GoalMoneyBlock {
  currency: 'BRL';
  coverageComplete: boolean;
  pricedHours: number;
  totalHours: number;
  tariffCoverageGaps: { missing: string[]; truncated: boolean; missingHours: number };
  uncategorizedDevices: Array<{ deviceId: string; code: string | null; label: string | null }>;
}
export interface GoalMoneyUnavailable {
  reason: 'MONEY_REQUIRES_DEVICE_GRANULARITY';
}
export interface NodeMoney {
  monetaryValue: string;
  monetaryRawValue: string;
}
export interface GoalMoneyResult {
  money: GoalMoneyBlock;
  annual?: NodeMoney;
  monthly: Record<string, NodeMoney>;
  daily: Record<string, NodeMoney>;
  hourly: Record<string, NodeMoney>;
}

const GAP_REF_CAP = 12;
const pad2 = (n: number): string => String(n).padStart(2, '0');
const slotOf = (m: number, d: number, h: number): number => m * 10000 + d * 100 + h;

export class GoalMoneyService {
  compute(params: {
    year: number;
    marginPct: number | null;
    rows: MoneyRow[];
    devices: MoneyDevice[];
    priceAt: PriceAt;
  }): GoalMoneyResult {
    const { year, marginPct, rows, devices, priceAt } = params;
    const factorNum = marginFactorNum(marginPct);
    const catByDevice = new Map(devices.map((d) => [d.id, d.tariffCategory]));
    const deviceById = new Map(devices.map((d) => [d.id, d]));

    // Accumulators per node (each node sums its own device-hours — DEC-8).
    const annual = new MoneyAccumulator();
    const monthly = new Map<string, MoneyAccumulator>();
    const daily = new Map<string, MoneyAccumulator>();
    const hourly = new Map<string, MoneyAccumulator>();
    const acc = (map: Map<string, MoneyAccumulator>, k: string): MoneyAccumulator => {
      let a = map.get(k);
      if (!a) { a = new MoneyAccumulator(); map.set(k, a); }
      return a;
    };

    let totalHours = 0;
    let pricedHours = 0;
    const missingTariffSlots = new Set<number>();
    const uncategorized = new Map<string, MoneyDevice>();

    for (const r of rows) {
      if (!r.deviceId) continue; // defensive — a DEVICE goal's rows carry a deviceId
      totalHours += 1;
      const category = catByDevice.get(r.deviceId) ?? null;
      if (category === null) {
        const dev = deviceById.get(r.deviceId);
        if (dev) uncategorized.set(dev.id, dev);
        continue; // excluded — never priced 0
      }
      const price = priceAt(category, r.month, r.day, r.hour);
      if (price === null) {
        missingTariffSlots.add(slotOf(r.month, r.day, r.hour));
        continue; // excluded — never priced 0
      }
      const qtyScaled = parseScaled(r.value, QTY_SCALE);
      const priceScaled = parseScaled(price, PRICE_SCALE);
      const mm = pad2(r.month);
      const dk = `${mm}-${pad2(r.day)}`;
      const hk = `${dk}T${pad2(r.hour)}`;
      annual.add(qtyScaled, priceScaled, factorNum);
      acc(monthly, mm).add(qtyScaled, priceScaled, factorNum);
      acc(daily, dk).add(qtyScaled, priceScaled, factorNum);
      acc(hourly, hk).add(qtyScaled, priceScaled, factorNum);
      pricedHours += 1;
    }

    const emit = (map: Map<string, MoneyAccumulator>): Record<string, NodeMoney> => {
      const out: Record<string, NodeMoney> = {};
      for (const [k, a] of map.entries()) {
        out[k] = { monetaryValue: a.monetaryValue(), monetaryRawValue: a.monetaryRawValue() };
      }
      return out;
    };

    const money: GoalMoneyBlock = {
      currency: 'BRL',
      coverageComplete: pricedHours === totalHours,
      pricedHours,
      totalHours,
      tariffCoverageGaps: summariseMissing(year, missingTariffSlots),
      uncategorizedDevices: [...uncategorized.values()].map((d) => ({
        deviceId: d.id, code: d.code, label: d.label,
      })),
    };

    const result: GoalMoneyResult = { money, monthly: emit(monthly), daily: emit(daily), hourly: emit(hourly) };
    if (pricedHours > 0) {
      result.annual = { monetaryValue: annual.monetaryValue(), monetaryRawValue: annual.monetaryRawValue() };
    }
    return result;
  }
}

/**
 * Compact refs for the missing-tariff slots (calendar hours), coarsest-first:
 * whole month → 'YYYY-MM', whole day → 'YYYY-MM-DD', else 'YYYY-MM-DDThh'.
 * Always returns the stable empty shape when nothing is missing.
 */
function summariseMissing(year: number, missing: Set<number>): { missing: string[]; truncated: boolean; missingHours: number } {
  const refs: string[] = [];
  let missingHours = 0;
  let truncated = false;
  for (let m = 1; m <= 12; m++) {
    const gaps = monthMissingRefs(year, m, missing);
    missingHours += gaps.missing;
    for (const ref of gaps.refs) {
      if (refs.length < GAP_REF_CAP) refs.push(ref);
      else { truncated = true; break; }
    }
  }
  return { missing: refs, truncated, missingHours };
}

/** ONE month's compact missing-tariff refs: whole month → whole days → hours. */
function monthMissingRefs(year: number, m: number, missing: Set<number>): { refs: string[]; missing: number } {
  const dim = daysInMonth(year, m);
  const mm = pad2(m);
  const dayRefs: string[] = [];
  let missTotal = 0;
  for (let d = 1; d <= dim; d++) {
    const dd = pad2(d);
    const hourRefs: string[] = [];
    for (let h = 0; h < 24; h++) if (missing.has(slotOf(m, d, h))) hourRefs.push(`${year}-${mm}-${dd}T${pad2(h)}`);
    missTotal += hourRefs.length;
    if (hourRefs.length === 24) dayRefs.push(`${year}-${mm}-${dd}`);
    else dayRefs.push(...hourRefs);
  }
  if (missTotal === dim * 24) return { refs: [`${year}-${mm}`], missing: missTotal };
  return { refs: dayRefs, missing: missTotal };
}

export const goalMoneyService = new GoalMoneyService();
