/**
 * SQL-shape tests for CentralCommandRepository.claimNextQueued / reapStalledJobs.
 * Same atomic claim as the restore poll loop, applied to central_commands. We
 * assert the generated SQL via PgDialect.sqlToQuery (no DB).
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { CentralCommandRepository } from '../../../src/repositories/CentralCommandRepository';

const dialect = new PgDialect();

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => import('drizzle-orm').SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

describe('CentralCommandRepository.claimNextQueued SQL shape', () => {
  const repo = new CentralCommandRepository();
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const CENTRAL = '22222222-2222-2222-2222-222222222222';

  const { sql, params } = queryOf(repo.claimNextQueuedQuery(TENANT, CENTRAL));

  it('is an UPDATE that transitions the command to RUNNING', () => {
    expect(sql).toMatch(/^\s*update\s+"central_commands"/i);
    expect(sql).toMatch(/set\s+"status"\s*=/i);
    expect(params).toContain('RUNNING');
  });

  it('only claims a QUEUED command for the given tenant + central', () => {
    expect(sql).toMatch(/"status"\s*=\s*'QUEUED'/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"central_id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, CENTRAL]));
  });

  it('claims the OLDEST queued command with FOR UPDATE SKIP LOCKED', () => {
    expect(sql).toMatch(/order\s+by\s+"central_commands"\."created_at"\s+asc/i);
    expect(sql).toMatch(/limit\s+1/i);
    expect(sql).toMatch(/for\s+update\s+skip\s+locked/i);
  });

  it('returns the claimed row', () => {
    expect(sql).toMatch(/returning/i);
  });
});

describe('CentralCommandRepository.reapStalledJobs SQL shape', () => {
  const repo = new CentralCommandRepository();
  const cutoff = new Date('2026-01-01T00:00:00.000Z');
  const { sql, params } = queryOf(repo.reapStalledJobsQuery(cutoff));

  it('fails stalled commands older than the cutoff', () => {
    expect(sql).toMatch(/^\s*update\s+"central_commands"/i);
    expect(sql).toMatch(/"updated_at"\s*</i);
    // status filter (RUNNING) and the new status (FAILED) are both bound params.
    expect(params).toContain('RUNNING');
    expect(params).toContain('FAILED');
    // cutoff is bound (Date or its ISO form, depending on driver serialization).
    expect(
      params.some((p) =>
        p instanceof Date ? p.getTime() === cutoff.getTime() : String(p).includes('2026-01-01'),
      ),
    ).toBe(true);
  });

  // A QUEUED command an offline central never claimed used to sit there for
  // good. findActiveByCentral then rejected every new command for that central
  // -- including the REBOOT an operator would reach for -- so one unreachable
  // box deadlocked its own queue, with the SET_WIFI password still in the row.
  it('reaps QUEUED as well as RUNNING, so an unclaimed command cannot deadlock the queue', () => {
    expect(params).toContain('QUEUED');
    expect(params).toContain('RUNNING');
  });

  // Whatever the reaper fails, it also strips: an abandoned SET_WIFI must not
  // leave its password behind in a row nobody will ever look at again.
  it('nulls the payload of everything it fails', () => {
    expect(sql).toMatch(/"payload"\s*=/i);
    expect(params).toContain(null);
  });

  it('returns what the sweep logs: the command and the central it belonged to', () => {
    expect(sql).toMatch(/returning/i);
    expect(sql).toMatch(/"central_id"/i);
  });
});
