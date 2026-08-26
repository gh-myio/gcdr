/**
 * SQL-shape test for CentralRepository.lockByIdQuery (RFC-0056 feedback P1).
 * This is the row lock that makes CentralInitialKeyService.getOrCreateInitialKey's
 * read-check-mint-write sequence atomic. Asserted via PgDialect.sqlToQuery (no DB) —
 * same technique as CentralCommandRepository.claim.sql.test.ts.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { CentralRepository } from '../../../src/repositories/CentralRepository';

const dialect = new PgDialect();

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => import('drizzle-orm').SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

describe('CentralRepository.lockByIdQuery SQL shape', () => {
  const repo = new CentralRepository();
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const CENTRAL = '22222222-2222-2222-2222-222222222222';

  const { sql, params } = queryOf(repo.lockByIdQuery(TENANT, CENTRAL));

  it('selects from centrals scoped by tenant + id', () => {
    expect(sql).toMatch(/select .* from\s+"centrals"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, CENTRAL]));
  });

  it('locks the row FOR UPDATE', () => {
    expect(sql).toMatch(/for\s+update/i);
  });

  it('is limited to a single row', () => {
    // Drizzle parameterizes the literal (`limit $3`), so assert the bound value.
    expect(sql).toMatch(/limit\s+\$\d+/i);
    expect(params).toContain(1);
  });
});
