// =============================================================================
// RFC-0054 (rev. 3) — Customer Tariffs: service (business logic), Phase 1.
//
// A tariff is (customer, domain, category, year) distributed to an HOURLY grain.
// Unlike a goal (whose value SUMs), a tariff value is a RATE: a price stated at
// a level is COPIED to every hour in scope (not divided), finest-level wins.
// The read tree reconstructs the operator's authored structure from each hour's
// stored `source_level` (a DAY price shows as a day node + HOUR overrides nest).
//
// Mutations (replace/merge/remove) run in ONE transaction: upsert/delete hours,
// bump the optimistic `version`, append one history row.
// =============================================================================

import {
  customerTariffRepository,
  CustomerTariffRepository,
  type TariffKey,
  type TariffHourUpsert,
  type TariffTx,
  type CustomerTariffRow,
  type CustomerTariffHourRow,
} from '../repositories/customerTariffRepository';
import { daysInMonth } from '../dto/request/GoalsDTO';
import {
  unitForDomain,
  type TariffDomain,
  type TariffCategory,
  type TariffGranularity,
  type TariffLevel,
  type ReplaceTariffBodyDTO,
  type MergeTariffBucketDTO,
} from '../dto/request/TariffsDTO';
import { AppError } from '../shared/errors/AppError';

// -----------------------------------------------------------------------------
// Version conflict (409) — mirrors the goals contract so the controller reuses
// the same §4.4-style body with currentVersion.
// -----------------------------------------------------------------------------
export class TariffVersionConflictError extends AppError {
  public readonly currentVersion: number;
  public readonly details: Record<string, unknown>;
  constructor(currentVersion: number, details: Record<string, unknown>) {
    super('TARIFF_VERSION_CONFLICT', 'Tariff was modified by another process', 409);
    this.currentVersion = currentVersion;
    this.details = details;
  }
}

// -----------------------------------------------------------------------------
// Result shapes
// -----------------------------------------------------------------------------
export interface TariffTreeNode {
  price?: string;
  sourceLevel?: TariffLevel;
  derived?: boolean;
  hourly?: Record<string, TariffTreeNode>;
  daily?: Record<string, TariffTreeNode>;
  monthly?: Record<string, TariffTreeNode>;
}
export interface TariffTree {
  annual?: TariffTreeNode;
  monthly?: Record<string, TariffTreeNode>;
  daily?: Record<string, TariffTreeNode>;
  hourly?: Record<string, TariffTreeNode>;
}
export interface TariffHistoryEntry {
  source: string;
  actionLevel: TariffLevel;
  bucketRef: string;
  oldPrice: string | null;
  newPrice: string | null;
  bucketCount: number;
  hoursAffected: number;
  version: number;
  actor: string | null;
  changedAt: string;
}
export interface TariffGetResult {
  customerId: string;
  domain: TariffDomain;
  category: TariffCategory;
  year: number;
  unit: 'kWh' | 'm3';
  currency: 'BRL';
  tariffModel: 'FLAT';
  timezone: string;
  version: number;
  tree: TariffTree;
  history?: TariffHistoryEntry[];
}
export interface TariffWriteResult extends TariffGetResult {
  distribution: { hoursWritten: number; actionLevel: TariffLevel };
}
export interface TariffDeleteResult {
  customerId: string;
  domain: TariffDomain;
  category: TariffCategory;
  year: number;
  deleted: { bucket: string | null; hoursRemoved: number; actionLevel: TariffLevel };
  version: number;
}

// -----------------------------------------------------------------------------
// Internal price bucket
// -----------------------------------------------------------------------------
interface PriceBucket {
  level: TariffLevel;
  month?: number;
  day?: number;
  hour?: number;
  price: string;
  ref: string;
}

const LEVEL_RANK: Record<TariffLevel, number> = { YEAR: 0, MONTH: 1, DAY: 2, HOUR: 3 };
const pad2 = (n: number): string => String(n).padStart(2, '0');
const hourKey = (m: number, d: number, h: number): string => `${m}-${d}-${h}`;

export class CustomerTariffService {
  constructor(private readonly repo: CustomerTariffRepository = customerTariffRepository) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------
  async get(key: TariffKey, granularity: TariffGranularity, fetchHistory: boolean): Promise<TariffGetResult> {
    const unit = unitForDomain(key.domain);
    const header = await this.repo.findHeader(key);

    if (!header) {
      const result: TariffGetResult = {
        customerId: key.customerId, domain: key.domain, category: key.category, year: key.year,
        unit, currency: 'BRL', tariffModel: 'FLAT', timezone: 'America/Sao_Paulo', version: 0, tree: {},
      };
      if (fetchHistory) result.history = (await this.repo.findHistoryByKey(key, 100)).map(mapHistoryRow);
      return result;
    }

    const rows = await this.repo.findHours(header.id);
    const result: TariffGetResult = {
      customerId: key.customerId, domain: key.domain, category: key.category, year: key.year,
      unit, currency: 'BRL', tariffModel: (header.tariffModel as 'FLAT'), timezone: header.timezone,
      version: header.version, tree: this.buildTree(rows, granularity),
    };
    if (fetchHistory) result.history = (await this.repo.findHistoryByKey(key, 100)).map(mapHistoryRow);
    return result;
  }

  // ---------------------------------------------------------------------------
  // PUT (replace the whole year)
  // ---------------------------------------------------------------------------
  async replace(key: TariffKey, body: ReplaceTariffBodyDTO, actor: string | null): Promise<TariffWriteResult> {
    const buckets = this.flattenReplaceBody(body, key.year);
    const actionLevel = coarsestLevel(buckets.map((b) => b.level));
    const hours = this.expandPrices(buckets, key.year, actor);

    const finalHeader = await this.repo.withTransaction(async (tx) => {
      const { header, created } = await this.openForWrite(key, body.expectedVersion, actor, tx);
      await this.repo.deleteHours(header.id, {}, tx);
      const written = await this.repo.upsertHours(header.id, hours, tx);
      const final = await this.commitVersion(header, created, body.expectedVersion, actor, key, tx);
      await this.repo.appendHistory({
        tariffId: header.id, tenantId: key.tenantId, customerId: key.customerId,
        domain: key.domain, category: key.category, year: key.year, actor,
        source: 'REPLACE', actionLevel, bucketRef: representativeRef(buckets),
        oldPrice: null, newPrice: buckets[0]?.price ?? null,
        bucketCount: buckets.length, hoursAffected: written, version: final.version,
      }, tx);
      return final;
    });

    return this.writeResult(key, finalHeader, hours.length, actionLevel);
  }

  // ---------------------------------------------------------------------------
  // PATCH (merge sparse buckets — overwrite their hours, preserve the rest)
  // ---------------------------------------------------------------------------
  async merge(key: TariffKey, rawBuckets: MergeTariffBucketDTO[], actor: string | null): Promise<TariffWriteResult> {
    const buckets = rawBuckets.map((b) => this.bucketFromRef(b.level, b.ref, b.price));
    const actionLevel = coarsestLevel(buckets.map((b) => b.level));
    const hours = this.expandPrices(buckets, key.year, actor);

    const finalHeader = await this.repo.withTransaction(async (tx) => {
      const { header, created } = await this.openForWrite(key, undefined, actor, tx);
      const written = await this.repo.upsertHours(header.id, hours, tx);
      const final = await this.commitVersion(header, created, undefined, actor, key, tx);
      await this.repo.appendHistory({
        tariffId: header.id, tenantId: key.tenantId, customerId: key.customerId,
        domain: key.domain, category: key.category, year: key.year, actor,
        source: 'MERGE', actionLevel, bucketRef: representativeRef(buckets),
        oldPrice: null, newPrice: buckets[0]?.price ?? null,
        bucketCount: buckets.length, hoursAffected: written, version: final.version,
      }, tx);
      return final;
    });

    return this.writeResult(key, finalHeader, hours.length, actionLevel);
  }

  // ---------------------------------------------------------------------------
  // DELETE (whole year → hours + header; sub-bucket → hours only). Idempotent.
  // ---------------------------------------------------------------------------
  async remove(
    key: TariffKey,
    bucket: { level: TariffLevel; ref: string } | undefined,
    expectedVersion: number | undefined,
    actor: string | null,
  ): Promise<TariffDeleteResult> {
    return this.repo.withTransaction(async (tx) => {
      const header = await this.repo.findHeader(key, tx);
      if (!header) {
        // Idempotent: nothing to delete.
        return {
          customerId: key.customerId, domain: key.domain, category: key.category, year: key.year,
          deleted: { bucket: bucket?.ref ?? null, hoursRemoved: 0, actionLevel: bucket?.level ?? 'YEAR' }, version: 0,
        };
      }
      if (expectedVersion !== undefined && header.version !== expectedVersion) {
        throw new TariffVersionConflictError(header.version, {
          expectedVersion, currentVersion: header.version,
          domain: key.domain, category: key.category, year: key.year,
        });
      }

      if (!bucket) {
        const removed = await this.repo.deleteHours(header.id, {}, tx);
        await this.repo.appendHistory({
          tariffId: header.id, tenantId: key.tenantId, customerId: key.customerId,
          domain: key.domain, category: key.category, year: key.year, actor,
          source: 'DELETE', actionLevel: 'YEAR', bucketRef: String(key.year),
          oldPrice: null, newPrice: null, bucketCount: 1, hoursAffected: removed, version: header.version,
        }, tx);
        await this.repo.deleteHeader(header.id, tx);
        return {
          customerId: key.customerId, domain: key.domain, category: key.category, year: key.year,
          deleted: { bucket: null, hoursRemoved: removed, actionLevel: 'YEAR' }, version: 0,
        };
      }

      const scope = this.scopeFromRef(bucket.level, bucket.ref);
      const removed = await this.repo.deleteHours(header.id, scope, tx);
      const bumped = await this.repo.bumpVersion(header.id, expectedVersion, actor, tx);
      if (!bumped) {
        throw new TariffVersionConflictError(header.version, {
          expectedVersion, currentVersion: header.version,
          domain: key.domain, category: key.category, year: key.year,
        });
      }
      await this.repo.appendHistory({
        tariffId: header.id, tenantId: key.tenantId, customerId: key.customerId,
        domain: key.domain, category: key.category, year: key.year, actor,
        source: 'DELETE', actionLevel: bucket.level, bucketRef: bucket.ref,
        oldPrice: null, newPrice: null, bucketCount: 1, hoursAffected: removed, version: bumped.version,
      }, tx);
      return {
        customerId: key.customerId, domain: key.domain, category: key.category, year: key.year,
        deleted: { bucket: bucket.ref, hoursRemoved: removed, actionLevel: bucket.level }, version: bumped.version,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Write helpers
  // ---------------------------------------------------------------------------
  private async openForWrite(
    key: TariffKey, expected: number | undefined, actor: string | null, tx: TariffTx,
  ): Promise<{ header: CustomerTariffRow; created: boolean }> {
    const existing = await this.repo.findHeader(key, tx);
    if (existing) {
      if (expected !== undefined && existing.version !== expected) {
        throw new TariffVersionConflictError(existing.version, {
          expectedVersion: expected, currentVersion: existing.version,
          domain: key.domain, category: key.category, year: key.year,
        });
      }
      return { header: existing, created: false };
    }
    // First write: a positive expectedVersion against an absent tariff is a conflict (v0).
    if (expected !== undefined && expected !== 0) {
      throw new TariffVersionConflictError(0, {
        expectedVersion: expected, currentVersion: 0,
        domain: key.domain, category: key.category, year: key.year,
      });
    }
    const header = await this.repo.createHeader(key, unitForDomain(key.domain), actor, tx);
    return { header, created: true };
  }

  /** On an existing tariff bump the version (guarded); a fresh create is already v1. */
  private async commitVersion(
    header: CustomerTariffRow, created: boolean, expected: number | undefined,
    actor: string | null, key: TariffKey, tx: TariffTx,
  ): Promise<CustomerTariffRow> {
    if (created) return header;
    const bumped = await this.repo.bumpVersion(header.id, expected, actor, tx);
    if (!bumped) {
      throw new TariffVersionConflictError(header.version, {
        expectedVersion: expected, currentVersion: header.version,
        domain: key.domain, category: key.category, year: key.year,
      });
    }
    return bumped;
  }

  private async writeResult(
    key: TariffKey, header: CustomerTariffRow, hoursWritten: number, actionLevel: TariffLevel,
  ): Promise<TariffWriteResult> {
    const rows = await this.repo.findHours(header.id);
    return {
      customerId: key.customerId, domain: key.domain, category: key.category, year: key.year,
      unit: unitForDomain(key.domain), currency: 'BRL', tariffModel: (header.tariffModel as 'FLAT'),
      timezone: header.timezone, version: header.version,
      tree: this.buildTree(rows, granularityOf(actionLevel)),
      distribution: { hoursWritten, actionLevel },
    };
  }

  // ---------------------------------------------------------------------------
  // Distribution — COPY to scope, finest-level wins (a rate is not divided).
  // ---------------------------------------------------------------------------
  private expandPrices(buckets: PriceBucket[], year: number, actor: string | null): TariffHourUpsert[] {
    const out = new Map<string, TariffHourUpsert>();
    // Dedupe (level, ref) last-wins, then coarsest→finest so finer overwrites.
    const deduped = [...new Map(buckets.map((b) => [`${b.level}:${b.ref}`, b])).values()];
    const ordered = deduped.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
    for (const bucket of ordered) {
      this.forEachHourInScope(bucket, year, (m, d, h) => {
        out.set(hourKey(m, d, h), {
          month: m, day: d, hour: h, price: bucket.price,
          sourceLevel: bucket.level, derived: bucket.level !== 'HOUR', updatedBy: actor,
        });
      });
    }
    return [...out.values()];
  }

  private forEachHourInScope(b: PriceBucket, year: number, fn: (m: number, d: number, h: number) => void): void {
    const months = b.month !== undefined ? [b.month] : range(1, 12);
    for (const m of months) {
      const days = b.day !== undefined ? [b.day] : range(1, daysInMonth(year, m));
      for (const d of days) {
        const hours = b.hour !== undefined ? [b.hour] : range(0, 23);
        for (const h of hours) fn(m, d, h);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Read tree — reconstruct authored structure from each hour's source_level.
  // ---------------------------------------------------------------------------
  private buildTree(rows: CustomerTariffHourRow[], granularity: TariffGranularity): TariffTree {
    if (rows.length === 0) return {};

    // annual: uniform price of YEAR-sourced hours.
    const yearRows = rows.filter((r) => r.sourceLevel === 'YEAR');
    const tree: TariffTree = {};
    const annualPrice = uniformPrice(yearRows);
    if (annualPrice !== null) tree.annual = { price: annualPrice, sourceLevel: 'YEAR', derived: true };
    if (granularity === 'year') return tree;

    // monthly: MONTH-sourced background per month.
    tree.monthly = {};
    const byMonth = groupBy(rows.filter((r) => r.sourceLevel === 'MONTH'), (r) => pad2(r.month));
    for (const [mm, mRows] of Object.entries(byMonth)) {
      const p = uniformPrice(mRows);
      if (p !== null) tree.monthly[mm] = { price: p, sourceLevel: 'MONTH', derived: true };
    }
    if (granularity === 'month') return tree;

    // daily: DAY-sourced background per day.
    tree.daily = {};
    const byDay = groupBy(rows.filter((r) => r.sourceLevel === 'DAY'), (r) => `${pad2(r.month)}-${pad2(r.day)}`);
    for (const [dk, dRows] of Object.entries(byDay)) {
      const p = uniformPrice(dRows);
      if (p !== null) tree.daily[dk] = { price: p, sourceLevel: 'DAY', derived: true };
    }
    if (granularity === 'day') return tree;

    // hourly: HOUR-sourced overrides (the finest authored grain).
    tree.hourly = {};
    for (const r of rows.filter((r) => r.sourceLevel === 'HOUR')) {
      tree.hourly[`${pad2(r.month)}-${pad2(r.day)}T${pad2(r.hour)}`] = {
        price: String(r.price), sourceLevel: 'HOUR', derived: false,
      };
    }
    return tree;
  }

  // ---------------------------------------------------------------------------
  // Body/ref flattening
  // ---------------------------------------------------------------------------
  private flattenReplaceBody(body: ReplaceTariffBodyDTO, year: number): PriceBucket[] {
    const out: PriceBucket[] = [];
    if (body.annual) {
      out.push({ level: body.annual.sourceLevel ?? 'YEAR', price: body.annual.price, ref: String(year) });
    }
    for (const [mk, month] of Object.entries(body.monthly ?? {})) {
      const m = Number(mk);
      out.push({ level: month.sourceLevel ?? 'MONTH', month: m, price: month.price, ref: `${year}-${mk}` });
      for (const [dk, day] of Object.entries(month.daily ?? {})) {
        const d = Number(dk);
        out.push({ level: day.sourceLevel ?? 'DAY', month: m, day: d, price: day.price, ref: `${year}-${mk}-${dk}` });
        for (const [hk, hour] of Object.entries(day.hourly ?? {})) {
          out.push({
            level: 'HOUR', month: m, day: d, hour: Number(hk), price: hour.price,
            ref: `${year}-${mk}-${dk}T${hk}`,
          });
        }
      }
    }
    return out;
  }

  private bucketFromRef(level: TariffLevel, ref: string, price: string): PriceBucket {
    return { level, price, ref, ...this.scopeFromRef(level, ref) };
  }

  private scopeFromRef(level: TariffLevel, ref: string): { month?: number; day?: number; hour?: number } {
    const scope: { month?: number; day?: number; hour?: number } = {};
    if (level === 'YEAR') return scope;
    scope.month = Number(ref.slice(5, 7));
    if (level === 'MONTH') return scope;
    scope.day = Number(ref.slice(8, 10));
    if (level === 'DAY') return scope;
    scope.hour = Number(ref.slice(11, 13));
    return scope;
  }
}

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------
function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
function groupBy<T>(rows: T[], key: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return out;
}
function uniformPrice(rows: CustomerTariffHourRow[]): string | null {
  if (rows.length === 0) return null;
  const first = String(rows[0].price);
  return rows.every((r) => String(r.price) === first) ? first : null;
}
function coarsestLevel(levels: TariffLevel[]): TariffLevel {
  return levels.reduce<TariffLevel>((acc, l) => (LEVEL_RANK[l] < LEVEL_RANK[acc] ? l : acc), 'HOUR');
}
function granularityOf(level: TariffLevel): TariffGranularity {
  return level === 'YEAR' ? 'year' : level === 'MONTH' ? 'month' : level === 'DAY' ? 'day' : 'hour';
}
function representativeRef(buckets: PriceBucket[]): string {
  return buckets.length > 0 ? buckets[0].ref : '';
}
function mapHistoryRow(r: {
  source: string; actionLevel: string; bucketRef: string; oldPrice: string | null; newPrice: string | null;
  bucketCount: number; hoursAffected: number; version: number; actor: string | null; changedAt: Date;
}): TariffHistoryEntry {
  return {
    source: r.source, actionLevel: r.actionLevel as TariffLevel, bucketRef: r.bucketRef,
    oldPrice: r.oldPrice, newPrice: r.newPrice, bucketCount: r.bucketCount, hoursAffected: r.hoursAffected,
    version: r.version, actor: r.actor, changedAt: r.changedAt.toISOString(),
  };
}

export const customerTariffService = new CustomerTariffService();
