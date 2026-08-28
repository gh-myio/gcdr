/**
 * RFC-0061 M2 — SQL-shape tests for InventoryStockRepository (no DB).
 * Same pattern as CentralCommandRepository.claim.sql.test.ts: assert the
 * generated SQL via PgDialect.sqlToQuery, most importantly the item-row
 * FOR UPDATE lock the negative-stock guard depends on (§M2).
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { InventoryStockRepository } from '../../../src/repositories/inventory/InventoryStockRepository';

const dialect = new PgDialect();

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

const TENANT = '11111111-1111-1111-1111-111111111111';
const ITEM = '33333333-3333-3333-3333-333333333333';

const repo = new InventoryStockRepository();

describe('InventoryStockRepository.lockItemQuery SQL shape', () => {
  const { sql, params } = queryOf(repo.lockItemQuery(TENANT, ITEM));

  it('selects the item row from inv_items scoped by tenant + id', () => {
    expect(sql).toMatch(/from\s+"inv_items"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, ITEM]));
  });

  it('locks the row with FOR UPDATE (serializes concurrent movements per item)', () => {
    expect(sql).toMatch(/for\s+update/i);
    expect(sql).toMatch(/limit\s+/i);
  });
});

describe('InventoryStockRepository.balanceQuery SQL shape', () => {
  const { sql, params } = queryOf(repo.balanceQuery(TENANT, ITEM, 'FABRICA'));

  it('aggregates over inv_stock_movements scoped by tenant + item + location', () => {
    expect(sql).toMatch(/from\s+"inv_stock_movements"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"item_id"\s*=/i);
    expect(sql).toMatch(/"location"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, ITEM, 'FABRICA']));
  });

  it('derives balance as in-types minus out-types (DEC-2 — never stored)', () => {
    expect(sql).toMatch(/case\s+when\s+"type"\s+in\s+\('ENTRADA','AJUSTE','TRANSFERENCIA_IN'\)/i);
    expect(sql).toMatch(/else\s+-\s*"quantity"/i);
    expect(sql).toMatch(/coalesce\(sum/i);
  });

  it('splits totalIn/totalOut with FILTER clauses and takes max(created_at)', () => {
    expect(sql).toMatch(/filter\s*\(where\s+"type"\s+in\s+\('ENTRADA','AJUSTE','TRANSFERENCIA_IN'\)\)/i);
    expect(sql).toMatch(/filter\s*\(where\s+"type"\s+in\s+\('SAIDA','TRANSFERENCIA_OUT'\)\)/i);
    expect(sql).toMatch(/max\("created_at"\)/i);
  });
});

describe('InventoryStockRepository.listBalancesQuery SQL shape', () => {
  it('groups by (item, location) joined with the catalog', () => {
    const { sql } = queryOf(repo.listBalancesQuery(TENANT, {}));
    expect(sql).toMatch(/inner\s+join\s+"inv_items"/i);
    expect(sql).toMatch(/group\s+by/i);
    expect(sql).toMatch(/"inv_stock_movements"\."item_id"/i);
    expect(sql).toMatch(/"inv_stock_movements"\."location"/i);
  });

  it('applies location and domain filters when given', () => {
    const { sql, params } = queryOf(
      repo.listBalancesQuery(TENANT, { location: 'ALMOXARIFADO', domain: 'PRODUCT' }),
    );
    expect(sql).toMatch(/"inv_stock_movements"\."location"\s*=/i);
    expect(sql).toMatch(/"inv_items"\."domain"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, 'ALMOXARIFADO', 'PRODUCT']));
  });
});

describe('InventoryStockRepository.listMovementsQuery SQL shape', () => {
  const { sql, params } = queryOf(repo.listMovementsQuery(TENANT, 2, 20));

  it('paginates the tenant ledger newest-first', () => {
    expect(sql).toMatch(/from\s+"inv_stock_movements"/i);
    expect(sql).toMatch(/order\s+by\s+"inv_stock_movements"\."created_at"\s+desc/i);
    expect(sql).toMatch(/limit\s+/i);
    expect(sql).toMatch(/offset\s+/i);
    // page 2, pageSize 20 → limit 20 offset 20
    expect(params).toEqual(expect.arrayContaining([TENANT, 20, 20]));
  });
});

describe('InventoryStockRepository.consistencyQuery SQL shape', () => {
  const q = dialect.sqlToQuery(repo.consistencyQuery(TENANT));

  it('compares ledger balance vs latest-event active QRs for manufactured items (W1)', () => {
    expect(q.sql).toMatch(/inv_stock_movements/);
    expect(q.sql).toMatch(/inv_movement_qrs/);
    expect(q.sql).toMatch(/is_manufactured/);
    expect(q.sql).toMatch(/DISTINCT ON \(mq\.qr_value\)/);
    expect(q.sql).toMatch(/type NOT IN \('SAIDA','TRANSFERENCIA_OUT'\)/);
    expect(q.sql).toMatch(/FULL OUTER JOIN/);
    expect(q.params).toEqual([TENANT, TENANT]);
  });
});

describe('InventoryStockRepository.deleteMovementsQuery SQL shape', () => {
  it('deletes the tenant ledger (QR links cascade via FK)', () => {
    const { sql, params } = queryOf(repo.deleteMovementsQuery(TENANT));
    expect(sql).toMatch(/delete\s+from\s+"inv_stock_movements"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/returning/i);
    expect(params).toEqual([TENANT]);
  });

  it('narrows to one location when given', () => {
    const { sql, params } = queryOf(repo.deleteMovementsQuery(TENANT, 'FABRICA'));
    expect(sql).toMatch(/"location"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, 'FABRICA']));
  });
});
