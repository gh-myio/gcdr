# RFC-0008: Device Attributes Extension

- Feature Name: `device_attributes_extension`
- Start Date: 2026-01-23
- RFC PR: N/A
- Status: Draft

## Summary

Estender a entidade `devices` com novos atributos para suportar configuracao Modbus, integracao com sistemas de ingestao, identificacao avancada e monitoramento de atividade. A implementacao usa uma abordagem hibrida: colunas para campos frequentemente filtrados e JSONB para configuracoes tecnicas complexas.

## Motivation

Os devices no GCDR precisam armazenar informacoes adicionais para:

1. **Comunicacao Modbus**: slave ID, enderecos de registradores, frequencia de polling
2. **Integracao**: IDs de sistemas externos de ingestao e gateways
3. **Identificacao**: identificadores legiveis e perfis de dispositivo
4. **Monitoramento**: timestamps de atividade e alarmes
5. **Configuracao avancada**: mapas de potencia e anotacoes de log

## Guide-level Explanation

### Novos Campos Disponiveis

Apos esta mudanca, devices terao:

```typescript
// Novos campos como colunas (filtraveis)
device.slaveId          // Modbus slave ID (1-247)
device.centralId        // UUID da central associada
device.identifier       // Ex: "ENTRADA_SHOPPING_GARAGEM_L2"
device.deviceProfile    // Ex: "HIDROMETRO_AREA_COMUM"
device.deviceType       // Ex: "3F_MEDIDOR"
device.ingestionId      // UUID no sistema de ingestao
device.ingestionGatewayId // UUID do gateway de ingestao
device.lastActivityTime // Ultima atividade do device
device.lastAlarmTime    // Ultimo alarme disparado

// Novos campos no specs (configuracao tecnica)
device.specs.addrLow    // Endereco Modbus baixo
device.specs.addrHigh   // Endereco Modbus alto
device.specs.frequency  // Frequencia de polling (segundos)
device.specs.mapInstantaneousPower  // Mapa de limites de potencia
device.specs.logAnnotations         // Anotacoes de log
```

### Semantica dos Campos: `type` vs `device_type`

| Campo | Tipo | Proposito | Controlado por | Exemplo |
|-------|------|-----------|----------------|---------|
| `type` | ENUM | Categoria tecnica padronizada do GCDR | GCDR (sistema) | `SENSOR`, `METER`, `ACTUATOR`, `GATEWAY` |
| `device_type` | VARCHAR | Subtipo especifico do negocio/integracao | Integrador (usuario) | `3F_MEDIDOR`, `SENSOR_TEMP_HUMIDITY` |

**Regras**:
1. `type` e obrigatorio e define comportamento no sistema (ex: sensores tem telemetria, atuadores tem comandos)
2. `device_type` e opcional e define o modelo/subtipo especifico para fins de dashboard/relatorios
3. Nao ha sincronizacao automatica entre eles - sao campos independentes
4. `type` e controlado pelo GCDR, `device_type` e livre para integradores definirem

### Exemplos de Queries

```typescript
// Buscar devices por central
const devices = await deviceRepo.findByCentralId(centralId);

// Buscar devices inativos (sem atividade ha 1 hora)
const inactive = await deviceRepo.findInactive({ hours: 1 });

// Buscar por perfil
const meters = await deviceRepo.findByProfile('HIDROMETRO_AREA_COMUM');

// Buscar por slave ID Modbus
const device = await deviceRepo.findBySlaveId(1);
```

## Reference-level Explanation

### Novos Campos como Colunas

| Campo | Tipo | Nullable | Indice | Constraint | Descricao |
|-------|------|----------|--------|------------|-----------|
| `slave_id` | SMALLINT | Yes | Yes | CHECK 1-247, UNIQUE(tenant,central,slave) | Modbus slave ID |
| `central_id` | UUID | Yes | Yes (FK) | - | Referencia a central |
| `identifier` | VARCHAR(255) | Yes | Yes | UNIQUE(tenant,identifier) | Identificador legivel unico |
| `device_profile` | VARCHAR(100) | Yes | Yes | - | Perfil do dispositivo |
| `device_type` | VARCHAR(100) | Yes | Yes | - | Tipo especifico do dispositivo |
| `ingestion_id` | UUID | Yes | Yes | - | ID no sistema de ingestao |
| `ingestion_gateway_id` | UUID | Yes | Yes | - | ID do gateway de ingestao |
| `last_activity_time` | TIMESTAMPTZ | Yes | Yes | - | Ultima atividade registrada |
| `last_alarm_time` | TIMESTAMPTZ | Yes | Yes | - | Ultimo alarme disparado |

### Regras de Atualizacao de Timestamps

| Campo | Quem Atualiza | Quando | Frequencia Recomendada |
|-------|---------------|--------|------------------------|
| `last_activity_time` | Servico de Ingestao | Ao receber telemetria valida | Debounce 1 minuto |
| `last_alarm_time` | Servico de Alarmes | Ao disparar alarme para o device | A cada alarme |

**Endpoints dedicados**:
```typescript
// PATCH /devices/:id/activity - chamado pelo servico de ingestao
updateLastActivityTime(tenantId: string, id: string): Promise<Device>;

// PATCH /devices/:id/alarm - chamado pelo servico de alarmes
updateLastAlarmTime(tenantId: string, id: string): Promise<Device>;
```

**Consideracoes de performance**:
- Recomenda-se debounce de 1 minuto para `last_activity_time` em devices com alta frequencia de telemetria
- Updates sao feitos via query direta sem carregar a entidade completa

### Novos Campos no JSONB `specs`

```typescript
interface DeviceSpecs {
  // Campos existentes...

  // Novos campos Modbus
  addrLow?: number;      // 0-65535 (endereco registrador)
  addrHigh?: number;     // 0-65535 (endereco registrador)
  frequency?: number;    // 1-3600 (segundos)

  // Configuracao complexa de potencia
  mapInstantaneousPower?: {
    version: string;
    limitsByInstantaneousPowerType: Array<{
      telemetryType: string;
      itemsByDeviceType: Array<{
        deviceType: string;
        name: string;
        description: string;
        limitsByDeviceStatus: Array<{
          deviceStatusName: string;
          limitsValues: {
            baseValue: number;
            topValue: number;
          };
        }>;
      }>;
    }>;
  };

  // Anotacoes de log
  logAnnotations?: {
    entries?: Array<{
      timestamp: string;
      message: string;
      level: string;
    }>;
    metadata?: Record<string, unknown>;
  };
}
```

### Limites de Payload JSONB

| Campo | Limite | Politica |
|-------|--------|----------|
| `mapInstantaneousPower` | 100 KB | Rejeitar se exceder |
| `logAnnotations.entries` | 100 entradas | FIFO (remove mais antigas) |
| `logAnnotations` total | 50 KB | Rejeitar se exceder |

### Validacao de Campos JSONB (DTO)

```typescript
// src/dto/request/DeviceDTO.ts
const deviceSpecsSchema = z.object({
  addrLow: z.number().int().min(0).max(65535).optional(),
  addrHigh: z.number().int().min(0).max(65535).optional(),
  frequency: z.number().int().min(1).max(3600).optional(),
  mapInstantaneousPower: z.any().optional(),
  logAnnotations: z.object({
    entries: z.array(z.object({
      timestamp: z.string(),
      message: z.string().max(1000),
      level: z.enum(['info', 'warn', 'error', 'debug']),
    })).max(100).optional(),
    metadata: z.record(z.unknown()).optional(),
  }).optional(),
}).refine(
  (data) => !data.addrLow || !data.addrHigh || data.addrLow <= data.addrHigh,
  { message: 'addrLow must be less than or equal to addrHigh' }
);

// Validacao de tamanho no service
const SPECS_LIMITS = {
  mapInstantaneousPower: { maxSizeBytes: 100 * 1024 },
  logAnnotations: { maxEntries: 100, maxSizeBytes: 50 * 1024 },
};
```

| Campo | Tipo | Min | Max | Descricao |
|-------|------|-----|-----|-----------|
| `addrLow` | int | 0 | 65535 | Endereco Modbus (16-bit) |
| `addrHigh` | int | 0 | 65535 | Endereco Modbus (16-bit) |
| `frequency` | int | 1 | 3600 | Polling em segundos (1s a 1h) |

### Schema Drizzle Atualizado

```typescript
export const devices = pgTable('devices', {
  // Campos existentes...
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  assetId: uuid('asset_id').notNull().references(() => assets.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  label: varchar('label', { length: 100 }),
  type: deviceTypeEnum('type').notNull(),
  description: text('description'),
  serialNumber: varchar('serial_number', { length: 100 }).notNull(),
  externalId: varchar('external_id', { length: 255 }),
  specs: jsonb('specs').notNull().default({}),
  connectivityStatus: connectivityStatusEnum('connectivity_status').notNull().default('UNKNOWN'),
  lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
  lastDisconnectedAt: timestamp('last_disconnected_at', { withTimezone: true }),
  credentials: jsonb('credentials'),
  telemetryConfig: jsonb('telemetry_config'),
  tags: jsonb('tags').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),
  attributes: jsonb('attributes').notNull().default({}),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),

  // =====================
  // NOVOS CAMPOS
  // =====================
  slaveId: smallint('slave_id'),  // SMALLINT (nao integer)
  centralId: uuid('central_id').references(() => centrals.id),
  identifier: varchar('identifier', { length: 255 }),
  deviceProfile: varchar('device_profile', { length: 100 }),
  deviceType: varchar('device_type', { length: 100 }),
  ingestionId: uuid('ingestion_id'),
  ingestionGatewayId: uuid('ingestion_gateway_id'),
  lastActivityTime: timestamp('last_activity_time', { withTimezone: true }),
  lastAlarmTime: timestamp('last_alarm_time', { withTimezone: true }),

}, (table) => ({
  // Indices existentes...
  tenantSerialUnique: uniqueIndex('devices_tenant_serial_unique').on(table.tenantId, table.serialNumber),
  tenantAssetIdx: index('devices_tenant_asset_idx').on(table.tenantId, table.assetId),
  tenantCustomerIdx: index('devices_tenant_customer_idx').on(table.tenantId, table.customerId),
  externalIdIdx: index('devices_external_id_idx').on(table.externalId),

  // =====================
  // NOVOS INDICES (todos com tenant_id para multi-tenant)
  // =====================
  slaveIdIdx: index('devices_slave_id_idx').on(table.tenantId, table.slaveId),
  centralIdIdx: index('devices_central_id_idx').on(table.tenantId, table.centralId),
  identifierIdx: index('devices_identifier_idx').on(table.tenantId, table.identifier),
  deviceProfileIdx: index('devices_device_profile_idx').on(table.tenantId, table.deviceProfile),
  deviceTypeIdx: index('devices_device_type_idx').on(table.tenantId, table.deviceType),
  ingestionIdIdx: index('devices_ingestion_id_idx').on(table.tenantId, table.ingestionId),
  ingestionGatewayIdIdx: index('devices_ingestion_gateway_id_idx').on(table.tenantId, table.ingestionGatewayId),
  lastActivityTimeIdx: index('devices_last_activity_time_idx').on(table.tenantId, table.lastActivityTime),
  lastAlarmTimeIdx: index('devices_last_alarm_time_idx').on(table.tenantId, table.lastAlarmTime),

  // =====================
  // CONSTRAINTS DE UNICIDADE
  // =====================
  tenantIdentifierUnique: uniqueIndex('devices_tenant_identifier_unique').on(table.tenantId, table.identifier),
  tenantCentralSlaveUnique: uniqueIndex('devices_tenant_central_slave_unique').on(table.tenantId, table.centralId, table.slaveId),

  // Constraint: slave_id valido (1-247 para Modbus)
  validSlaveId: check(
    'valid_slave_id',
    sql`${table.slaveId} IS NULL OR (${table.slaveId} >= 1 AND ${table.slaveId} <= 247)`
  ),
}));
```

### Migration SQL

```sql
-- ============================================================================
-- RFC-0008: Device Attributes Extension
-- ============================================================================

-- Adicionar novas colunas
ALTER TABLE devices
  ADD COLUMN slave_id SMALLINT,
  ADD COLUMN central_id UUID REFERENCES centrals(id),
  ADD COLUMN identifier VARCHAR(255),
  ADD COLUMN device_profile VARCHAR(100),
  ADD COLUMN device_type VARCHAR(100),
  ADD COLUMN ingestion_id UUID,
  ADD COLUMN ingestion_gateway_id UUID,
  ADD COLUMN last_activity_time TIMESTAMPTZ,
  ADD COLUMN last_alarm_time TIMESTAMPTZ;

-- Constraint para slave_id Modbus valido
ALTER TABLE devices
  ADD CONSTRAINT valid_slave_id
  CHECK (slave_id IS NULL OR (slave_id >= 1 AND slave_id <= 247));

-- Constraints de unicidade
ALTER TABLE devices
  ADD CONSTRAINT devices_tenant_identifier_unique
  UNIQUE (tenant_id, identifier);

ALTER TABLE devices
  ADD CONSTRAINT devices_tenant_central_slave_unique
  UNIQUE (tenant_id, central_id, slave_id);

-- Indices para queries frequentes (TODOS com tenant_id para multi-tenant)
CREATE INDEX CONCURRENTLY devices_slave_id_idx
  ON devices(tenant_id, slave_id) WHERE slave_id IS NOT NULL;

CREATE INDEX CONCURRENTLY devices_central_id_idx
  ON devices(tenant_id, central_id) WHERE central_id IS NOT NULL;

CREATE INDEX CONCURRENTLY devices_identifier_idx
  ON devices(tenant_id, identifier) WHERE identifier IS NOT NULL;

CREATE INDEX CONCURRENTLY devices_device_profile_idx
  ON devices(tenant_id, device_profile) WHERE device_profile IS NOT NULL;

CREATE INDEX CONCURRENTLY devices_device_type_idx
  ON devices(tenant_id, device_type) WHERE device_type IS NOT NULL;

-- CORRECAO: indices de ingestao agora incluem tenant_id
CREATE INDEX CONCURRENTLY devices_ingestion_id_idx
  ON devices(tenant_id, ingestion_id) WHERE ingestion_id IS NOT NULL;

CREATE INDEX CONCURRENTLY devices_ingestion_gateway_id_idx
  ON devices(tenant_id, ingestion_gateway_id) WHERE ingestion_gateway_id IS NOT NULL;

CREATE INDEX CONCURRENTLY devices_last_activity_time_idx
  ON devices(tenant_id, last_activity_time) WHERE last_activity_time IS NOT NULL;

-- NOVO: indice para last_alarm_time
CREATE INDEX CONCURRENTLY devices_last_alarm_time_idx
  ON devices(tenant_id, last_alarm_time) WHERE last_alarm_time IS NOT NULL;

-- Indice GIN para specs (busca em JSONB)
CREATE INDEX IF NOT EXISTS devices_specs_gin ON devices USING GIN (specs);
```

### Tipos TypeScript

```typescript
// src/domain/entities/device.types.ts

export interface DeviceModbusConfig {
  addrLow?: number;
  addrHigh?: number;
  frequency?: number;
}

export interface PowerLimitValue {
  baseValue: number;
  topValue: number;
}

export interface DeviceStatusLimit {
  deviceStatusName: string;
  limitsValues: PowerLimitValue;
}

export interface DeviceTypeItem {
  deviceType: string;
  name: string;
  description: string;
  limitsByDeviceStatus: DeviceStatusLimit[];
}

export interface InstantaneousPowerType {
  telemetryType: string;
  itemsByDeviceType: DeviceTypeItem[];
}

export interface MapInstantaneousPower {
  version: string;
  limitsByInstantaneousPowerType: InstantaneousPowerType[];
}

export interface LogAnnotationEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

export interface LogAnnotations {
  entries?: LogAnnotationEntry[];
  metadata?: Record<string, unknown>;
}

export interface DeviceSpecs extends DeviceModbusConfig {
  mapInstantaneousPower?: MapInstantaneousPower;
  logAnnotations?: LogAnnotations;
  [key: string]: unknown;
}
```

### Atualizacao do Seed Script

```sql
-- scripts/db/seeds/08-devices.sql (atualizado)

-- Device com novos campos
INSERT INTO devices (
  id, tenant_id, asset_id, customer_id,
  name, display_name, serial_number, type,
  -- Novos campos
  slave_id, central_id, identifier, device_profile, device_type,
  ingestion_id, ingestion_gateway_id, last_activity_time,
  specs
) VALUES (
  '11110001-0001-0001-0001-000000000001',
  v_tenant_id,
  v_room1_id,
  v_company1_id,
  'Temperature Sensor 01',
  'Sensor de Temperatura 01',
  'TEMP-001',
  'SENSOR',
  -- Novos campos
  1,                                              -- slave_id
  v_central1_id,                                  -- central_id
  'ENTRADA_SHOPPING_GARAGEM_L2',                  -- identifier
  'HIDROMETRO_AREA_COMUM',                        -- device_profile
  'SENSOR_TEMP_HUMIDITY',                         -- device_type
  'ce6a7e51-e642-4562-8d3d-8f492929d4df',        -- ingestion_id
  'd3202744-05dd-46d1-af33-495e9a2ecd52',        -- ingestion_gateway_id
  NOW() - INTERVAL '5 minutes',                   -- last_activity_time
  -- specs com novos campos JSONB
  '{
    "addrLow": 100,
    "addrHigh": 200,
    "frequency": 60,
    "mapInstantaneousPower": {
      "version": "1.0.0",
      "limitsByInstantaneousPowerType": []
    },
    "logAnnotations": {
      "entries": [],
      "metadata": {}
    }
  }'
);
```

## Drawbacks

1. **Migration em tabela existente**: Pode ser lenta em tabelas grandes (mitigar com `CONCURRENTLY` nos indices)
2. **Mais colunas**: Aumenta tamanho do catalogo (mas sao todas nullable)
3. **Complexidade de validacao**: Limites de payload JSONB adicionam overhead no service

## Rationale and Alternatives

### Por que abordagem hibrida?

| Abordagem | Pros | Contras |
|-----------|------|---------|
| Tudo coluna | Maxima performance | Muitas migrations, rigidez |
| Tudo JSONB | Maxima flexibilidade | Performance em filtros |
| **Hibrida** | **Equilibrio** | Complexidade moderada |

### Campos escolhidos como coluna

- `slave_id`: Filtro frequente para troubleshooting Modbus
- `central_id`: FK, relacionamento forte
- `identifier`: Busca por usuarios, precisa ser rapido
- `device_profile`, `device_type`: Filtros em dashboards
- `ingestion_id`, `ingestion_gateway_id`: Integracao externa
- `last_activity_time`, `last_alarm_time`: Detectar devices inativos/com alarmes

### Campos escolhidos como JSONB

- `addrLow`, `addrHigh`, `frequency`: Config tecnica, raramente filtrada
- `mapInstantaneousPower`: Estrutura complexa, so leitura
- `logAnnotations`: Estrutura variavel, so leitura

## Change Map - Arquivos a Modificar

### 1. Database Schema

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `src/infrastructure/database/drizzle/schema.ts` | Adicionar 9 novas colunas + indices + constraints | P0 |
| `drizzle/*.sql` (gerado) | Migration gerada pelo drizzle-kit | P0 |

### 2. Domain Layer

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `src/domain/entities/Device.ts` | Adicionar novos campos na interface `Device` e `DeviceSpecs` | P0 |
| `src/domain/entities/index.ts` | Exportar novos tipos se necessario | P1 |

**Mudancas em Device.ts:**
```typescript
// Adicionar na interface Device:
slaveId?: number;
centralId?: string;
identifier?: string;
deviceProfile?: string;
deviceType?: string;
ingestionId?: string;
ingestionGatewayId?: string;
lastActivityTime?: string;
lastAlarmTime?: string;

// Adicionar na interface DeviceSpecs:
addrLow?: number;
addrHigh?: number;
frequency?: number;
mapInstantaneousPower?: MapInstantaneousPower;
logAnnotations?: LogAnnotations;
```

### 3. Repository Layer

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `src/repositories/interfaces/IDeviceRepository.ts` | Adicionar novos metodos de busca | P0 |
| `src/repositories/DeviceRepository.ts` | Implementar novos metodos + mapear campos | P0 |

**Novos metodos em IDeviceRepository:**
```typescript
// Adicionar:
findByCentralId(tenantId: string, centralId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>>;
findBySlaveId(tenantId: string, slaveId: number): Promise<Device | null>;
findByIdentifier(tenantId: string, identifier: string): Promise<Device | null>;
findByProfile(tenantId: string, deviceProfile: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>>;
findByDeviceType(tenantId: string, deviceType: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>>;
findInactive(tenantId: string, options: { hours: number }): Promise<Device[]>;
findByIngestionId(tenantId: string, ingestionId: string): Promise<Device | null>;
updateLastActivityTime(tenantId: string, id: string): Promise<Device>;
updateLastAlarmTime(tenantId: string, id: string): Promise<Device>;
```

**Mudancas em DeviceRepository.ts:**
- Atualizar metodo `create()` para aceitar novos campos
- Atualizar metodo `update()` para aceitar novos campos
- Atualizar metodo `mapToEntity()` para mapear novos campos
- Implementar novos metodos de busca
- Adicionar filtros por `deviceProfile`, `deviceType`, `centralId` no `list()`

### 4. Service Layer

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `src/services/DeviceService.ts` | Expor novos metodos do repository + validacao de payload | P1 |

### 5. DTOs (Request/Response)

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `src/dto/request/DeviceDTO.ts` | Adicionar novos campos em CreateDeviceDTO e UpdateDeviceDTO | P0 |
| `src/dto/response/DeviceResponseDTO.ts` | Adicionar novos campos na resposta (se existir) | P1 |

**Mudancas em DeviceDTO.ts:**
```typescript
// CreateDeviceDTO - adicionar:
slaveId?: number;
centralId?: string;
identifier?: string;
deviceProfile?: string;
deviceType?: string;
ingestionId?: string;
ingestionGatewayId?: string;

// UpdateDeviceDTO - adicionar os mesmos campos como opcionais
```

### 6. Controller Layer

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `src/controllers/devices.controller.ts` | Adicionar novos query params para filtros | P1 |

**Novos query params para GET /devices:**
```typescript
// Adicionar filtros:
?deviceProfile=HIDROMETRO_AREA_COMUM
?deviceType=3F_MEDIDOR
?centralId=uuid
?inactive=true&inactiveHours=1
```

### 7. API Documentation (OpenAPI/Swagger)

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `docs/openapi.yaml` | Atualizar schemas Device, CreateDevice, UpdateDevice | P1 |
| `src/handlers/docs/openapi.ts` | Atualizar se gerado programaticamente | P1 |

**Mudancas em openapi.yaml:**
```yaml
# Adicionar em components/schemas/Device:
slaveId:
  type: integer
  minimum: 1
  maximum: 247
  description: Modbus slave ID
centralId:
  type: string
  format: uuid
  description: ID da central associada
identifier:
  type: string
  maxLength: 255
  description: Identificador legivel unico
deviceProfile:
  type: string
  maxLength: 100
  description: Perfil do dispositivo
deviceType:
  type: string
  maxLength: 100
  description: Tipo especifico do dispositivo
ingestionId:
  type: string
  format: uuid
  description: ID no sistema de ingestao
ingestionGatewayId:
  type: string
  format: uuid
  description: ID do gateway de ingestao
lastActivityTime:
  type: string
  format: date-time
  description: Ultima atividade registrada
lastAlarmTime:
  type: string
  format: date-time
  description: Ultimo alarme disparado

# Adicionar em specs:
addrLow:
  type: integer
  minimum: 0
  maximum: 65535
  description: Endereco Modbus baixo
addrHigh:
  type: integer
  minimum: 0
  maximum: 65535
  description: Endereco Modbus alto
frequency:
  type: integer
  minimum: 1
  maximum: 3600
  description: Frequencia de polling em segundos
mapInstantaneousPower:
  type: object
  description: Mapa de limites de potencia instantanea (max 100KB)
logAnnotations:
  type: object
  description: Anotacoes de log (max 100 entries, 50KB)
```

### 8. Seed Scripts

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `scripts/db/seeds/08-devices.sql` | Adicionar novos campos nos INSERTs | P1 |
| `scripts/db/seeds/99-verify-all.sql` | Adicionar verificacao dos novos campos | P2 |

### 9. Documentacao

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `docs/ONBOARDING.md` | Documentar novos campos do device | P2 |
| `docs/url-api-gcdr.md` | Atualizar exemplos de API se necessario | P2 |

### 10. Testes

| Arquivo | Mudanca | Prioridade |
|---------|---------|------------|
| `tests/unit/repositories/DeviceRepository.test.ts` | Testar novos metodos | P1 |
| `tests/unit/services/DeviceService.test.ts` | Testar novos metodos | P1 |
| `tests/integration/devices.test.ts` | Testar endpoints com novos campos | P1 |

---

## Implementation Plan

### Fase 1 - Schema e Migration (P0)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 1.1 | Adicionar colunas no schema Drizzle | `src/infrastructure/database/drizzle/schema.ts` |
| 1.2 | Gerar migration | `npm run db:generate` |
| 1.3 | Executar migration | `npm run db:migrate` |
| 1.4 | Verificar no banco | `npm run db:seed:verify` |

### Fase 2 - Domain e Repository (P0)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 2.1 | Atualizar interface Device | `src/domain/entities/Device.ts` |
| 2.2 | Atualizar interface IDeviceRepository | `src/repositories/interfaces/IDeviceRepository.ts` |
| 2.3 | Implementar novos metodos | `src/repositories/DeviceRepository.ts` |
| 2.4 | Atualizar mapeamento de entidade | `src/repositories/DeviceRepository.ts` |

### Fase 3 - DTOs e Controller (P1)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 3.1 | Atualizar CreateDeviceDTO | `src/dto/request/DeviceDTO.ts` |
| 3.2 | Atualizar UpdateDeviceDTO | `src/dto/request/DeviceDTO.ts` |
| 3.3 | Adicionar query params | `src/controllers/devices.controller.ts` |
| 3.4 | Atualizar DeviceService | `src/services/DeviceService.ts` |

### Fase 4 - Documentacao (P1)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 4.1 | Atualizar OpenAPI schemas | `docs/openapi.yaml` |
| 4.2 | Atualizar exemplos de request/response | `docs/openapi.yaml` |
| 4.3 | Adicionar novos endpoints de filtro | `docs/openapi.yaml` |

### Fase 5 - Seeds e Dados de Teste (P1)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 5.1 | Atualizar seed de devices | `scripts/db/seeds/08-devices.sql` |
| 5.2 | Atualizar script de verificacao | `scripts/db/seeds/99-verify-all.sql` |
| 5.3 | Executar seeds | `npm run db:seed` |
| 5.4 | Verificar dados | `npm run db:seed:verify` |

### Fase 6 - Testes (P1)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 6.1 | Testes unitarios do repository | `tests/unit/repositories/DeviceRepository.test.ts` |
| 6.2 | Testes unitarios do service | `tests/unit/services/DeviceService.test.ts` |
| 6.3 | Testes de integracao | `tests/integration/devices.test.ts` |
| 6.4 | Executar suite completa | `npm run test` |

### Fase 7 - Documentacao Final (P2)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 7.1 | Atualizar onboarding | `docs/ONBOARDING.md` |
| 7.2 | Atualizar guia de API | `docs/url-api-gcdr.md` |
| 7.3 | Marcar RFC como Implemented | `docs/RFC-0008-Device-Attributes-Extension.md` |

---

## Checklist de Validacao

### Apos Fase 1 (Schema)
- [ ] Colunas existem no banco: `\d devices` no psql
- [ ] Indices criados corretamente (todos com tenant_id)
- [ ] CHECK constraint funciona (testar slave_id = 300 deve falhar)
- [ ] FK para centrals funciona
- [ ] UNIQUE constraint (tenant_id, identifier) funciona
- [ ] UNIQUE constraint (tenant_id, central_id, slave_id) funciona

### Apos Fase 2 (Repository)
- [ ] `create()` aceita novos campos
- [ ] `update()` atualiza novos campos
- [ ] `findByCentralId()` retorna devices corretos
- [ ] `findInactive()` retorna devices sem atividade

### Apos Fase 3 (API)
- [ ] POST /devices aceita novos campos
- [ ] PATCH /devices/:id atualiza novos campos
- [ ] GET /devices?deviceProfile=X filtra corretamente
- [ ] Swagger mostra novos campos

### Apos Fase 5 (Seeds)
- [ ] Seed executa sem erros
- [ ] Devices tem novos campos populados
- [ ] Verificacao mostra dados corretos

### Apos Fase 6 (Testes)
- [ ] Todos os testes passam
- [ ] Cobertura de codigo adequada

### Cobertura Minima Exigida

| Componente | Cobertura |
|------------|-----------|
| DeviceRepository (novos metodos) | 90% |
| DeviceService (novos metodos) | 85% |
| DTOs (validacao) | 100% |

### Cenarios de Teste Obrigatorios
- [ ] Criar device com todos os novos campos
- [ ] Atualizar device com novos campos
- [ ] Filtrar por `deviceProfile`, `deviceType`, `centralId`
- [ ] `findInactive()` com diferentes thresholds
- [ ] Validacao de `slave_id` fora do range (1-247)
- [ ] Validacao de `addrLow > addrHigh`
- [ ] Rejeicao de `mapInstantaneousPower` > 100KB
- [ ] FIFO em `logAnnotations.entries` > 100
- [ ] Violacao de UNIQUE constraint em `identifier`
- [ ] Violacao de UNIQUE constraint em `(central_id, slave_id)`

## Prior Art

- ThingsBoard: usa `additional_info` (JSONB) para campos extensiveis
- AWS IoT: combina `attributes` fixos com `shadow` (JSON dinamico)
- Azure IoT Hub: `deviceTwin` com `properties` e `tags`

## Resolved Questions

| Pergunta | Decisao | Justificativa |
|----------|---------|---------------|
| `device_type` substitui ou complementa `type`? | Complementa | `type` e categoria tecnica (GCDR), `device_type` e subtipo de negocio (integrador) |
| `identifier` deve ser unico por tenant? | Sim | E uma chave logica de negocio |
| `slave_id` deve ser unico por `central_id`? | Sim | Dois devices na mesma central nao podem ter o mesmo Modbus slave ID |

## Next Steps

1. Implementacao da Fase 1 (Schema)
2. Implementacao das Fases 2-4
3. Atualizacao da documentacao
4. Marcar RFC como Implemented
