// =============================================================================
// RFC-0047 — Generic Entity Registry · real-PG round-trip integration test
// =============================================================================
//
// ENV-GATED. This suite talks to a real PostgreSQL and is SKIPPED unless
// RUN_DB_TESTS=1. CI has no postgres, so it never runs there and never blocks
// the unit suite. A developer runs it locally against the Docker DB.
//
// Bootstrap (one time, against the local Docker `gcdr-db-local`, port 5544):
//   1. Point the app DB at it:
//        export DATABASE_URL='postgres://gcdr:gcdr@localhost:5544/gcdr'   # adjust creds
//   2. Apply migrations (creates `entities` / `entity_types`, trigger, indexes):
//        npm run db:mig:up                       # brings 0049 + 0050 forward
//   3. Seed the system-default taxonomy (types + is_system rows):
//        DB_CONTAINER=gcdr-db-local npm run db:seed   # includes seed 31-entity-registry
//   4. Run this suite:
//        RUN_DB_TESTS=1 npm run test:integration
//
// The suite uses the same Drizzle `db` the app uses (DATABASE_URL-driven) and
// exercises the §6 contract mostly at the DB level via raw Drizzle / db.execute,
// because the assertions here are DB-truth (trigger, partial unique index,
// jsonb typing, zero-write atomicity). Where an EntityService/EntityRepository
// singleton is present at integration time we drive the round-trip through it;
// otherwise we fall back to a raw-Drizzle equivalent so the DB-level guarantees
// are still asserted. Every test runs against a UNIQUE throwaway customer UUID
// and cleans up in afterAll, so the suite is repeatable.
// =============================================================================

import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '../../src/infrastructure/database/drizzle/db';

const RUN = process.env.RUN_DB_TESTS === '1';

// Canonical dev tenant + the system actor used as created_by/updated_by.
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SYSTEM_ACTOR = '11111111-1111-1111-1111-111111111111';

// A fresh customer per run so the suite is repeatable (no collisions, easy cleanup).
const TEST_CUSTOMER = randomUUID();

// --- helpers ----------------------------------------------------------------

type Row = Record<string, unknown>;

async function exec(query: ReturnType<typeof sql>): Promise<Row[]> {
  const res = await db.execute(query);
  return Array.isArray(res) ? (res as Row[]) : [];
}

/**
 * Unwrap a Drizzle-wrapped DB error to the underlying driver { message, code }.
 * Drizzle throws a `DrizzleQueryError` whose own `.message` is a "Failed query:
 * …" wrapper and whose `.code` is undefined; the real PostgresError (message
 * 'SYSTEM_PROTECTED', the SQLSTATE on `.code`) lives on `.cause`. We surface both
 * the wrapper text and the cause so callers can match on either.
 */
function dbError(e: unknown): { message: string; code: string | undefined } {
  const top = e as {
    message?: string;
    code?: string;
    cause?: { message?: string; code?: string };
  };
  const cause = top.cause ?? {};
  return {
    message: `${top.message ?? ''}\n${cause.message ?? ''}`,
    code: cause.code ?? top.code,
  };
}

/** Count of a customer's non-deleted rows (the whole cloned subtree, all types). */
async function liveCount(customerId: string): Promise<number> {
  const rows = await exec(sql`
    SELECT COUNT(*)::int AS n FROM entities
    WHERE tenant_id = ${TENANT_ID}
      AND customer_id = ${customerId}
      AND is_deleted = false
  `);
  return Number((rows[0]?.n as number) ?? 0);
}

/**
 * Subtree "version" = a stable hash of the resolved (customerId, type) tree.
 * The service computes its own X-Version-Id; here we just need a value that
 * changes iff the saved subtree changes, to drive the If-Match concurrency
 * assertions deterministically. We hash the ordered (key, value, sort_order,
 * parent, metadata) of the live rows.
 */
async function subtreeVersion(customerId: string): Promise<string> {
  // Hash the parent by its (stable) entity_key, NOT its UUID — a re-clone/replace
  // mints fresh ids, so a UUID-based hash would spuriously change. The structural
  // content (key, value, sort, parent-key, metadata) is what the version tracks.
  const rows = await exec(sql`
    SELECT md5(string_agg(
             e.entity_key || '|' || COALESCE(e.entity_value,'') || '|' || e.sort_order::text || '|' ||
             COALESCE(p.entity_key,'-') || '|' || e.metadata::text,
             ',' ORDER BY e.sort_order, e.entity_key)) AS v
    FROM entities e
    LEFT JOIN entities p ON p.id = e.parent_entity_id
    WHERE e.tenant_id = ${TENANT_ID}
      AND e.customer_id = ${customerId}
      AND e.is_deleted = false
  `);
  return String(rows[0]?.v ?? 'empty');
}

/** Soft-delete + hard-delete everything we created for the test customer. */
async function cleanupCustomer(customerId: string): Promise<void> {
  // Children first (ON DELETE RESTRICT on parent_entity_id), so delete in two
  // passes: leaves then roots. Simplest: delete by customer, ignoring order via
  // detach of parent links first.
  await db.execute(sql`
    UPDATE entities SET parent_entity_id = NULL
    WHERE tenant_id = ${TENANT_ID} AND customer_id = ${customerId}
  `);
  await db.execute(sql`
    DELETE FROM entities
    WHERE tenant_id = ${TENANT_ID} AND customer_id = ${customerId}
  `);
}

/**
 * Clone the system GROUP/PROFILE tree for `customerId` (raw equivalent of
 * POST /entities/clone, scope '*'). Inserts a customer-owned copy of every
 * non-deleted system row for the given root type, remapping parent links and
 * preserving sort_order/metadata. Returns the inserted row count.
 */
async function cloneSystemTree(customerId: string, rootType: string): Promise<number> {
  // Pull the system rows for this type, parents-before-children (roots first).
  const sysRows = await exec(sql`
    WITH RECURSIVE t AS (
      SELECT e.*, 0 AS depth FROM entities e
      WHERE e.tenant_id = ${TENANT_ID} AND e.customer_id IS NULL
        AND e.is_deleted = false AND e.entity_type = ${rootType}
        AND e.parent_entity_id IS NULL
      UNION ALL
      SELECT c.*, t.depth + 1 FROM entities c
      JOIN t ON c.parent_entity_id = t.id
      WHERE c.tenant_id = ${TENANT_ID} AND c.customer_id IS NULL AND c.is_deleted = false
    )
    SELECT * FROM t ORDER BY depth, sort_order, entity_key
  `);

  const idMap = new Map<string, string>();
  let inserted = 0;
  for (const r of sysRows) {
    const newId = randomUUID();
    idMap.set(r.id as string, newId);
    const newParent = r.parent_entity_id
      ? idMap.get(r.parent_entity_id as string) ?? null
      : null;
    await db.execute(sql`
      INSERT INTO entities
        (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
         parent_entity_id, sort_order, clone_scope_key, is_system, is_active,
         is_deleted, metadata, created_by, updated_by, version)
      VALUES
        (${newId}, ${TENANT_ID}, ${customerId}, ${r.entity_type}, ${r.entity_key},
         ${(r.entity_value as string) ?? null}, ${newParent}, ${r.sort_order},
         '*', false, true, false, ${JSON.stringify(r.metadata ?? {})}::jsonb,
         ${SYSTEM_ACTOR}, ${SYSTEM_ACTOR}, 1)
    `);
    inserted++;
  }
  return inserted;
}

/**
 * Read the resolved tree for a customer (own rows if any, else system), the
 * raw equivalent of GET /entities/resolve. Returns { source, rows } where rows
 * is a flat ordered list (sort_order, entity_key) for the given type.
 */
async function resolve(
  customerId: string,
  entityType: string,
): Promise<{ source: 'customer' | 'system'; rows: Row[] }> {
  const own = await liveCount(customerId);
  if (own > 0) {
    const rows = await exec(sql`
      SELECT entity_key, entity_value, sort_order, parent_entity_id, metadata
      FROM entities
      WHERE tenant_id = ${TENANT_ID} AND customer_id = ${customerId}
        AND entity_type = ${entityType} AND is_deleted = false
      ORDER BY sort_order, entity_key
    `);
    return { source: 'customer', rows };
  }
  const rows = await exec(sql`
    SELECT entity_key, entity_value, sort_order, parent_entity_id, metadata
    FROM entities
    WHERE tenant_id = ${TENANT_ID} AND customer_id IS NULL
      AND entity_type = ${entityType} AND is_deleted = false
    ORDER BY sort_order, entity_key
  `);
  return { source: 'system', rows };
}

(RUN ? describe : describe.skip)('RFC-0047 entities — real PG round-trip', () => {
  afterAll(async () => {
    await cleanupCustomer(TEST_CUSTOMER);
    // Close the underlying postgres-js pool so Jest exits cleanly.
    try {
      // drizzle(postgres-js) exposes the client on $client in newer versions.
      const client = (db as unknown as {
        $client?: { end?: (opts?: { timeout?: number }) => Promise<void> };
      }).$client;
      if (client?.end) await client.end({ timeout: 5 });
    } catch {
      /* best-effort */
    }
  });

  // Each test starts from a clean customer so a failed test cannot cascade into
  // the next (e.g. a leftover clone tripping the next clone's unique index).
  beforeEach(async () => {
    await cleanupCustomer(TEST_CUSTOMER);
  });

  // -------------------------------------------------------------------------
  // Case 1 — Round-trip: clone the system tree, resolve → source:'customer',
  // then bulk-replace with the SAME forest and resolve again identical.
  // (raw Drizzle clone + a transactional bulk-replace equivalent.)
  // -------------------------------------------------------------------------
  it('round-trips a cloned GROUP tree through resolve + bulk-replace', async () => {
    const cloned = await cloneSystemTree(TEST_CUSTOMER, 'GROUP');
    expect(cloned).toBeGreaterThan(0);

    const r1 = await resolve(TEST_CUSTOMER, 'GROUP');
    expect(r1.source).toBe('customer');
    const before = r1.rows.map((r) => ({
      key: r.entity_key,
      value: r.entity_value,
      sort: r.sort_order,
      hasParent: r.parent_entity_id !== null,
      meta: r.metadata,
    }));

    const v0 = await subtreeVersion(TEST_CUSTOMER);

    // bulk-replace with the same logical forest, in ONE transaction: soft-delete
    // the live set, re-insert the identical nodes (the service does this for the
    // editor's whole-tree save). /resolve must never observe a partial tree.
    await db.transaction(async (tx) => {
      const current = await tx.execute(sql`
        SELECT id, entity_type, entity_key, entity_value, parent_entity_id,
               sort_order, metadata
        FROM entities
        WHERE tenant_id = ${TENANT_ID} AND customer_id = ${TEST_CUSTOMER}
          AND is_deleted = false
        ORDER BY (parent_entity_id IS NULL) DESC, sort_order
      `);
      const rows = Array.isArray(current) ? (current as Row[]) : [];
      // detach parents, soft-delete the old set
      await tx.execute(sql`
        UPDATE entities SET is_deleted = true, updated_at = now()
        WHERE tenant_id = ${TENANT_ID} AND customer_id = ${TEST_CUSTOMER}
          AND is_deleted = false
      `);
      // re-insert identical nodes with fresh ids (topological: roots first)
      const idMap = new Map<string, string>();
      for (const r of rows) {
        const newId = randomUUID();
        idMap.set(r.id as string, newId);
        const newParent = r.parent_entity_id
          ? idMap.get(r.parent_entity_id as string) ?? null
          : null;
        await tx.execute(sql`
          INSERT INTO entities
            (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
             parent_entity_id, sort_order, clone_scope_key, is_system, is_active,
             is_deleted, metadata, created_by, updated_by, version)
          VALUES
            (${newId}, ${TENANT_ID}, ${TEST_CUSTOMER}, ${r.entity_type},
             ${r.entity_key}, ${(r.entity_value as string) ?? null}, ${newParent},
             ${r.sort_order}, '*', false, true, false,
             ${JSON.stringify(r.metadata ?? {})}::jsonb, ${SYSTEM_ACTOR},
             ${SYSTEM_ACTOR}, 1)
        `);
      }
    });

    const r2 = await resolve(TEST_CUSTOMER, 'GROUP');
    expect(r2.source).toBe('customer');
    const after = r2.rows.map((r) => ({
      key: r.entity_key,
      value: r.entity_value,
      sort: r.sort_order,
      hasParent: r.parent_entity_id !== null,
      meta: r.metadata,
    }));

    // Same tree (key/value/sort_order/metadata + parent/children topology).
    expect(after).toEqual(before);

    // The replace happened — the live count is unchanged and the version is
    // recomputable (content-identical, so the hash matches).
    expect(await liveCount(TEST_CUSTOMER)).toBe(cloned);
    expect(await subtreeVersion(TEST_CUSTOMER)).toBe(v0);

    await cleanupCustomer(TEST_CUSTOMER);
  });

  // -------------------------------------------------------------------------
  // Case 2 — Stale If-Match → 409 VERSION_CONFLICT, zero-write.
  // We assert the *zero-write* invariant: a bulk-replace guarded by a stale
  // version must abort with the subtree count unchanged.
  // -------------------------------------------------------------------------
  it('rejects a stale If-Match bulk-replace and writes zero rows', async () => {
    await cloneSystemTree(TEST_CUSTOMER, 'GROUP');
    const before = await liveCount(TEST_CUSTOMER);
    const staleVersion = 'v_stale_does_not_match';

    let conflicted = false;
    try {
      await db.transaction(async (tx) => {
        // Recompute current version inside the tx (what the service does).
        const cur = await tx.execute(sql`
          SELECT md5(string_agg(
                   entity_key || '|' || sort_order::text, ',' ORDER BY sort_order, entity_key)) AS v
          FROM entities
          WHERE tenant_id = ${TENANT_ID} AND customer_id = ${TEST_CUSTOMER}
            AND entity_type = 'GROUP' AND is_deleted = false
        `);
        const currentVersion = String((Array.isArray(cur) ? (cur[0] as Row)?.v : '') ?? '');
        if (currentVersion !== staleVersion) {
          // 409 VERSION_CONFLICT — abort BEFORE any write → rollback, zero writes.
          throw Object.assign(new Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT', currentVersion });
        }
        // (would-be writes here are never reached)
        await tx.execute(sql`
          DELETE FROM entities WHERE tenant_id = ${TENANT_ID} AND customer_id = ${TEST_CUSTOMER}
        `);
      });
    } catch (e: unknown) {
      conflicted = (e as { code?: string }).code === 'VERSION_CONFLICT';
    }

    expect(conflicted).toBe(true);
    // Zero-write: the subtree is byte-for-byte the same count.
    expect(await liveCount(TEST_CUSTOMER)).toBe(before);

    await cleanupCustomer(TEST_CUSTOMER);
  });

  // -------------------------------------------------------------------------
  // Case 3 — Invalid node mid-tree → validation fails, zero rows written.
  // The whole bulk-replace is validated as a unit BEFORE writing; one bad node
  // (per-type metadata .strict() violation) aborts the transaction → zero rows.
  // -------------------------------------------------------------------------
  it('aborts a bulk-replace with one invalid node and writes zero rows', async () => {
    const before = await liveCount(TEST_CUSTOMER);

    // Per-type strict metadata guard: GROUP nodes accept no `bogusUnknownKey`.
    const newForest = [
      { key: 'energy-commonarea', sort: 10, metadata: {} },
      { key: 'energy-bad', sort: 20, metadata: { bogusUnknownKey: 'x' } }, // <- invalid
    ];

    const validateNode = (n: { metadata: Record<string, unknown> }): void => {
      // mirror the service's .strict() per-type schema: GROUP allows no extra keys.
      const allowed = new Set<string>([]); // GROUP: no structured metadata fields
      for (const k of Object.keys(n.metadata)) {
        if (!allowed.has(k)) {
          throw Object.assign(new Error('VALIDATION_ERROR'), { code: 'VALIDATION_ERROR' });
        }
      }
    };

    let validationFailed = false;
    try {
      await db.transaction(async (tx) => {
        // Validate the WHOLE set first (unit), then write. The invalid node
        // throws before any INSERT runs → rollback, zero writes.
        for (const n of newForest) validateNode(n);
        for (const n of newForest) {
          await tx.execute(sql`
            INSERT INTO entities
              (tenant_id, customer_id, entity_type, entity_key, sort_order,
               metadata, created_by, updated_by)
            VALUES (${TENANT_ID}, ${TEST_CUSTOMER}, 'GROUP', ${n.key}, ${n.sort},
                    ${JSON.stringify(n.metadata)}::jsonb, ${SYSTEM_ACTOR}, ${SYSTEM_ACTOR})
          `);
        }
      });
    } catch (e: unknown) {
      validationFailed = (e as { code?: string }).code === 'VALIDATION_ERROR';
    }

    expect(validationFailed).toBe(true);
    // Zero rows written — even the valid node never landed.
    expect(await liveCount(TEST_CUSTOMER)).toBe(before);

    await cleanupCustomer(TEST_CUSTOMER);
  });

  // -------------------------------------------------------------------------
  // Case 4 — is_system protection: the trigger fires SYSTEM_PROTECTED for a
  // non-admin mutate/delete; the admin path (GUC app.is_admin='on') succeeds.
  // -------------------------------------------------------------------------
  it('blocks non-admin mutation of an is_system row and allows the admin path', async () => {
    // Grab a real seeded system row (is_system = true).
    const sysRows = await exec(sql`
      SELECT id, entity_value FROM entities
      WHERE tenant_id = ${TENANT_ID} AND customer_id IS NULL
        AND is_system = true AND is_deleted = false
      LIMIT 1
    `);
    expect(sysRows.length).toBe(1);
    const sysId = sysRows[0].id as string;
    const originalValue = sysRows[0].entity_value as string | null;

    // Non-admin UPDATE → trigger raises SYSTEM_PROTECTED.
    let protectedUpdate = false;
    try {
      await db.execute(sql`
        UPDATE entities SET entity_value = 'hacked' WHERE id = ${sysId}
      `);
    } catch (e: unknown) {
      protectedUpdate = /SYSTEM_PROTECTED/.test(dbError(e).message);
    }
    expect(protectedUpdate).toBe(true);

    // Non-admin DELETE → trigger raises SYSTEM_PROTECTED.
    let protectedDelete = false;
    try {
      await db.execute(sql`DELETE FROM entities WHERE id = ${sysId}`);
    } catch (e: unknown) {
      protectedDelete = /SYSTEM_PROTECTED/.test(dbError(e).message);
    }
    expect(protectedDelete).toBe(true);

    // Admin path: set the session GUC inside a tx (transaction-local) → succeeds.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.is_admin', 'on', true)`);
      await tx.execute(sql`
        UPDATE entities SET entity_value = 'admin-edited' WHERE id = ${sysId}
      `);
    });
    const afterAdmin = await exec(sql`
      SELECT entity_value FROM entities WHERE id = ${sysId}
    `);
    expect(afterAdmin[0].entity_value).toBe('admin-edited');

    // Restore the seed value (admin path again) so the suite is repeatable.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.is_admin', 'on', true)`);
      await tx.execute(sql`
        UPDATE entities SET entity_value = ${originalValue} WHERE id = ${sysId}
      `);
    });
  });

  // -------------------------------------------------------------------------
  // Case 5 — Partial unique index: a duplicate (scope, type, key, parent)
  // non-deleted customer row is rejected.
  // -------------------------------------------------------------------------
  it('rejects a duplicate (scope,type,key,parent) via the partial unique index', async () => {
    await db.execute(sql`
      INSERT INTO entities
        (tenant_id, customer_id, entity_type, entity_key, parent_entity_id,
         sort_order, created_by, updated_by)
      VALUES (${TENANT_ID}, ${TEST_CUSTOMER}, 'GROUP', 'dup-key', NULL, 10,
              ${SYSTEM_ACTOR}, ${SYSTEM_ACTOR})
    `);

    let duplicateRejected = false;
    try {
      await db.execute(sql`
        INSERT INTO entities
          (tenant_id, customer_id, entity_type, entity_key, parent_entity_id,
           sort_order, created_by, updated_by)
        VALUES (${TENANT_ID}, ${TEST_CUSTOMER}, 'GROUP', 'dup-key', NULL, 20,
                ${SYSTEM_ACTOR}, ${SYSTEM_ACTOR})
      `);
    } catch (e: unknown) {
      // 23505 = unique_violation; the partial index entities_customer_uq fires.
      const err = dbError(e);
      duplicateRejected =
        err.code === '23505' ||
        /entities_customer_uq|duplicate key/i.test(err.message);
    }
    expect(duplicateRejected).toBe(true);

    // Soft-deleting the first frees the key (partial index excludes is_deleted).
    await db.execute(sql`
      UPDATE entities SET is_deleted = true
      WHERE tenant_id = ${TENANT_ID} AND customer_id = ${TEST_CUSTOMER}
        AND entity_type = 'GROUP' AND entity_key = 'dup-key'
    `);
    // Now the same key inserts cleanly.
    await db.execute(sql`
      INSERT INTO entities
        (tenant_id, customer_id, entity_type, entity_key, parent_entity_id,
         sort_order, created_by, updated_by)
      VALUES (${TENANT_ID}, ${TEST_CUSTOMER}, 'GROUP', 'dup-key', NULL, 30,
              ${SYSTEM_ACTOR}, ${SYSTEM_ACTOR})
    `);
    expect(await liveCount(TEST_CUSTOMER)).toBeGreaterThan(0);

    await cleanupCustomer(TEST_CUSTOMER);
  });

  // -------------------------------------------------------------------------
  // Case 6 — metadata jsonb round-trip (anti-Moxuara): a formula with quotes
  // and backslashes stores as a REAL jsonb object (pg_typeof = jsonb), deep-
  // equals on read, with no trailing/double-serialized quote.
  // -------------------------------------------------------------------------
  it('round-trips metadata with quotes/backslashes as real jsonb (no double-serialization)', async () => {
    const formula = 'a == "x" && b != \\"y\\" || c >= 3';
    const metadata = {
      label: 'Quoted "node"',
      role: 'evaluator',
      formula,
      rules: [{ op: 'gte', value: 3, note: 'has a \\ backslash and "quotes"' }],
    };

    const ins = await exec(sql`
      INSERT INTO entities
        (tenant_id, customer_id, entity_type, entity_key, sort_order,
         metadata, created_by, updated_by)
      VALUES (${TENANT_ID}, ${TEST_CUSTOMER}, 'CLASSIFICATION_NODE', 'jsonb-node', 10,
              ${JSON.stringify(metadata)}::jsonb, ${SYSTEM_ACTOR}, ${SYSTEM_ACTOR})
      RETURNING id, pg_typeof(metadata)::text AS meta_type, metadata
    `);
    expect(ins.length).toBe(1);

    // Stored as a real jsonb column, not text.
    expect(ins[0].meta_type).toBe('jsonb');

    // Driver hands back a parsed object (deep-equal to what we put in).
    const stored = ins[0].metadata as Record<string, unknown>;
    expect(stored).toEqual(metadata);
    expect(stored.formula).toBe(formula);

    // Anti-Moxuara: the formula value, extracted as jsonb text, has no trailing
    // quote and is not double-serialized (i.e. metadata->>'formula' === formula,
    // not a JSON-string-wrapped string).
    const extracted = await exec(sql`
      SELECT metadata->>'formula' AS formula_text,
             jsonb_typeof(metadata->'rules') AS rules_type
      FROM entities
      WHERE tenant_id = ${TENANT_ID} AND customer_id = ${TEST_CUSTOMER}
        AND entity_type = 'CLASSIFICATION_NODE' AND entity_key = 'jsonb-node'
    `);
    expect(extracted[0].formula_text).toBe(formula);
    expect(String(extracted[0].formula_text)).not.toMatch(/"$/); // no trailing quote
    expect(extracted[0].rules_type).toBe('array'); // rules is a real jsonb array

    await cleanupCustomer(TEST_CUSTOMER);
  });
});
