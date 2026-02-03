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

## 12. API Endpoints

### Criar Rule

```http
POST /rules
Content-Type: application/json
Authorization: Bearer <token>
X-Tenant-Id: <tenant-id>

{
  "customerId": "77777777-7777-7777-7777-777777777777",
  "name": "High Temperature Alert",
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
  "tags": ["temperature", "critical"]
}
```

### Listar Rules

```http
GET /rules?customerId=<id>&type=ALARM_THRESHOLD
```

### Obter Bundle

```http
GET /customers/:customerId/alarm-rules/bundle/simple
X-API-Key: <api-key>
X-Tenant-Id: <tenant-id>
```

---

## 13. Diagrama de Estados

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

## 14. Checklist de Implementação

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

### UX

- [ ] Unidades dinâmicas baseadas na métrica
- [ ] Tooltips explicativos
- [ ] Feedback visual para campos com regras automáticas
- [ ] Atalhos para configurações comuns
- [ ] Confirmação antes de deletar
