/**
 * SQL-shape test for CentralRestoreJobRepository.claimNextQueued.
 *
 * The claim is the atomic heart of the central-agent poll loop: it must
 * transition the OLDEST QUEUED job for ONE central to RUNNING in a single
 * statement (version-bumped), and only that central's jobs. We assert the
 * generated SQL via PgDialect.sqlToQuery (no DB) — same approach as
 * WikiPageRepository.sql.test.ts.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { CentralRestoreJobRepository } from '../../../src/repositories/CentralRestoreJobRepository';

const dialect = new PgDialect();

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => import('drizzle-orm').SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

describe('CentralRestoreJobRepository.claimNextQueued SQL shape', () => {
  const repo = new CentralRestoreJobRepository();
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const CENTRAL = '22222222-2222-2222-2222-222222222222';

  const { sql, params } = queryOf(repo.claimNextQueuedQuery(TENANT, CENTRAL));

  it('is an UPDATE that transitions the job to RUNNING and bumps version', () => {
    expect(sql).toMatch(/^\s*update\s+"central_restore_jobs"/i);
    // status set to RUNNING (bound param) + version bumped.
    expect(sql).toMatch(/set\s+"status"\s*=/i);
    expect(params).toContain('RUNNING');
    expect(sql).toMatch(/"version"\s*=\s*"central_restore_jobs"\."version"\s*\+\s*1/i);
  });

  it('only claims a QUEUED job for the given tenant + central', () => {
    // Inner select filters status = 'QUEUED'
    expect(sql).toMatch(/"status"\s*=\s*'QUEUED'/i);
    // Scoped to BOTH tenant_id and central_id (bound params present)
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"central_id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, CENTRAL]));
  });

  it('claims the OLDEST queued job (order by created_at asc, limit 1)', () => {
    expect(sql).toMatch(/order\s+by\s+"central_restore_jobs"\."created_at"\s+asc/i);
    expect(sql).toMatch(/limit\s+1/i);
    // Concurrency-safe handout: skip rows another poll already locked.
    expect(sql).toMatch(/for\s+update\s+skip\s+locked/i);
  });

  it('returns the claimed row', () => {
    expect(sql).toMatch(/returning/i);
  });
});
