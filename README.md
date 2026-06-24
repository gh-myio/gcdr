# GCDR — Global Central Data Registry

> The single global **source of truth** for all master data in the MYIO ecosystem.

GCDR is the authoritative registry that every MYIO system (ThingsBoard, NodeHub, OS/Work Orders, alarm orchestrator, Node-RED bundles…) reads from, instead of each keeping — and diverging on — its own copy of customers, devices, rules and permissions. It centralizes master data, governance, RBAC, and audit in one place.

This README is the **canonical onboarding + developer guide** (it absorbs the former `docs/ONBOARDING.md`).

---

## Table of contents

1. [Overview](#1-overview)
2. [Quick start](#2-quick-start)
3. [Environments](#3-environments)
4. [Tech stack](#4-tech-stack)
5. [Architecture](#5-architecture)
6. [Project structure](#6-project-structure)
7. [Consuming the API](#7-consuming-the-api) — headers, modules, examples, response envelope, error codes
8. [Authentication](#8-authentication) — JWT, Partner API Key, OAuth2, Customer API Key
9. [Local development](#9-local-development) — commands, DB migrations & seeding, Admin UI, Simulator
10. [Testing](#10-testing)
11. [CI / Quality Gates](#11-ci--quality-gates)
12. [Conventions](#12-conventions)
13. [Common tasks](#13-common-tasks)
14. [Troubleshooting](#14-troubleshooting)
15. [Contributing](#15-contributing)
16. [Documentation index](#16-documentation-index)

---

## 1. Overview

Without GCDR, every system kept its own version of the data → divergent names/contacts/rules, manual sync across 5 places, no governance, inconsistent permissions. GCDR fixes this by being the **single authoritative store** for:

- **Customers** with hierarchy (`ROOT → RESELLER → ENTERPRISE → BUSINESS → INDIVIDUAL`)
- **Partners**, API Keys, OAuth Clients
- **Authorization (RBAC)** — Roles, Policies, Assignments, scopes
- **Assets** (`SITE → BUILDING → FLOOR → AREA → EQUIPMENT`) and **Devices** (IoT, Modbus `centralId`/`slaveId`)
- **Rules Engine** (ALARM_THRESHOLD, SLA, ESCALATION, MAINTENANCE_WINDOW) + **Alarm Bundles** for Node-RED
- **Work Orders / OS**, **Centrals**, **Groups**, **Themes**, **Templates**, **Public Single Apps**, **Consumption Goals**
- **Audit Logs** (RFC-0009) for compliance and traceability

---

## 2. Quick start

### Prerequisites
- **Node.js 20+** (LTS) · **npm 9+**
- **Docker** & **Docker Compose v2**
- **Git**

### Setup

```bash
git clone https://github.com/gh-myio/gcdr.git
cd gcdr
npm install
cp .env.example .env            # edit if needed

# Option A — everything in Docker (API + PostgreSQL)
docker compose up -d

# Option B — run the API locally against a running Postgres
npm run dev                     # tsx watch, hot reload
```

`npm run dev` auto-loads `.env` / `.env.local` (`--env-file-if-exists`). The `db:*` scripts do **not** — export the env vars in your shell first.

### Verify

```bash
curl http://localhost:3015/health
# { "success": true, "data": { "status": "healthy", "service": "gcdr-api", ... } }

curl http://localhost:3015/health/ready   # includes the database
```

---

## 3. Environments

| Environment | URL | Notes |
|---|---|---|
| **Production** | https://gcdr-server.apps.myio-bas.com | Dokploy deployment |
| **Local** | http://localhost:3015 | Docker / `npm run dev` |

| Resource | Path |
|---|---|
| Swagger UI | `/docs` |
| OpenAPI JSON | `/docs/openapi.json` (local file: `docs/openapi.yaml`, 155+ endpoints) |
| Health / Readiness | `/health` · `/health/ready` |
| DB Admin UI | `/admin/db` (password-gated) |
| Alarm Simulator | `/admin/simulator` |

---

## 4. Tech stack

| Technology | Purpose |
|---|---|
| **Node.js 20** · **TypeScript 5** | Runtime + type safety |
| **Express.js** | HTTP framework |
| **PostgreSQL 16** | Database |
| **Drizzle ORM** | Type-safe data access + schema (`src/infrastructure/database/drizzle/`) |
| **Zod** | Request/response validation |
| **Jest** | Tests |
| **Docker / Docker Compose** | Containerization (Dokploy in prod) |

> Migrated from AWS Lambda/DynamoDB to containers + PostgreSQL — see [RFC-0004](docs/rfcs/RFC-0004-Migration-DynamoDB-to-Postgres.md) and [RFC-0005](docs/rfcs/RFC-0005-Container-Deployment-Migration.md). The external event bus (AWS EventBridge) was removed; traceability is now **local audit logs** (RFC-0009).

---

## 5. Architecture

Layered: **Controllers → Services → Repositories → Drizzle/PostgreSQL**, with cross-cutting middleware and audit.

```
Traefik (proxy) → GCDR API (Express container) → PostgreSQL 16 (container)
                       │
   Controllers ──> Services ──> Repositories ──> Drizzle ──> PostgreSQL
   (HTTP, Zod)     (business)    (data access)              (+ audit_logs)
```

| Layer | Responsibility |
|---|---|
| **Controllers** | Receive HTTP, validate input (Zod), call services, format responses |
| **Services** | Business logic, orchestration across repositories |
| **Repositories** | Data access via Drizzle ORM (tenant-scoped) |
| **DTOs** | Zod schemas for request/response |
| **Middleware** | Auth, request context (`req.context`: `tenantId`/`userId`/`requestId`), error handling, response helpers |
| **Audit Logs** | Local event log for compliance (RFC-0009) |

---

## 6. Project structure

```
src/
├── app.ts                      # Express entry point + route mounting
├── controllers/                # HTTP routers (auth, customers, devices, rules, wo, centrals, …)
│   └── admin/                  # Admin DB UI, simulator
├── middleware/                 # auth, context, errorHandler, response helpers
├── services/                   # business logic
├── repositories/               # data access (Drizzle); interfaces/ = ports
├── domain/entities/            # TypeScript domain models
├── dto/
│   ├── request/                # Zod input schemas
│   └── response/               # output formatting
├── infrastructure/
│   └── database/drizzle/       # schema.ts, client/db.ts, types
└── shared/                     # config, errors (AppError), types, utils

tests/  unit/ · integration/ · helpers/
docs/   rfcs/ · specs/ · server/ · alarms/ · simulator/ · node-red/ · frontend/
scripts/db/  migrations/ · seeds/ · ops/   (+ scripts/api/ tooling)
```

---

## 7. Consuming the API

> Full reference: **Swagger** at `/docs` and **`docs/openapi.yaml`** (155+ endpoints). The canonical guide for users/auth/RBAC/groups/bundles/contacts is **[`docs/GCDR-USER.md`](docs/GCDR-USER.md)**.

### Required headers

```http
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

For M2M partner / customer integrations, use an API key instead of the bearer:

```http
X-API-Key: gcdr_cust_xxxxxxxx     # customer M2M (Node-RED bundles)
X-API-Key: gcdr_pk_xxxxxxxx       # partner
```

> The **tenant** is derived from the auth context. `auth/login` additionally requires the `X-Tenant-Id` header (default seed tenant `11111111-1111-1111-1111-111111111111`).

### Modules

| Module | Base path | Notes |
|---|---|---|
| Health | `/health` | health + readiness |
| Authentication | `/auth` | login, refresh, logout, MFA, password reset, self-registration (RFC-0011) |
| Customers | `/customers` | hierarchy, `tree`, `ancestors`, `external/:externalId` (TB), force-delete |
| Partners | `/partners` | partners, API keys, OAuth clients, webhooks |
| Authorization | `/authorization` | RBAC (roles, policies, assignments, `check`) |
| Assets | `/assets` | `SITE → BUILDING → FLOOR → AREA → EQUIPMENT` |
| Devices | `/devices` | IoT; filters `centralId`/`slaveId`; `POST /:id/move` |
| Rules | `/rules` | ALARM_THRESHOLD, SLA, ESCALATION, MAINTENANCE_WINDOW + guard configs |
| Alarm Bundles | `/customers/:id/alarm-rules/bundle/*` | Node-RED M2M, versioned (`X-Version-Id` → 304) |
| Alarm Simulator | `/admin/simulator` | premium simulator |
| Work Orders (OS) | `/wo` | work-order domain (UI shows "OS") — see [WO-OS-MAP](docs/WO-OS-MAP.md) |
| Centrals | `/centrals` | gateways (NODEHUB / GATEWAY / EDGE_CONTROLLER) |
| Customer API Keys | `/customers/:id/api-keys` | M2M keys; `hierarchyAccess` = SELF/SUBTREE/TENANT |
| Audit Logs | `/audit-logs` | compliance (RFC-0009) |
| Users · Admin Users | `/users` · `/admin/users` | management, MFA, approval/unlock (RFC-0011) |
| Groups | `/groups` | user/device/asset groups with hierarchy |
| Themes | `/customers/:id/theme/*` | look & feel; per-template-type themes (RFC-0021) |
| Templates · Template Types | `/templates` · `/template-types` | HTML email engine (RFC-0021) |
| Public Single Apps | `/public-apps` | versioned form apps (RFC-0020) |
| Device Sync Jobs | `/device-sync/jobs` | async TB→GCDR sync, 6 phases (RFC-0023) |
| Consumption Goals | `/customers/:id/consumption-goals` | per-operation audited goals (RFC-0046) |
| Integrations | `/integrations` | integration marketplace |

### Representative examples

```bash
# List customers
curl http://localhost:3015/customers \
  -H "Authorization: Bearer <token>"

# Customer tree (with deep enrichment via ?deep=1)
curl http://localhost:3015/customers/{id}/tree -H "Authorization: Bearer <token>"

# Alarm bundle for Node-RED (M2M, customer API key)
curl http://localhost:3015/customers/33333333-3333-3333-3333-333333333333/alarm-rules/bundle/simple \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026"

# Resolve a Modbus device by central + slave (used by alarms-backend)
curl "http://localhost:3015/api/v1/devices?centralId=<uuid>&slaveId=4" \
  -H "Authorization: Bearer <token>"

# Invalidate the bundle cache after a direct DB change
curl -X DELETE http://localhost:3015/api/v1/customers/{id}/alarm-rules/bundle/cache \
  -H "Authorization: Bearer <jwt>"
```

### Response envelope

```jsonc
// Success
{ "success": true, "data": { ... }, "meta": { "requestId": "uuid", "timestamp": "..." } }

// Error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "...", "details": {} }, "meta": {...} }

// Paginated — every paginated endpoint returns total + totalPages
{ "success": true, "data": { "items": [...], "pagination": { "total": 47, "totalPages": 3, "hasMore": true } }, "meta": {...} }
```

### HTTP error codes
`200` OK · `201` Created · `400` Validation · `401` Unauthorized · `403` Forbidden · `404` Not Found · `409` Conflict · `422` Business-rule violation · `429` Rate limit · `500` Internal.

---

## 8. Authentication

Four mechanisms (see [`docs/GCDR-USER.md`](docs/GCDR-USER.md) and [RFC-0003](docs/rfcs/RFC-0003-Refactoring-Multiple-Audience.md)):

**1. JWT Bearer** (frontend/mobile). Issued by `POST /auth/login`. Claims:
```jsonc
{ "sub": "user-uuid", "tenant_id": "...", "email": "...",
  "roles": ["role:super-admin"], "type": "CUSTOMER",
  "iss": "gcdr", "aud": ["gcdr-api", "alarm-orchestrator"], "iat": ..., "exp": ... }
```
Roles are loaded from `AuthorizationService` on each login/MFA/refresh. **Multiple-audience** (RFC 7519 §4.1.3) lets the same token work across MYIO services (e.g. `alarm-orchestrator`).

**2. Partner API Key** — `X-API-Key: gcdr_pk_...`

**3. OAuth2 Client Credentials** (M2M partners) — `POST /partners/token` → access token.

**4. Customer API Key** (M2M, e.g. Node-RED) — `X-API-Key: gcdr_cust_...`. Created by an admin via `POST /customers/:id/api-keys` with scopes such as `bundles:read`, `devices:read|write`, `rules:read`, `assets:read|write`, `customers:write`, `groups:read`, `*:read`. See [`docs/node-red/`](docs/node-red).

**Test users (seed):** `admin@gcdr.io` / `Test123!` (Admin) and others — see seeds.

**Rate limiting:** per IP (1000 req/min), per user (100 req/min), per API key (per plan).

---

## 9. Local development

### Commands

```bash
# Dev / build
npm run dev            # hot reload (tsx watch)
npm run build          # compile TypeScript
npm start              # run compiled

# Docker
docker compose up -d   # start all
docker compose logs -f api
docker compose down

# Quality
npm run lint           # ESLint (src/ tests/)
npm run typecheck      # tsc --noEmit
npm run quality        # lint + test:coverage

# Tests
npm test               # all
npm run test:unit      # unit only
npm run test:integration
npm run test:coverage
```

### Database migrations & seeding

Migrations are tracked by a **custom runner** (`schema_migrations` table) — the single source of truth for what ran where. The `db:*` scripts need `DATABASE_URL` exported in the shell.

```bash
npm run db:mig:status   # applied / pending / drift
npm run db:mig:up       # apply pending
npm run db:seed         # populate dev data
npm run db:seed:clear   # wipe seeded data (asks to confirm)
```

**Seeding against a Docker Postgres** shells in via `docker exec ${DB_CONTAINER:-gcdr-postgres} psql …`. For the dedicated dev DB `gcdr-db-local` (compose `docker-compose.db-local.yml`, host port `5544`), set `DB_CONTAINER`:

```bash
DB_CONTAINER=gcdr-db-local npm run db:seed              # bash
$env:DB_CONTAINER = "gcdr-db-local"; npm run db:seed    # PowerShell
```

> Seeds are **not idempotent** (`ON_ERROR_STOP=1`) — always `clear` before re-seeding. `db:seed:clear` does not truncate `public_single_apps*`; clear those manually for a fully clean reset.

### Admin DB UI — `/admin/db`
Password-gated (`DB_ADMIN_PASSWORD`, default `myio2026`). Dashboard (table counts/stats), run individual or all seeds, execution logs, ad-hoc SQL console, Quick Reset (clear + seed). See [RFC-0007](docs/rfcs/RFC-0007-Database-Admin-UI.md).

### Alarm Simulator — `/admin/simulator`
Test alarm rules without touching production. Click **🚀 DEMO** to bootstrap a full tenant/customer/devices/rules sandbox. See [SIMULATOR-MANUAL](docs/simulator/SIMULATOR-MANUAL.md).

### VS Code debugging
A `.vscode/launch.json` with "Debug API (Express)" (`npm run dev`), "Debug Tests", and "Attach to Docker" (port 9229) is the standard setup.

---

## 10. Testing

```
tests/
├── unit/         # service/controller/repository unit tests (mocked deps)
├── integration/  # API + DB integration
└── helpers/      # shared setup
```

```bash
npm test -- tests/unit/services/CustomerService.test.ts   # one file
npm test -- -t "CustomerService"                          # by name
npm run test:coverage
```

Unit tests mock the repository (DI); coverage thresholds are enforced by `jest.config.js` and ratchet upward over time (see CI below).

---

## 11. CI / Quality Gates

Every PR and push to `main`/`desenv` runs **four checks** (two GitHub workflows). **This is the merge gate** — read the full spec in **[`docs/specs/CI-PIPELINE.md`](docs/specs/CI-PIPELINE.md)**.

| Check | Blocks merge on |
|---|---|
| **PR Quality Gate / Typecheck + tests + coverage** | `tsc --noEmit`, Jest failure, coverage below threshold |
| **PR Quality Gate / Lint (changed files)** | any ESLint error/warning in a **changed** `.ts` file (new-code gate) |
| **CodeQL Security Scan / Analyze** | the analysis failing |
| **Code scanning results / CodeQL** | new **high-severity** alerts on the diff |

Reproduce locally before pushing:

```bash
npm run typecheck
npx eslint --max-warnings 0 <your-changed-files>   # mirror the new-code gate
npm run test:ci
```

> CodeQL only recognizes `express-rate-limit` for `js/missing-rate-limiting`; the custom `rateLimit` middleware isn't recognized (see CI-PIPELINE.md for the known quirks). See also [`docs/QUALITY-GATE.md`](docs/QUALITY-GATE.md).

---

## 12. Conventions

| Kind | Pattern | Example |
|---|---|---|
| Files | camelCase | `CustomerService.ts` |
| Classes | PascalCase | `CustomerService` |
| Interfaces | `I` + PascalCase | `ICustomerRepository` |
| Constants | SCREAMING_SNAKE | `DEFAULT_PAGE_SIZE` |

- **Always validate input with Zod** in controllers.
- **Errors:** `AppError` / `NotFoundError` / `ValidationError` from `shared/errors/AppError` — never `throw new Error()`.
- **Responses:** `sendSuccess(res, data, 200, requestId)` / `sendCreated(res, data, requestId)`.
- **Request context:** `req.context` (`tenantId`, `userId`, `requestId`).
- Every query is **tenant-scoped**.

---

## 13. Common tasks

**Add an endpoint** — create/extend `src/controllers/{domain}.controller.ts` (Router with try/catch → `next(err)`, parse with Zod, return via `sendSuccess`/`sendCreated`), mount in `app.ts` (`app.use('/x', authMiddleware, controller)`), export from `controllers/index.ts`, add tests.

**Add an entity** — entity in `domain/entities/`, DTOs in `dto/request|response/`, repository in `repositories/` (tenant-scoped Drizzle), service in `services/`, table in `infrastructure/database/drizzle/schema.ts` + a migration.

**Add an audit log** — `await auditLogService.log({ tenantId, userId, action, resourceType, resourceId, changes, ip })` after a successful mutation (RFC-0009).

**Device conformity pipeline** — `scripts/api/engine-check-inconformidades/` (check → action-plan → relocations → registry; `run-all.sh --customer <name>`). The async equivalent is the Device Sync Job API (RFC-0023).

---

## 14. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find module` | `npm run build`; check `tsconfig.json` paths |
| Port `3015` in use | `netstat -ano \| findstr :3015` (Win) / `lsof -i :3015` (unix); kill or `docker compose down && up` |
| Postgres connection fails | `docker compose ps` / `logs postgres`; inside Docker use host `postgres`, locally `localhost:5433` |
| Tests timeout | ensure all repository methods are mocked |
| TS types stale | `rm -rf dist/ && npm run build`; restart TS Server in VS Code |

---

## 15. Contributing

1. Branch from **`desenv`** (the integration branch; PRs target `desenv`): `git checkout -b feat/my-feature`.
2. Make changes; keep new code lint-clean and tested.
3. Run the gates locally: `npm run typecheck && npx eslint --max-warnings 0 <changed> && npm run test:ci`.
4. Conventional commits: `feat: …`, `fix: …`, `docs: …`.
5. Push and open a PR → **CI must be green** (§11) before merge.

---

## 16. Documentation index

**Start here**
- [`docs/GCDR-USER.md`](docs/GCDR-USER.md) — **canonical** guide: users, auth, RBAC, groups, bundles, contacts
- [`docs/specs/CI-PIPELINE.md`](docs/specs/CI-PIPELINE.md) — **CI / quality gates** (the merge gate)
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — change history (was the ONBOARDING changelog)
- [`docs/BACKLOG-RFCS.md`](docs/BACKLOG-RFCS.md) — consolidated RFC backlog
- [`docs/AUTHORIZATION-MODEL.md`](docs/AUTHORIZATION-MODEL.md) · [`docs/RBAC-ACCESS-CONTROL.md`](docs/RBAC-ACCESS-CONTROL.md)

**Domains**
- [`docs/alarms/RULE-ENTITY.md`](docs/alarms/RULE-ENTITY.md) — rules engine · [`docs/simulator/SIMULATOR-MANUAL.md`](docs/simulator/SIMULATOR-MANUAL.md) — simulator
- [`docs/WO-OS-MAP.md`](docs/WO-OS-MAP.md) · [`docs/WO-OS-API-GUIDE.md`](docs/WO-OS-API-GUIDE.md) — Work Orders / OS
- [`docs/server/DEPLOY-DOKPLOY.md`](docs/server/DEPLOY-DOKPLOY.md) · [`docs/server/SOLVE-DOKPLOY.md`](docs/server/SOLVE-DOKPLOY.md) — deploy

**Key RFCs** (full set in [`docs/rfcs/`](docs/rfcs))
- [RFC-0001](docs/rfcs/RFC-0001-GCDR-MYIO-Integration-Marketplace.md) Marketplace · [RFC-0002](docs/rfcs/RFC-0002-GCDR-Authorization-Model.md) Authorization Model
- [RFC-0009](docs/rfcs/RFC-0009-Events-Audit-Logs.md) Audit Logs · [RFC-0011](docs/rfcs/RFC-0011-User-Registration-Approval-Workflow.md) Registration
- [RFC-0013](docs/rfcs/RFC-0013-User-Access-Profile-Bundle.md) Access Profile Bundle · [RFC-0015](docs/rfcs/RFC-0015-Alarm-Bundle-Version-History.md) Bundle Versioning
- [RFC-0023](docs/rfcs/RFC-0023-Device-Sync-Job-API.md) Device Sync Jobs · [RFC-0025](docs/rfcs/RFC-0025-User-Notification-Contacts.md) Contacts
- [RFC-0037](docs/rfcs/RFC-0037-Work-Orders-Event-Model.md) Work Orders · [RFC-0046](docs/rfcs/RFC-0046-Customer-Consumption-Goals.md) Consumption Goals

**Contacts** — Tech Lead: Rodrigo Lago · Dev: `#dev` (Slack)

---

_Proprietary — MYIO. This README is the canonical developer guide; `docs/ONBOARDING.md` now redirects here._
