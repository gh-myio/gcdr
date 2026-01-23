# Estudo: Extensão de Atributos do Device

## 1. Contexto

Solicitação para adicionar novos atributos à entidade `devices`:

| Atributo | Tipo | Exemplo | Uso |
|----------|------|---------|-----|
| `slaveid` | number (0-999) | 1 | Modbus slave ID |
| `centralid` | UUID | d3202744-... | Referência à central |
| `addr_low` | number (0-999) | 100 | Endereço Modbus baixo |
| `addr_high` | number (0-999) | 200 | Endereço Modbus alto |
| `frequency` | number (0-999) | 60 | Frequência de polling (s) |
| `deviceType` | string | HIDROMETRO_AREA_COMUM | Tipo específico do device |
| `deviceProfile` | string | ENERGIA_GERAL | Perfil de telemetria |
| `deviceMapInstantaneousPower` | JSON | {...} | Mapa de limites de potência |
| `identifier` | string | ENTRADA_SHOPPING_L2 | Identificador legível |
| `inactivityAlarmTime` | datetime | 2024-01-20T10:00:00Z | Tempo de alarme de inatividade |
| `ingestionId` | UUID | ce6a7e51-... | ID no sistema de ingestão |
| `ingestionGatewayId` | UUID | ce6a7e51-... | ID do gateway de ingestão |
| `lastActivityTime` | datetime | 2024-01-20T10:00:00Z | Última atividade |
| `lastConnectTime` | datetime | 2024-01-20T10:00:00Z | Última conexão |
| `lastDisconnectTime` | datetime | 2024-01-20T10:00:00Z | Última desconexão |

## 2. Schema Atual

```typescript
// devices já possui:
- id, tenantId, assetId, customerId
- name, displayName, label, type, description
- serialNumber, externalId
- specs (JSONB) ← configurações técnicas
- connectivityStatus, lastConnectedAt, lastDisconnectedAt
- credentials (JSONB), telemetryConfig (JSONB)
- tags (JSONB), metadata (JSONB), attributes (JSONB)
- status, deletedAt, createdAt, updatedAt, version
```

## 3. Análise: Colunas vs JSONB

### 3.1 Colunas Dedicadas

**Prós:**
- Tipagem forte (validação no banco)
- Índices diretos e eficientes
- Queries simples: `WHERE identifier = 'X'`
- Foreign keys possíveis (centralId)
- Melhor performance em filtros frequentes

**Contras:**
- Requer migration para cada mudança
- Pode "poluir" a tabela com muitas colunas
- Campos NULL ocupam espaço no catálogo

### 3.2 JSONB (metadata/attributes/specs)

**Prós:**
- Flexível, sem migrations
- Agrupa dados relacionados
- PostgreSQL tem excelente suporte JSONB
- Índices GIN para busca eficiente

**Contras:**
- Queries mais verbosas: `WHERE specs->>'slaveId' = '1'`
- Sem validação de tipo no banco
- Índices GIN são maiores que B-tree

### 3.3 Queries em JSONB - Exemplos

```sql
-- Filtrar por slaveId dentro de specs
SELECT * FROM devices
WHERE specs->>'slaveId' = '1';

-- Filtrar por valor numérico
SELECT * FROM devices
WHERE (specs->>'frequency')::int > 30;

-- Busca com índice GIN (containment)
SELECT * FROM devices
WHERE specs @> '{"deviceProfile": "ENERGIA_GERAL"}';

-- Múltiplos filtros
SELECT * FROM devices
WHERE specs->>'deviceProfile' = 'HIDROMETRO_AREA_COMUM'
  AND (specs->>'frequency')::int <= 60;
```

### 3.4 Índices GIN para JSONB

```sql
-- Índice GIN genérico (suporta @>, ?, ?&, ?|)
CREATE INDEX idx_devices_specs_gin ON devices USING GIN (specs);

-- Índice específico para um campo (mais eficiente se só filtrar esse campo)
CREATE INDEX idx_devices_device_profile ON devices ((specs->>'deviceProfile'));

-- Índice para múltiplos campos extraídos
CREATE INDEX idx_devices_specs_profile_freq ON devices (
  (specs->>'deviceProfile'),
  ((specs->>'frequency')::int)
);
```

## 4. Recomendação: Abordagem Híbrida

### 4.1 Novos Campos como COLUNAS (filtrados frequentemente)

| Campo | Tipo | Justificativa |
|-------|------|---------------|
| `centralId` | UUID (FK) | Relacionamento com centrals, filtro comum |
| `identifier` | VARCHAR(255) | Busca frequente, único por contexto |
| `deviceProfile` | VARCHAR(100) | Filtro comum em dashboards |
| `ingestionId` | UUID | Integração externa, filtro comum |
| `ingestionGatewayId` | UUID | Integração externa, filtro comum |
| `lastActivityTime` | TIMESTAMP | Detectar dispositivos inativos |
| `inactivityAlarmTime` | TIMESTAMP | Configuração de alarme |

### 4.2 Campos no JSONB `specs` (configuração técnica Modbus)

```typescript
specs: {
  // Modbus configuration
  modbus?: {
    slaveId: number;      // 0-999
    addrLow: number;      // 0-999
    addrHigh: number;     // 0-999
    frequency: number;    // polling em segundos
  };

  // Device classification (se diferente do type enum)
  deviceType?: string;    // HIDROMETRO_AREA_COMUM, etc.

  // Power mapping (estrutura complexa)
  powerMap?: {
    version: string;
    limitsByInstantaneousPowerType: [...];
  };
}
```

### 4.3 Campos já existentes (não precisam ser adicionados)

| Solicitado | Já existe como |
|------------|----------------|
| `lastConnectTime` | `lastConnectedAt` |
| `lastDisconnectTime` | `lastDisconnectedAt` |

## 5. Schema Proposto

```typescript
export const devices = pgTable('devices', {
  // ... campos existentes ...

  // NOVOS CAMPOS (colunas)
  centralId: uuid('central_id').references(() => centrals.id),
  identifier: varchar('identifier', { length: 255 }),
  deviceProfile: varchar('device_profile', { length: 100 }),
  ingestionId: uuid('ingestion_id'),
  ingestionGatewayId: uuid('ingestion_gateway_id'),
  lastActivityTime: timestamp('last_activity_time', { withTimezone: true }),
  inactivityAlarmTime: timestamp('inactivity_alarm_time', { withTimezone: true }),

  // specs (JSONB) já existe - adicionar modbus config
  specs: jsonb('specs').notNull().default({}),
  // ^^ Conterá: { modbus: {...}, deviceType, powerMap }

}, (table) => ({
  // ... índices existentes ...

  // NOVOS ÍNDICES
  centralIdx: index('devices_central_idx').on(table.centralId),
  identifierIdx: index('devices_identifier_idx').on(table.identifier),
  deviceProfileIdx: index('devices_device_profile_idx').on(table.deviceProfile),
  ingestionIdx: index('devices_ingestion_idx').on(table.ingestionId),
  lastActivityIdx: index('devices_last_activity_idx').on(table.lastActivityTime),
}));
```

## 6. Migration SQL

```sql
-- Adicionar novas colunas
ALTER TABLE devices
  ADD COLUMN central_id UUID REFERENCES centrals(id),
  ADD COLUMN identifier VARCHAR(255),
  ADD COLUMN device_profile VARCHAR(100),
  ADD COLUMN ingestion_id UUID,
  ADD COLUMN ingestion_gateway_id UUID,
  ADD COLUMN last_activity_time TIMESTAMPTZ,
  ADD COLUMN inactivity_alarm_time TIMESTAMPTZ;

-- Criar índices
CREATE INDEX devices_central_idx ON devices(central_id);
CREATE INDEX devices_identifier_idx ON devices(identifier);
CREATE INDEX devices_device_profile_idx ON devices(device_profile);
CREATE INDEX devices_ingestion_idx ON devices(ingestion_id);
CREATE INDEX devices_last_activity_idx ON devices(last_activity_time);

-- Índice GIN para specs (se ainda não existir)
CREATE INDEX devices_specs_gin ON devices USING GIN (specs);
```

## 7. Exemplos de Uso

### 7.1 Criar device com novos campos

```typescript
const device = await db.insert(devices).values({
  tenantId: '...',
  assetId: '...',
  customerId: '...',
  name: 'Medidor Entrada',
  serialNumber: 'MED-001',
  type: 'METER',

  // Novos campos
  centralId: 'd3202744-05dd-46d1-af33-495e9a2ecd52',
  identifier: 'ENTRADA_SHOPPING_GARAGEM_L2',
  deviceProfile: 'HIDROMETRO_AREA_COMUM',
  ingestionId: 'ce6a7e51-e642-4562-8d3d-8f492929d4df',
  ingestionGatewayId: 'ce6a7e51-e642-4562-8d3d-8f492929d4df',

  // Modbus config no specs
  specs: {
    modbus: {
      slaveId: 1,
      addrLow: 100,
      addrHigh: 200,
      frequency: 60,
    },
    deviceType: 'HIDROMETRO_AREA_COMUM',
    powerMap: {
      version: '1.0.0',
      limitsByInstantaneousPowerType: [...]
    }
  }
});
```

### 7.2 Queries

```typescript
// Buscar por identifier
const device = await db.select()
  .from(devices)
  .where(eq(devices.identifier, 'ENTRADA_SHOPPING_GARAGEM_L2'));

// Buscar por central
const devicesByCentral = await db.select()
  .from(devices)
  .where(eq(devices.centralId, centralId));

// Buscar por profile
const meters = await db.select()
  .from(devices)
  .where(eq(devices.deviceProfile, 'HIDROMETRO_AREA_COMUM'));

// Buscar inativos (última atividade > 1 hora)
const inactiveDevices = await db.select()
  .from(devices)
  .where(lt(devices.lastActivityTime, sql`NOW() - INTERVAL '1 hour'`));

// Buscar por config Modbus (JSONB)
const modbusDevice = await db.select()
  .from(devices)
  .where(sql`specs->'modbus'->>'slaveId' = '1'`);
```

## 8. Comparação de Performance

| Query | Coluna | JSONB (sem índice) | JSONB (com GIN) |
|-------|--------|-------------------|-----------------|
| `WHERE identifier = 'X'` | ~0.1ms | N/A | N/A |
| `WHERE device_profile = 'X'` | ~0.2ms | ~5ms | ~0.5ms |
| `WHERE specs->>'slaveId' = '1'` | N/A | ~10ms | ~1ms |
| `WHERE specs @> '{"modbus":{"slaveId":1}}'` | N/A | ~15ms | ~0.3ms |

*Valores aproximados para tabela com 100k registros*

## 9. Conclusão

**Recomendação: Abordagem Híbrida**

1. **7 novos campos como colunas** - dados frequentemente filtrados
2. **Modbus config, deviceType, powerMap no `specs`** - configuração técnica agrupada
3. **Índice GIN no `specs`** - para queries em campos JSONB

Esta abordagem oferece:
- Performance otimizada para queries frequentes
- Flexibilidade para campos técnicos
- Validação de tipo nos campos críticos
- Relacionamento FK com centrals

## 10. Próximos Passos

- [ ] Aprovar abordagem híbrida
- [ ] Criar RFC formal (RFC-0008)
- [ ] Implementar migration Drizzle
- [ ] Atualizar DeviceRepository
- [ ] Atualizar seed scripts
- [ ] Atualizar documentação OpenAPI
