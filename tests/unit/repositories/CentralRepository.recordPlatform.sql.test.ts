/**
 * SQL-shape test for CentralRepository.recordPlatform. The agent stamps its
 * board on every poll, so this UPDATE runs constantly and has to be a no-op --
 * at the database, not after a read -- whenever the board has not changed.
 * We assert the generated SQL via PgDialect.sqlToQuery (no DB).
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { CentralRepository } from '../../../src/repositories/CentralRepository';

const dialect = new PgDialect();

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => import('drizzle-orm').SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

describe('CentralRepository.recordPlatform SQL shape', () => {
  const repo = new CentralRepository();
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const CENTRAL = '22222222-2222-2222-2222-222222222222';
  const PLATFORM = 'raspberrypi-cm4-64';

  const { sql, params } = queryOf(repo.recordPlatformQuery(TENANT, CENTRAL, PLATFORM));

  it('is a single UPDATE scoped to the tenant and central', () => {
    expect(sql).toMatch(/^\s*update\s+"centrals"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, CENTRAL]));
  });

  // The whole point of the rewrite: no SELECT to decide whether to write, and
  // the write itself does nothing when the board is unchanged.
  it('writes only when the stored platform differs', () => {
    expect(sql).toMatch(/->>'platform'\s+is\s+distinct\s+from/i);
    expect(params).toContain(PLATFORM);
  });

  // `IS DISTINCT FROM` rather than `<>`: on the very first poll the key is
  // absent, and `NULL <> 'x'` is NULL, which would never let the row be written.
  it('still writes when the key is absent, not just when it differs', () => {
    expect(sql).not.toMatch(/->>'platform'\s*<>/i);
  });

  // jsonb_set edits the one key, so a metadata field an operator changed
  // concurrently is not overwritten by a stale copy of the whole object.
  it('edits metadata.platform in place instead of replacing metadata', () => {
    expect(sql).toMatch(/jsonb_set\(/i);
    expect(sql).toMatch(/'\{platform\}'/);
    expect(sql).not.toMatch(/set\s+"metadata"\s*=\s*\$\d+\s*,/i);
  });

  it('bumps updated_at but not version, like the other heartbeat writes', () => {
    expect(sql).toMatch(/"updated_at"\s*=/i);
    expect(sql).not.toMatch(/"version"\s*=/i);
  });
});
