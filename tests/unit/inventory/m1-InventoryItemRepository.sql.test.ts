/**
 * RFC-0061 M1 — SQL-shape tests for InventoryItemRepository. The query
 * builders are asserted via PgDialect.sqlToQuery without a database, same
 * pattern as CentralReplacementRepository.sql.test.ts.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { InventoryItemRepository } from '../../../src/repositories/inventory/InventoryItemRepository';

const dialect = new PgDialect();

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => import('drizzle-orm').SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

const repo = new InventoryItemRepository();
const TENANT = '11111111-1111-1111-1111-111111111111';
const ITEM = '22222222-2222-2222-2222-222222222222';

describe('InventoryItemRepository.stockByItemQuery SQL shape (GET /items/:id/stock)', () => {
  const { sql, params } = queryOf(repo.stockByItemQuery(TENANT, ITEM));

  it('aggregates the ledger scoped to tenant + item, grouped by location', () => {
    expect(sql).toMatch(/from\s+"inv_stock_movements"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"item_id"\s*=/i);
    expect(sql).toMatch(/group\s+by\s+"inv_stock_movements"\."location"/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, ITEM]));
  });

  it('adds ENTRADA/AJUSTE/TRANSFERENCIA_IN and subtracts SAIDA/TRANSFERENCIA_OUT', () => {
    // total_in branch: the three in-types sum the quantity.
    expect(sql).toMatch(/case when .*'ENTRADA','AJUSTE','TRANSFERENCIA_IN'.* then .*"quantity" else 0 end/i);
    // total_out branch: the two out-types sum the quantity.
    expect(sql).toMatch(/case when .*'SAIDA','TRANSFERENCIA_OUT'.* then .*"quantity" else 0 end/i);
    // balance branch: out-types are NEGATED (else -quantity).
    expect(sql).toMatch(/then .*"quantity" else -.*"quantity" end/i);
    // never NULL on an empty ledger.
    expect(sql).toMatch(/coalesce\(sum\(/i);
  });

  it('exposes the last movement timestamp per location', () => {
    expect(sql).toMatch(/max\(.*"created_at".*\)/i);
  });
});

describe('InventoryItemRepository.listQuery SQL shape (GET /items)', () => {
  it('pages, filters by tenant and orders by name', () => {
    const { sql, params } = queryOf(repo.listQuery(TENANT, { page: 2, pageSize: 20 }));
    expect(sql).toMatch(/from\s+"inv_items"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/order\s+by\s+"inv_items"\."name"\s+asc/i);
    expect(sql).toMatch(/limit\s+/i);
    expect(sql).toMatch(/offset\s+/i);
    // page 2 × pageSize 20 → offset 20
    expect(params).toEqual(expect.arrayContaining([TENANT, 20, 20]));
  });

  it('applies domain/active/q filters when present (q via ILIKE on name)', () => {
    const { sql, params } = queryOf(
      repo.listQuery(TENANT, { page: 1, pageSize: 10, domain: 'PRODUCT', active: true, q: 'medidor' }),
    );
    expect(sql).toMatch(/"domain"\s*=/i);
    expect(sql).toMatch(/"active"\s*=/i);
    expect(sql).toMatch(/"name"\s+ilike\s+/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, 'PRODUCT', true, '%medidor%']));
  });
});

describe('InventoryItemRepository.bomQuery SQL shape (GET /items/:id/bom)', () => {
  const { sql, params } = queryOf(repo.bomQuery(TENANT, ITEM));

  it('joins inv_boms to the component catalog row, scoped to tenant + product', () => {
    expect(sql).toMatch(/from\s+"inv_boms"/i);
    expect(sql).toMatch(/inner\s+join\s+"inv_items"/i);
    expect(sql).toMatch(/"component_item_id"\s*=\s*"inv_items"\."id"/i);
    expect(sql).toMatch(/"tenant_id"\s*=/i);
    expect(sql).toMatch(/"product_item_id"\s*=/i);
    expect(params).toEqual(expect.arrayContaining([TENANT, ITEM]));
  });
});
