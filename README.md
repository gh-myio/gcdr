# GCDR - Global Central Data Registry

The single global source of truth for all MYIO master data.

## Overview

GCDR is the **Single Source of Truth** for all master data in the MYIO ecosystem. It provides:

- **Customer Management** with hierarchy (Holding -> Enterprise -> Business -> Individual)
- **Partner Registration** for API integrations
- **Authorization Control** with roles, policies, and scopes
- **Device & Asset Management** with connectivity tracking
- **Rules Engine** for alarms, SLA, and maintenance windows
- **Integration Marketplace** for third-party packages

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Git

### Development Setup

```bash
# Clone the repository
git clone https://github.com/gh-myio/gcdr.git
cd gcdr

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start with Docker (API + PostgreSQL)
docker compose up -d

# Or run locally (requires PostgreSQL running)
npm run dev
```

### Verify Installation

```bash
# Health check
curl http://localhost:3015/health
# Response: {"status":"ok"}

# Readiness check (includes database)
curl http://localhost:3015/health/ready
# Response: {"status":"ready"}
```

## Environments

| Environment | URL | Description |
|-------------|-----|-------------|
| **Production** | https://gcdr-server.apps.myio-bas.com | Dokploy deployment |
| **Local** | http://localhost:3015 | Docker development |

### Production Resources

| Resource | URL |
|----------|-----|
| Swagger UI | https://gcdr-server.apps.myio-bas.com/docs |
| OpenAPI JSON | https://gcdr-server.apps.myio-bas.com/docs/openapi.json |
| Health Check | https://gcdr-server.apps.myio-bas.com/health |
| DB Admin | https://gcdr-server.apps.myio-bas.com/admin/db |
| Alarm Simulator | https://gcdr-server.apps.myio-bas.com/admin/simulator |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Dokploy Platform                          │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Traefik │───>│   GCDR API   │───>│   PostgreSQL     │   │
│  │  (proxy) │    │  (container) │    │   (container)    │   │
│  └──────────┘    └──────────────┘    └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Technology | Purpose |
|------------|---------|
| **Node.js 20** | Runtime |
| **TypeScript 5** | Type safety |
| **Express.js** | HTTP framework |
| **PostgreSQL 16** | Database |
| **Docker** | Containerization |
| **Zod** | Schema validation |
| **Jest** | Testing |

## Project Structure

```
src/
├── app.ts                 # Express application entry point
├── controllers/           # HTTP route controllers
│   ├── auth.controller.ts
│   ├── customers.controller.ts
│   ├── devices.controller.ts
│   ├── users.controller.ts
│   ├── rules.controller.ts
│   └── ...
├── middleware/            # Express middlewares
│   ├── auth.ts           # JWT authentication
│   ├── context.ts        # Request context extraction
│   ├── errorHandler.ts   # Global error handling
│   └── response.ts       # Standardized responses
├── services/             # Business logic
├── repositories/         # Data access layer
├── domain/entities/      # Domain models
├── dto/                  # Data transfer objects
│   ├── request/          # Input validation (Zod schemas)
│   └── response/         # Output formatting
└── shared/               # Shared utilities
```

## API Endpoints

### Public Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/health/ready` | Readiness check (with DB) |
| POST | `/auth/login` | User authentication |
| POST | `/auth/refresh` | Refresh token |
| POST | `/auth/logout` | Logout |

### Protected Routes (require authentication)

| Module | Base Path | Description |
|--------|-----------|-------------|
| Customers | `/customers` | Customer hierarchy management |
| Devices | `/devices` | Device management |
| Users | `/users` | User management |
| Rules | `/rules` | Business rules engine |
| Policies | `/policies` | Policy management |
| Authorization | `/authorization` | RBAC operations |
| Integrations | `/integrations` | Integration marketplace |

### Authentication

All protected routes require:

```http
Authorization: Bearer <jwt-token>
X-Tenant-Id: <tenant-uuid>
```

For M2M integrations (Node-RED, etc.):

```http
X-API-Key: gcdr_cust_xxxxxxxxxxxx
```

## Development

### Commands

```bash
# Development
npm run dev              # Start with hot reload
npm run build            # Compile TypeScript
npm start                # Run compiled code

# Docker
docker compose up -d     # Start all services
docker compose down      # Stop all services
docker compose logs -f   # View logs

# Quality
npm run lint             # ESLint check
npm run lint:fix         # Auto-fix issues
npm run typecheck        # TypeScript check
npm test                 # Run tests
npm run test:coverage    # Tests with coverage
```

`npm run dev` auto-loads `.env` and `.env.local` (`--env-file-if-exists`).
The `db:*` scripts do **not** — export the env vars in your shell first.

### Database migrations & seeding

Migrations are tracked by a custom runner (`schema_migrations` table) — the
single source of truth for what ran where. The `db:*` scripts need
`DATABASE_URL` in the environment.

```bash
npm run db:mig:status    # list applied / pending / drift
npm run db:mig:up        # apply pending migrations
npm run db:seed          # populate dev data
npm run db:seed:clear    # wipe seeded data (asks for confirmation)
```

**Seeding against a Docker Postgres.** The seed runner shells into the DB
via `docker exec ${DB_CONTAINER:-gcdr-postgres} psql …`. If your local
Postgres container has a different name (e.g. the dedicated dev DB
`gcdr-db-local` from `docker-compose.db-local.yml`, host port `5544`), set
`DB_CONTAINER`:

```powershell
# PowerShell
$env:DB_CONTAINER = "gcdr-db-local"
npm run db:seed
```

```bash
# bash
DB_CONTAINER=gcdr-db-local npm run db:seed
```

Caveats:

- Seeds are **not idempotent** and run with `ON_ERROR_STOP=1` — re-running
  against an already-populated DB fails with duplicate-key / FK errors.
  Always `clear` before re-seeding.
- `db:seed:clear` (`00-clear-all.sql`) does **not** truncate
  `public_single_apps` / `public_single_app_responses`, so seed
  `18-public-single-apps.sql` can still collide after a clear. For a clean
  reset:

  ```bash
  DB_CONTAINER=gcdr-db-local "yes" | npx tsx scripts/db/seed-runner.ts clear
  docker exec -i gcdr-db-local psql -U postgres -d db_gcdr \
    -c "DELETE FROM public_single_app_responses; DELETE FROM public_single_apps;"
  DB_CONTAINER=gcdr-db-local npm run db:seed
  ```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `development` |
| `PORT` | Server port | `3015` |
| `DATABASE_URL` | PostgreSQL connection | - |
| `JWT_SECRET` | JWT signing key | - |
| `JWT_ISSUER` | JWT issuer | `gcdr` |
| `JWT_AUDIENCE` | JWT audience | `gcdr-api` |
| `JWT_EXPIRES_IN` | Token expiration | `1h` |
| `CORS_ORIGIN` | CORS allowed origins | `*` |

### Docker Services

| Service | Port | Description |
|---------|------|-------------|
| `api` | 3015 | GCDR API |
| `postgres` | 5433 | PostgreSQL database |

## Documentation

- [ONBOARDING.md](docs/ONBOARDING.md) - Developer onboarding guide
- [RFC-0001](./docs/rfcs/RFC-0001-GCDR-MYIO-Integration-Marketplace.md) - Integration Marketplace
- [RFC-0002](./docs/rfcs/RFC-0002-GCDR-Authorization-Model.md) - Authorization Model (RFC)
- [AUTHORIZATION-MODEL.md](docs/AUTHORIZATION-MODEL.md) - Authorization Implementation Guide
- [RFC-0003](./docs/rfcs/RFC-0003-Refactoring-Multiple-Audience.md) - JWT Multiple Audience
- [RFC-0004](./docs/rfcs/RFC-0004-Migration-DynamoDB-to-Postgres.md) - PostgreSQL Migration
- [RFC-0005](./docs/rfcs/RFC-0005-Container-Deployment-Migration.md) - Container Deployment
- [RFC-0006](./docs/rfcs/RFC-0006-Database-Seed-Scripts.md) - Database Seed Scripts
- [RFC-0007](./docs/rfcs/RFC-0007-Database-Admin-UI.md) - Database Admin UI
- [RFC-0008](./docs/rfcs/RFC-0008-Device-Attributes-Extension.md) - Device Attributes Extension
- [RFC-0009](./docs/rfcs/RFC-0009-Events-Audit-Logs.md) - Events & Audit Logs
- [RFC-0010](./docs/rfcs/RFC-0010-Premium-Alarm-Simulator.md) - Premium Alarm Simulator
- [RFC-0011](./docs/rfcs/RFC-0011-User-Registration-Approval-Workflow.md) - User Registration & Approval Workflow
- [RFC-0012](./docs/rfcs/RFC-0012-Features-Registry.md) - Features Registry (Draft)
- [RFC-0013](./docs/rfcs/RFC-0013-User-Access-Profile-Bundle.md) - User Access Profile Bundle
- [RFC-0014](./docs/rfcs/RFC-0014-FixSimulator-Implementation-Plan.md) - Simulator UI/UX Overhaul (Scenario Builder + 2×3 Grid)
- [RULE-ENTITY.md](./docs/alarms/RULE-ENTITY.md) - Rules Engine Documentation
- [SIMULATOR-MANUAL.md](./docs/simulator/SIMULATOR-MANUAL.md) - Alarm Simulator Manual
- [DEPLOY-DOKPLOY.md](./docs/server/DEPLOY-DOKPLOY.md) - Dokploy Deployment Guide
- [SOLVE-DOKPLOY.md](./docs/server/SOLVE-DOKPLOY.md) - Dokploy Issues Runbook

## Deployment

### Dokploy

The application is configured for deployment on Dokploy. See `dokploy.yml` for configuration.

```bash
# Build Docker image
docker build -t gcdr-api .

# Push to registry
docker push registry.example.com/gcdr-api:latest
```

### Production Checklist

- [ ] Set secure `JWT_SECRET` (use `openssl rand -base64 64`)
- [ ] Configure proper `CORS_ORIGIN`
- [ ] Set `NODE_ENV=production`
- [ ] Configure database credentials
- [ ] Enable TLS/HTTPS
- [ ] Set up monitoring and alerting

## Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Run quality checks: `npm run lint && npm test`
4. Commit: `git commit -m "feat: description"`
5. Push and create a PR

## License

Proprietary - MYIO
