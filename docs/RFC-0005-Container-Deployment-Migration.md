# RFC-0005: Migration from AWS Lambda to Container Deployment

- Feature Name: `container_deployment_migration`
- Start Date: 2026-01-21
- Completion Date: 2026-01-22
- RFC PR: N/A
- Status: **Implemented**

## Summary

This RFC proposes migrating GCDR from AWS Lambda/Serverless Framework deployment to a container-based deployment on Dokploy. The migration includes converting Lambda handlers to an HTTP framework (Express/Fastify), creating Docker images, and establishing container orchestration workflows.

## Motivation

The current AWS Lambda deployment model has served well but presents challenges for:

- **Cost predictability**: Lambda costs scale linearly with invocations; sustained workloads can be more cost-effective on containers.
- **Cold start latency**: Lambda cold starts add 100-500ms latency on first invocations.
- **Deployment complexity**: Managing 177 Lambda functions increases deployment time and CloudFormation stack limits.
- **Infrastructure control**: Limited control over runtime environment, networking, and resource allocation.
- **Vendor lock-in**: Heavy reliance on AWS-specific services (API Gateway, Lambda, EventBridge).
- **Local development**: Serverless-offline provides approximation but not identical behavior.

Container deployment on Dokploy offers:

- Fixed monthly costs with predictable scaling.
- No cold starts; consistent response times.
- Unified deployment artifact (Docker image).
- Full control over runtime and networking.
- Portability across cloud providers.
- Identical local and production environments.

## Guide-level Explanation

### What Changes for Developers

- **Entry Point**: Single application entry (`src/app.ts`) instead of 177 handler exports.
- **HTTP Framework**: Express.js or Fastify routes replace Lambda handlers.
- **Request/Response**: Standard HTTP request/response objects instead of `APIGatewayProxyEvent`.
- **Local Development**: `npm run dev` starts the server locally (identical to production).
- **Environment**: Docker Compose for local development with all dependencies.

### What Changes for Operations

- **Deployment Target**: Dokploy container platform instead of AWS Lambda.
- **Build Pipeline**: Docker image build and push to container registry.
- **Scaling**: Horizontal pod/container scaling instead of Lambda concurrency.
- **Monitoring**: Container metrics (CPU, memory) instead of Lambda metrics.
- **Secrets**: Environment variables or secret management (not AWS SSM/Secrets Manager).

### Migration Approach (High Level)

1. Create HTTP framework adapter layer.
2. Convert handlers to route controllers.
3. Build Dockerfile and container infrastructure.
4. Deploy to Dokploy staging environment.
5. Validate functionality and performance.
6. Cutover production traffic.
7. Decommission Lambda deployment.

## Reference-level Explanation

### Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AWS Cloud                                │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │   API    │───▶│   Lambda     │───▶│    DynamoDB      │   │
│  │ Gateway  │    │  (177 funcs) │    │   (14 tables)    │   │
│  └──────────┘    └──────────────┘    └──────────────────┘   │
│                         │                                    │
│                         ▼                                    │
│                  ┌──────────────┐                            │
│                  │ EventBridge  │                            │
│                  └──────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

### Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Dokploy Platform                          │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Traefik │───▶│   GCDR API   │───▶│   PostgreSQL     │   │
│  │  (proxy) │    │  (container) │    │   (container)    │   │
│  └──────────┘    └──────────────┘    └──────────────────┘   │
│                         │                                    │
│                         ▼                                    │
│                  ┌──────────────┐                            │
│                  │ Redis/Queue  │ (optional)                 │
│                  └──────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

### Codebase Statistics

| Metric | Count |
|--------|-------|
| Lambda Handlers | 177 |
| Functional Modules | 22 |
| Repositories | 25 |
| Services | 15 |
| TypeScript LOC | ~11,231 |
| DynamoDB Tables | 14 |

### Handler Modules by Domain

| Domain | Handlers | Description |
|--------|----------|-------------|
| Authentication | 6 | login, refresh, mfa, logout, password reset |
| Customers | 9 | CRUD + tree hierarchy operations |
| Assets | 10 | Asset management with hierarchy |
| Devices | 8 | Device management + connectivity |
| Partners | 20 | Partner lifecycle, OAuth, webhooks |
| Users | 15 | User management, MFA, invitations |
| Authorization | 9 | Permissions, role assignment |
| Rules | 9 | CRUD + evaluation, statistics |
| Roles & Policies | 14 | RBAC management |
| Integrations | 12 | Integration marketplace |
| Centrals | 10 | Central device management |
| Others | 55 | Themes, groups, API keys, health |

### Handler Conversion Pattern

**Current Lambda Handler:**

```typescript
// src/handlers/customers/create.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { extractContext } from '../middleware/requestContext';
import { parseBody } from '../../shared/utils/parseBody';
import { created, handleError } from '../middleware/response';
import { CreateCustomerSchema } from '../../dto/request/CustomerDTO';
import { customerService } from '../../services';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);
    const data = CreateCustomerSchema.parse(body);
    const customer = await customerService.create(ctx.tenantId, data, ctx.userId);
    return created(customer);
  } catch (err) {
    return handleError(err);
  }
};
```

**Target Express Controller:**

```typescript
// src/controllers/customers.controller.ts
import { Router, Request, Response, NextFunction } from 'express';
import { CreateCustomerSchema } from '../dto/request/CustomerDTO';
import { customerService } from '../services';

const router = Router();

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;  // From middleware
    const data = CreateCustomerSchema.parse(req.body);
    const customer = await customerService.create(tenantId, data, userId);
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    next(err);
  }
});

export default router;
```

### Application Entry Point

```typescript
// src/app.ts
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { contextMiddleware } from './middleware/context';
import { authMiddleware } from './middleware/auth';

// Route imports
import authRoutes from './controllers/auth.controller';
import customerRoutes from './controllers/customers.controller';
import assetRoutes from './controllers/assets.controller';
// ... other routes

const app = express();

// Global middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(contextMiddleware);

// Public routes
app.use('/auth', authRoutes);
app.use('/health', healthRoutes);
app.use('/docs', docsRoutes);

// Protected routes
app.use('/customers', authMiddleware, customerRoutes);
app.use('/assets', authMiddleware, assetRoutes);
app.use('/devices', authMiddleware, deviceRoutes);
// ... other protected routes

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GCDR API running on port ${PORT}`);
});

export default app;
```

### Middleware Adaptation

**Current (Lambda):**

```typescript
// src/handlers/middleware/requestContext.ts
export function extractContext(event: APIGatewayProxyEvent): RequestContext {
  const tenantId = event.headers['x-tenant-id'];
  const authHeader = event.headers['authorization'];
  // ... decode JWT, extract user
  return { tenantId, userId, requestId, ip };
}
```

**Target (Express):**

```typescript
// src/middleware/context.ts
import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      context: RequestContext;
    }
  }
}

export function contextMiddleware(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.headers['x-tenant-id'] as string;
  const authHeader = req.headers['authorization'];
  // ... decode JWT, extract user
  req.context = { tenantId, userId, requestId, ip };
  next();
}
```

### Dockerfile

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production=false

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Security: non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S gcdr -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

USER gcdr

EXPOSE 3000

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/app.js"]
```

### Docker Compose (Development)

```yaml
version: "3.9"

services:
  api:
    build:
      context: .
      target: builder
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: 3000
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/gcdr
      JWT_SECRET: dev-secret
      JWT_ISSUER: gcdr-dev
      JWT_AUDIENCE: gcdr-api
    volumes:
      - ./src:/app/src
      - ./node_modules:/app/node_modules
    depends_on:
      postgres:
        condition: service_healthy
    command: npm run dev

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: gcdr
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

### Dokploy Deployment Configuration

**dokploy.yml:**

```yaml
name: gcdr-api
type: application

build:
  dockerfile: Dockerfile
  context: .

deploy:
  replicas: 2
  resources:
    limits:
      memory: 512M
      cpu: 500m
    requests:
      memory: 256M
      cpu: 100m

env:
  - name: NODE_ENV
    value: production
  - name: PORT
    value: "3000"
  - name: DATABASE_URL
    fromSecret: database-url
  - name: JWT_SECRET
    fromSecret: jwt-secret

healthCheck:
  path: /health
  port: 3000
  interval: 30s
  timeout: 5s

ingress:
  host: api.gcdr.myio.com.br
  tls: true
```

### Components That Remain Unchanged

| Component | Reason |
|-----------|--------|
| Service Layer | Business logic is framework-agnostic |
| Repository Layer | DynamoDB SDK works in containers |
| DTOs (Zod schemas) | Validation is framework-agnostic |
| Domain Entities | Pure TypeScript interfaces |
| Error Classes | Can adapt to any HTTP framework |
| Utility Functions | No framework dependency |

### Components Requiring Changes

| Component | Change Required |
|-----------|----------------|
| Handler files (177) | Convert to route controllers |
| Response helpers | Adapt to Express response methods |
| Request context | Use Express middleware pattern |
| Error handler | Use Express error middleware |
| Entry point | Create Express app initialization |
| Health check | Adapt to HTTP endpoint |
| OpenAPI serving | Use swagger-ui-express |

### AWS Services Impact

| Service | Current Usage | After Migration |
|---------|---------------|-----------------|
| Lambda | 177 functions | Removed |
| API Gateway | HTTP routing | Replaced by Traefik |
| DynamoDB | Data storage | Keep or migrate to PostgreSQL |
| EventBridge | Event publishing | Keep, replace, or remove |
| CloudWatch | Logs/metrics | Replace with container logging |
| IAM | Lambda roles | Not needed (credentials via env) |

### Migration Phases

**Phase 0 - Preparation** - COMPLETED

- [x] Define target HTTP framework (Express vs Fastify). -> Express.js chosen
- [x] Create adapter layer interfaces.
- [x] Set up Docker build pipeline.
- [x] Configure Dokploy project.

**Phase 1 - Framework Setup** - COMPLETED

- [x] Create Express application structure (`src/app.ts`).
- [x] Implement global middleware (CORS, helmet, JSON parsing).
- [x] Adapt request context middleware (`src/middleware/context.ts`).
- [x] Adapt error handling middleware (`src/middleware/errorHandler.ts`).
- [x] Implement health check endpoint (`src/controllers/health.controller.ts`).

**Phase 2 - Handler Conversion** - PARTIALLY COMPLETED

- [x] Convert authentication handlers (6).
- [x] Convert customer handlers (9).
- [ ] Convert asset handlers (10).
- [x] Convert device handlers (8).
- [ ] Convert partner handlers (20).
- [x] Convert user handlers (15).
- [x] Convert authorization handlers (9).
- [x] Convert rule handlers (10).
- [x] Convert integration handlers (12).
- [x] Convert customer-api-keys handlers.
- [ ] Convert remaining handlers.

**Phase 3 - Infrastructure** - COMPLETED

- [x] Finalize Dockerfile (multi-stage build with non-root user).
- [x] Set up container registry (local Docker).
- [x] Configure Dokploy deployment (`dokploy.yml`).
- [x] Set up secrets management (environment variables).
- [ ] Configure TLS/ingress (pending production deployment).

**Phase 4 - Testing** - PENDING

- [ ] Adapt unit tests for Express.
- [ ] Create integration tests.
- [ ] Performance testing (load tests).
- [ ] Security scanning.

**Phase 5 - Deployment** - PENDING

- [ ] Deploy to Dokploy staging.
- [ ] Validate all endpoints.
- [ ] Monitor performance metrics.
- [ ] DNS cutover to container deployment.

**Phase 6 - Cleanup** - PENDING

- [ ] Remove Lambda handlers.
- [ ] Remove serverless.yml.
- [ ] Remove serverless plugins.
- [x] Update documentation.
- [ ] Decommission AWS resources.

### Environment Variables

**Current (Lambda via serverless.yml):**

```yaml
environment:
  CUSTOMERS_TABLE: gcdr-customers-${stage}
  JWT_SECRET: ${env:JWT_SECRET}
  # ... 14 table names
```

**Target (Container):**

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/gcdr

# Or DynamoDB (if keeping)
AWS_REGION=sa-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
CUSTOMERS_TABLE=gcdr-customers-prod

# JWT
JWT_SECRET=xxx
JWT_ISSUER=gcdr
JWT_AUDIENCE=gcdr-api

# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
```

### Package.json Changes

**Add:**

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "helmet": "^7.1.0",
    "compression": "^1.7.4",
    "swagger-ui-express": "^5.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/compression": "^1.7.5",
    "nodemon": "^3.0.2",
    "ts-node-dev": "^2.0.0"
  },
  "scripts": {
    "dev": "ts-node-dev --respawn src/app.ts",
    "build": "tsc",
    "start": "node dist/app.js",
    "docker:build": "docker build -t gcdr-api .",
    "docker:run": "docker run -p 3000:3000 gcdr-api"
  }
}
```

**Remove:**

```json
{
  "devDependencies": {
    "serverless": "^3.34.0",
    "serverless-dotenv-plugin": "^6.0.0",
    "serverless-esbuild": "^1.46.0",
    "serverless-offline": "^12.0.4",
    "serverless-plugin-split-stacks": "^1.14.0",
    "@types/aws-lambda": "^8.10.119"
  }
}
```

## Drawbacks

- **Migration effort**: Converting 177 handlers requires significant development time.
- **Testing coverage**: All endpoints need re-validation in the new framework.
- **Learning curve**: Team needs familiarity with container operations.
- **Infrastructure management**: Containers require more operational oversight than Lambda.
- **Database connection pooling**: Need to manage connection pools (not needed in Lambda).

## Rationale and Alternatives

### Why Express.js

- Mature ecosystem with extensive middleware.
- Large community and documentation.
- Similar request/response patterns to Lambda handlers.
- TypeScript support well-established.

### Alternatives Considered

**Fastify:**

- Pros: Faster performance, built-in validation.
- Cons: Smaller ecosystem, different plugin model.
- Decision: Consider for v2 if performance is critical.

**NestJS:**

- Pros: Full framework with DI, decorators, structured approach.
- Cons: Significant rewrite required, steeper learning curve.
- Decision: Overkill for this migration scope.

**Keep Lambda:**

- Pros: No migration effort.
- Cons: Does not address cost, cold start, and control concerns.
- Decision: Not aligned with long-term goals.

**AWS ECS/Fargate:**

- Pros: Container deployment within AWS ecosystem.
- Cons: Still AWS-locked, higher complexity than Dokploy.
- Decision: Consider if staying in AWS is preferred.

### Why Dokploy

- Self-hosted with full control.
- Simpler than Kubernetes for small teams.
- Integrated secrets, deployments, and monitoring.
- Lower cost than managed container services.

## Prior Art

- Serverless to container migrations at Segment, Honeycomb.
- AWS Lambda to ECS migration patterns.
- Express.js best practices for large applications.
- 12-factor app methodology for containers.

## Unresolved Questions

- Should we migrate to PostgreSQL concurrently or keep DynamoDB initially?
- What container registry will be used (Docker Hub, GitHub Container Registry, self-hosted)?
- How will secrets be managed in Dokploy (environment variables, external vault)?
- What is the rollback strategy if container deployment fails?
- Should we implement blue-green deployment or rolling updates?

## Future Possibilities

- **Kubernetes migration**: Dokploy containers can be migrated to K8s if scale demands.
- **Multi-region deployment**: Containers simplify multi-region with image replication.
- **Microservices split**: Container model enables future service decomposition.
- **GitOps workflow**: Container deployments enable GitOps with ArgoCD or similar.
- **Horizontal scaling**: Auto-scaling based on CPU/memory metrics.

## Appendix: Route Mapping

### Authentication Routes

| Lambda Handler | Express Route | Method |
|----------------|---------------|--------|
| auth/login | /auth/login | POST |
| auth/refresh | /auth/refresh | POST |
| auth/logout | /auth/logout | POST |
| auth/mfaVerify | /auth/mfa/verify | POST |
| auth/forgotPassword | /auth/forgot-password | POST |
| auth/resetPassword | /auth/reset-password | POST |

### Customer Routes

| Lambda Handler | Express Route | Method |
|----------------|---------------|--------|
| customers/create | /customers | POST |
| customers/get | /customers/:id | GET |
| customers/list | /customers | GET |
| customers/update | /customers/:id | PUT |
| customers/delete | /customers/:id | DELETE |
| customers/getChildren | /customers/:id/children | GET |
| customers/getDescendants | /customers/:id/descendants | GET |
| customers/getTree | /customers/:id/tree | GET |
| customers/move | /customers/:id/move | POST |

### Asset Routes

| Lambda Handler | Express Route | Method |
|----------------|---------------|--------|
| assets/create | /assets | POST |
| assets/get | /assets/:id | GET |
| assets/list | /assets | GET |
| assets/update | /assets/:id | PUT |
| assets/delete | /assets/:id | DELETE |
| assets/listByCustomer | /customers/:customerId/assets | GET |
| assets/getChildren | /assets/:id/children | GET |
| assets/getDescendants | /assets/:id/descendants | GET |
| assets/getTree | /assets/:id/tree | GET |
| assets/move | /assets/:id/move | POST |

*(Additional route mappings for all 177 handlers would be documented in implementation)*

## Implementation Summary (2026-01-22)

The initial migration has been completed with the following deliverables:

### Files Created

| File | Description |
|------|-------------|
| `src/app.ts` | Express application entry point |
| `src/middleware/auth.ts` | JWT authentication middleware |
| `src/middleware/context.ts` | Request context extraction |
| `src/middleware/errorHandler.ts` | Global error handling |
| `src/middleware/response.ts` | Standardized response helpers |
| `src/controllers/auth.controller.ts` | Authentication routes |
| `src/controllers/customers.controller.ts` | Customer management routes |
| `src/controllers/devices.controller.ts` | Device management routes |
| `src/controllers/users.controller.ts` | User management routes |
| `src/controllers/policies.controller.ts` | Policy management routes |
| `src/controllers/authorization.controller.ts` | Authorization routes |
| `src/controllers/rules.controller.ts` | Rules engine routes |
| `src/controllers/integrations.controller.ts` | Integration marketplace routes |
| `src/controllers/customer-api-keys.controller.ts` | Customer API keys routes |
| `src/controllers/health.controller.ts` | Health check routes |
| `Dockerfile` | Multi-stage production build |
| `docker-compose.yml` | Full stack orchestration |
| `docker-compose.dev.yml` | Development overrides |
| `dokploy.yml` | Dokploy deployment configuration |
| `.env.example` | Environment variables template |
| `.dockerignore` | Docker build optimization |

### Running Services

```bash
# Start containers
docker compose up -d

# Services running:
# - gcdr-api on port 3000
# - gcdr-postgres on port 5433
```

### Verified Endpoints

- `GET /health` -> `{"status":"ok"}`
- `GET /health/ready` -> `{"status":"ready"}`

## Next Steps

1. ~~Team review and RFC approval.~~ DONE
2. ~~Framework decision (Express vs Fastify).~~ DONE - Express.js
3. ~~Proof of concept with 5-10 handlers.~~ DONE - 10 controllers migrated
4. Complete remaining handler migrations (assets, partners, centrals, etc.)
5. Set up staging environment in Dokploy.
6. Run comprehensive endpoint validation.
7. Performance and load testing.
