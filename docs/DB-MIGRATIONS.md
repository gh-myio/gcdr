# Database Migrations — governance

## TL;DR

- **Tracking table:** `schema_migrations (filename, checksum, applied_at, applied_by)` — the single source of truth for what ran in each environment.
- **Runner:** `scripts/db/migrate-runner.ts` (aliases `db:mig:status` / `db:mig:up` / `db:mig:baseline`).
- **Fresh DB bootstrap:** `db:push` (schema.ts → DB) **then** `db:mig:baseline`.
- **Ongoing:** add a numbered `drizzle/migrations/NNNN_*.sql` → `db:mig:up`.

## Why a custom runner (not `drizzle-kit migrate`)

Migrations are **hand-written numbered SQL** in `drizzle/migrations/`. Drizzle's
own journal (`meta/_journal.json`) **froze at `0012`**, so `drizzle-kit migrate`
(and `db:migrate:prod`, which calls `drizzle-orm`'s migrator) only ever
tracked/applied `0000–0012`. Migrations `0013–0029` were applied **ad-hoc via
psql**, leaving no record of what ran where.

**The numbered migrations do NOT rebuild the schema from scratch.** Verified:
running `0000→0029` on an empty DB fails at `0017_templates_customer_id.sql`
(`relation "templates" does not exist`) — the `templates` table (and others)
were only ever created by `drizzle-kit push`, never by a CREATE-TABLE migration.
So the migration set is a series of **patches on top of a push-built base**, not
a replayable history.

Given that, the pragmatic, honest model is:

| Scenario | Do this |
|---|---|
| **Fresh/empty DB** (local dev, new env) | `db:push` to materialize the full current schema from `schema.ts`, then `db:mig:baseline` to record all current migrations as applied. |
| **Existing DB** (prod, already built by push + ad-hoc) | `db:mig:baseline` once to record the current files as applied (does **not** execute them). |
| **New migration from now on** | write `drizzle/migrations/NNNN_name.sql`, then `db:mig:up` (applies pending in order, each in a transaction, records checksum). |
| **Audit any env** | `db:mig:status` → applied / pending / changed(drift) / orphan. |

## Runner commands

```bash
# DATABASE_URL must be set (the runner is env-agnostic — same tool for local & prod)
npm run db:mig:status          # report: ✅ applied / ⏳ pending / ⚠️ changed / ❓ orphan
npm run db:mig:up              # apply every pending migration in order (tx each, records it)
npm run db:mig:baseline        # mark ALL current files as applied WITHOUT executing
npm run db:mig:baseline 0016   # baseline only up to 0016 (then `up` runs 0017+)
```

- **checksum drift:** if a `.sql` file is edited after being applied, `status`
  flags it `⚠️ CHANGED` and exits non-zero (migrations must be immutable once shipped).
- **orphan:** a row in `schema_migrations` with no file on disk.
- The table is created automatically on first run; it is not itself a migration.

## Local dev quick start

```powershell
docker compose -f docker-compose.db-local.yml up -d
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5544/db_gcdr"
npm run db:push           # full schema from schema.ts
npm run db:mig:baseline   # record migrations 0000..NNNN as applied
npm run db:mig:status     # → all applied
```

## Known gap / recommended follow-up

The 0013+ migrations assume a push-built base. To make fresh environments
reproducible **from migrations alone**, generate a single complete baseline
(`drizzle-kit generate` against an empty DB to capture every current table) and
treat older patches as historical. Until then, `db:push` is the bootstrap step.
The stale `drizzle/migrations/meta/_journal.json` and `combined-production.sql`
(only 0000+0001) are legacy and superseded by this runner.
