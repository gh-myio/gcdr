# RFC-0009: Events Audit Logs

- Feature Name: `events_audit_logs`
- Start Date: 2026-01-23
- RFC PR: N/A
- Status: Draft
- Related: `alarms-backend/RFC-0002-Events-Audit-Logs.md`

## Summary

Implementar um sistema de audit logs flexível para o GCDR, inspirado no middleware `logEvent` do rec4go-api e alinhado com o RFC-0002 do Alarms Backend, permitindo rastrear ações de usuários e eventos do sistema em endpoints de forma estruturada e consultável.

## Motivation

### Necessidades

1. **Compliance & Auditoria**: Rastrear quem fez o que e quando em um sistema multi-tenant
2. **Debugging**: Entender a sequência de eventos que levaram a um estado
3. **Analytics**: Métricas de uso e padrões de comportamento por tenant/customer
4. **Segurança**: Detectar acessos suspeitos ou não autorizados
5. **Integração**: Manter padrão consistente com outros serviços (Alarms)

### Estado Atual

O GCDR já possui uma tabela `audit_logs` no schema, mas:
- Não tem middleware para captura automática
- Faltam campos para contexto de request (httpMethod, httpPath, statusCode, durationMs)
- Faltam campos para categorização (eventCategory, description, actorType)
- Não está sendo populada ativamente pelos endpoints

## Comparação: Alarms RFC-0002 vs GCDR

### Análise de Compatibilidade

| Aspecto | Alarms RFC-0002 | GCDR (Atual) | GCDR (Proposto) |
|---------|-----------------|--------------|-----------------|
| ID | VARCHAR(26) nanoid | UUID | **UUID** (manter) |
| Framework | Fastify hooks | Express | **Express middleware** |
| Multi-tenant | tenantId opcional | tenantId obrigatório | **tenantId obrigatório** |
| Recurso | resourceType/Id | entityType/Id | **entityType/Id** (manter) |
| Actor | actorId, actorType | userId | **userId + actorType** |
| Request context | httpMethod, path, status, duration | Não tem | **Adicionar** |
| Categorização | eventCategory | Não tem | **Adicionar** |
| Descrição | description | Não tem | **Adicionar** |

### Diferenças Justificadas

| Campo GCDR | Campo Alarms | Justificativa |
|------------|--------------|---------------|
| `entityType` + `entityId` | `resourceType` + `resourceId` | Nomenclatura GCDR já estabelecida |
| `action` (CREATE, UPDATE, DELETE) | Não tem | GCDR precisa do tipo de ação CRUD |
| `tenantId` obrigatório | `tenantId` opcional | GCDR é 100% multi-tenant |
| UUID para IDs | nanoid | Padrão GCDR já estabelecido |

### Campos a Adicionar no GCDR

```diff
+ eventCategory: varchar('event_category', { length: 30 })
+ description: text('description')
+ actorType: varchar('actor_type', { length: 20 })
+ httpMethod: varchar('http_method', { length: 10 })
+ httpPath: varchar('http_path', { length: 500 })
+ statusCode: integer('status_code')
+ errorMessage: text('error_message')
+ durationMs: integer('duration_ms')
+ customerId: uuid('customer_id')  // Específico GCDR
+ externalLink: varchar('external_link', { length: 255 })  // Inspirado rec4go
```

## Guide-level Explanation

### Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Express Request                                │
│                                 │                                        │
│                                 ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      logEvent Middleware                           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐   │  │
│  │  │ Capture Req  │─▶│   Execute    │─▶│  Capture Response      │   │  │
│  │  │   Context    │  │   Handler    │  │  & Write Audit Log     │   │  │
│  │  └──────────────┘  └──────────────┘  └────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                 │                                        │
│                                 ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                       audit_logs Table                             │  │
│  │  ┌─────────┬───────────┬────────────┬───────────┬──────────────┐  │  │
│  │  │ Event   │   Actor   │   Entity   │  Request  │  Timestamp   │  │  │
│  │  │ Type    │ (User/Sys)│ (Customer) │  Context  │              │  │  │
│  │  └─────────┴───────────┴────────────┴───────────┴──────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Exemplo de Uso (Inspirado no rec4go-api)

```typescript
// Em controllers/customers.controller.ts
router.post(
  '/',
  authMiddleware,
  logEvent({
    eventType: EventType.CUSTOMER_CREATED,
    eventCategory: EventCategory.ENTITY_CHANGE,
    description: (req) => `Customer "${req.body.name}" criado`,
    getEntityType: () => 'customer',
    getEntityId: (req, res) => res.locals.createdId,
    getCustomerId: (req, res) => res.locals.createdId,
    getMetadata: (req) => ({
      customerType: req.body.type,
      parentCustomerId: req.body.parentCustomerId,
    }),
  }),
  customersController.create
);

// Em controllers/devices.controller.ts
router.patch(
  '/:id',
  authMiddleware,
  logEvent({
    eventType: EventType.DEVICE_UPDATED,
    eventCategory: EventCategory.ENTITY_CHANGE,
    description: (req) => `Device ${req.params.id} atualizado`,
    getEntityType: () => 'device',
    getEntityId: (req) => req.params.id,
    getCustomerId: (req) => req.body.customerId,
    getPreviousValue: (req) => req.previousDevice, // Carregado antes
    getNewValue: (req, res) => res.locals.updatedDevice,
  }),
  devicesController.update
);
```

## Reference-level Explanation

### Schema Atualizado (Drizzle)

```typescript
// src/infrastructure/database/drizzle/schema.ts

export const eventCategoryEnum = pgEnum('event_category', [
  'ENTITY_CHANGE',    // CRUD em entidades
  'USER_ACTION',      // Ações do usuário (login, export, etc.)
  'SYSTEM_EVENT',     // Eventos automáticos
  'QUERY',            // Consultas/leituras
  'AUTH',             // Autenticação/autorização
  'INTEGRATION',      // Eventos de integração
]);

export const actorTypeEnum = pgEnum('actor_type', [
  'USER',             // Usuário autenticado
  'SYSTEM',           // Sistema/automação
  'API_KEY',          // Acesso via API Key
  'SERVICE_ACCOUNT',  // Conta de serviço
  'ANONYMOUS',        // Não autenticado
]);

export const auditLogs = pgTable('audit_logs', {
  // === Identificação ===
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  // === Evento ===
  eventType: varchar('event_type', { length: 100 }).notNull(),
  eventCategory: eventCategoryEnum('event_category').notNull(),
  description: text('description'),
  action: varchar('action', { length: 20 }).notNull(), // CREATE, UPDATE, DELETE, READ

  // === Entidade (alvo da ação) ===
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id'),
  customerId: uuid('customer_id'), // Customer context (GCDR específico)

  // === Ator (quem executou) ===
  userId: uuid('user_id'),
  userEmail: varchar('user_email', { length: 255 }),
  actorType: actorTypeEnum('actor_type').notNull().default('USER'),

  // === Estado antes/depois ===
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),

  // === Contexto da requisição ===
  requestId: uuid('request_id'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  httpMethod: varchar('http_method', { length: 10 }),
  httpPath: varchar('http_path', { length: 500 }),

  // === Resultado ===
  statusCode: integer('status_code'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),

  // === Metadados flexíveis ===
  metadata: jsonb('metadata').notNull().default({}),
  externalLink: varchar('external_link', { length: 255 }), // Link externo (rec4go style)

  // === Timestamp ===
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Índices existentes
  tenantEntityIdx: index('audit_logs_tenant_entity_idx').on(table.tenantId, table.entityType, table.entityId),
  tenantUserIdx: index('audit_logs_tenant_user_idx').on(table.tenantId, table.userId),
  tenantCreatedIdx: index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
  tenantEventTypeIdx: index('audit_logs_tenant_event_type_idx').on(table.tenantId, table.eventType),

  // Novos índices
  tenantCustomerIdx: index('audit_logs_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantCategoryIdx: index('audit_logs_tenant_category_idx').on(table.tenantId, table.eventCategory),
  tenantActionIdx: index('audit_logs_tenant_action_idx').on(table.tenantId, table.action),
  metadataGinIdx: index('audit_logs_metadata_gin_idx').using('gin', table.metadata),
}));
```

### Migration SQL

```sql
-- ============================================================================
-- RFC-0009: Events Audit Logs Enhancement
-- ============================================================================

-- Criar enums
CREATE TYPE event_category AS ENUM (
  'ENTITY_CHANGE', 'USER_ACTION', 'SYSTEM_EVENT', 'QUERY', 'AUTH', 'INTEGRATION'
);

CREATE TYPE actor_type AS ENUM (
  'USER', 'SYSTEM', 'API_KEY', 'SERVICE_ACCOUNT', 'ANONYMOUS'
);

-- Adicionar novas colunas
ALTER TABLE audit_logs
  ADD COLUMN event_category event_category,
  ADD COLUMN description TEXT,
  ADD COLUMN actor_type actor_type DEFAULT 'USER',
  ADD COLUMN customer_id UUID,
  ADD COLUMN http_method VARCHAR(10),
  ADD COLUMN http_path VARCHAR(500),
  ADD COLUMN status_code INTEGER,
  ADD COLUMN error_message TEXT,
  ADD COLUMN duration_ms INTEGER,
  ADD COLUMN external_link VARCHAR(255);

-- Tornar entityId nullable (para eventos sem entidade específica)
ALTER TABLE audit_logs ALTER COLUMN entity_id DROP NOT NULL;

-- Novos índices
CREATE INDEX audit_logs_tenant_customer_idx ON audit_logs(tenant_id, customer_id);
CREATE INDEX audit_logs_tenant_category_idx ON audit_logs(tenant_id, event_category);
CREATE INDEX audit_logs_tenant_action_idx ON audit_logs(tenant_id, action);
CREATE INDEX audit_logs_metadata_gin_idx ON audit_logs USING GIN(metadata);

-- Backfill event_category para registros existentes
UPDATE audit_logs SET event_category = 'ENTITY_CHANGE' WHERE event_category IS NULL;
ALTER TABLE audit_logs ALTER COLUMN event_category SET NOT NULL;
```

### Event Types para GCDR

```typescript
// src/shared/types/audit.types.ts

export enum EventType {
  // === Customers ===
  CUSTOMER_CREATED = 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED = 'CUSTOMER_UPDATED',
  CUSTOMER_DELETED = 'CUSTOMER_DELETED',
  CUSTOMER_VIEWED = 'CUSTOMER_VIEWED',
  CUSTOMER_LIST_VIEWED = 'CUSTOMER_LIST_VIEWED',
  CUSTOMER_MOVED = 'CUSTOMER_MOVED',

  // === Users ===
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_INVITED = 'USER_INVITED',
  USER_ACTIVATED = 'USER_ACTIVATED',
  USER_SUSPENDED = 'USER_SUSPENDED',

  // === Assets ===
  ASSET_CREATED = 'ASSET_CREATED',
  ASSET_UPDATED = 'ASSET_UPDATED',
  ASSET_DELETED = 'ASSET_DELETED',
  ASSET_MOVED = 'ASSET_MOVED',

  // === Devices ===
  DEVICE_CREATED = 'DEVICE_CREATED',
  DEVICE_UPDATED = 'DEVICE_UPDATED',
  DEVICE_DELETED = 'DEVICE_DELETED',
  DEVICE_MOVED = 'DEVICE_MOVED',
  DEVICE_STATUS_CHANGED = 'DEVICE_STATUS_CHANGED',
  DEVICE_CONNECTIVITY_CHANGED = 'DEVICE_CONNECTIVITY_CHANGED',

  // === Rules ===
  RULE_CREATED = 'RULE_CREATED',
  RULE_UPDATED = 'RULE_UPDATED',
  RULE_DELETED = 'RULE_DELETED',
  RULE_ENABLED = 'RULE_ENABLED',
  RULE_DISABLED = 'RULE_DISABLED',
  RULE_TRIGGERED = 'RULE_TRIGGERED',

  // === Roles & Policies ===
  ROLE_CREATED = 'ROLE_CREATED',
  ROLE_UPDATED = 'ROLE_UPDATED',
  ROLE_DELETED = 'ROLE_DELETED',
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
  ROLE_REVOKED = 'ROLE_REVOKED',
  POLICY_CREATED = 'POLICY_CREATED',
  POLICY_UPDATED = 'POLICY_UPDATED',
  POLICY_DELETED = 'POLICY_DELETED',

  // === Partners ===
  PARTNER_REGISTERED = 'PARTNER_REGISTERED',
  PARTNER_APPROVED = 'PARTNER_APPROVED',
  PARTNER_REJECTED = 'PARTNER_REJECTED',
  PARTNER_SUSPENDED = 'PARTNER_SUSPENDED',
  PARTNER_ACTIVATED = 'PARTNER_ACTIVATED',

  // === API Keys ===
  API_KEY_CREATED = 'API_KEY_CREATED',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
  API_KEY_USED = 'API_KEY_USED',

  // === Integrations ===
  PACKAGE_SUBSCRIBED = 'PACKAGE_SUBSCRIBED',
  PACKAGE_UNSUBSCRIBED = 'PACKAGE_UNSUBSCRIBED',
  PACKAGE_PUBLISHED = 'PACKAGE_PUBLISHED',

  // === Auth ===
  AUTH_LOGIN_SUCCESS = 'AUTH_LOGIN_SUCCESS',
  AUTH_LOGIN_FAILED = 'AUTH_LOGIN_FAILED',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_TOKEN_REFRESHED = 'AUTH_TOKEN_REFRESHED',
  AUTH_PASSWORD_CHANGED = 'AUTH_PASSWORD_CHANGED',
  AUTH_PASSWORD_RESET_REQUESTED = 'AUTH_PASSWORD_RESET_REQUESTED',
  AUTH_MFA_ENABLED = 'AUTH_MFA_ENABLED',
  AUTH_MFA_DISABLED = 'AUTH_MFA_DISABLED',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',

  // === Centrals ===
  CENTRAL_CREATED = 'CENTRAL_CREATED',
  CENTRAL_UPDATED = 'CENTRAL_UPDATED',
  CENTRAL_DELETED = 'CENTRAL_DELETED',
  CENTRAL_STATUS_CHANGED = 'CENTRAL_STATUS_CHANGED',

  // === Groups ===
  GROUP_CREATED = 'GROUP_CREATED',
  GROUP_UPDATED = 'GROUP_UPDATED',
  GROUP_DELETED = 'GROUP_DELETED',
  GROUP_MEMBER_ADDED = 'GROUP_MEMBER_ADDED',
  GROUP_MEMBER_REMOVED = 'GROUP_MEMBER_REMOVED',

  // === Look & Feel ===
  THEME_CREATED = 'THEME_CREATED',
  THEME_UPDATED = 'THEME_UPDATED',
  THEME_DELETED = 'THEME_DELETED',
  THEME_SET_DEFAULT = 'THEME_SET_DEFAULT',

  // === Alarm Bundle (GCDR-specific) ===
  ALARM_BUNDLE_GENERATED = 'ALARM_BUNDLE_GENERATED',
  ALARM_BUNDLE_DOWNLOADED = 'ALARM_BUNDLE_DOWNLOADED',

  // === Admin ===
  ADMIN_DATA_EXPORTED = 'ADMIN_DATA_EXPORTED',
  ADMIN_BULK_OPERATION = 'ADMIN_BULK_OPERATION',
}

export enum EventCategory {
  ENTITY_CHANGE = 'ENTITY_CHANGE',
  USER_ACTION = 'USER_ACTION',
  SYSTEM_EVENT = 'SYSTEM_EVENT',
  QUERY = 'QUERY',
  AUTH = 'AUTH',
  INTEGRATION = 'INTEGRATION',
}

export enum ActorType {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
  API_KEY = 'API_KEY',
  SERVICE_ACCOUNT = 'SERVICE_ACCOUNT',
  ANONYMOUS = 'ANONYMOUS',
}

export enum ActionType {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  EXECUTE = 'EXECUTE',
}
```

### Middleware Implementation (Express)

```typescript
// src/middleware/audit.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { generateId } from '../shared/utils/idGenerator';
import { EventType, EventCategory, ActorType, ActionType } from '../shared/types/audit.types';

export interface LogEventOptions {
  eventType: EventType;
  eventCategory?: EventCategory;
  action?: ActionType;
  description?: string | ((req: Request, res: Response) => string);
  getEntityType?: (req: Request) => string;
  getEntityId?: (req: Request, res: Response) => string | null;
  getCustomerId?: (req: Request, res: Response) => string | null;
  getMetadata?: (req: Request, res: Response) => Record<string, unknown>;
  getPreviousValue?: (req: Request) => Record<string, unknown> | null;
  getNewValue?: (req: Request, res: Response) => Record<string, unknown> | null;
  getExternalLink?: (req: Request) => string | null;
  logOnError?: boolean;
  logOnSuccess?: boolean;
}

export function logEvent(options: LogEventOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Capturar contexto da requisição
    const context = {
      requestId: req.headers['x-request-id'] as string || generateId(),
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      httpMethod: req.method,
      httpPath: req.originalUrl,
      tenantId: (req as any).tenantId,
      userId: (req as any).user?.id,
      userEmail: (req as any).user?.email,
      actorType: determineActorType(req),
    };

    // Interceptar response
    const originalJson = res.json.bind(res);
    res.json = function(body: any) {
      res.locals.responseBody = body;
      return originalJson(body);
    };

    // Hook para executar após response
    res.on('finish', async () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      const isError = statusCode >= 400;

      if (isError && options.logOnError === false) return;
      if (!isError && options.logOnSuccess === false) return;

      try {
        const description = typeof options.description === 'function'
          ? options.description(req, res)
          : options.description;

        const auditLog = {
          id: generateId(),
          tenantId: context.tenantId,
          eventType: options.eventType,
          eventCategory: options.eventCategory ?? inferCategory(options.eventType),
          description,
          action: options.action ?? inferAction(options.eventType),
          entityType: options.getEntityType?.(req) ?? inferEntityType(options.eventType),
          entityId: options.getEntityId?.(req, res),
          customerId: options.getCustomerId?.(req, res),
          userId: context.userId,
          userEmail: context.userEmail,
          actorType: context.actorType,
          oldValues: options.getPreviousValue?.(req),
          newValues: options.getNewValue?.(req, res),
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          httpMethod: context.httpMethod,
          httpPath: context.httpPath,
          statusCode,
          errorMessage: isError ? extractErrorMessage(res.locals.responseBody) : null,
          durationMs: duration,
          metadata: options.getMetadata?.(req, res) ?? {},
          externalLink: options.getExternalLink?.(req),
        };

        // Inserir assíncronamente para não bloquear response
        await insertAuditLog(auditLog);
      } catch (error) {
        console.error('Failed to write audit log:', error);
      }
    });

    next();
  };
}

function determineActorType(req: Request): ActorType {
  if ((req as any).apiKey) return ActorType.API_KEY;
  if ((req as any).serviceAccount) return ActorType.SERVICE_ACCOUNT;
  if ((req as any).user) return ActorType.USER;
  return ActorType.ANONYMOUS;
}

function inferCategory(eventType: EventType): EventCategory {
  if (eventType.includes('_VIEWED') || eventType.includes('_LIST_')) {
    return EventCategory.QUERY;
  }
  if (eventType.startsWith('AUTH_')) {
    return EventCategory.AUTH;
  }
  if (eventType.includes('_TRIGGERED') || eventType.includes('_CHANGED')) {
    return EventCategory.SYSTEM_EVENT;
  }
  if (eventType.includes('PACKAGE_') || eventType.includes('INTEGRATION_')) {
    return EventCategory.INTEGRATION;
  }
  return EventCategory.ENTITY_CHANGE;
}

function inferAction(eventType: EventType): ActionType {
  if (eventType.includes('_CREATED') || eventType.includes('_REGISTERED')) {
    return ActionType.CREATE;
  }
  if (eventType.includes('_UPDATED') || eventType.includes('_CHANGED') ||
      eventType.includes('_ENABLED') || eventType.includes('_DISABLED') ||
      eventType.includes('_MOVED') || eventType.includes('_ASSIGNED')) {
    return ActionType.UPDATE;
  }
  if (eventType.includes('_DELETED') || eventType.includes('_REVOKED') ||
      eventType.includes('_REMOVED')) {
    return ActionType.DELETE;
  }
  if (eventType.includes('_VIEWED') || eventType.includes('_DOWNLOADED')) {
    return ActionType.READ;
  }
  return ActionType.EXECUTE;
}

function inferEntityType(eventType: EventType): string {
  const match = eventType.match(/^([A-Z]+)_/);
  return match ? match[1].toLowerCase() : 'unknown';
}

function extractErrorMessage(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    return (obj.error as string) || (obj.message as string) || null;
  }
  return null;
}
```

### Níveis de Audit (Configurável)

```typescript
// src/config/audit.config.ts

export enum AuditLevel {
  NONE = 0,
  MINIMAL = 1,    // Apenas ações críticas (CREATE, DELETE, auth)
  STANDARD = 2,   // Ações de usuário + erros
  VERBOSE = 3,    // Inclui queries/leituras
  DEBUG = 4,      // Tudo
}

export const AUDIT_CONFIG: Record<EventType, AuditLevel> = {
  // Crítico - sempre loga
  [EventType.CUSTOMER_CREATED]: AuditLevel.MINIMAL,
  [EventType.CUSTOMER_DELETED]: AuditLevel.MINIMAL,
  [EventType.USER_CREATED]: AuditLevel.MINIMAL,
  [EventType.USER_DELETED]: AuditLevel.MINIMAL,
  [EventType.ROLE_ASSIGNED]: AuditLevel.MINIMAL,
  [EventType.ROLE_REVOKED]: AuditLevel.MINIMAL,
  [EventType.API_KEY_CREATED]: AuditLevel.MINIMAL,
  [EventType.API_KEY_REVOKED]: AuditLevel.MINIMAL,
  [EventType.AUTH_LOGIN_FAILED]: AuditLevel.MINIMAL,
  [EventType.AUTH_PASSWORD_CHANGED]: AuditLevel.MINIMAL,

  // Standard
  [EventType.CUSTOMER_UPDATED]: AuditLevel.STANDARD,
  [EventType.DEVICE_CREATED]: AuditLevel.STANDARD,
  [EventType.DEVICE_UPDATED]: AuditLevel.STANDARD,
  [EventType.DEVICE_DELETED]: AuditLevel.STANDARD,
  [EventType.RULE_CREATED]: AuditLevel.STANDARD,
  [EventType.RULE_UPDATED]: AuditLevel.STANDARD,

  // Verbose
  [EventType.CUSTOMER_VIEWED]: AuditLevel.VERBOSE,
  [EventType.CUSTOMER_LIST_VIEWED]: AuditLevel.VERBOSE,
  [EventType.DEVICE_STATUS_CHANGED]: AuditLevel.VERBOSE,

  // Debug
  [EventType.AUTH_TOKEN_REFRESHED]: AuditLevel.DEBUG,
};

export function shouldLog(eventType: EventType, currentLevel: AuditLevel): boolean {
  const requiredLevel = AUDIT_CONFIG[eventType] ?? AuditLevel.STANDARD;
  return currentLevel >= requiredLevel;
}
```

### API para Consulta de Logs

```typescript
// GET /api/v1/audit-logs

interface AuditLogQuery {
  tenantId: string;           // Obrigatório
  customerId?: string;
  userId?: string;
  eventType?: EventType;
  eventCategory?: EventCategory;
  entityType?: string;
  entityId?: string;
  action?: ActionType;
  from?: string;              // ISO date
  to?: string;                // ISO date
  limit?: number;             // default: 50, max: 100
  cursor?: string;
}

interface AuditLogResponse {
  data: AuditLog[];
  pagination: {
    cursor?: string;
    hasMore: boolean;
    total?: number;
  };
}
```

## Ações a Serem Logadas por Entidade

### Tier 1: Críticas (MINIMAL - Sempre logar)

| Entidade | Ações | Contexto |
|----------|-------|----------|
| Customer | CREATE, DELETE | parentCustomerId, type |
| User | CREATE, DELETE, SUSPEND | email, role |
| Role | ASSIGN, REVOKE | userId, roleId, scope |
| API Key | CREATE, REVOKE | keyPrefix, scopes |
| Auth | LOGIN_FAILED, PASSWORD_CHANGED | email, reason |

### Tier 2: Standard (Produção)

| Entidade | Ações | Contexto |
|----------|-------|----------|
| Customer | UPDATE, MOVE | changedFields |
| Device | CREATE, UPDATE, DELETE, MOVE | serialNumber, assetId |
| Asset | CREATE, UPDATE, DELETE, MOVE | code, parentAssetId |
| Rule | CREATE, UPDATE, DELETE, ENABLE/DISABLE | ruleType, priority |
| Partner | REGISTER, APPROVE, REJECT, SUSPEND | companyName |

### Tier 3: Verbose (Opcional)

| Entidade | Ações | Contexto |
|----------|-------|----------|
| * | VIEW, LIST | filters |
| Device | STATUS_CHANGED, CONNECTIVITY_CHANGED | oldStatus, newStatus |
| Alarm Bundle | GENERATED, DOWNLOADED | ruleCount |

## Change Map - Arquivos a Modificar

### 1. Database

| Arquivo | Mudança |
|---------|---------|
| `src/infrastructure/database/drizzle/schema.ts` | Adicionar enums + novos campos em auditLogs |
| `drizzle/*.sql` | Migration gerada |

### 2. Tipos

| Arquivo | Mudança |
|---------|---------|
| `src/shared/types/audit.types.ts` | Criar EventType, EventCategory, ActorType, ActionType |

### 3. Middleware

| Arquivo | Mudança |
|---------|---------|
| `src/middleware/audit.middleware.ts` | Criar middleware logEvent |
| `src/middleware/index.ts` | Exportar logEvent |

### 4. Repository

| Arquivo | Mudança |
|---------|---------|
| `src/repositories/AuditLogRepository.ts` | Criar/atualizar repository |
| `src/repositories/interfaces/IAuditLogRepository.ts` | Criar interface |

### 5. Controllers (adicionar logEvent)

| Arquivo | Eventos |
|---------|---------|
| `src/controllers/customers.controller.ts` | CUSTOMER_* |
| `src/controllers/devices.controller.ts` | DEVICE_* |
| `src/controllers/users.controller.ts` | USER_* |
| `src/controllers/rules.controller.ts` | RULE_* |
| `src/controllers/policies.controller.ts` | POLICY_* |
| `src/controllers/auth.controller.ts` | AUTH_* |
| `src/controllers/integrations.controller.ts` | PACKAGE_* |

### 6. Documentação

| Arquivo | Mudança |
|---------|---------|
| `docs/openapi.yaml` | Adicionar endpoint GET /audit-logs |
| `scripts/db/seeds/15-audit-logs.sql` | Seed com exemplos |

## Drawbacks

1. **Performance**: Escrita síncrona adiciona ~5-10ms por request
2. **Storage**: Logs crescem rapidamente (necessário política de retenção)
3. **Manutenção**: Cada novo endpoint precisa do decorator

## Rationale and Alternatives

### Por que manter compatibilidade com Alarms RFC-0002?

1. **Consistência**: Facilita queries cross-service
2. **Tooling**: Mesmas ferramentas de análise
3. **Onboarding**: Desenvolvedores familiarizados

### Diferenças justificadas do GCDR

| Diferença | Justificativa |
|-----------|---------------|
| UUID vs nanoid | Padrão já estabelecido no GCDR |
| entityType vs resourceType | Nomenclatura GCDR existente |
| action separado | GCDR precisa filtrar por tipo CRUD |
| customerId | GCDR é customer-centric |

## Implementation Plan

### Fase 1: Schema e Tipos
- [ ] Criar enums no schema
- [ ] Adicionar novas colunas em audit_logs
- [ ] Criar migration
- [ ] Criar audit.types.ts

### Fase 2: Middleware e Repository
- [ ] Criar middleware logEvent
- [ ] Criar AuditLogRepository
- [ ] Configurar audit levels

### Fase 3: Integração nos Controllers
- [ ] Adicionar logEvent em customers
- [ ] Adicionar logEvent em devices
- [ ] Adicionar logEvent em users
- [ ] Adicionar logEvent em rules
- [ ] Adicionar logEvent em auth

### Fase 4: API e Documentação
- [ ] Criar endpoint GET /audit-logs
- [ ] Documentar no OpenAPI
- [ ] Criar seed com exemplos

## Unresolved Questions

1. **Retenção**: Quanto tempo manter logs? (sugestão: 90 dias para VERBOSE, 1 ano para MINIMAL)
2. **PII**: Como mascarar dados sensíveis (emails, IPs)?
3. **Export**: Formato para exportação (CSV, JSON)?
4. **Rate Limiting**: Limitar queries de audit logs?

## Future Possibilities

1. **Real-time**: WebSocket para audit log em tempo real
2. **Alertas**: Trigger alertas em padrões suspeitos
3. **SIEM Integration**: Enviar para sistemas de segurança
4. **Analytics Dashboard**: UI para visualização
5. **Cross-service**: Agregar logs de GCDR + Alarms
