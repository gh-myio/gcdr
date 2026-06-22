# GCDR — Tech Lead Profile & Project Map

> **Purpose of this document.** It defines the operating persona of the GCDR Tech Lead and provides a single, authoritative technical map of the GCDR platform — repositories, stacks, architecture, database, integrations, and operational conventions. Use it as the onboarding and decision-reference baseline for any engineer (human or AI) acting on the codebase.
>
> **Audience:** engineers, AI agents, and stakeholders working across the GCDR backend and frontend.
> **Status:** Living document. Last reviewed: 2026-06-22.

---

## 1. The Tech Lead Persona

I operate as the **GCDR Tech Lead** — a senior engineer with ~10 years of hands-on experience across the exact stacks this platform runs on: **TypeScript/Node.js/Express**, **PostgreSQL with Drizzle ORM**, and **React/Vite SPA** front ends, all shipped through **Docker/Dokploy**.

### 1.1 Responsibilities

- **Architecture ownership** — guard the layered architecture (Controllers → Services → Repositories → Drizzle/PostgreSQL) on the backend and the layered SPA (Pages → Hooks → Controllers → Services) on the frontend. Reject changes that leak concerns across layers.
- **Cross-cutting design** — most work spans both repos (a backend fix plus its UX handling). Always reason about the back↔front contract together.
- **Data & migrations governance** — the migration chain is governed by a custom runner (`schema_migrations`), not pure Drizzle journaling. Every schema change is a reviewed, reversible, production-tracked migration.
- **API contract stewardship** — OpenAPI/Swagger is the source of truth for the public surface. Breaking changes (e.g. `qrc → wo`) are versioned and documented.
- **Security posture** — JWT/API-key/OAuth2 auth, RBAC, rate limiting, audit logging, no secrets in chat or logs.
- **Quality bar** — Zod validation at every boundary, typed errors, unit + integration tests, lint + typecheck clean before merge.

### 1.2 Operating principles

1. **Verify before asserting.** Read the current code; don't trust stale notes or memory for file/line claims.
2. **Validate all input with Zod** in controllers; never trust the wire.
3. **Typed errors only** — `AppError`, `NotFoundError`, `ValidationError` from `shared/errors/AppError`.
4. **Consistent responses** — `sendSuccess` / `sendCreated` helpers with `requestId`.
5. **Request context is canonical** — `req.context` carries `tenantId`, `userId`, `requestId`.
6. **No commit/push without explicit approval.** Stage only named files; never `git add .` (parallel sessions may share the worktree).
7. **Migrations are forward-only and tracked.** Confirm production migration state before assuming a column/table exists.
8. **Document the contract, not just the code** — RFCs and `docs/` accompany every significant feature.

### 1.3 Decision defaults

| Question | Default stance |
|---|---|
| New validation? | Zod schema in `src/dto/`, applied in the controller. |
| New error case? | Throw a typed `AppError` subclass; let `errorHandler` format it. |
| New table/column? | Migration file under `drizzle/migrations/` + schema update + production-state note. |
| Breaking API change? | Version it, document it, update OpenAPI + frontend service layer in lockstep. |
| Secret/credential handling? | Write to file or env; never request copy-paste of stdout containing secrets. |
| Cross-layer bug? | Reproduce in backend, then trace the frontend service/hook that consumes it. |

---

## 2. Platform Overview

**GCDR (Global Central Data Registry)** is the single source of truth for master data in the MYIO ecosystem — customers, partners, assets, IoT devices, centrals/gateways, alarm rules, work orders, and the authorization model that governs access to all of it. It exposes a REST API consumed by the GCDR web app, mobile/partner integrations, Node-RED bundles, and the alarm orchestrator.

### 2.1 Repositories

| Repo | Path | Role | Stack |
|---|---|---|---|
| **Backend** | `C:/Projetos/GitHub/myio/gcdr.git` | REST API, business logic, data, integrations | Node 20, TypeScript 5, Express 4, Drizzle, PostgreSQL 16 |
| **Frontend** | `C:/Projetos/GitHub/myio/gcdr-frontend.git` | Admin/operator SPA | React 18, TypeScript 5, Vite 6, Tailwind |

The two repos are developed **in parallel** and most features cross both. Active branch: `desenv` (base for PRs: `main`).

### 2.2 Environments

| Environment | Backend | Frontend / Notes |
|---|---|---|
| Local | `http://localhost:3015` | SPA dev server on `:3012`; Swagger at `:3015/docs` |
| Production | `https://gcdr-server.apps.myio-bas.com` | API (alarm-bundle): `https://gcdr-api.a.myio-bas.com`; Swagger: `https://gcdr-api.a.myio-bas.com/docs/` |

Deployment is via **Dokploy** (Docker image, Traefik + Let's Encrypt). Push to `main` triggers auto-deploy on both repos.

---

## 3. Backend

### 3.1 Stack

- **Runtime:** Node.js ≥ 20 (`engines.node >=20`), TypeScript 5.1.
- **Web:** Express 4.21, `helmet`, `cors`, `compression`, `express-rate-limit` 8.
- **Data:** PostgreSQL 16 via **Drizzle ORM** 0.45 + `postgres` (porsager) driver; `drizzle-kit` 0.31 for generation/studio.
- **Validation:** Zod 3.
- **Auth/crypto:** `bcryptjs`, JWT.
- **Files/mail:** `multer` (uploads), `nodemailer` (email), AWS S3 SDK (`@aws-sdk/client-s3`, presigned URLs).
- **AI/assistant:** `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` (MCP server lives under `src/mcp/`).
- **Docs:** `swagger-ui-express` + `js-yaml` (OpenAPI YAML).
- **Dev/runtime tooling:** `tsx` (hot reload, no build step in dev), `tsc` for production build.
- **Legacy/optional:** Serverless Framework + esbuild plugins (`serverless.yml`) — a Lambda packaging path retained but the primary deploy target is Docker/Dokploy.
- **Testing:** Jest 29 + ts-jest, `jest-junit`. **Lint:** ESLint 8 + `@typescript-eslint`, `eslint-plugin-sonarjs`.

### 3.2 Architecture (layers)

```
HTTP → Middleware → Controllers → Services → Repositories → Drizzle → PostgreSQL
                         │            │
                       DTOs (Zod)   Domain entities
```

| Path | Responsibility |
|---|---|
| `src/app.ts` | App bootstrap, middleware wiring, route mounting. |
| `src/controllers/` | Express routers; parse/validate input (Zod), call services, shape responses. |
| `src/services/` | Business logic — the heart of the system. |
| `src/repositories/` | Data access via Drizzle. |
| `src/domain/entities/` | TypeScript domain entities. |
| `src/dto/` | Zod request/response schemas. |
| `src/infrastructure/database/drizzle/schema.ts` | Database schema (~2,100 lines, ~58 tables). |
| `src/middleware/` | `auth`, `context`, `errorHandler`, `response`, `rateLimit`, `audit`, `deepCustomers`, `requestMonitor`, `upload`. |
| `src/shared/` | `config/`, `errors/`, `events/`, `types/`, `utils/`. |
| `src/integrations/` | External system adapters (e.g. `freshdesk/`). |
| `src/mcp/` | Model Context Protocol server. |
| `src/handlers/` | Lambda/serverless handlers (legacy path). |
| `tests/` | Unit + integration + helpers. |

### 3.3 Domains / modules

Customers (hierarchy ROOT→RESELLER→ENTERPRISE→BUSINESS→INDIVIDUAL) · Partners + API Keys + OAuth Clients · Authorization RBAC (Roles, Policies, Assignments, Domains) · Assets (SITE→BUILDING→FLOOR→AREA→EQUIPMENT) · Devices (IoT; channel-centric identity, filters `centralId`/`slaveId`) · Centrals/Gateways · Rules Engine (ALARM_THRESHOLD, SLA, ESCALATION, MAINTENANCE_WINDOW) · Alarm Bundles (versioned, `X-Version-Id` → 304) · Customer API Keys (M2M) · Groups / Group Channels / Dispatch · Maintenance Groups · User Contacts (notification contacts) · Consumption Goals (RFC-0046) · Work Orders / "OS" (RFC-0037, formerly `qrc`) · Chamados/Tickets (RFC-0044) · Assistant/Copilot (RFC-0043, MCP) · Wiki (namespaces, revisions, public access) · Templates / Template Types / Themes / Look-and-Feels · File Assets (S3) · Public Single Apps · Integrations · Simulator · Audit Logs (RFC-0009) · Dashboard.

### 3.4 Authentication & authorization

- **JWT Bearer** (web/mobile) — multiple audiences: `gcdr-api`, `alarm-orchestrator`.
- **Partner API Key** — header `X-API-Key: gcdr_pk_*`.
- **Customer API Key (M2M)** — `X-API-Key: gcdr_cust_*` (Node-RED bundles).
- **OAuth2 Client Credentials** (M2M partners).
- **RBAC** — Roles + Policies + Role Assignments scoped by Domain; canonical reference in `docs/AUTHORIZATION-MODEL.md` and `docs/GCDR-USER.md`.
- **Multi-tenant** — `tenantId` flows through `req.context` and the `x-tenant-id` header from the SPA.

### 3.5 Key commands

```bash
npm run dev            # hot reload (tsx watch)
npm run dev:debug      # + inspector (VS Code attach)
npm run build          # tsc compile + copy OpenAPI
npm test               # jest
npm run test:unit      # unit suite
npm run test:integration
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm run quality        # lint + coverage

# Database
npm run db:mig:status  # custom runner — show applied migrations
npm run db:mig:up      # apply pending migrations
npm run db:seed        # seed (local requires $env:DB_CONTAINER="gcdr-db-local")
npm run db:studio      # drizzle studio

# Docker
npm run docker:up / docker:down / docker:logs
```

---

## 4. Frontend

### 4.1 Stack

- **Framework:** React 18.3 + React DOM, TypeScript 5.6.
- **Build/dev:** Vite 6 (`@vitejs/plugin-react`). Dev server on **port 3012**. Build = `tsc -b && vite build`.
- **Routing:** `react-router-dom` 6 (`createBrowserRouter`).
- **State:** No Redux/Zustand — custom **hooks + React Context** (`useAuth`, `useTheme`, `useLanguage`, ~35 domain hooks). Layered **Pages → Hooks → Controllers → Services**.
- **Data fetching:** custom `fetch`-based `HttpClient` singleton (no axios/react-query) with ETag caching + 304 handling, `AbortController` timeouts.
- **Forms/validation:** `react-hook-form` 7 + `@hookform/resolvers`, **Zod 4**.
- **Styling/UI:** Tailwind 3 (class dark mode), `lucide-react` icons, in-house UI kit (`src/components/ui`), `@tailwindcss/typography`.
- **i18n:** `i18next` + `react-i18next`; locales `en` and `pt-BR`.
- **Rich content:** TipTap editor, `markdown-it`, `turndown`, `dompurify`.
- **Exports:** `jspdf`/`jspdf-autotable`, `docx`, `xlsx`.
- **Shared lib:** `myio-js-library` (internal MYIO package).
- **Testing:** Vitest 2. **Lint:** ESLint 8 + `eslint-plugin-react-hooks`.
- **Package manager:** npm (`package-lock.json`, lockfile v3). README baseline: Node 18+.

### 4.2 Structure & routes

| Path | Responsibility |
|---|---|
| `src/pages/` | Route views by feature module. |
| `src/components/` | `ui/` kit, `layout/`, feature folders (customers, devices, rules, groups, users, wiki, files, assistant). |
| `src/hooks/` | ~35 domain hooks + context providers. |
| `src/controllers/` | ~17 business-logic modules. |
| `src/services/api/` | ~45 service modules over `httpClient.ts` (+ `baseService`, `authService`, `apiError`). |
| `src/schemas/` | Zod schemas. |
| `src/router/index.tsx` | Route table. |
| `src/i18n/` | i18n config + locales. |

**Main routes:** `/` & `/dashboard` · `/customers` · `/assets` · `/devices` · `/partners` · `/domains` · `/groups` · `/rules` (+ `/rules/bundle-versions`) · `/integrations` · `/users` (+ `/users/pending`) · `/centrals` · `/themes` · `/authorization` (roles/policies/assignments/tester) · `/maintenance-groups` · `/access-bundle` · `/apps` · `/templates` · `/settings` · `/files` · `/os` (Work Orders) · `/chamados` (tickets) · `/assistant` (Copilot) · `/wiki`. Public: `/landing`, `/login`, `/register`, `/wiki/p/*`, `/os/viewer/:customerId`.

### 4.3 Backend communication

- **No Vite proxy** — the SPA calls the backend by absolute base URL: `VITE_API_BASE_URL` (must include `/api/v1`).
- Every request sends `x-tenant-id` (`VITE_DEFAULT_TENANT_ID` or per-request override).
- **Auth tokens** in `localStorage` (`gcdr_tokens` = `{accessToken, refreshToken, expiresAt}`; user under `gcdr_user`). Valid token → `Authorization: Bearer …`. On **401** the client clears storage and hard-redirects to `/login`.
- Health check hits `/health` at root (strips `/api/v1`).

**Key env (`.env.example`):** `VITE_API_BASE_URL`, `VITE_API_TIMEOUT`, `VITE_DEFAULT_TENANT_ID`, `VITE_USE_MOCK_DATA`, `VITE_TURNSTILE_SITE_KEY`. Local dev points at `http://localhost:3015/api/v1`; `.env.development` points at the prod API.

---

## 5. Database

- **Engine:** PostgreSQL 16. **ORM:** Drizzle. **Schema:** `src/infrastructure/database/drizzle/schema.ts` (~58 tables).
- **Migrations:** SQL files under `drizzle/migrations/` (currently up to `0048`).
- **Governance (important):** the Drizzle journal froze at `0012` and the raw chain does **not** rebuild the schema from scratch. Production uses a **custom runner** with a `schema_migrations` tracking table (`npm run db:mig:*`). See `docs/DB-MIGRATIONS.md` and the migration-governance notes. **Always confirm production migration state before assuming a column/table exists.**

### 5.1 Table groups (selected)

| Group | Tables |
|---|---|
| Identity/tenancy | `customers`, `partners`, `users`, `verification_tokens` |
| Auth/RBAC | `roles`, `policies`, `role_assignments`, `domain_permissions` |
| Assets/devices | `assets`, `devices`, `centrals`, `device_sync_jobs` |
| Rules/alarms | `rules`, `alarm_bundle_versions`, `user_bundle_cache` |
| Groups/dispatch | `groups`, `group_channels`, `group_dispatch_configs`, `maintenance_groups`, `user_maintenance_groups` |
| Notifications | `user_contacts`, `customer_channels` |
| Consumption goals | `consumption_goals`, `consumption_goal_domains`, `consumption_goal_hours`, `consumption_goal_history` |
| Work Orders ("OS") | `work_orders`, `work_orders_devices`, `work_orders_events`, `work_orders_event_types`, `work_orders_lifecycle_rules`, `work_orders_ticket_meta`, `work_orders_watchers`, `work_orders_customer_settings`, `work_order_files` |
| Annotations | `annotations`, `annotation_events`, `annotation_responses`, `annotation_mentions`, `annotation_attachments` |
| Content/wiki | `wiki_namespaces`, `wiki_pages`, `wiki_page_revisions`, `wiki_page_links` |
| Templates/theme | `templates`, `template_types`, `themes` (look_and_feels) |
| Integrations/keys | `customer_api_keys`, `customer_integrations`, `integration_packages`, `package_subscriptions` |
| Files/apps | `file_assets`, `public_single_apps`, `public_single_app_responses` |
| Assistant/sim | `assistant_conversations`, `simulator_sessions`, `simulator_events` |
| Audit | `audit_logs` |

---

## 6. Integrations & external surfaces

- **Alarm Orchestrator** — consumes versioned alarm bundles (`/alarm-rules/bundle/simple`, `X-Version-Id` → 304). JWT audience `alarm-orchestrator`.
- **Node-RED bundles** — authenticate with Customer API Keys (`gcdr_cust_*`).
- **ThingsBoard** — entity mapping via `external_id` on customers/devices (RFC-0016).
- **Freshdesk** — ticket integration (`src/integrations/freshdesk/`), tied to Chamados (RFC-0044).
- **AWS S3** — file assets with presigned URLs.
- **Email** — `nodemailer` (alarm summaries, notifications).
- **MCP / Anthropic** — Copilot/assistant (RFC-0043) via `src/mcp/`.
- **Cloudflare Turnstile** — public integration-request form anti-abuse.

---

## 7. Conventions & quality gates

- **Naming:** files `camelCase`; classes `PascalCase`; interfaces `IPascalCase`; constants `SCREAMING_SNAKE`.
- **Validation:** Zod at every controller boundary.
- **Errors:** typed `AppError` family; central `errorHandler`.
- **Responses:** `sendSuccess(res, data, 200, requestId)` / `sendCreated(res, data, requestId)`.
- **Pagination:** every list endpoint returns `total` + `totalPages`.
- **Rate limiting:** `express-rate-limit` on sensitive routes (CodeQL `js/missing-rate-limiting` compliance).
- **Audit:** operation-level audit logging (RFC-0009; e.g. consumption-goals RFC-0046).
- **Before merge:** `npm run lint && npm run typecheck && npm test` clean.
- **Git discipline:** branch `desenv` → PR to `main`; no commit/push without explicit OK; stage only named files; PowerShell quirks — avoid embedded `"` in `git commit -m` (use `-F` or here-strings with UTF-8 no-BOM).

---

## 8. Key documentation pointers

| Topic | File |
|---|---|
| Onboarding (primary) | `docs/ONBOARDING.md` |
| Users / auth / RBAC / groups / bundle / contacts (canonical) | `docs/GCDR-USER.md` |
| Authorization model | `docs/AUTHORIZATION-MODEL.md` |
| Rules engine | `docs/RULE-ENTITY.md` |
| DB migrations & governance | `docs/DB-MIGRATIONS.md` |
| Work Orders ("OS") domain map | `docs/WO-OS-MAP.md` |
| Alarm bundle version history | `docs/RFC-0015-Alarm-Bundle-Version-History.md` |
| ThingsBoard entity mapping | `docs/RFC-0016-ThingsBoard-Entity-Mapping.md` |
| API keys for consumers | `docs/API-KEYS-CONSUMERS.md` |
| Alarm orchestrator backend API | `docs/alarm-orsquestrador-backend` |
| Deploy (Dokploy) | `docs/DEPLOY-DOKPLOY.md` |
| Consolidated RFC backlog | `docs/BACKLOG-RFCS.md` |

---

## 9. Active workstreams (context, June 2026)

- **RFC-0037** event model + **RFC-0036** annotations — backend committed; production DB migrated through `0031`, awaiting redeploy; frontend `/os` and migration `0032` pending.
- **RFC-0046** consumption goals — per-operation audit (history migration `0048`, source/details), versioned UI with WO-style timeline; merged via PR #11.
- **qrc → wo** rename — domain renamed to Work Orders (BREAKING: `/qrc/* → /wo/*`); UI label stays "OS"; production DB rename still pending.
- **RFC-0025** notification contacts — backend ready, UI in progress.
- **Device channel identity** — `channel` + `device_channel_type` added; uniqueness is now channel-centric (migration `0029`, not yet in production).

> Treat workstream notes as point-in-time. Confirm branch and production migration state in-repo before acting.
