# RFC: Dokploy Deployment Issues Post-Mortem

- Feature Name: dokploy-deployment-issues
- Start Date: 2026-01-29
- RFC PR: (leave blank)
- Tracking Issue: (leave blank)
- Quick Reference: [SOLVE-DOKPLOY.md](./SOLVE-DOKPLOY.md)

## Summary
This RFC documents multiple issues encountered during Dokploy deployment on 2026-01-29,
their root causes, and applied solutions. The primary issue was a container restart loop,
but additional problems with Swagger UI and CSP were also identified and resolved.

## Motivation
The current production Dockerfile runs migrations and then starts the API. If
`DATABASE_URL` is missing or malformed, the migration script exits with code 1 and
the application boot also throws, causing the container to exit immediately. The
orchestrator restarts it repeatedly, which prevents log collection and delays
incident response.

## Issues Overview

| # | Issue | Root Cause | Status |
|---|-------|------------|--------|
| 1 | Container restart loop | Missing/invalid DATABASE_URL + migration exit(1) | Resolved |
| 2 | Migration loop | drizzle.__drizzle_migrations table empty/stale | Resolved |
| 3 | Swagger UI not loading | Duplicate YAML key in openapi.yaml | Resolved |
| 4 | Swagger scripts blocked | Helmet CSP blocking external resources | Resolved |

## Guide-level explanation
What happens during startup:

1. `node dist/scripts/migrate.js` runs.
2. If it succeeds, `node dist/app.js` starts the API.
3. Healthcheck probes `http://localhost:3015/health`.

Failure mode:
- `migrate.ts` calls `process.exit(1)` if `DATABASE_URL` is missing.
- `db.ts` throws at import time if `DATABASE_URL` is missing.
- The process exits immediately and Dokploy restarts the container.

Practical mitigations:
- Ensure `DATABASE_URL` (and related DB settings) are correctly injected in Dokploy.
- Validate connectivity (host/port/credentials) before deploy.
- Temporarily override the command to keep the container alive for log capture:

```sh
sh -c "node dist/scripts/migrate.js || true; node dist/app.js || true; sleep 600"
```

## Reference-level explanation
Relevant code paths:

- `src/scripts/migrate.ts`:
  - Exits with code 1 if `DATABASE_URL` is missing.
- `src/infrastructure/database/drizzle/db.ts`:
  - Throws an error at module load if `DATABASE_URL` is missing.

Dockerfile behavior:
```
CMD ["sh", "-c", "node dist/scripts/migrate.js || echo 'Migration warning: check logs above'; node dist/app.js"]
```

This means any migration error or DB configuration error causes immediate process
termination and a restart loop under Dokploy.

## Drawbacks
- Tight restart loops hide logs and increase time-to-diagnose.
- Automatically running migrations during app boot couples service availability to
  database readiness and correct environment configuration.

## Rationale and alternatives
Rationale:
- The current Dockerfile optimizes for simplicity (migrate then start), but it
  assumes a stable runtime environment that may not hold in Dokploy.

Alternatives:
1. Run migrations as a separate pre-deploy job.
2. Introduce a `start.sh` that validates envs and prints actionable errors before
   exiting.
3. Add a debug-safe entrypoint override (documented for ops use).

## Prior art
- Common practice in containerized deployments is to decouple migrations from
  application startup to avoid cascading failures.

## Unresolved questions
- Should we fail hard when `DATABASE_URL` is missing, or degrade to a "no DB" mode?
- Do we want a standardized entrypoint to validate envs across services?

## Future possibilities
- Add a healthcheck endpoint that reports configuration readiness.
- Add structured startup logs that always flush before exit.
- Provide a Dokploy "debug start" toggle to keep the container alive for inspection.

---

## Issue 2: Migration Loop (type already exists)

### Symptom
Container enters infinite restart loop because migration fails with:
```
PostgresError: type "actor_type" already exists
```

### Root Cause
The `drizzle.__drizzle_migrations` table was empty or outdated, causing Drizzle to
attempt re-running migrations that were already applied to the database schema.

### Solution Applied
Manually insert migration records to sync the journal:

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES
  ('0000_third_tempest', EXTRACT(EPOCH FROM NOW()) * 1000),
  ('0001_fuzzy_mojo', EXTRACT(EPOCH FROM NOW()) * 1000),
  ('0002_misty_unicorn', EXTRACT(EPOCH FROM NOW()) * 1000);
```

### Prevention
- Always backup `drizzle.__drizzle_migrations` before database operations
- Consider using `db:push` only in development, migrations in production

---

## Issue 3: Swagger UI Not Loading

### Symptom
The `/docs` page loads but shows only minimal spec with `http://localhost:3015`.

### Root Cause
The `docs/openapi.yaml` file had a **duplicate YAML key** (`/auth/password/forgot`
defined twice), causing a parsing error:
```
duplicated mapping key (3768:3)
```

### Solution Applied
Removed the duplicate "Legacy endpoints (deprecated)" section from `openapi.yaml`.

**Commit**: `6bc3ac7`

### Prevention
- Validate OpenAPI spec with `swagger-cli validate` before commit
- Add CI check for YAML syntax errors

---

## Issue 4: CSP Blocking Swagger UI Scripts

### Symptom
Swagger UI page loads but scripts fail to execute, console shows CSP violations.

### Root Cause
The `/docs` route was registered **after** the Helmet middleware, which applies a
restrictive Content-Security-Policy that blocks external scripts (unpkg.com CDN).

### Solution Applied
Move the `/docs` route registration to **before** `app.use(helmet())` in `src/app.ts`:

```typescript
// Routes BEFORE Helmet (need relaxed CSP for external scripts)
app.use('/docs', docsController);

// Security middleware
app.use(helmet());
```

**Commit**: `d78cc5e`

### Prevention
- Document middleware ordering requirements
- Consider self-hosting Swagger UI assets to avoid CSP issues

---

## Appendix: Useful Dokploy Commands

```bash
# View containers
docker ps | grep gcdr

# View container logs
docker logs <container_id> --tail 100

# Force service update (Swarm)
docker service update --force myio-gcdr-app-container-prod-4jycfh

# Manual rebuild
cd /etc/dokploy/applications/myio-gcdr-app-container-prod-*
git pull
docker compose build --no-cache
docker compose up -d

# Clear Docker cache
docker builder prune -f
docker system prune -f
```

---

## Related Documents
- [SOLVE-DOKPLOY.md](./SOLVE-DOKPLOY.md) - Quick reference runbook
- [FEEDBACK-DOKPLOY.md](./FEEDBACK-DOKPLOY.md) - Issue tracking template
