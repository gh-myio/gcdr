# RFC-0009: Events Audit Logs

- Feature Name: `events_audit_logs`
- Start Date: 2026-01-23
- RFC PR: N/A
- Status: Implemented
- Related: `alarms-backend/RFC-0002-Events-Audit-Logs.md`

## Summary

Implementar um sistema de audit logs flexivel para o GCDR, inspirado no middleware `logEvent` do rec4go-api e alinhado com o RFC-0002 do Alarms Backend, permitindo rastrear acoes de usuarios e eventos do sistema em endpoints de forma estruturada e consultavel.

## Motivation

### Necessidades

1. **Compliance & Auditoria**: Rastrear quem fez o que e quando em um sistema multi-tenant
2. **Debugging**: Entender a sequencia de eventos que levaram a um estado
3. **Analytics**: Metricas de uso e padroes de comportamento por tenant/customer
4. **Seguranca**: Detectar acessos suspeitos ou nao autorizados
5. **Integracao**: Manter padrao consistente com outros servicos (Alarms)

### Estado Atual

O GCDR ja possui uma tabela `audit_logs` no schema, mas:
- Nao tem middleware para captura automatica
- Faltam campos para contexto de request (httpMethod, httpPath, statusCode, durationMs)
- Faltam campos para categorizacao (eventCategory, description, actorType)
- Nao esta sendo populada ativamente pelos endpoints

## Comparacao: Alarms RFC-0002 vs GCDR

### Analise de Compatibilidade

| Aspecto | Alarms RFC-0002 | GCDR (Atual) | GCDR (Proposto) |
|---------|-----------------|--------------|-----------------|
| ID | VARCHAR(26) nanoid | UUID | **UUID** (manter) |
| Framework | Fastify hooks | Express | **Express middleware** |
| Multi-tenant | tenantId opcional | tenantId obrigatorio | **tenantId obrigatorio** |
| Recurso | resourceType/Id | entityType/Id | **entityType/Id** (manter) |
| Actor | actorId, actorType | userId | **userId + actorType** |
| Request context | httpMethod, path, status, duration | Nao tem | **Adicionar** |
| Categorizacao | eventCategory | Nao tem | **Adicionar** |
| Descricao | description | Nao tem | **Adicionar** |

### Diferencas Justificadas

| Campo GCDR | Campo Alarms | Justificativa |
|------------|--------------|---------------|
| `entityType` + `entityId` | `resourceType` + `resourceId` | Nomenclatura GCDR ja estabelecida |
| `action` (CREATE, UPDATE, DELETE) | Nao tem | GCDR precisa do tipo de acao CRUD |
| `tenantId` obrigatorio | `tenantId` opcional | GCDR e 100% multi-tenant |
| UUID para IDs | nanoid | Padrao GCDR ja estabelecido |

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
+ customerId: uuid('customer_id')  // Especifico GCDR
+ externalLink: varchar('external_link', { length: 255 })  // Inspirado rec4go
```

## Non-Functional Requirements

### Retencao de Dados

| Audit Level | Retencao | Descricao |
|-------------|----------|-----------|
| MINIMAL | 365 dias | Acoes criticas (CREATE, DELETE, auth failures) |
| STANDARD | 180 dias | Acoes de usuario em producao |
| VERBOSE | 90 dias | Queries e leituras |
| DEBUG | 30 dias | Tudo (apenas desenvolvimento) |

### Particionamento

A tabela `audit_logs` deve ser particionada por `created_at` para performance e facilitar purge:

```sql
-- Criar tabela particionada por range mensal
CREATE TABLE audit_logs (
  -- ... colunas ...
) PARTITION BY RANGE (created_at);

-- Particoes mensais
CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit_logs_2026_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ...
```

### Volume Estimado

| Cenario | Logs/dia/tenant | Storage/mes/tenant |
|---------|-----------------|-------------------|
| Baixo uso | ~100 | ~5 MB |
| Uso medio | ~500 | ~25 MB |
| Alto uso | ~2000 | ~100 MB |

### Purge Job

Cron job diario para deletar logs expirados:

```typescript
// src/jobs/audit-purge.job.ts
async function purgeExpiredAuditLogs() {
  const retentionDays = {
    [AuditLevel.MINIMAL]: 365,
    [AuditLevel.STANDARD]: 180,
    [AuditLevel.VERBOSE]: 90,
    [AuditLevel.DEBUG]: 30,
  };

  for (const [level, days] of Object.entries(retentionDays)) {
    const cutoffDate = subDays(new Date(), days);
    await db.delete(auditLogs)
      .where(and(
        lte(auditLogs.createdAt, cutoffDate),
        eq(auditLogs.auditLevel, level)
      ));
  }
}

// Executar diariamente as 03:00 UTC
cron.schedule('0 3 * * *', purgeExpiredAuditLogs);
```

## Security & Privacy

### Mascaramento de PII

Dados sensiveis devem ser mascarados antes de persistir em `oldValues`, `newValues` e `metadata`:

```typescript
// src/shared/utils/pii-sanitizer.ts

const SENSITIVE_PATTERNS = [
  'password', 'senha', 'secret', 'token', 'apiKey', 'api_key',
  'creditCard', 'credit_card', 'cardNumber', 'card_number',
  'cvv', 'ssn', 'cpf', 'cnpj', 'privateKey', 'private_key',
  'accessToken', 'access_token', 'refreshToken', 'refresh_token',
];

export function sanitizePII(data: Record<string, unknown>): Record<string, unknown> {
  if (!data || typeof data !== 'object') return data;

  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      // Verifica se a chave contem padrao sensivel
      const isSensitive = SENSITIVE_PATTERNS.some(pattern =>
        key.toLowerCase().includes(pattern.toLowerCase())
      );

      if (isSensitive) {
        return [key, '***REDACTED***'];
      }

      // Recursivamente sanitiza objetos aninhados
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return [key, sanitizePII(value as Record<string, unknown>)];
      }

      // Mascara emails parcialmente
      if (typeof value === 'string' && value.includes('@') && key.toLowerCase().includes('email')) {
        const [local, domain] = value.split('@');
        const maskedLocal = local.length > 2
          ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
          : '**';
        return [key, `${maskedLocal}@${domain}`];
      }

      // Mascara IPs parcialmente
      if (key.toLowerCase().includes('ip') && typeof value === 'string') {
        const parts = value.split('.');
        if (parts.length === 4) {
          return [key, `${parts[0]}.${parts[1]}.***.***`];
        }
      }

      return [key, value];
    })
  );
}
```

### RBAC para Endpoint `/audit-logs`

```typescript
// Permissoes necessarias para acessar audit logs
const AUDIT_LOG_PERMISSIONS = {
  read: ['admin', 'auditor', 'security-analyst'],
  export: ['admin', 'auditor'],
  delete: ['admin'], // Apenas para compliance requests
};

// Middleware de autorizacao
function requireAuditAccess(action: 'read' | 'export' | 'delete') {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRoles = (req as any).user?.roles || [];
    const allowedRoles = AUDIT_LOG_PERMISSIONS[action];

    if (!userRoles.some((role: string) => allowedRoles.includes(role))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Requires one of roles: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}
```

### Rate Limiting

```typescript
// Rate limit especifico para audit logs (evitar exfiltracao)
const auditLogRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // 10 requests por minuto
  message: { error: 'Too many audit log requests, please try again later' },
  keyGenerator: (req) => (req as any).user?.id || req.ip,
});

router.get('/audit-logs', auditLogRateLimiter, requireAuditAccess('read'), ...);
```

## Payload Limits

Limites para evitar abuso e manter consistencia:

```typescript
// src/config/audit.config.ts

export const AUDIT_PAYLOAD_LIMITS = {
  description: {
    maxLength: 500,
  },
  metadata: {
    maxKeys: 20,
    maxKeyLength: 50,
    maxValueLength: 1000,
    maxTotalSize: 10000, // 10KB
  },
  httpPath: {
    maxLength: 500,
  },
  errorMessage: {
    maxLength: 2000,
  },
  userAgent: {
    maxLength: 500,
  },
  externalLink: {
    maxLength: 255,
  },
};

export function enforcePayloadLimits(data: Partial<AuditLog>): Partial<AuditLog> {
  return {
    ...data,
    description: data.description?.slice(0, AUDIT_PAYLOAD_LIMITS.description.maxLength),
    httpPath: data.httpPath?.slice(0, AUDIT_PAYLOAD_LIMITS.httpPath.maxLength),
    errorMessage: data.errorMessage?.slice(0, AUDIT_PAYLOAD_LIMITS.errorMessage.maxLength),
    userAgent: data.userAgent?.slice(0, AUDIT_PAYLOAD_LIMITS.userAgent.maxLength),
    externalLink: data.externalLink?.slice(0, AUDIT_PAYLOAD_LIMITS.externalLink.maxLength),
    metadata: truncateMetadata(data.metadata),
  };
}

function truncateMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};

  const entries = Object.entries(metadata).slice(0, AUDIT_PAYLOAD_LIMITS.metadata.maxKeys);
  return Object.fromEntries(
    entries.map(([key, value]) => {
      const truncatedKey = key.slice(0, AUDIT_PAYLOAD_LIMITS.metadata.maxKeyLength);
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const truncatedValue = stringValue.slice(0, AUDIT_PAYLOAD_LIMITS.metadata.maxValueLength);
      return [truncatedKey, truncatedValue];
    })
  );
}
```

## Guide-level Explanation

### Arquitetura Proposta

```
+-------------------------------------------------------------------------+
|                           Express Request                                |
|                                 |                                        |
|                                 v                                        |
|  +---------------------------------------------------------------+      |
|  |                      logEvent Middleware                       |      |
|  |  +---------------+  +---------------+  +--------------------+  |      |
|  |  | Capture Req   |->|   Execute     |->| Capture Response   |  |      |
|  |  |   Context     |  |   Handler     |  | & Write Audit Log  |  |      |
|  |  +---------------+  +---------------+  +--------------------+  |      |
|  +---------------------------------------------------------------+      |
|                                 |                                        |
|                                 v                                        |
|  +---------------------------------------------------------------+      |
|  |                    PII Sanitizer + Limits                      |      |
|  +---------------------------------------------------------------+      |
|                                 |                                        |
|                                 v                                        |
|  +---------------------------------------------------------------+      |
|  |                       audit_logs Table                         |      |
|  |  +---------+-----------+------------+-----------+------------+ |      |
|  |  | Event   |   Actor   |   Entity   |  Request  |  Timestamp | |      |
|  |  | Type    | (User/Sys)| (Customer) |  Context  |            | |      |
|  |  +---------+-----------+------------+-----------+------------+ |      |
|  +---------------------------------------------------------------+      |
+-------------------------------------------------------------------------+
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
  'USER_ACTION',      // Acoes do usuario (login, export, etc.)
  'SYSTEM_EVENT',     // Eventos automaticos
  'QUERY',            // Consultas/leituras
  'AUTH',             // Autenticacao/autorizacao
  'INTEGRATION',      // Eventos de integracao
]);

export const actorTypeEnum = pgEnum('actor_type', [
  'USER',             // Usuario autenticado
  'SYSTEM',           // Sistema/automacao
  'API_KEY',          // Acesso via API Key
  'SERVICE_ACCOUNT',  // Conta de servico
  'ANONYMOUS',        // Nao autenticado
]);

export const auditLevelEnum = pgEnum('audit_level', [
  'MINIMAL',
  'STANDARD',
  'VERBOSE',
  'DEBUG',
]);

export const auditLogs = pgTable('audit_logs', {
  // === Identificacao ===
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  // === Evento ===
  eventType: varchar('event_type', { length: 100 }).notNull(),
  eventCategory: eventCategoryEnum('event_category').notNull(),
  auditLevel: auditLevelEnum('audit_level').notNull().default('STANDARD'),
  description: varchar('description', { length: 500 }),
  action: varchar('action', { length: 20 }).notNull(), // CREATE, UPDATE, DELETE, READ

  // === Entidade (alvo da acao) ===
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id'),
  customerId: uuid('customer_id'), // Customer context (GCDR especifico)

  // === Ator (quem executou) ===
  userId: uuid('user_id'),
  userEmail: varchar('user_email', { length: 255 }),
  actorType: actorTypeEnum('actor_type').notNull().default('USER'),

  // === Estado antes/depois (sanitizado) ===
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),

  // === Contexto da requisicao ===
  requestId: uuid('request_id'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: varchar('user_agent', { length: 500 }),
  httpMethod: varchar('http_method', { length: 10 }),
  httpPath: varchar('http_path', { length: 500 }),

  // === Resultado ===
  statusCode: integer('status_code'),
  errorMessage: varchar('error_message', { length: 2000 }),
  durationMs: integer('duration_ms'),

  // === Metadados flexiveis ===
  metadata: jsonb('metadata').notNull().default({}),
  externalLink: varchar('external_link', { length: 255 }),

  // === Timestamp ===
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Indices para queries comuns
  tenantEntityIdx: index('audit_logs_tenant_entity_idx').on(table.tenantId, table.entityType, table.entityId),
  tenantUserIdx: index('audit_logs_tenant_user_idx').on(table.tenantId, table.userId),
  tenantCreatedIdx: index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
  tenantEventTypeIdx: index('audit_logs_tenant_event_type_idx').on(table.tenantId, table.eventType),
  tenantCustomerIdx: index('audit_logs_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantCategoryIdx: index('audit_logs_tenant_category_idx').on(table.tenantId, table.eventCategory),
  tenantActionIdx: index('audit_logs_tenant_action_idx').on(table.tenantId, table.action),
  tenantLevelIdx: index('audit_logs_tenant_level_idx').on(table.tenantId, table.auditLevel),
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

CREATE TYPE audit_level AS ENUM (
  'MINIMAL', 'STANDARD', 'VERBOSE', 'DEBUG'
);

-- Adicionar novas colunas
ALTER TABLE audit_logs
  ADD COLUMN event_category event_category,
  ADD COLUMN audit_level audit_level DEFAULT 'STANDARD',
  ADD COLUMN description VARCHAR(500),
  ADD COLUMN actor_type actor_type DEFAULT 'USER',
  ADD COLUMN customer_id UUID,
  ADD COLUMN http_method VARCHAR(10),
  ADD COLUMN http_path VARCHAR(500),
  ADD COLUMN status_code INTEGER,
  ADD COLUMN error_message VARCHAR(2000),
  ADD COLUMN duration_ms INTEGER,
  ADD COLUMN external_link VARCHAR(255);

-- Ajustar limites de campos existentes
ALTER TABLE audit_logs ALTER COLUMN user_agent TYPE VARCHAR(500);

-- Tornar entityId nullable (para eventos sem entidade especifica)
ALTER TABLE audit_logs ALTER COLUMN entity_id DROP NOT NULL;

-- Novos indices
CREATE INDEX audit_logs_tenant_customer_idx ON audit_logs(tenant_id, customer_id);
CREATE INDEX audit_logs_tenant_category_idx ON audit_logs(tenant_id, event_category);
CREATE INDEX audit_logs_tenant_action_idx ON audit_logs(tenant_id, action);
CREATE INDEX audit_logs_tenant_level_idx ON audit_logs(tenant_id, audit_level);
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

export enum AuditLevel {
  NONE = 0,
  MINIMAL = 1,
  STANDARD = 2,
  VERBOSE = 3,
  DEBUG = 4,
}
```

### Middleware Implementation (Express)

```typescript
// src/middleware/audit.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { EventType, EventCategory, ActorType, ActionType, AuditLevel } from '../shared/types/audit.types';
import { sanitizePII } from '../shared/utils/pii-sanitizer';
import { enforcePayloadLimits, AUDIT_PAYLOAD_LIMITS } from '../config/audit.config';

export interface LogEventOptions {
  eventType: EventType;
  eventCategory?: EventCategory;
  auditLevel?: AuditLevel;
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

    // Capturar contexto da requisicao
    const requestId = req.headers['x-request-id'] as string || randomUUID();
    const context = {
      requestId,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']?.slice(0, AUDIT_PAYLOAD_LIMITS.userAgent.maxLength),
      httpMethod: req.method,
      httpPath: req.originalUrl.slice(0, AUDIT_PAYLOAD_LIMITS.httpPath.maxLength),
      tenantId: (req as any).tenantId,
      userId: (req as any).user?.id,
      userEmail: (req as any).user?.email,
      actorType: determineActorType(req),
    };

    // Propagar requestId no response header
    res.setHeader('X-Request-Id', requestId);

    // Interceptar TODOS os metodos de response
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);
    const originalEnd = res.end.bind(res);

    res.send = function(body: any) {
      res.locals.responseBody = body;
      return originalSend(body);
    };

    res.json = function(body: any) {
      res.locals.responseBody = body;
      return originalJson(body);
    };

    res.end = function(chunk?: any, encoding?: BufferEncoding, cb?: () => void) {
      if (chunk && !res.locals.responseBody) {
        res.locals.responseBody = chunk;
      }
      return originalEnd(chunk, encoding, cb);
    };

    // Hook para executar apos response
    res.on('finish', async () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      const isError = statusCode >= 400;

      if (isError && options.logOnError === false) return;
      if (!isError && options.logOnSuccess === false) return;

      // Verificar nivel de audit configurado
      const currentLevel = parseInt(process.env.AUDIT_LEVEL || '2', 10) as AuditLevel;
      const eventLevel = options.auditLevel ?? inferAuditLevel(options.eventType);
      if (currentLevel < eventLevel) return;

      try {
        const description = typeof options.description === 'function'
          ? options.description(req, res)
          : options.description;

        // Sanitizar PII dos valores antigos/novos
        const oldValues = options.getPreviousValue?.(req);
        const newValues = options.getNewValue?.(req, res);

        const auditLog = enforcePayloadLimits({
          id: randomUUID(),
          tenantId: context.tenantId,
          eventType: options.eventType,
          eventCategory: options.eventCategory ?? inferCategory(options.eventType),
          auditLevel: eventLevel === AuditLevel.MINIMAL ? 'MINIMAL'
            : eventLevel === AuditLevel.VERBOSE ? 'VERBOSE'
            : eventLevel === AuditLevel.DEBUG ? 'DEBUG'
            : 'STANDARD',
          description,
          action: options.action ?? inferAction(options.eventType),
          entityType: options.getEntityType?.(req) ?? inferEntityType(options.eventType),
          entityId: options.getEntityId?.(req, res),
          customerId: options.getCustomerId?.(req, res),
          userId: context.userId,
          userEmail: context.userEmail,
          actorType: context.actorType,
          oldValues: oldValues ? sanitizePII(oldValues) : null,
          newValues: newValues ? sanitizePII(newValues) : null,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          httpMethod: context.httpMethod,
          httpPath: context.httpPath,
          statusCode,
          errorMessage: isError ? extractErrorMessage(res.locals.responseBody) : null,
          durationMs: duration,
          metadata: sanitizePII(options.getMetadata?.(req, res) ?? {}),
          externalLink: options.getExternalLink?.(req),
        });

        // Inserir assincronamente - fire and forget com logging de erro
        insertAuditLog(auditLog).catch(error => {
          console.error('[AUDIT] Failed to write audit log:', {
            eventType: options.eventType,
            requestId: context.requestId,
            error: error.message,
          });
          // TODO: Implementar fallback (fila, arquivo, etc.)
        });
      } catch (error) {
        console.error('[AUDIT] Error preparing audit log:', error);
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

function inferAuditLevel(eventType: EventType): AuditLevel {
  // Criticos - sempre logar
  if (eventType.includes('_DELETED') || eventType.includes('_REVOKED') ||
      eventType.includes('AUTH_LOGIN_FAILED') || eventType.includes('AUTH_PASSWORD') ||
      eventType.includes('API_KEY_')) {
    return AuditLevel.MINIMAL;
  }
  // Verbose - queries/leituras
  if (eventType.includes('_VIEWED') || eventType.includes('_LIST_')) {
    return AuditLevel.VERBOSE;
  }
  // Debug
  if (eventType.includes('TOKEN_REFRESHED')) {
    return AuditLevel.DEBUG;
  }
  return AuditLevel.STANDARD;
}

function inferEntityType(eventType: EventType): string {
  const match = eventType.match(/^([A-Z]+)_/);
  return match ? match[1].toLowerCase() : 'unknown';
}

function extractErrorMessage(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const message = (obj.error as string) || (obj.message as string) || null;
    return message?.slice(0, AUDIT_PAYLOAD_LIMITS.errorMessage.maxLength) ?? null;
  }
  return null;
}

async function insertAuditLog(log: Record<string, unknown>): Promise<void> {
  // Implementacao real usara o AuditLogRepository
  // await auditLogRepository.create(log);
  console.log('[AUDIT]', JSON.stringify(log));
}
```

### API para Consulta de Logs

```typescript
// GET /api/v1/audit-logs

import { z } from 'zod';
import { differenceInDays, subDays } from 'date-fns';

const MAX_DATE_RANGE_DAYS = 30;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const AuditLogQuerySchema = z.object({
  tenantId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  eventType: z.nativeEnum(EventType).optional(),
  eventCategory: z.nativeEnum(EventCategory).optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.string().uuid().optional(),
  action: z.nativeEnum(ActionType).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
  orderBy: z.enum(['createdAt:asc', 'createdAt:desc']).default('createdAt:desc'),
}).refine(data => {
  // Validar janela de datas
  const from = data.from ? new Date(data.from) : subDays(new Date(), 7);
  const to = data.to ? new Date(data.to) : new Date();

  if (differenceInDays(to, from) > MAX_DATE_RANGE_DAYS) {
    return false;
  }
  return true;
}, {
  message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
});

interface AuditLogResponse {
  data: AuditLog[];
  pagination: {
    cursor?: string;
    hasMore: boolean;
  };
  meta: {
    from: string;
    to: string;
    totalInRange?: number; // Opcional - pode ser caro calcular
  };
}
```

## Acoes a Serem Logadas por Entidade

### Tier 1: Criticas (MINIMAL - Sempre logar)

| Entidade | Acoes | Contexto |
|----------|-------|----------|
| Customer | CREATE, DELETE | parentCustomerId, type |
| User | CREATE, DELETE, SUSPEND | email, role |
| Role | ASSIGN, REVOKE | userId, roleId, scope |
| API Key | CREATE, REVOKE | keyPrefix, scopes |
| Auth | LOGIN_FAILED, PASSWORD_CHANGED | email, reason |

### Tier 2: Standard (Producao)

| Entidade | Acoes | Contexto |
|----------|-------|----------|
| Customer | UPDATE, MOVE | changedFields |
| Device | CREATE, UPDATE, DELETE, MOVE | serialNumber, assetId |
| Asset | CREATE, UPDATE, DELETE, MOVE | code, parentAssetId |
| Rule | CREATE, UPDATE, DELETE, ENABLE/DISABLE | ruleType, priority |
| Partner | REGISTER, APPROVE, REJECT, SUSPEND | companyName |

### Tier 3: Verbose (Opcional)

| Entidade | Acoes | Contexto |
|----------|-------|----------|
| * | VIEW, LIST | filters |
| Device | STATUS_CHANGED, CONNECTIVITY_CHANGED | oldStatus, newStatus |
| Alarm Bundle | GENERATED, DOWNLOADED | ruleCount |

## Change Map - Arquivos a Modificar

### 1. Database

| Arquivo | Mudanca |
|---------|---------|
| `src/infrastructure/database/drizzle/schema.ts` | Adicionar enums + novos campos em auditLogs |
| `drizzle/*.sql` | Migration gerada |

### 2. Tipos e Config

| Arquivo | Mudanca |
|---------|---------|
| `src/shared/types/audit.types.ts` | Criar EventType, EventCategory, ActorType, ActionType, AuditLevel |
| `src/shared/utils/pii-sanitizer.ts` | Criar funcao de sanitizacao PII |
| `src/config/audit.config.ts` | Criar limites de payload e configuracao |

### 3. Middleware

| Arquivo | Mudanca |
|---------|---------|
| `src/middleware/audit.middleware.ts` | Criar middleware logEvent |
| `src/middleware/index.ts` | Exportar logEvent |

### 4. Repository

| Arquivo | Mudanca |
|---------|---------|
| `src/repositories/AuditLogRepository.ts` | Criar/atualizar repository |
| `src/repositories/interfaces/IAuditLogRepository.ts` | Criar interface |

### 5. Jobs

| Arquivo | Mudanca |
|---------|---------|
| `src/jobs/audit-purge.job.ts` | Criar job de purge |

### 6. Controllers (adicionar logEvent)

| Arquivo | Eventos |
|---------|---------|
| `src/controllers/customers.controller.ts` | CUSTOMER_* |
| `src/controllers/devices.controller.ts` | DEVICE_* |
| `src/controllers/users.controller.ts` | USER_* |
| `src/controllers/rules.controller.ts` | RULE_* |
| `src/controllers/policies.controller.ts` | POLICY_* |
| `src/controllers/auth.controller.ts` | AUTH_* |
| `src/controllers/integrations.controller.ts` | PACKAGE_* |
| `src/controllers/audit-logs.controller.ts` | Novo - endpoint de consulta |

### 7. Documentacao

| Arquivo | Mudanca |
|---------|---------|
| `docs/openapi.yaml` | Adicionar endpoint GET /audit-logs |
| `scripts/db/seeds/15-audit-logs.sql` | Seed com exemplos |

## Drawbacks

1. **Performance**: Escrita assincrona adiciona ~5-10ms por request
2. **Storage**: Logs crescem rapidamente (mitigado por retencao e particionamento)
3. **Manutencao**: Cada novo endpoint precisa do decorator
4. **Complexidade**: PII sanitization adiciona overhead de processamento

## Rationale and Alternatives

### Por que manter compatibilidade com Alarms RFC-0002?

1. **Consistencia**: Facilita queries cross-service
2. **Tooling**: Mesmas ferramentas de analise
3. **Onboarding**: Desenvolvedores familiarizados

### Diferencas justificadas do GCDR

| Diferenca | Justificativa |
|-----------|---------------|
| UUID vs nanoid | Padrao ja estabelecido no GCDR |
| entityType vs resourceType | Nomenclatura GCDR existente |
| action separado | GCDR precisa filtrar por tipo CRUD |
| customerId | GCDR e customer-centric |
| auditLevel | Permite controle granular de retencao |

## Implementation Plan

### Fase 1: Schema, Tipos e Config
- [x] Criar enums no schema (event_category, actor_type, audit_level)
- [x] Adicionar novas colunas em audit_logs
- [x] Criar migration
- [x] Criar audit.types.ts
- [x] Criar pii-sanitizer.ts
- [x] Criar audit.config.ts com limites

### Fase 2: Middleware e Repository
- [x] Criar middleware logEvent (interceptando send/json/end)
- [x] Criar AuditLogRepository
- [x] Configurar audit levels
- [ ] Criar job de purge

### Fase 3: Integracao nos Controllers
- [x] Adicionar logEvent em customers
- [ ] Adicionar logEvent em devices
- [ ] Adicionar logEvent em users
- [ ] Adicionar logEvent em rules
- [ ] Adicionar logEvent em auth

### Fase 4: API, Seguranca e Documentacao
- [x] Criar endpoint GET /audit-logs com RBAC
- [ ] Implementar rate limiting
- [x] Validar janela de datas obrigatoria
- [ ] Documentar no OpenAPI
- [ ] Criar seed com exemplos

## Resolved Questions

| Questao | Decisao |
|---------|---------|
| Retencao | 90 dias VERBOSE, 180 dias STANDARD, 365 dias MINIMAL |
| PII | Sanitizar automaticamente com allowlist de campos sensiveis |
| Janela de consulta | Maximo 30 dias por request |
| Rate limiting | 10 req/min para endpoint de audit logs |

## Future Possibilities

1. **Real-time**: WebSocket para audit log em tempo real
2. **Alertas**: Trigger alertas em padroes suspeitos (ex: muitos LOGIN_FAILED)
3. **SIEM Integration**: Enviar para sistemas de seguranca (Splunk, ELK)
4. **Analytics Dashboard**: UI para visualizacao e relatorios
5. **Cross-service**: Agregar logs de GCDR + Alarms
6. **Export**: CSV/JSON export com limite de registros
7. **Particionamento automatico**: Script para criar particoes mensais
