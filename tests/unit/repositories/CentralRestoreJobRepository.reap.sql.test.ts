/**
 * SQL-shape test for CentralRestoreJobRepository.reapStalledJobs (CR-S5).
 * Asserts the generated SQL via PgDialect.sqlToQuery (no DB), same approach as
 * the claim SQL-shape test.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { CentralRestoreJobRepository } from '../../../src/repositories/CentralRestoreJobRepository';

const dialect = new PgDialect();

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => import('drizzle-orm').SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

describe('CentralRestoreJobRepository.reapStalledJobs SQL shape', () => {
  const repo = new CentralRestoreJobRepository();
  const cutoff = new Date('2026-01-01T00:00:00Z');
  const { sql, params } = queryOf(repo.reapStalledJobsQuery(cutoff));

  it('UPDATEs central_restore_jobs, setting status FAILED', () => {
    expect(sql).toMatch(/^\s*update\s+"central_restore_jobs"/i);
    expect(sql).toMatch(/set\s+"status"\s*=/i);
    expect(params).toContain('FAILED');
  });

  it('only targets RUNNING jobs older than the cutoff', () => {
    // status is a bound param (eq), updated_at uses a `<` bound comparison.
    expect(params).toContain('RUNNING');
    expect(sql).toMatch(/"status"\s*=\s*\$\d+/i);
    expect(sql).toMatch(/"updated_at"\s*<\s*\$\d+/i);
  });

  it('returns the reaped id + central_id', () => {
    expect(sql).toMatch(/returning/i);
    expect(sql).toMatch(/"id"/i);
    expect(sql).toMatch(/"central_id"/i);
  });
});
