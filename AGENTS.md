# AGENTS

Project: GCDR (Global Central Data Registry)

## Purpose
Single source of truth for MYIO master data. Manages customers (hierarchy), partners, auth (RBAC), and publishes events.

## Tech Stack
- Node.js 20, TypeScript 5, Express.js
- PostgreSQL 16, Drizzle
- Docker / Docker Compose
- Zod, Jest

## Environments
- Local API: http://localhost:3015
- Production API: https://gcdr-server.apps.myio-bas.com

## Required Headers (API)
- Content-Type: application/json
- x-tenant-id: <tenant-uuid>
- Authorization: Bearer <jwt>
- For partner endpoints: X-API-Key: <api-key>

## OpenAPI
- Swagger UI: /docs (local)
- OpenAPI JSON: /docs/openapi.json (local)
- Local spec: docs/openapi.yaml

## Quick Start
1. npm install
2. cp .env.example .env
3. docker compose up -d
4. curl http://localhost:3015/health

## Useful Commands
- Dev: npm run dev
- Build: npm run build
- Start: npm start
- Lint: npm run lint
- Typecheck: npm run typecheck
- Tests: npm test
- Docker: docker compose up -d / down / logs -f
- Seeds: npm run db:seed / db:seed:clear / db:seed:verify

## Testing
- Unit: npm run test:unit
- Integration: npm run test:integration
- Coverage: npm run test:coverage

## Code Conventions
- Files: camelCase
- Classes/Types: PascalCase
- Interfaces: PascalCase prefixed with I
- Constants: SCREAMING_SNAKE
- Always validate inputs with Zod in handlers
- Use custom AppError classes (NotFoundError, ValidationError, etc.)

## Common Paths
- Controllers: src/controllers/
- Middleware: src/middleware/
- Services: src/services/
- Domain entities: src/domain/entities/
- DB schema: src/infrastructure/database/drizzle/schema.ts
- Tests: tests/

## Authentication
- JWT Bearer for frontend/mobile
- API Key for partner integrations
- OAuth2 client credentials for M2M partners
- Customer API Key for M2M (Node-RED bundles)

## Notes
- No /dev prefix in routes (legacy serverless removed)
- JWT supports multiple audiences (gcdr-api, alarm-orchestrator)

## Troubleshooting Shortcuts
- Port in use: netstat -ano | findstr :3015
- Docker status: docker compose ps
- Postgres logs: docker compose logs postgres

## Device Types
- SENSOR, ACTUATOR, GATEWAY, CONTROLLER, METER, CAMERA, OUTLET, OTHER
- OUTLET devices have `channels` array in specs: `{ name, channel, type }`

## Docs
- docs/ONBOARDING.md (primary)
- RFCs: docs/RFC-0001..RFC-0014
- Simulator: docs/SIMULATOR-MANUAL.md
- Metrics reference: docs/metricas.txt

## Contacts
- Tech Lead: Rodrigo Lago (rodrigo@myio.com.br)
- Slack: #dev
