/**
 * SQL-shape tests for CentralReplacementRepository (RFC-0005). The full
 * replace() runs in one db.transaction and needs a real database; the query
 * builders it executes are asserted here via PgDialect.sqlToQuery (no DB),
 * same pattern as CentralCommandRepository.claim.sql.test.ts.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { CentralReplacementRepository } from '../../../src/repositories/CentralReplacementRepository';

const dialect = new PgDialect();

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => import('drizzle-orm').SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

const repo = new CentralReplacementRepository();
const TENANT = '11111111-1111-1111-1111-111111111111';
const OLD = '22222222-2222-2222-2222-222222222222';
const NEW = '33333333-3333-3333-3333-333333333333';
const REPLACEMENT_ID = '44444444-4444-4444-4444-444444444444';
const IPV6 = '200:1234:5678:9abc:def0:1234:5678:9abc';

describe('CentralReplacementRepository.lockOldCentralQuery SQL shape', () => {
  const { sql, params } = queryOf(repo.lockOldCentralQuery(TENANT, OLD));

  it('selects the old central scoped to the tenant', () => {
    expect(sql).toMatch(/from\s+"centrals"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, OLD]));
  });

  it('locks the row FOR UPDATE for the whole transaction', () => {
    expect(sql).toMatch(/for\s+update/i);
    expect(sql).toMatch(/limit\s+/i);
  });
});

describe('CentralReplacementRepository.priorReplacementQuery SQL shape', () => {
  const { sql, params } = queryOf(repo.priorReplacementQuery(TENANT, REPLACEMENT_ID));

  it('looks up the GATEWAY_REPLACED ledger event by replacementId in the tenant', () => {
    expect(sql).toMatch(/from\s+"audit_logs"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"event_type"\s*=/i);
    expect(sql).toMatch(/"metadata"\s*->>\s*'replacementId'/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, 'GATEWAY_REPLACED', REPLACEMENT_ID]));
  });
});

describe('CentralReplacementRepository.newUuidInUseQuery SQL shape', () => {
  const { sql, params } = queryOf(repo.newUuidInUseQuery(NEW));

  it('is a GLOBAL PK lookup (no tenant filter — the hardware UUID is global)', () => {
    expect(sql).toMatch(/from\s+"centrals"/i);
    expect(sql).toMatch(/"id"\s*=/i);
    expect(sql).not.toMatch(/"tenant_id"/i);
    expect(params).toContain(NEW);
  });
});

describe('CentralReplacementRepository.ipv6InUseQuery SQL shape', () => {
  const { sql, params } = queryOf(repo.ipv6InUseQuery(IPV6, OLD));

  it('matches config->>ipv6Yggdrasil on ACTIVE centrals excluding the replaced one', () => {
    expect(sql).toMatch(/"config"\s*->>\s*'ipv6Yggdrasil'/i);
    expect(sql).toMatch(/"status"\s*=/i);
    expect(sql).toMatch(/"id"\s*<>/i);
    expect(params).toEqual(expect.arrayContaining([IPV6, 'ACTIVE', OLD]));
  });
});

describe('CentralReplacementRepository.serialInUseQuery SQL shape', () => {
  const { sql, params } = queryOf(repo.serialInUseQuery(TENANT, '10.20.30.40', OLD));

  it('checks the reissued serial within the tenant (unique-index scope)', () => {
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"serial_number"\s*=/i);
    expect(sql).toMatch(/"id"\s*<>/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, '10.20.30.40', OLD]));
  });
});

describe('CentralReplacementRepository.repointDevicesQuery SQL shape', () => {
  const now = new Date('2026-07-30T00:00:00.000Z');
  const { sql, params } = queryOf(repo.repointDevicesQuery(TENANT, OLD, NEW, 'user-1', now));

  it('is an UPDATE on devices setting central_id to the new UUID', () => {
    expect(sql).toMatch(/^\s*update\s+"devices"/i);
    expect(sql).toMatch(/"central_id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([NEW]));
  });

  it('repoints ONLY the old central devices of the same tenant', () => {
    expect(sql).toMatch(/where/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, OLD]));
  });

  it('bumps version and returns the repointed ids (for the devicesRepointed count)', () => {
    expect(sql).toMatch(/"version"\s*\+\s*1/i);
    expect(sql).toMatch(/returning/i);
  });
});
