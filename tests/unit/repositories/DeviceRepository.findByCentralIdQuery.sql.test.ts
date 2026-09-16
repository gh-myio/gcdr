/**
 * SQL-shape test for DeviceRepository.findByCentralIdQuery.
 *
 * This is the query the device-topology view walks page by page, so its ORDER BY
 * has to be a TOTAL order: `name` alone is not unique on a central, and under
 * LIMIT/OFFSET the database may return tied rows in a different order on each
 * page -- a device that changes sides of a page boundary is skipped and vanishes
 * from the topology. Asserted via PgDialect.sqlToQuery (no DB) -- same technique
 * as CentralRepository.lockByIdQuery.sql.test.ts.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { DeviceRepository } from '../../../src/repositories/DeviceRepository';

const dialect = new PgDialect();

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => import('drizzle-orm').SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

describe('DeviceRepository.findByCentralIdQuery SQL shape', () => {
  const repo = new DeviceRepository();
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const CENTRAL = '22222222-2222-2222-2222-222222222222';

  it('scopes the page by tenant + central', () => {
    const { sql, params } = queryOf(repo.findByCentralIdQuery(TENANT, CENTRAL));
    expect(sql).toMatch(/from\s+"devices"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"central_id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, CENTRAL]));
  });

  it('orders by a UNIQUE key as well as the name, so paging cannot skip a row', () => {
    const { sql } = queryOf(repo.findByCentralIdQuery(TENANT, CENTRAL));
    // Drizzle qualifies the columns: order by "devices"."name", "devices"."id".
    expect(sql).toMatch(/order\s+by\s+"devices"\."name",\s*"devices"\."id"/i);
  });

  it('asks for one row more than the page, which is how hasMore is decided', () => {
    const { sql, params } = queryOf(repo.findByCentralIdQuery(TENANT, CENTRAL, { limit: 100 }));
    expect(sql).toMatch(/limit\s+\$\d+/i);
    expect(params).toContain(101);
  });

  it('turns the cursor into the OFFSET it is', () => {
    const { params } = queryOf(
      repo.findByCentralIdQuery(TENANT, CENTRAL, { limit: 100, cursor: '200' }),
    );
    expect(params).toContain(200);
  });

  it('carries the status filter into the WHERE when one is asked for', () => {
    const { sql, params } = queryOf(
      repo.findByCentralIdQuery(TENANT, CENTRAL, { limit: 100, status: 'ACTIVE' }),
    );
    expect(sql).toMatch(/"status"\s*=/i);
    expect(params).toContain('ACTIVE');
  });

  it('leaves the status out entirely when none is asked for', () => {
    const { params } = queryOf(repo.findByCentralIdQuery(TENANT, CENTRAL, { limit: 100 }));
    expect(params).not.toContain('ACTIVE');
  });
});
