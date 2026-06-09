/**
 * Migration runner + governance — custom `schema_migrations` tracking table.
 *
 * The repo's migrations are hand-written numbered SQL files in
 * `drizzle/migrations/NNNN_*.sql`. Drizzle's own journal (`meta/_journal.json`)
 * froze at 0012, so `drizzle-kit migrate` no longer tracks 0013+. This runner
 * tracks EVERY numbered file by checksum in a `schema_migrations` table and is
 * the single source of truth for "what ran where".
 *
 * Usage (DATABASE_URL must be set):
 *   tsx scripts/db/migrate-runner.ts status              # applied / pending / drift
 *   tsx scripts/db/migrate-runner.ts up                  # apply pending, in order, each in a tx
 *   tsx scripts/db/migrate-runner.ts baseline [NNNN]     # mark as applied WITHOUT running
 *                                                        # (use on envs where the schema already exists;
 *                                                        #  optional NNNN limits up to that prefix)
 *
 * npm aliases: db:mig:status | db:mig:up | db:mig:baseline
 */
import postgres from 'postgres';
import { readFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || path.join(process.cwd(), 'drizzle/migrations');

const MIGRATION_RE = /^\d{4}_.*\.sql$/; // numbered files only — excludes combined-production.sql / meta

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => MIGRATION_RE.test(f)).sort();
}

function checksumOf(file: string): string {
  const content = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

async function ensureTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text        PRIMARY KEY,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      applied_by  text
    )
  `;
}

async function getApplied(sql: postgres.Sql): Promise<Map<string, string>> {
  const rows = await sql<{ filename: string; checksum: string }[]>`
    SELECT filename, checksum FROM schema_migrations
  `;
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

async function cmdStatus(sql: postgres.Sql): Promise<void> {
  await ensureTable(sql);
  const applied = await getApplied(sql);
  const files = listMigrationFiles();
  let pending = 0;
  let drift = 0;

  for (const f of files) {
    const cs = checksumOf(f);
    if (!applied.has(f)) {
      console.log(`  ⏳ PENDING  ${f}`);
      pending++;
    } else if (applied.get(f) !== cs) {
      console.log(`  ⚠️  CHANGED  ${f}  (file differs from what was applied)`);
      drift++;
    } else {
      console.log(`  ✅ applied  ${f}`);
    }
  }
  for (const f of applied.keys()) {
    if (!files.includes(f)) console.log(`  ❓ ORPHAN   ${f}  (in DB, no file on disk)`);
  }
  console.log(
    `\n${files.length} migrations · ${files.length - pending} applied · ${pending} pending · ${drift} changed`,
  );
  if (drift > 0) process.exitCode = 2;
}

async function cmdUp(sql: postgres.Sql, by: string): Promise<void> {
  await ensureTable(sql);
  const applied = await getApplied(sql);
  const pending = listMigrationFiles().filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log('Nothing to apply — up to date.');
    return;
  }
  for (const f of pending) {
    const content = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const cs = createHash('sha256').update(content).digest('hex');
    process.stdout.write(`Applying ${f} ... `);
    await sql.begin(async (tx) => {
      // simple protocol → allows the multi-statement migration body
      await tx.unsafe(content).simple();
      await tx`INSERT INTO schema_migrations (filename, checksum, applied_by)
               VALUES (${f}, ${cs}, ${by})`;
    });
    console.log('OK');
  }
  console.log(`\nApplied ${pending.length} migration(s).`);
}

async function cmdBaseline(sql: postgres.Sql, by: string, upTo?: string): Promise<void> {
  await ensureTable(sql);
  const applied = await getApplied(sql);
  let files = listMigrationFiles();
  if (upTo) files = files.filter((f) => f.slice(0, 4) <= upTo.padStart(4, '0'));
  const toMark = files.filter((f) => !applied.has(f));
  for (const f of toMark) {
    await sql`INSERT INTO schema_migrations (filename, checksum, applied_by)
              VALUES (${f}, ${checksumOf(f)}, ${by})
              ON CONFLICT (filename) DO NOTHING`;
  }
  console.log(
    `Baselined ${toMark.length} migration(s) as applied (NOT executed)` +
      (upTo ? ` up to ${upTo}` : '') + '.',
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2] || 'status';
  const arg = process.argv[3];
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL is not set');
    process.exit(1);
  }
  const by = process.env.MIGRATION_ACTOR || process.env.USER || process.env.USERNAME || 'runner';
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    switch (cmd) {
      case 'status':   await cmdStatus(sql); break;
      case 'up':       await cmdUp(sql, by); break;
      case 'baseline': await cmdBaseline(sql, by, arg); break;
      default:
        console.error(`Unknown command "${cmd}". Use: status | up | baseline [NNNN]`);
        process.exit(1);
    }
  } catch (err) {
    console.error('❌ Migration runner failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
