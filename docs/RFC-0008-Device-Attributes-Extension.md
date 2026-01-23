# RFC-0008: Device Attributes Extension

- Feature Name: `device_attributes_extension`
- Start Date: 2026-01-23
- RFC PR: N/A
- Status: Draft

## Summary

Estender a entidade `devices` com novos atributos para suportar configuração Modbus, integração com sistemas de ingestão, identificação avançada e monitoramento de atividade. A implementação usa uma abordagem híbrida: colunas para campos frequentemente filtrados e JSONB para configurações técnicas complexas.

## Motivation

Os devices no GCDR precisam armazenar informações adicionais para:

1. **Comunicação Modbus**: slave ID, endereços de registradores, frequência de polling
2. **Integração**: IDs de sistemas externos de ingestão e gateways
3. **Identificação**: identificadores legíveis e perfis de dispositivo
4. **Monitoramento**: timestamps de atividade e alarmes
5. **Configuração avançada**: mapas de potência e anotações de log

## Guide-level Explanation

### Novos Campos Disponíveis

Após esta mudança, devices terão:

```typescript
// Novos campos como colunas (filtráveis)
device.slaveId          // Modbus slave ID (1-247)
device.centralId        // UUID da central associada
device.identifier       // Ex: "ENTRADA_SHOPPING_GARAGEM_L2"
device.deviceProfile    // Ex: "HIDROMETRO_AREA_COMUM"
device.deviceType       // Ex: "3F_MEDIDOR"
device.ingestionId      // UUID no sistema de ingestão
device.ingestionGatewayId // UUID do gateway de ingestão
device.lastActivityTime // Última atividade do device
device.lastAlarmTime    // Último alarme disparado

// Novos campos no specs (configuração técnica)
device.specs.addrLow    // Endereço Modbus baixo
device.specs.addrHigh   // Endereço Modbus alto
device.specs.frequency  // Frequência de polling (segundos)
device.specs.mapInstantaneousPower  // Mapa de limites de potência
device.specs.logAnnotations         // Anotações de log
```

### Exemplos de Queries

```typescript
// Buscar devices por central
const devices = await deviceRepo.findByCentralId(centralId);

// Buscar devices inativos (sem atividade há 1 hora)
const inactive = await deviceRepo.findInactive({ hours: 1 });

// Buscar por perfil
const meters = await deviceRepo.findByProfile('HIDROMETRO_AREA_COMUM');

// Buscar por slave ID Modbus
const device = await deviceRepo.findBySlaveId(1);
```

## Reference-level Explanation

### Novos Campos como Colunas

| Campo | Tipo | Nullable | Índice | Descrição |
|-------|------|----------|--------|-----------|
| `slave_id` | SMALLINT | Yes | Yes | Modbus slave ID (1-247) |
| `central_id` | UUID | Yes | Yes (FK) | Referência à central |
| `identifier` | VARCHAR(255) | Yes | Yes | Identificador legível único |
| `device_profile` | VARCHAR(100) | Yes | Yes | Perfil do dispositivo |
| `device_type` | VARCHAR(100) | Yes | Yes | Tipo específico do dispositivo |
| `ingestion_id` | UUID | Yes | Yes | ID no sistema de ingestão |
| `ingestion_gateway_id` | UUID | Yes | Yes | ID do gateway de ingestão |
| `last_activity_time` | TIMESTAMPTZ | Yes | Yes | Última atividade registrada |
| `last_alarm_time` | TIMESTAMPTZ | Yes | No | Último alarme disparado |

### Novos Campos no JSONB `specs`

```typescript
interface DeviceSpecs {
  // Campos existentes...

  // Novos campos Modbus
  addrLow?: number;      // 0-65535 (endereço registrador)
  addrHigh?: number;     // 0-65535 (endereço registrador)
  frequency?: number;    // 1-3600 (segundos)

  // Configuração complexa de potência
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

  // Anotações de log
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
  slaveId: integer('slave_id'),
  centralId: uuid('central_id').references(() => centrals.id),
  identifier: varchar('identifier', { length: 255 }),
  deviceProfile: varchar('device_profile', { length: 100 }),
  deviceType: varchar('device_type', { length: 100 }),
  ingestionId: uuid('ingestion_id'),
  ingestionGatewayId: uuid('ingestion_gateway_id'),
  lastActivityTime: timestamp('last_activity_time', { withTimezone: true }),
  lastAlarmTime: timestamp('last_alarm_time', { withTimezone: true }),

}, (table) => ({
  // Índices existentes...
  tenantSerialUnique: uniqueIndex('devices_tenant_serial_unique').on(table.tenantId, table.serialNumber),
  tenantAssetIdx: index('devices_tenant_asset_idx').on(table.tenantId, table.assetId),
  tenantCustomerIdx: index('devices_tenant_customer_idx').on(table.tenantId, table.customerId),
  externalIdIdx: index('devices_external_id_idx').on(table.externalId),

  // =====================
  // NOVOS ÍNDICES
  // =====================
  slaveIdIdx: index('devices_slave_id_idx').on(table.tenantId, table.slaveId),
  centralIdIdx: index('devices_central_id_idx').on(table.tenantId, table.centralId),
  identifierIdx: index('devices_identifier_idx').on(table.tenantId, table.identifier),
  deviceProfileIdx: index('devices_device_profile_idx').on(table.tenantId, table.deviceProfile),
  deviceTypeIdx: index('devices_device_type_idx').on(table.tenantId, table.deviceType),
  ingestionIdIdx: index('devices_ingestion_id_idx').on(table.ingestionId),
  ingestionGatewayIdIdx: index('devices_ingestion_gateway_id_idx').on(table.ingestionGatewayId),
  lastActivityTimeIdx: index('devices_last_activity_time_idx').on(table.tenantId, table.lastActivityTime),

  // Constraint: slave_id válido (1-247 para Modbus)
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

-- Constraint para slave_id Modbus válido
ALTER TABLE devices
  ADD CONSTRAINT valid_slave_id
  CHECK (slave_id IS NULL OR (slave_id >= 1 AND slave_id <= 247));

-- Índices para queries frequentes
CREATE INDEX devices_slave_id_idx ON devices(tenant_id, slave_id) WHERE slave_id IS NOT NULL;
CREATE INDEX devices_central_id_idx ON devices(tenant_id, central_id) WHERE central_id IS NOT NULL;
CREATE INDEX devices_identifier_idx ON devices(tenant_id, identifier) WHERE identifier IS NOT NULL;
CREATE INDEX devices_device_profile_idx ON devices(tenant_id, device_profile) WHERE device_profile IS NOT NULL;
CREATE INDEX devices_device_type_idx ON devices(tenant_id, device_type) WHERE device_type IS NOT NULL;
CREATE INDEX devices_ingestion_id_idx ON devices(ingestion_id) WHERE ingestion_id IS NOT NULL;
CREATE INDEX devices_ingestion_gateway_id_idx ON devices(ingestion_gateway_id) WHERE ingestion_gateway_id IS NOT NULL;
CREATE INDEX devices_last_activity_time_idx ON devices(tenant_id, last_activity_time) WHERE last_activity_time IS NOT NULL;

-- Índice GIN para specs (busca em JSONB)
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

### Atualização do Seed Script

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

1. **Migration em tabela existente**: Pode ser lenta em tabelas grandes (mitigar com `CONCURRENTLY` nos índices)
2. **Mais colunas**: Aumenta tamanho do catálogo (mas são todas nullable)
3. **Duplicação conceitual**: `type` (enum) vs `device_type` (string livre) - necessário documentar diferença

## Rationale and Alternatives

### Por que abordagem híbrida?

| Abordagem | Prós | Contras |
|-----------|------|---------|
| Tudo coluna | Máxima performance | Muitas migrations, rigidez |
| Tudo JSONB | Máxima flexibilidade | Performance em filtros |
| **Híbrida** | **Equilíbrio** | Complexidade moderada |

### Campos escolhidos como coluna

- `slave_id`: Filtro frequente para troubleshooting Modbus
- `central_id`: FK, relacionamento forte
- `identifier`: Busca por usuários, precisa ser rápido
- `device_profile`, `device_type`: Filtros em dashboards
- `ingestion_id`, `ingestion_gateway_id`: Integração externa
- `last_activity_time`: Detectar devices inativos

### Campos escolhidos como JSONB

- `addrLow`, `addrHigh`, `frequency`: Config técnica, raramente filtrada
- `mapInstantaneousPower`: Estrutura complexa, só leitura
- `logAnnotations`: Estrutura variável, só leitura

## Change Map - Arquivos a Modificar

### 1. Database Schema

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `src/infrastructure/database/drizzle/schema.ts` | Adicionar 9 novas colunas + índices + CHECK constraint | P0 |
| `drizzle/*.sql` (gerado) | Migration gerada pelo drizzle-kit | P0 |

### 2. Domain Layer

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `src/domain/entities/Device.ts` | Adicionar novos campos na interface `Device` e `DeviceSpecs` | P0 |
| `src/domain/entities/index.ts` | Exportar novos tipos se necessário | P1 |

**Mudanças em Device.ts:**
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

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `src/repositories/interfaces/IDeviceRepository.ts` | Adicionar novos métodos de busca | P0 |
| `src/repositories/DeviceRepository.ts` | Implementar novos métodos + mapear campos | P0 |

**Novos métodos em IDeviceRepository:**
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

**Mudanças em DeviceRepository.ts:**
- Atualizar método `create()` para aceitar novos campos
- Atualizar método `update()` para aceitar novos campos
- Atualizar método `mapToEntity()` para mapear novos campos
- Implementar novos métodos de busca
- Adicionar filtros por `deviceProfile`, `deviceType`, `centralId` no `list()`

### 4. Service Layer

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `src/services/DeviceService.ts` | Expor novos métodos do repository | P1 |

### 5. DTOs (Request/Response)

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `src/dto/request/DeviceDTO.ts` | Adicionar novos campos em CreateDeviceDTO e UpdateDeviceDTO | P0 |
| `src/dto/response/DeviceResponseDTO.ts` | Adicionar novos campos na resposta (se existir) | P1 |

**Mudanças em DeviceDTO.ts:**
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

| Arquivo | Mudança | Prioridade |
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

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `docs/openapi.yaml` | Atualizar schemas Device, CreateDevice, UpdateDevice | P1 |
| `src/handlers/docs/openapi.ts` | Atualizar se gerado programaticamente | P1 |

**Mudanças em openapi.yaml:**
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
  description: Identificador legível único
deviceProfile:
  type: string
  maxLength: 100
  description: Perfil do dispositivo
deviceType:
  type: string
  maxLength: 100
  description: Tipo específico do dispositivo
ingestionId:
  type: string
  format: uuid
  description: ID no sistema de ingestão
ingestionGatewayId:
  type: string
  format: uuid
  description: ID do gateway de ingestão
lastActivityTime:
  type: string
  format: date-time
  description: Última atividade registrada
lastAlarmTime:
  type: string
  format: date-time
  description: Último alarme disparado

# Adicionar em specs:
addrLow:
  type: integer
  description: Endereço Modbus baixo
addrHigh:
  type: integer
  description: Endereço Modbus alto
frequency:
  type: integer
  description: Frequência de polling em segundos
mapInstantaneousPower:
  type: object
  description: Mapa de limites de potência instantânea
logAnnotations:
  type: object
  description: Anotações de log
```

### 8. Seed Scripts

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `scripts/db/seeds/08-devices.sql` | Adicionar novos campos nos INSERTs | P1 |
| `scripts/db/seeds/99-verify-all.sql` | Adicionar verificação dos novos campos | P2 |

### 9. Documentação

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `docs/ONBOARDING.md` | Documentar novos campos do device | P2 |
| `docs/url-api-gcdr.md` | Atualizar exemplos de API se necessário | P2 |

### 10. Testes

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `tests/unit/repositories/DeviceRepository.test.ts` | Testar novos métodos | P1 |
| `tests/unit/services/DeviceService.test.ts` | Testar novos métodos | P1 |
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
| 2.3 | Implementar novos métodos | `src/repositories/DeviceRepository.ts` |
| 2.4 | Atualizar mapeamento de entidade | `src/repositories/DeviceRepository.ts` |

### Fase 3 - DTOs e Controller (P1)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 3.1 | Atualizar CreateDeviceDTO | `src/dto/request/DeviceDTO.ts` |
| 3.2 | Atualizar UpdateDeviceDTO | `src/dto/request/DeviceDTO.ts` |
| 3.3 | Adicionar query params | `src/controllers/devices.controller.ts` |
| 3.4 | Atualizar DeviceService | `src/services/DeviceService.ts` |

### Fase 4 - Documentação (P1)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 4.1 | Atualizar OpenAPI schemas | `docs/openapi.yaml` |
| 4.2 | Atualizar exemplos de request/response | `docs/openapi.yaml` |
| 4.3 | Adicionar novos endpoints de filtro | `docs/openapi.yaml` |

### Fase 5 - Seeds e Dados de Teste (P1)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 5.1 | Atualizar seed de devices | `scripts/db/seeds/08-devices.sql` |
| 5.2 | Atualizar script de verificação | `scripts/db/seeds/99-verify-all.sql` |
| 5.3 | Executar seeds | `npm run db:seed` |
| 5.4 | Verificar dados | `npm run db:seed:verify` |

### Fase 6 - Testes (P1)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 6.1 | Testes unitários do repository | `tests/unit/repositories/DeviceRepository.test.ts` |
| 6.2 | Testes unitários do service | `tests/unit/services/DeviceService.test.ts` |
| 6.3 | Testes de integração | `tests/integration/devices.test.ts` |
| 6.4 | Executar suite completa | `npm run test` |

### Fase 7 - Documentação Final (P2)

| # | Tarefa | Arquivo |
|---|--------|---------|
| 7.1 | Atualizar onboarding | `docs/ONBOARDING.md` |
| 7.2 | Atualizar guia de API | `docs/url-api-gcdr.md` |
| 7.3 | Marcar RFC como Implemented | `docs/RFC-0008-Device-Attributes-Extension.md` |

---

## Checklist de Validação

### Após Fase 1 (Schema)
- [ ] Colunas existem no banco: `\d devices` no psql
- [ ] Índices criados corretamente
- [ ] CHECK constraint funciona (testar slave_id = 300 deve falhar)
- [ ] FK para centrals funciona

### Após Fase 2 (Repository)
- [ ] `create()` aceita novos campos
- [ ] `update()` atualiza novos campos
- [ ] `findByCentralId()` retorna devices corretos
- [ ] `findInactive()` retorna devices sem atividade

### Após Fase 3 (API)
- [ ] POST /devices aceita novos campos
- [ ] PATCH /devices/:id atualiza novos campos
- [ ] GET /devices?deviceProfile=X filtra corretamente
- [ ] Swagger mostra novos campos

### Após Fase 5 (Seeds)
- [ ] Seed executa sem erros
- [ ] Devices têm novos campos populados
- [ ] Verificação mostra dados corretos

### Após Fase 6 (Testes)
- [ ] Todos os testes passam
- [ ] Cobertura de código adequada

## Prior Art

- ThingsBoard: usa `additional_info` (JSONB) para campos extensíveis
- AWS IoT: combina `attributes` fixos com `shadow` (JSON dinâmico)
- Azure IoT Hub: `deviceTwin` com `properties` e `tags`

## Unresolved Questions

1. O campo `device_type` (string) deve substituir ou complementar o enum `type` existente?
2. Deve haver validação de unicidade em `identifier` por tenant?
3. O `slave_id` deve ser único por `central_id`?

## Next Steps

1. Revisão e aprovação deste RFC
2. Implementação da Fase 1 (Schema)
3. Implementação das Fases 2-4
4. Atualização da documentação
