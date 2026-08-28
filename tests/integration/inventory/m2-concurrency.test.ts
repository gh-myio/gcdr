/**
 * RFC-0061 M2 — REAL concurrency harness (AC-2, A6): stock can never go
 * negative under concurrent exits. Requires a live PostgreSQL with migration
 * 0067 applied and is gated behind INV_IT_DB — it is SKIPPED otherwise (the
 * default unit/CI runs never touch a database).
 *
 * Run with:
 *   INV_IT_DB=1 DATABASE_URL=postgres://... npx jest tests/integration/inventory
 *
 * The suite opens TWO independent postgres connections (two drizzle clients
 * over two sockets) and races two exits whose sum exceeds the balance: the
 * FOR UPDATE item lock must serialize them — exactly one succeeds, the loser
 * gets INV_INSUFFICIENT_STOCK — and the final derived balance stays
 * non-negative.
 *
 * NOTE: a `describe.skip` body still executes at collection time, so every
 * import/connection happens lazily inside beforeAll.
 */

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import type { InventoryStockService as ServiceT } from '../../../src/services/inventory/InventoryStockService';
import type { InventoryStockRepository as RepositoryT } from '../../../src/repositories/inventory/InventoryStockRepository';

type Schema = typeof import('../../../src/infrastructure/database/drizzle/schema');
type Db = PostgresJsDatabase<Schema>;

const gate = process.env.INV_IT_DB ? describe : describe.skip;

gate('M2 concurrency (two real pg connections)', () => {
  jest.setTimeout(30_000);

  const TENANT = 'eeeeeeee-0000-4000-8000-000000000001';

  let sqlA: Sql;
  let sqlB: Sql;
  let dbA: Db;
  let dbB: Db;
  let schema: Schema;
  let repoA: RepositoryT;
  let svcA: ServiceT;
  let svcB: ServiceT;
  let itemId: string;

  /** Repository whose withTransaction is pinned to one connection. */
  function repoOn(db: Db, Repository: new () => RepositoryT): RepositoryT {
    const repo = new Repository();
    (repo as { withTransaction: unknown }).withTransaction = <T>(fn: (tx: never) => Promise<T>) =>
      db.transaction(fn as never) as Promise<T>;
    return repo;
  }

  beforeAll(async () => {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { default: postgres } = await import('postgres');
    schema = await import('../../../src/infrastructure/database/drizzle/schema');
    const { InventoryStockService } = await import('../../../src/services/inventory/InventoryStockService');
    const { InventoryStockRepository } = await import('../../../src/repositories/inventory/InventoryStockRepository');

    const url = process.env.DATABASE_URL as string;
    sqlA = postgres(url, { max: 1 });
    sqlB = postgres(url, { max: 1 });
    dbA = drizzle(sqlA, { schema }) as never;
    dbB = drizzle(sqlB, { schema }) as never;

    repoA = repoOn(dbA, InventoryStockRepository);
    svcA = new InventoryStockService(repoA);
    svcB = new InventoryStockService(repoOn(dbB, InventoryStockRepository));

    const [item] = await dbA
      .insert(schema.invItems)
      .values({ tenantId: TENANT, name: `conc-test-${Date.now()}`, domain: 'TOOL' })
      .returning();
    itemId = item.id;

    // Seed balance 10 at FABRICA.
    await dbA.insert(schema.invStockMovements).values({
      tenantId: TENANT,
      itemId,
      location: 'FABRICA',
      quantity: '10',
      type: 'ENTRADA',
    });
  });

  afterAll(async () => {
    if (!sqlA) return;
    await dbA.delete(schema.invStockMovements).where(eq(schema.invStockMovements.tenantId, TENANT));
    await dbA.delete(schema.invItems).where(eq(schema.invItems.id, itemId));
    await sqlA.end({ timeout: 5 });
    await sqlB.end({ timeout: 5 });
  });

  it('two concurrent exits of 7 against a balance of 10: exactly one wins', async () => {
    const ctx = { tenantId: TENANT };
    const dto = {
      itemId,
      location: 'FABRICA',
      quantity: 7,
      type: 'SAIDA',
      responsible: 'Técnico A', // TOOL exit: destination required
    } as never;

    const outcomes = await Promise.allSettled([
      svcA.createMovement(ctx, dto, `conc-a-${Date.now()}`),
      svcB.createMovement(ctx, dto, `conc-b-${Date.now()}`),
    ]);

    const wins = outcomes.filter((o) => o.status === 'fulfilled');
    const losses = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');

    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0].reason as { code?: string }).code).toBe('INV_INSUFFICIENT_STOCK');

    // Final derived balance: 10 − 7 = 3, never negative.
    const totals = await repoA.getBalance(TENANT, itemId, 'FABRICA', dbA as never);
    expect(Number(totals.balance)).toBe(3);
  });
});
