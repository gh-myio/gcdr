/**
 * SQL-shape tests for the RFC-0047 EntityRepository (no DB).
 *
 * We render the critical query builders through `PgDialect().sqlToQuery()` and
 * assert the SQL SHAPE only — the deterministic ORDER BY, the soft-delete /
 * partial-unique WHERE, the JSONB `@>` containment for `metadata.<path>`, and the
 * bulk-replace soft-delete + topological insert shape. These guard the exact SQL
 * the repo emits without standing up Postgres.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { eq, and, or, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../../../src/infrastructure/database/drizzle/db';

const { entities } = schema;
const dialect = new PgDialect();

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';

function queryOf(builder: unknown): { sql: string; params: unknown[] } {
  const sqlObj = (builder as { getSQL: () => import('drizzle-orm').SQL }).getSQL();
  const q = dialect.sqlToQuery(sqlObj);
  return { sql: q.sql, params: q.params };
}

describe('EntityRepository SQL shape', () => {
  it('exports the entityRepository singleton', () => {
    const { entityRepository, EntityRepository } = require('../../../src/repositories/EntityRepository');
    expect(entityRepository).toBeInstanceOf(EntityRepository);
  });

  it('list/resolve orders siblings by sort_order ASC then entity_key ASC', () => {
    const builder = db
      .select()
      .from(entities)
      .where(and(eq(entities.tenantId, TENANT), eq(entities.isDeleted, false)))
      .orderBy(entities.sortOrder, entities.entityKey);

    const { sql: text } = queryOf(builder);
    // ORDER BY "sort_order", "entity_key" (asc is the Drizzle default).
    expect(text).toMatch(/order by\s+"entities"\."sort_order",\s*"entities"\."entity_key"/i);
  });

  it('reads filter out soft-deleted rows (is_deleted = false)', () => {
    const builder = db
      .select()
      .from(entities)
      .where(and(eq(entities.tenantId, TENANT), eq(entities.isDeleted, false)));

    const { sql: text, params } = queryOf(builder);
    expect(text).toMatch(/"is_deleted"\s*=\s*\$\d+/);
    expect(params).toContain(false);
    expect(params).toContain(TENANT);
  });

  it('scope=system constrains customer_id IS NULL', () => {
    const builder = db
      .select()
      .from(entities)
      .where(and(eq(entities.tenantId, TENANT), isNull(entities.customerId)));

    const { sql: text } = queryOf(builder);
    expect(text).toMatch(/"customer_id"\s+is null/i);
  });

  it('metadata.<path> filter renders as JSONB containment (@>) with a json param', () => {
    const path = 'ingestionId';
    const value = 'ing_123';
    const json = JSON.stringify({ [path]: value });
    const condition = sql`${entities.metadata} @> ${json}::jsonb`;

    const builder = db.select().from(entities).where(condition);
    const { sql: text, params } = queryOf(builder);

    // Must be `"metadata" @> $n::jsonb` — containment, not equality or ->>.
    expect(text).toMatch(/"metadata"\s*@>\s*\$\d+::jsonb/);
    expect(params).toContain(json);
    // The json payload binds the top-level scalar, not a nested path expression.
    expect(json).toBe('{"ingestionId":"ing_123"}');
  });

  it('q search uses escaped ILIKE over entity_key and entity_value', () => {
    const pattern = '%chiller%';
    const condition = or(
      sql`${entities.entityKey} ILIKE ${pattern} ESCAPE '\\'`,
      sql`${entities.entityValue} ILIKE ${pattern} ESCAPE '\\'`,
    )!;
    const builder = db.select().from(entities).where(condition);
    const { sql: text, params } = queryOf(builder);

    expect(text).toMatch(/"entity_key"\s+ILIKE\s+\$\d+\s+ESCAPE/i);
    expect(text).toMatch(/"entity_value"\s+ILIKE\s+\$\d+\s+ESCAPE/i);
    expect(params).toContain(pattern);
  });

  it('id IN list renders an inArray placeholder set', () => {
    const ids = [
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ];
    const builder = db
      .select()
      .from(entities)
      .where(and(eq(entities.tenantId, TENANT), inArray(entities.id, ids)));

    const { sql: text, params } = queryOf(builder);
    expect(text).toMatch(/"id"\s+in\s+\(\$\d+,\s*\$\d+\)/i);
    expect(params).toEqual(expect.arrayContaining(ids));
  });

  it('bulk-replace soft-delete targets (customer_id, entity_type) live rows', () => {
    const builder = db
      .update(entities)
      .set({ isDeleted: true })
      .where(
        and(
          eq(entities.tenantId, TENANT),
          eq(entities.customerId, CUSTOMER),
          eq(entities.entityType, 'CLASSIFICATION_ENERGY'),
          eq(entities.isDeleted, false),
        ),
      );

    const { sql: text, params } = queryOf(builder);
    expect(text).toMatch(/update\s+"entities"\s+set\s+"is_deleted"\s*=\s*\$\d+/i);
    expect(text).toMatch(/"customer_id"\s*=\s*\$\d+/);
    expect(text).toMatch(/"entity_type"\s*=\s*\$\d+/);
    expect(params).toContain(CUSTOMER);
    expect(params).toContain('CLASSIFICATION_ENERGY');
  });

  it('bulk-replace insert carries customer_id, sort_order and is_system=false', () => {
    const builder = db.insert(entities).values({
      tenantId: TENANT,
      customerId: CUSTOMER,
      entityType: 'CLASSIFICATION_ENERGY',
      entityKey: 'root',
      sortOrder: 0,
      isSystem: false,
      createdBy: CUSTOMER,
      updatedBy: CUSTOMER,
    });

    const { sql: text } = queryOf(builder);
    expect(text).toMatch(/insert into "entities"/i);
    expect(text).toMatch(/"customer_id"/);
    expect(text).toMatch(/"sort_order"/);
    expect(text).toMatch(/"is_system"/);
    expect(text).toMatch(/"parent_entity_id"|"entity_key"/);
  });

  it('clone selects the system forest (customer_id IS NULL) FOR SHARE', () => {
    const builder = db
      .select()
      .from(entities)
      .where(and(eq(entities.tenantId, TENANT), isNull(entities.customerId), eq(entities.isDeleted, false)))
      .orderBy(entities.sortOrder, entities.entityKey)
      .for('share');

    const { sql: text } = queryOf(builder);
    expect(text).toMatch(/"customer_id"\s+is null/i);
    expect(text).toMatch(/for share/i);
    expect(text).toMatch(/order by\s+"entities"\."sort_order",\s*"entities"\."entity_key"/i);
  });
});
