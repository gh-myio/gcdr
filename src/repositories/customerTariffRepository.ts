// =============================================================================
// RFC-0054 (rev. 3) — Customer Tariffs: repository (data access), Phase 1.
//
// Owns the three tariff tables (migration 0062):
//   - customer_tariffs        (parent — one per tenant+customer+domain+category+year)
//   - customer_tariff_hours   (canonical hourly grain — price per (m,d,h))
//   - customer_tariff_history (append-only audit; stable key, NOT NULL)
//
// Same conventions as consumptionGoalRepository: shared `db`, tenant-scoped
// reads, optimistic `version` on the parent, and every mutating method accepts
// an optional executor so the service composes upsert + bump + history in ONE
// transaction. The hourly UNIQUE (tariff_id, month, day, hour) is the batched
// upsert's conflict target (no daterange/EXCLUDE — DEC-8).
// =============================================================================

import { and, eq, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import type { TariffCategory, TariffDomain, TariffLevel } from '../dto/request/TariffsDTO';

const { customerTariffs, customerTariffHours, customerTariffHistory } = schema;

export type TariffTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type TariffDbClient = typeof db | TariffTx;

export type CustomerTariffRow = typeof customerTariffs.$inferSelect;
export type CustomerTariffHourRow = typeof customerTariffHours.$inferSelect;
export type CustomerTariffHistoryRow = typeof customerTariffHistory.$inferSelect;

/** Identifies the parent tariff. */
export interface TariffKey {
  tenantId: string;
  customerId: string;
  domain: TariffDomain;
  category: TariffCategory;
  year: number;
}

/** One hour row to upsert. */
export interface TariffHourUpsert {
  month: number;
  day: number;
  hour: number;
  price: string;          // decimal string for numeric(14,6)
  sourceLevel: TariffLevel;
  derived: boolean;
  updatedBy?: string | null;
}

/** Sub-bucket scope for a narrowed delete (whole year when empty). */
export interface TariffHourScope {
  month?: number;
  day?: number;
  hour?: number;
}

export interface TariffHistoryAppend {
  tariffId: string;
  tenantId: string;
  customerId: string;
  domain: TariffDomain;
  category: TariffCategory;
  year: number;
  actor: string | null;
  source: 'IMPORT' | 'REPLACE' | 'MERGE' | 'DELETE' | 'EDIT';
  actionLevel: TariffLevel;
  bucketRef: string;
  oldPrice: string | null;
  newPrice: string | null;
  bucketCount: number;
  hoursAffected: number;
  version: number;
}

function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

export class CustomerTariffRepository {
  /** Exposes the transaction boundary so the service composes atomic writes. */
  async withTransaction<T>(fn: (tx: TariffTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  async findHeader(key: TariffKey, exec: TariffDbClient = db): Promise<CustomerTariffRow | null> {
    const [row] = await exec
      .select()
      .from(customerTariffs)
      .where(and(
        eq(customerTariffs.tenantId, key.tenantId),
        eq(customerTariffs.customerId, key.customerId),
        eq(customerTariffs.domain, key.domain),
        eq(customerTariffs.category, key.category),
        eq(customerTariffs.year, key.year),
      ))
      .limit(1);
    return row ?? null;
  }

  async findHeaderById(tenantId: string, id: string, exec: TariffDbClient = db): Promise<CustomerTariffRow | null> {
    const [row] = await exec
      .select()
      .from(customerTariffs)
      .where(and(eq(customerTariffs.tenantId, tenantId), eq(customerTariffs.id, id)))
      .limit(1);
    return row ?? null;
  }

  async createHeader(
    key: TariffKey,
    unit: 'kWh' | 'm3',
    createdBy: string | null,
    exec: TariffDbClient = db,
  ): Promise<CustomerTariffRow> {
    const [row] = await exec
      .insert(customerTariffs)
      .values({
        tenantId: key.tenantId,
        customerId: key.customerId,
        domain: key.domain,
        category: key.category,
        year: key.year,
        unit,
        currency: 'BRL',
        tariffModel: 'FLAT',
        version: 1,
        createdBy,
        updatedBy: createdBy,
      })
      .returning();
    return row;
  }

  /**
   * Optimistic version bump: `UPDATE … SET version = version + 1 WHERE id = ?
   * AND version = ?` — a 0-row result signals a stale `expectedVersion`.
   * When `expectedVersion` is undefined the bump is unguarded.
   */
  async bumpVersion(
    id: string,
    expectedVersion: number | undefined,
    updatedBy: string | null,
    exec: TariffDbClient = db,
  ): Promise<CustomerTariffRow | null> {
    const where = expectedVersion === undefined
      ? eq(customerTariffs.id, id)
      : and(eq(customerTariffs.id, id), eq(customerTariffs.version, expectedVersion));
    const [row] = await exec
      .update(customerTariffs)
      .set({ version: sql`${customerTariffs.version} + 1`, updatedAt: new Date(), updatedBy })
      .where(where)
      .returning();
    return row ?? null;
  }

  async findHours(tariffId: string, exec: TariffDbClient = db): Promise<CustomerTariffHourRow[]> {
    return exec
      .select()
      .from(customerTariffHours)
      .where(eq(customerTariffHours.tariffId, tariffId));
  }

  /**
   * Batched hourly upsert. A full leap year is 8 784 rows × 7 bound columns
   * (~61k params) — chunked at 1 000 to stay well under postgres' 65 534 limit.
   * Conflict target is the plain UNIQUE (tariff_id, month, day, hour).
   */
  async upsertHours(tariffId: string, hours: TariffHourUpsert[], exec: TariffDbClient = db): Promise<number> {
    if (hours.length === 0) return 0;
    const now = new Date();
    const values = hours.map((h) => ({
      tariffId,
      month: h.month,
      day: h.day,
      hour: h.hour,
      price: h.price,
      sourceLevel: h.sourceLevel,
      derived: h.derived,
      updatedAt: now,
      updatedBy: h.updatedBy ?? null,
    }));

    const CHUNK_SIZE = 1000;
    let affected = 0;
    for (let i = 0; i < values.length; i += CHUNK_SIZE) {
      const chunk = values.slice(i, i + CHUNK_SIZE);
      const rows = await exec
        .insert(customerTariffHours)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            customerTariffHours.tariffId,
            customerTariffHours.month,
            customerTariffHours.day,
            customerTariffHours.hour,
          ],
          set: {
            price: sqlExcluded('price'),
            sourceLevel: sqlExcluded('source_level'),
            derived: sqlExcluded('derived'),
            updatedAt: now,
            updatedBy: sqlExcluded('updated_by'),
          },
        })
        .returning({ tariffId: customerTariffHours.tariffId });
      affected += rows.length;
    }
    return affected;
  }

  /** Deletes hour rows — all of them (whole-year) or a month/day/hour sub-bucket. */
  async deleteHours(tariffId: string, scope: TariffHourScope = {}, exec: TariffDbClient = db): Promise<number> {
    const conds = [eq(customerTariffHours.tariffId, tariffId)];
    if (scope.month !== undefined) conds.push(eq(customerTariffHours.month, scope.month));
    if (scope.day !== undefined) conds.push(eq(customerTariffHours.day, scope.day));
    if (scope.hour !== undefined) conds.push(eq(customerTariffHours.hour, scope.hour));
    const rows = await exec
      .delete(customerTariffHours)
      .where(and(...conds))
      .returning({ tariffId: customerTariffHours.tariffId });
    return rows.length;
  }

  async deleteHeader(id: string, exec: TariffDbClient = db): Promise<void> {
    await exec.delete(customerTariffs).where(eq(customerTariffs.id, id));
  }

  async appendHistory(entry: TariffHistoryAppend, exec: TariffDbClient = db): Promise<void> {
    await exec.insert(customerTariffHistory).values({
      tariffId: entry.tariffId,
      tenantId: entry.tenantId,
      customerId: entry.customerId,
      domain: entry.domain,
      category: entry.category,
      year: entry.year,
      actor: entry.actor,
      source: entry.source,
      actionLevel: entry.actionLevel,
      bucketRef: entry.bucketRef,
      oldPrice: entry.oldPrice,
      newPrice: entry.newPrice,
      bucketCount: entry.bucketCount,
      hoursAffected: entry.hoursAffected,
      version: entry.version,
    });
  }

  /** History by stable key — survives a header delete (DEC-10). */
  async findHistoryByKey(key: TariffKey, limit = 100, exec: TariffDbClient = db): Promise<CustomerTariffHistoryRow[]> {
    return exec
      .select()
      .from(customerTariffHistory)
      .where(and(
        eq(customerTariffHistory.tenantId, key.tenantId),
        eq(customerTariffHistory.customerId, key.customerId),
        eq(customerTariffHistory.domain, key.domain),
        eq(customerTariffHistory.category, key.category),
        eq(customerTariffHistory.year, key.year),
      ))
      .orderBy(desc(customerTariffHistory.changedAt))
      .limit(limit);
  }
}

export const customerTariffRepository = new CustomerTariffRepository();
