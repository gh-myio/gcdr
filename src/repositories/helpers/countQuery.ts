import { sql, and, SQL } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { db } from '../../infrastructure/database/drizzle/db';

export async function countWhere(
  table: PgTable,
  conditions: (SQL | undefined)[]
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(and(...conditions));
  return result?.count ?? 0;
}
