# Rules - Guia para Frontend

Este documento descreve a estrutura de dados necessária para criar/editar regras de alarme no frontend, visando a geração do bundle simplificado consumido pelo Node-RED.

## Endpoint de Destino

```
GET /customers/:customerId/alarm-rules/bundle/simple
```

---

## 1. Estrutura do Bundle Simplificado

### Response Structure

```json
{
  "success": true,
  "data": {
    "versionId": "v1-20260203-143052",
    "deviceIndex": {
      "<deviceId>": {
        "deviceName": "Energy Laboratório",
        "centralId": "eeee2222-2222-2222-2222-222222222222",
        "slaveId": 1,
        "offset": 0,
        "ruleIds": ["rule-id-1", "rule-id-2"]
      }
    },
    "rules": {
      "<ruleId>": {
        "id": "aaaa0001-0001-0001-0001-000000000001",
        "name": "High Temperature Alert",
        "metric": "temperature",
        "operator": "GT",
        "value": 28,
        "valueHigh": null,
        "duration": 300000,
        "hysteresis": 2,
        "aggregation": "AVG",
        "startAt": "08:00",
        "endAt": "18:00",
        "daysOfWeek": {
          "0": false,
          "1": true,
          "2": true,
          "3": true,
          "4": true,
          "5": true,
          "6": false
        }
      }
    }
  }
}
```

---

## 2. Campos da Rule

### 2.1 Campos Obrigatórios

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `name` | string | Nome da regra | "Alerta Temperatura Alta" |
| `metric` | MetricDomain | Tipo de métrica monitorada | "temperature" |
| `operator` | ComparisonOperator | Operador de comparação | "GT" |
| `value` | number | Valor de threshold | 28 |

### 2.2 Campos Opcionais (com defaults)

| Campo | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `valueHigh` | number | null | Segundo valor (para BETWEEN/OUTSIDE) |
| `duration` | number | 0 | Duração em **minutos** no banco (convertido para ms no bundle) |
| `hysteresis` | number | 0 | Histerese para evitar oscilações |
| `aggregation` | AggregationType | "LAST" | Tipo de agregação |
| `startAt` | string | "00:00" | Hora início (HH:mm) |
| `endAt` | string | "23:59" | Hora fim (HH:mm) |
| `daysOfWeek` | number[] | [0,1,2,3,4,5,6] | Dias ativos (0=Domingo) |

---

## 3. Tipos de Métricas (MetricDomain)

### 3.1 Métricas Contínuas

| Metric | Unidade | Descrição | Aggregation Padrão |
|--------|---------|-----------|-------------------|
| `temperature` | °C | Temperatura | AVG |
| `humidity` | % | Umidade relativa | AVG |
| `instantaneous_power` | W | Potência instantânea | AVG |
| `energy_consumption` | Wh | Consumo de energia | **SUM** (forçado) |
| `water_flow` | L | Vazão de água | SUM |
| `water_level_continuous` | % | Nível de água (contínuo) | LAST |
| `water_level_discreet` | % | Nível de água (discreto) | LAST |

### 3.2 Métricas Discretas (Binárias)

| Metric | Valores | Descrição | Device Metadata |
|--------|---------|-----------|-----------------|
| `sensor` | 0 \| 1 | Sensor genérico | `{ channelId, value }` |
| `presence_sensor` | 0=not_detected, 1=detected | Sensor de presença | `{ channelId, value }` |
| `door_sensor` | 0=closed, 1=open | Sensor de porta | `{ channelId, value }` |
| `lamp` | 0=on, 1=off | Controle de lâmpada | `{ channelId, value }` |

---

## 4. Operadores de Comparação (ComparisonOperator)

| Operador | Nome | Descrição | Requer valueHigh |
|----------|------|-----------|------------------|
| `GT` | Greater Than | Maior que | Não |
| `GTE` | Greater Than or Equal | Maior ou igual | Não |
| `LT` | Less Than | Menor que | Não |
| `LTE` | Less Than or Equal | Menor ou igual | Não |
| `EQ` | Equal | Igual a | Não |
| `NEQ` | Not Equal | Diferente de | Não |
| `BETWEEN` | Between | Entre value e valueHigh | **Sim** |
| `OUTSIDE` | Outside | Fora do intervalo | **Sim** |

### Exemplo BETWEEN/OUTSIDE

```json
{
  "metric": "temperature",
  "operator": "BETWEEN",
  "value": 18,
  "valueHigh": 26
}
```
> Alarme dispara se temperatura estiver **entre** 18°C e 26°C

---

## 5. Tipos de Agregação (AggregationType)

| Aggregation | Descrição | Uso Típico |
|-------------|-----------|------------|
| `LAST` | Último valor recebido | Métricas instantâneas, sensores discretos |
| `AVG` | Média no período | Temperatura, umidade |
| `MIN` | Valor mínimo | Detectar quedas |
| `MAX` | Valor máximo | Detectar picos |
| `SUM` | Soma no período | Energia, vazão |
| `COUNT` | Contagem de eventos | Eventos discretos |

### Regras de Negócio

| Condição | Comportamento |
|----------|---------------|
| `metric = "energy_consumption"` | `aggregation` é **forçado** para `"SUM"` |
| `aggregation = "LAST"` | `duration` é **forçado** para `0` |

---

## 6. Duration (Duração)

### Armazenamento vs Bundle

| Local | Unidade | Exemplo |
|-------|---------|---------|
| Banco de Dados | **minutos** | 5 |
| Bundle /simple | **milissegundos** | 300000 |

### Conversão

```
duration_ms = duration_minutos × 60 × 1000
```

### Exemplos

| Input (min) | Output (ms) | Descrição |
|-------------|-------------|-----------|
| 0 | 0 | Imediato |
| 1 | 60000 | 1 minuto |
| 5 | 300000 | 5 minutos |
| 10 | 600000 | 10 minutos |
| 30 | 1800000 | 30 minutos |

---

## 7. Schedule (Agendamento)

### Campos

| Campo | Formato | Exemplo | Descrição |
|-------|---------|---------|-----------|
| `startAt` | HH:mm | "08:00" | Hora de início |
| `endAt` | HH:mm | "18:00" | Hora de fim |
| `daysOfWeek` | number[] | [1,2,3,4,5] | Dias ativos |

### Dias da Semana

| Valor | Dia |
|-------|-----|
| 0 | Domingo |
| 1 | Segunda |
| 2 | Terça |
| 3 | Quarta |
| 4 | Quinta |
| 5 | Sexta |
| 6 | Sábado |

### Conversão no Bundle

O frontend envia array, o bundle converte para objeto:

```json
// Input (frontend)
"daysOfWeek": [1, 2, 3, 4, 5]

// Output (bundle)
"daysOfWeek": {
  "0": false,
  "1": true,
  "2": true,
  "3": true,
  "4": true,
  "5": true,
  "6": false
}
```

---

## 8. Device Mapping

### Estrutura

```typescript
{
  deviceName: string;      // Nome do device
  centralId?: string;      // UUID da central (Modbus)
  slaveId?: number;        // Slave ID (Modbus 1-247)
  offset: number;          // Offset de calibração
  ruleIds: string[];       // IDs das rules aplicáveis
}
```

### Offset (Calibração)

O `offset` é lido do device:
- `device.metadata.offset` (preferido)
- `device.attributes.offset` (fallback)
- Default: `0`

Usado para calibrar sensores de temperatura, umidade, potência, etc.

---

## 9. Formulário do Frontend

### Campos Sugeridos

#### Seção: Identificação
- **Nome** (text, required) - max 100 chars
- **Descrição** (textarea, optional)
- **Prioridade** (select) - LOW, MEDIUM, HIGH, CRITICAL
- **Tags** (chips/multi-select)

#### Seção: Condição

- **Métrica** (select, required)
  - Grupo "Contínuas": temperature, humidity, instantaneous_power, energy_consumption, water_flow
  - Grupo "Discretas": sensor, presence_sensor, door_sensor, lamp

- **Operador** (select, required)
  - GT, GTE, LT, LTE, EQ, NEQ, BETWEEN, OUTSIDE

- **Valor** (number, required)
  - Label dinâmico com unidade da métrica

- **Valor Alto** (number, conditional)
  - Visível apenas quando operator = BETWEEN ou OUTSIDE

#### Seção: Comportamento

- **Duração** (number + select)
  - Input: número
  - Select: minutos/segundos
  - Hint: "Tempo que a condição deve persistir antes de disparar o alarme"

- **Agregação** (select)
  - LAST, AVG, MIN, MAX, SUM, COUNT
  - Disabled quando metric = "energy_consumption" (mostrar "SUM - automático")

- **Histerese** (number)
  - Hint: "Margem para evitar alarmes repetidos (ex: 2°C)"

#### Seção: Agendamento

- **Horário Ativo**
  - Hora Início (time picker) - default "00:00"
  - Hora Fim (time picker) - default "23:59"

- **Dias da Semana** (checkbox group)
  - [ ] Domingo
  - [x] Segunda
  - [x] Terça
  - [x] Quarta
  - [x] Quinta
  - [x] Sexta
  - [ ] Sábado
  - Atalhos: "Dias úteis" | "Todos" | "Nenhum"

#### Seção: Escopo

- **Tipo de Escopo** (select)
  - GLOBAL - Todos os devices
  - CUSTOMER - Devices do customer
  - ASSET - Devices do asset
  - DEVICE - Device específico

- **Entidade** (select, conditional)
  - Visível quando tipo != GLOBAL
  - Lista de customers/assets/devices conforme tipo

---

## 10. Validações

### Frontend

| Campo | Validação |
|-------|-----------|
| `name` | Required, 1-100 chars |
| `metric` | Required, enum válido |
| `operator` | Required, enum válido |
| `value` | Required, number |
| `valueHigh` | Required se operator = BETWEEN/OUTSIDE |
| `valueHigh` | Deve ser > value |
| `duration` | >= 0 |
| `hysteresis` | >= 0 |
| `startAt` | Formato HH:mm |
| `endAt` | Formato HH:mm, >= startAt |
| `daysOfWeek` | Ao menos 1 dia selecionado |

### Backend (regras automáticas)

| Condição | Ação |
|----------|------|
| `metric = "energy_consumption"` | Força `aggregation = "SUM"` |
| `aggregation = "LAST"` | Força `duration = 0` |

---

## 11. Exemplos de Rules

### Temperatura Alta (contínua)

```json
{
  "name": "Alerta Temperatura Alta",
  "metric": "temperature",
  "operator": "GT",
  "value": 28,
  "duration": 5,
  "hysteresis": 2,
  "aggregation": "AVG",
  "startAt": "00:00",
  "endAt": "23:59",
  "daysOfWeek": [0, 1, 2, 3, 4, 5, 6]
}
```

**Bundle output:**
```json
{
  "id": "...",
  "name": "Alerta Temperatura Alta",
  "metric": "temperature",
  "operator": "GT",
  "value": 28,
  "duration": 300000,
  "hysteresis": 2,
  "aggregation": "AVG",
  "startAt": "00:00",
  "endAt": "23:59",
  "daysOfWeek": {"0": true, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true}
}
```

---

### Consumo de Energia (forçado SUM)

```json
{
  "name": "Alto Consumo Energia",
  "metric": "energy_consumption",
  "operator": "GT",
  "value": 1000,
  "duration": 60,
  "aggregation": "AVG"
}
```

**Bundle output:**
```json
{
  "metric": "energy_consumption",
  "operator": "GT",
  "value": 1000,
  "duration": 3600000,
  "aggregation": "SUM"
}
```
> Note: `aggregation` foi forçado para "SUM"

---

### Potência Instantânea (pico imediato)

```json
{
  "name": "Pico de Potência",
  "metric": "instantaneous_power",
  "operator": "GTE",
  "value": 800,
  "duration": 0,
  "aggregation": "LAST"
}
```

**Bundle output:**
```json
{
  "metric": "instantaneous_power",
  "operator": "GTE",
  "value": 800,
  "duration": 0,
  "aggregation": "LAST"
}
```

---

### Sensor de Presença (discreto)

```json
{
  "name": "Presença Detectada Noite",
  "metric": "presence_sensor",
  "operator": "EQ",
  "value": 1,
  "duration": 0,
  "aggregation": "LAST",
  "startAt": "22:00",
  "endAt": "06:00",
  "daysOfWeek": [0, 1, 2, 3, 4, 5, 6]
}
```

---

### Temperatura em Faixa (BETWEEN)

```json
{
  "name": "Temperatura Fora da Faixa Ideal",
  "metric": "temperature",
  "operator": "OUTSIDE",
  "value": 20,
  "valueHigh": 25,
  "duration": 10,
  "hysteresis": 1,
  "aggregation": "AVG"
}
```

---

### Apenas Dias Úteis

```json
{
  "name": "Consumo Alto Horário Comercial",
  "metric": "instantaneous_power",
  "operator": "GT",
  "value": 500,
  "duration": 5,
  "aggregation": "AVG",
  "startAt": "08:00",
  "endAt": "18:00",
  "daysOfWeek": [1, 2, 3, 4, 5]
}
```

---

## 12. API Endpoints - Referência Completa

### Headers de Autenticação

#### Opção 1: JWT Token

```http
Content-Type: application/json
Authorization: Bearer <jwt-token>
X-Tenant-Id: <tenant-uuid>
```

#### Opção 2: API Key (Recomendado para integrações)

```http
Content-Type: application/json
X-API-Key: <api-key>
```

> **Nota:** O header `X-Tenant-Id` é **opcional** quando usando API Key.
> O tenant é automaticamente descoberto a partir da API Key.
> Se fornecido, permite uma busca mais rápida no banco de dados.

---

### 12.1 Criar Rule

```http
POST /rules
```

#### Request Body

```json
{
  "customerId": "77777777-7777-7777-7777-777777777777",
  "name": "High Temperature Alert",
  "description": "Alerta quando temperatura excede 28°C",
  "type": "ALARM_THRESHOLD",
  "priority": "HIGH",
  "scope": {
    "type": "CUSTOMER",
    "entityId": "77777777-7777-7777-7777-777777777777",
    "inherited": true
  },
  "alarmConfig": {
    "metric": "temperature",
    "operator": "GT",
    "value": 28,
    "valueHigh": null,
    "unit": "°C",
    "duration": 5,
    "hysteresis": 2,
    "hysteresisType": "ABSOLUTE",
    "aggregation": "AVG",
    "aggregationWindow": 60,
    "startAt": "08:00",
    "endAt": "18:00",
    "daysOfWeek": [1, 2, 3, 4, 5]
  },
  "notificationChannels": [
    {
      "type": "EMAIL",
      "config": {
        "to": "ops@empresa.com"
      },
      "enabled": true
    }
  ],
  "tags": ["temperature", "critical"],
  "enabled": true
}
```

#### Campos do Body

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `customerId` | UUID | Sim | ID do customer |
| `name` | string | Sim | Nome da rule (1-255 chars) |
| `description` | string | Não | Descrição (max 1000 chars) |
| `type` | enum | Sim | `ALARM_THRESHOLD` |
| `priority` | enum | Não | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` (default: `MEDIUM`) |
| `scope` | object | Sim | Escopo de aplicação |
| `alarmConfig` | object | Sim* | Configuração do alarme (*obrigatório para `ALARM_THRESHOLD`) |
| `notificationChannels` | array | Não | Canais de notificação |
| `tags` | string[] | Não | Tags para organização |
| `enabled` | boolean | Não | Se a rule está ativa (default: `true`) |

#### Scope Object

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `type` | enum | Sim | `GLOBAL`, `CUSTOMER`, `ASSET`, `DEVICE` |
| `entityId` | UUID | Condicional | Obrigatório se type != `GLOBAL` |
| `inherited` | boolean | Não | Se aplica a entidades filhas |

#### AlarmConfig Object

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `metric` | MetricDomain | Sim | Tipo de métrica |
| `operator` | enum | Sim | `GT`, `GTE`, `LT`, `LTE`, `EQ`, `NEQ`, `BETWEEN`, `OUTSIDE` |
| `value` | number | Sim | Valor de threshold |
| `valueHigh` | number | Condicional | Obrigatório para `BETWEEN`/`OUTSIDE` |
| `unit` | string | Não | Unidade de medida |
| `duration` | number | Não | Duração em **minutos** (default: 0) |
| `hysteresis` | number | Não | Valor de histerese (default: 0) |
| `hysteresisType` | enum | Não | `PERCENTAGE`, `ABSOLUTE` |
| `aggregation` | enum | Não | `LAST`, `AVG`, `MIN`, `MAX`, `SUM`, `COUNT` (default: `LAST`) |
| `aggregationWindow` | number | Não | Janela de agregação em segundos |
| `startAt` | string | Não | Hora início "HH:mm" (default: "00:00") |
| `endAt` | string | Não | Hora fim "HH:mm" (default: "23:59") |
| `daysOfWeek` | number[] | Não | Dias ativos 0-6 (default: todos) |

#### Response (201 Created)

```json
{
  "success": true,
  "data": {
    "id": "aaaa0001-0001-0001-0001-000000000020",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "customerId": "77777777-7777-7777-7777-777777777777",
    "name": "High Temperature Alert",
    "description": "Alerta quando temperatura excede 28°C",
    "type": "ALARM_THRESHOLD",
    "priority": "HIGH",
    "scope": {
      "type": "CUSTOMER",
      "entityId": "77777777-7777-7777-7777-777777777777",
      "inherited": true
    },
    "alarmConfig": { ... },
    "notificationChannels": [ ... ],
    "tags": ["temperature", "critical"],
    "status": "ACTIVE",
    "enabled": true,
    "version": 1,
    "createdAt": "2026-02-03T15:30:00.000Z",
    "updatedAt": "2026-02-03T15:30:00.000Z",
    "createdBy": "bbbb1111-1111-1111-1111-111111111111"
  },
  "meta": {
    "requestId": "abc123",
    "timestamp": "2026-02-03T15:30:00.000Z"
  }
}
```

---

### 12.2 Listar Rules

```http
GET /rules
```

#### Query Parameters (Filtros)

| Parâmetro | Tipo | Descrição | Exemplo |
|-----------|------|-----------|---------|
| `limit` | number | Itens por página (1-100, default: 20) | `?limit=50` |
| `cursor` | string | Cursor para paginação | `?cursor=abc123` |
| `type` | enum | Filtrar por tipo | `?type=ALARM_THRESHOLD` |
| `priority` | enum | Filtrar por prioridade | `?priority=HIGH` |
| `customerId` | UUID | Filtrar por customer | `?customerId=77777777-...` |
| `enabled` | boolean | Filtrar por status ativo | `?enabled=true` |
| `status` | enum | Filtrar por status | `?status=ACTIVE` |

#### Exemplos de Filtros

```http
# Todas as rules ALARM_THRESHOLD do customer
GET /rules?customerId=77777777-7777-7777-7777-777777777777&type=ALARM_THRESHOLD

# Rules de alta prioridade ativas
GET /rules?priority=HIGH&enabled=true

# Paginação
GET /rules?limit=20&cursor=eyJpZCI6ImFhYWEwMDAxLi4uIn0=
```

#### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "aaaa0001-0001-0001-0001-000000000001",
        "name": "High Temperature Alert",
        "type": "ALARM_THRESHOLD",
        "priority": "HIGH",
        "scope": { ... },
        "alarmConfig": { ... },
        "status": "ACTIVE",
        "enabled": true,
        "createdAt": "2026-02-03T15:30:00.000Z"
      },
      ...
    ],
    "count": 15,
    "nextCursor": "eyJpZCI6ImFhYWEwMDAxLi4uIn0="
  },
  "meta": {
    "requestId": "abc123",
    "timestamp": "2026-02-03T15:30:00.000Z"
  }
}
```

---

### 12.3 Obter Rule por ID

```http
GET /rules/:id
```

#### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "aaaa0001-0001-0001-0001-000000000001",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "customerId": "77777777-7777-7777-7777-777777777777",
    "name": "High Temperature Alert",
    "description": "Alerta quando temperatura excede 28°C",
    "type": "ALARM_THRESHOLD",
    "priority": "HIGH",
    "scope": {
      "type": "CUSTOMER",
      "entityId": "77777777-7777-7777-7777-777777777777",
      "inherited": true
    },
    "alarmConfig": {
      "metric": "temperature",
      "operator": "GT",
      "value": 28,
      "unit": "°C",
      "duration": 5,
      "hysteresis": 2,
      "aggregation": "AVG",
      "startAt": "08:00",
      "endAt": "18:00",
      "daysOfWeek": [1, 2, 3, 4, 5]
    },
    "notificationChannels": [],
    "tags": ["temperature", "critical"],
    "status": "ACTIVE",
    "enabled": true,
    "version": 1,
    "lastTriggeredAt": "2026-02-02T10:15:00.000Z",
    "triggerCount": 42,
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-02-01T14:30:00.000Z",
    "createdBy": "bbbb1111-1111-1111-1111-111111111111",
    "updatedBy": "bbbb2222-2222-2222-2222-222222222222"
  }
}
```

---

### 12.4 Atualizar Rule

```http
PUT /rules/:id
```

#### Request Body (campos opcionais)

```json
{
  "name": "Updated Temperature Alert",
  "description": "Nova descrição",
  "priority": "CRITICAL",
  "scope": {
    "type": "ASSET",
    "entityId": "dddd2222-2222-2222-2222-222222222222",
    "inherited": false
  },
  "alarmConfig": {
    "metric": "temperature",
    "operator": "GT",
    "value": 30,
    "duration": 10,
    "hysteresis": 3,
    "aggregation": "AVG"
  },
  "tags": ["temperature", "updated"],
  "enabled": true
}
```

> **Nota:** Envie apenas os campos que deseja atualizar. Campos não enviados mantêm seus valores atuais.

#### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "aaaa0001-0001-0001-0001-000000000001",
    "name": "Updated Temperature Alert",
    "version": 2,
    "updatedAt": "2026-02-03T16:00:00.000Z",
    ...
  }
}
```

---

### 12.5 Deletar Rule

```http
DELETE /rules/:id
```

#### Response (204 No Content)

```
(sem corpo de resposta)
```

---

### 12.6 Toggle Enable/Disable

```http
POST /rules/:id/toggle
```

#### Request Body

```json
{
  "enabled": false,
  "reason": "Manutenção programada"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `enabled` | boolean | Sim | Novo estado |
| `reason` | string | Não | Motivo da alteração (max 500 chars) |

#### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "aaaa0001-0001-0001-0001-000000000001",
    "enabled": false,
    "updatedAt": "2026-02-03T16:30:00.000Z"
  }
}
```

---

### 12.7 Listar Rules por Customer

```http
GET /customers/:customerId/rules
```

#### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "count": 10
  }
}
```

---

### 12.8 Estatísticas de Rules

```http
GET /rules/statistics
```

#### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "total": 45,
    "byType": {
      "ALARM_THRESHOLD": 30,
      "SLA": 5,
      "ESCALATION": 5,
      "MAINTENANCE_WINDOW": 5
    },
    "byPriority": {
      "LOW": 10,
      "MEDIUM": 20,
      "HIGH": 10,
      "CRITICAL": 5
    },
    "byStatus": {
      "enabled": 40,
      "disabled": 5
    }
  }
}
```

---

### 12.9 Testar/Avaliar Rule

```http
POST /rules/evaluate
```

#### Request Body

```json
{
  "ruleId": "aaaa0001-0001-0001-0001-000000000001",
  "sampleData": {
    "temperature": 32,
    "humidity": 65,
    "timestamp": "2026-02-03T15:00:00.000Z"
  }
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "ruleId": "aaaa0001-0001-0001-0001-000000000001",
    "ruleName": "High Temperature Alert",
    "triggered": true,
    "evaluation": {
      "metric": "temperature",
      "operator": "GT",
      "threshold": 28,
      "actualValue": 32,
      "condition": "32 > 28",
      "result": true
    }
  }
}
```

---

### 12.10 Obter Bundle Simplificado

```http
GET /customers/:customerId/alarm-rules/bundle/simple
```

#### Query Parameters

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `domain` | string | Filtrar por domínio |
| `deviceType` | string | Filtrar por tipo de device |
| `includeDisabled` | boolean | Incluir rules desabilitadas |

#### Response Headers

```http
ETag: "v1-20260203-153000"
Cache-Control: private, max-age=300
X-Bundle-Version: v1-20260203-153000
X-Bundle-Signature: abc123...
X-Bundle-Rules-Count: 15
X-Bundle-Devices-Count: 6
```

#### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "versionId": "v1-20260203-153000",
    "deviceIndex": {
      "22220001-0001-0001-0001-000000000001": {
        "deviceName": "Energy Laboratório",
        "centralId": "eeee2222-2222-2222-2222-222222222222",
        "slaveId": 1,
        "offset": 0,
        "ruleIds": ["aaaa0001-0001-0001-0001-000000000014"]
      }
    },
    "rules": {
      "aaaa0001-0001-0001-0001-000000000014": {
        "id": "aaaa0001-0001-0001-0001-000000000014",
        "name": "High Instantaneous Power Alert",
        "metric": "instantaneous_power",
        "operator": "GT",
        "value": 500,
        "duration": 300000,
        "hysteresis": 0,
        "aggregation": "AVG",
        "startAt": "00:00",
        "endAt": "23:59",
        "daysOfWeek": {"0": true, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true}
      }
    }
  }
}
```

#### Caching com ETag

```http
# Primeira requisição
GET /customers/:customerId/alarm-rules/bundle/simple

# Response: 200 OK
# ETag: "v1-20260203-153000"

# Requisições subsequentes (verificar se mudou)
GET /customers/:customerId/alarm-rules/bundle/simple
If-None-Match: "v1-20260203-153000"

# Se não mudou: 304 Not Modified (sem body)
# Se mudou: 200 OK (novo bundle)
```

---

## 13. Códigos de Erro

| Código | Descrição | Causa |
|--------|-----------|-------|
| 400 | Bad Request | Payload inválido, validação falhou |
| 401 | Unauthorized | Token/API Key ausente ou inválido |
| 403 | Forbidden | Sem permissão para o recurso |
| 404 | Not Found | Rule não encontrada |
| 409 | Conflict | Conflito (ex: nome duplicado) |
| 422 | Unprocessable Entity | Dados válidos mas não processáveis |
| 500 | Internal Server Error | Erro interno |

### Exemplo de Erro

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "alarmConfig.value",
        "message": "Expected number, received string"
      },
      {
        "field": "scope.entityId",
        "message": "entityId is required for non-GLOBAL scope types"
      }
    ]
  },
  "meta": {
    "requestId": "abc123",
    "timestamp": "2026-02-03T15:30:00.000Z"
  }
}
```

---

## 14. Exemplos de Integração (Frontend)

### TypeScript/Fetch

```typescript
// Configuração base
const API_BASE = 'https://api.gcdr.com';
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`,
  'X-Tenant-Id': tenantId
};

// Criar Rule
async function createRule(data: CreateRuleDTO): Promise<Rule> {
  const response = await fetch(`${API_BASE}/rules`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error.message);
  }

  const result = await response.json();
  return result.data;
}

// Listar Rules com filtros
async function listRules(filters: ListRulesParams): Promise<RuleListResponse> {
  const params = new URLSearchParams();

  if (filters.customerId) params.append('customerId', filters.customerId);
  if (filters.type) params.append('type', filters.type);
  if (filters.priority) params.append('priority', filters.priority);
  if (filters.enabled !== undefined) params.append('enabled', String(filters.enabled));
  if (filters.limit) params.append('limit', String(filters.limit));
  if (filters.cursor) params.append('cursor', filters.cursor);

  const response = await fetch(`${API_BASE}/rules?${params}`, { headers });
  const result = await response.json();
  return result.data;
}

// Atualizar Rule
async function updateRule(id: string, data: UpdateRuleDTO): Promise<Rule> {
  const response = await fetch(`${API_BASE}/rules/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data)
  });

  const result = await response.json();
  return result.data;
}

// Toggle Enable/Disable
async function toggleRule(id: string, enabled: boolean, reason?: string): Promise<Rule> {
  const response = await fetch(`${API_BASE}/rules/${id}/toggle`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ enabled, reason })
  });

  const result = await response.json();
  return result.data;
}

// Deletar Rule
async function deleteRule(id: string): Promise<void> {
  await fetch(`${API_BASE}/rules/${id}`, {
    method: 'DELETE',
    headers
  });
}

// Obter Bundle com cache
async function getBundle(customerId: string, etag?: string): Promise<BundleResponse | null> {
  const requestHeaders = { ...headers };
  if (etag) {
    requestHeaders['If-None-Match'] = etag;
  }

  const response = await fetch(
    `${API_BASE}/customers/${customerId}/alarm-rules/bundle/simple`,
    { headers: requestHeaders }
  );

  if (response.status === 304) {
    return null; // Not modified, use cached version
  }

  const result = await response.json();
  return {
    data: result.data,
    etag: response.headers.get('ETag')
  };
}
```

### React Hook Exemplo

```typescript
function useRules(customerId: string) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchRules() {
      try {
        setLoading(true);
        const data = await listRules({ customerId, type: 'ALARM_THRESHOLD' });
        setRules(data.items);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchRules();
  }, [customerId]);

  const createNewRule = async (data: CreateRuleDTO) => {
    const newRule = await createRule({ ...data, customerId });
    setRules(prev => [...prev, newRule]);
    return newRule;
  };

  const updateExistingRule = async (id: string, data: UpdateRuleDTO) => {
    const updated = await updateRule(id, data);
    setRules(prev => prev.map(r => r.id === id ? updated : r));
    return updated;
  };

  const removeRule = async (id: string) => {
    await deleteRule(id);
    setRules(prev => prev.filter(r => r.id !== id));
  };

  return { rules, loading, error, createNewRule, updateExistingRule, removeRule };
}
```

---

## 15. Diagrama de Estados

```
┌─────────────────────────────────────────────────────────┐
│                    RULE LIFECYCLE                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [DRAFT] ──create──▶ [ACTIVE] ◀──enable──┐             │
│                          │                │             │
│                          │ disable        │             │
│                          ▼                │             │
│                     [DISABLED] ───────────┘             │
│                          │                              │
│                          │ delete                       │
│                          ▼                              │
│                     [DELETED]                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 16. Checklist de Implementação

### Frontend

- [ ] Formulário de criação de rule
- [ ] Formulário de edição de rule
- [ ] Lista de rules com filtros (type, status, priority)
- [ ] Toggle enable/disable
- [ ] Validação client-side
- [ ] Preview do bundle gerado
- [ ] Seletor de escopo (customer/asset/device)
- [ ] Agendamento com UI intuitiva
- [ ] Suporte a métricas discretas
- [ ] Integração com API (criar, editar, deletar, toggle)
- [ ] Paginação com cursor
- [ ] Cache do bundle com ETag
- [ ] Tratamento de erros

### UX

- [ ] Unidades dinâmicas baseadas na métrica
- [ ] Tooltips explicativos
- [ ] Feedback visual para campos com regras automáticas
- [ ] Atalhos para configurações comuns
- [ ] Confirmação antes de deletar
- [ ] Loading states
- [ ] Toast notifications para sucesso/erro
