# Manual do Simulador de Alarmes - GCDR

> **Premium Feature** - Ferramenta para testar regras de alarme sem afetar sistemas de produção.

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Acesso ao Simulador](#2-acesso-ao-simulador)
3. [Quick Start com DEMO](#3-quick-start-com-demo)
4. [Configuração Manual](#4-configuração-manual)
5. [Live Monitor](#5-live-monitor)
6. [Quotas e Limites](#6-quotas-e-limites)
7. [Métricas](#7-métricas)
8. [Perfis de Telemetria](#8-perfis-de-telemetria)
9. [Isolamento e Segurança](#9-isolamento-e-segurança)
10. [API Endpoints](#10-api-endpoints)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Visão Geral

O **GCDR Simulator Cockpit** é uma ferramenta premium para testar regras de alarme de forma segura e isolada. Ele simula dispositivos IoT gerando dados de telemetria, avalia regras de alarme e roteia os alarmes disparados para uma **fila isolada**.

### O que o Simulador faz?

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Dispositivos   │────▶│  Regras de       │────▶│  Fila Isolada   │
│  Simulados      │     │  Alarme          │     │  (não produção) │
│                 │     │                  │     │                 │
│  • Temperatura  │     │  • temp > 28°C   │     │  alarm-candidates│
│  • Umidade      │     │  • humidity > 70%│     │  :simulated     │
│  • Energia      │     │  • power > 400W  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Características Principais

| Feature | Descrição |
|---------|-----------|
| **Isolamento Total** | Alarmes vão para fila separada (`alarm-candidates:simulated`) |
| **Tempo Real** | Monitor SSE com grid 2×3 — cada bloco exibe uma etapa do ciclo de alarme |
| **Scenario Builder** | Wizard de 5 passos (Centrais → Devices → Rules → Controle → Review) |
| **OUTLET Support** | Dispositivos OUTLET exibem badges de canais (flow, temperature, etc.) |
| **Multi-tenant** | Suporte completo a múltiplos tenants |
| **Quotas** | Limites configuráveis (Standard vs Premium) |
| **Auto-expire** | Sessões expiram automaticamente (24h/72h) |

---

## 2. Acesso ao Simulador

### URL de Acesso

| Ambiente | URL |
|----------|-----|
| **Local** | `http://localhost:3015/admin/simulator` |
| **Staging** | `https://api-staging.gcdr.myio.com.br/admin/simulator` |
| **Production** | `https://api.gcdr.myio.com.br/admin/simulator` |

### Interface Principal — Grid 2×3

A interface é organizada como um **grid fixo de 2 linhas e 3 colunas**, onde cada bloco representa uma etapa do ciclo de vida do alarme:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Simulator Cockpit [Premium]              Manual  DEMO  [Tenant ID]  [Load]    │
├─────────────────────┬─────────────────────┬─────────────────────────────────────┤
│  Block 1            │  Block 2            │  Block 3                            │
│  Scenario Overview  │  Bundle & Rules     │  Device Scanner                     │
│  & Control Center   │  Status             │  & Telemetry Feed                   │
│                     │                     │                                     │
│  Centrals: 2        │  Version: v1.2.3    │  14:32:10 TEMP-A  temp=29.5        │
│  Devices: 5         │  Rules: 8           │  14:32:15 HUM-B   hum=65.2         │
│  Rules: 3           │  Last fetch: 10s    │  14:32:20 PWR-C   power=420        │
│  Status: RUNNING    │                     │                                     │
│                     │                     │                                     │
│  [Configure] [Start]│                     │                                     │
├─────────────────────┼─────────────────────┼─────────────────────────────────────┤
│  Block 4            │  Block 5            │  Block 6                            │
│  Rule Evaluator     │  Alarm Candidates   │  Metrics & Quotas                   │
│                     │                     │                                     │
│  Rule: Temp High    │  ALARM: Temp High   │  Scans: 42/1000                     │
│  Device: TEMP-A     │  Device: TEMP-A     │  Alarms: 3                          │
│  29.5 > 28 = FAIL   │  Severity: HIGH     │  Uptime: 01:15:30                   │
│                     │  Fingerprint: abc.. │  Remaining: 22:44                   │
└─────────────────────┴─────────────────────┴─────────────────────────────────────┘
```

| Bloco | Nome | Eventos SSE Associados |
|-------|------|----------------------|
| **Block 1** | Scenario Overview & Control | Status da sessão |
| **Block 2** | Bundle Status & Rules Catalog | `bundle:fetched`, `bundle:unchanged` |
| **Block 3** | Device Scanner & Telemetry Feed | `device:scanned` |
| **Block 4** | Rule Evaluator Live Results | `alarm:candidate` (detalhes da avaliação) |
| **Block 5** | Alarm Candidates Queue & History | `alarm:candidate` (alarmes gerados) |
| **Block 6** | Session Metrics & Quotas | Todos os eventos (contadores) |

---

## 3. Quick Start com DEMO

A forma mais rápida de ver o simulador funcionando é usando o botão **🚀 DEMO**.

### O que o DEMO cria automaticamente?

| Entidade | Detalhes |
|----------|----------|
| **Tenant** | `11111111-1111-1111-1111-111111111111` |
| **Customer** | DEMO Corp |
| **Asset** | Demo Building |
| **Central** | Demo NodeHub |
| **Devices** | 3 sensores (temperatura, umidade, energia) |
| **Rules** | 2 regras de alarme |

### Regras de Alarme Criadas

```javascript
// Regra 1: Alerta de Temperatura Alta
{
  name: "High Temperature Alert",
  field: "temperature",
  operator: "gt",      // greater than
  threshold: 28,       // °C
  priority: "HIGH"
}

// Regra 2: Aviso de Umidade Alta
{
  name: "High Humidity Warning",
  field: "humidity",
  operator: "gt",
  threshold: 70,       // %
  priority: "MEDIUM"
}
```

### Perfis de Telemetria do DEMO

Os dispositivos geram valores aleatórios dentro destes ranges:

| Dispositivo | Campo | Min | Max | Unidade |
|-------------|-------|-----|-----|---------|
| Temp Sensor A | temperature | 22 | 32 | °C |
| Humidity Sensor B | humidity | 50 | 80 | % |
| Power Meter C | power | 100 | 500 | W |
| Power Meter C | voltage | 110 | 130 | V |

> **Nota:** Como `temperature` pode chegar a 32°C e o threshold é 28°C, alarmes serão disparados quando o valor gerado for > 28.

### Como usar o DEMO

1. Clique no botão **🚀 DEMO** no header
2. Aguarde a configuração automática (~2-3 segundos)
3. O monitor conecta automaticamente
4. Observe os eventos em tempo real no Live Monitor

---

## 4. Scenario Builder (Wizard)

A configuração manual agora é feita via **Scenario Builder**, um wizard full-screen de 5 passos.

### Abrindo o Wizard

1. Digite seu **Tenant ID** (UUID) no campo do header e clique em **Load**
2. Selecione o **Customer** no dropdown
3. Clique em **"Configure Simulator"** no Block 1

### Step 1 — Centrals

- Lista todas as centrais do customer selecionado
- Selecione uma ou mais centrais (checkbox)
- Exibe: nome, serial number, status de conexão
- Mínimo: 1 central selecionada

### Step 2 — Devices

- Lista dispositivos de cada central selecionada (agrupados)
- Selecione os dispositivos desejados (checkbox)
- Para dispositivos **OUTLET**: badges coloridos mostram os canais disponíveis (ex: `[flow] [temperature] [humidity]`)
- Perfis de telemetria são **auto-gerados** com base no tipo do dispositivo:
  - OUTLET channels geram profiles automaticamente (ex: canal `temperature` → `{ min: 15, max: 35, unit: '°C' }`)
  - Usuário pode ajustar `min/max` antes de prosseguir
- Mínimo: 1 dispositivo selecionado

### Step 3 — Rules

- Lista regras de alarme do customer
- Filtrável por `centralId` (query parameter opcional)
- Exibe: nome da regra, métrica, operador, threshold, prioridade
- Selecione as regras que serão avaliadas durante a simulação
- Mínimo: 1 regra selecionada

> **Nota:** Ao selecionar regras específicas, o `SimulatorEngine` filtra e avalia **apenas** essas regras. Sem seleção de regras, todas as regras do bundle são avaliadas (comportamento legado).

### Step 4 — Simulation Control

| Campo | Descrição | Default |
|-------|-----------|---------|
| **Session Name** | Nome descritivo (obrigatório) | — |
| **Description** | Descrição opcional (max 500 chars) | — |
| **Scan Interval** | Intervalo entre scans: 10s / 30s / 60s / 120s | 60s |
| **Bundle Refresh** | Intervalo de refresh: 30s / 60s / 300s | 300s |
| **Session Duration** | Duração: 1h / 4h / 12h / 24h / 72h | 24h |

### Step 5 — Review & Create

- Resumo completo: centrais, dispositivos, regras, intervalos, duração
- Validação contra quotas do tenant
- Botão **"Create Scenario"** → salva config no browser, fecha o wizard
- O Block 1 atualiza para status `READY`
- Clique **"Start Simulation"** no Block 1 para iniciar

### Fluxo de Estados

```
NOT CONFIGURED → [Configure] → READY → [Start] → RUNNING → [Stop] → STOPPED
                                  ↑                                      │
                                  └──────── [Reconfigure] ──────────────┘
```

---

## 5. Live Monitor (SSE → Grid Blocks)

O Live Monitor usa **Server-Sent Events (SSE)** para streaming em tempo real. Os eventos são **roteados para blocos específicos** do grid 2×3.

### Roteamento de Eventos SSE

| Evento SSE | Bloco Destino | O que é atualizado |
|------------|---------------|-------------------|
| `bundle:fetched` | Block 2 | Versão, assinatura, timestamp do bundle |
| `bundle:unchanged` | Block 2 | Apenas timestamp atualizado |
| `device:scanned` | Block 3 | Feed de telemetria com valores coloridos |
| `alarm:candidate` | Block 4 + Block 5 | Resultado da avaliação (B4) + alarme gerado (B5) |
| Todos os eventos | Block 6 | Contadores de scans, alarmes, uptime |

### Indicadores Visuais no Block 3 (Device Scanner)

Os valores de telemetria são coloridos por proximidade ao threshold:

| Cor | Significado |
|-----|-------------|
| **Verde** | Valor dentro da faixa normal |
| **Amarelo** | Valor próximo ao threshold (< 10% de distância) |
| **Vermelho** | Valor excede o threshold (alarme disparado) |

### Controles do Monitor

- A conexão SSE é estabelecida automaticamente ao iniciar a simulação
- Heartbeat a cada **30 segundos** mantém conexão viva
- Cada bloco mantém suas **últimas entradas** visíveis (scroll automático)
- Block 6 exibe progress bars para quotas em tempo real

---

## 6. Quotas e Limites

### Planos Disponíveis

| Feature | Standard | Premium |
|---------|----------|---------|
| Sessões Concorrentes | 3 | 10 |
| Min Scan Interval | 30s | 10s |
| Min Bundle Refresh | 60s | 30s |
| Max Devices/Session | 50 | 200 |
| Max Scans/Hour | 1,000 | 10,000 |
| Session Expiry | 24h | 72h |

### Visualização de Quotas

A seção **📊 Quotas** mostra:

```
Sessions: 2/3 [████████░░] 67%
Max Devices: 50
Scans/hr: 1000/hr
```

- Barra verde: < 50% usado
- Barra amarela: 50-80% usado
- Barra vermelha: > 80% usado

---

## 7. Métricas

### Métricas Globais

| Métrica | Descrição |
|---------|-----------|
| **Active** | Sessões rodando no momento (todos os tenants) |
| **Scans** | Total de scans de dispositivos realizados |
| **Alarms** | Total de alarm candidates gerados |
| **Monitors** | Clientes SSE conectados |

### Health Status

| Status | Significado |
|--------|-------------|
| 🟢 Healthy | Sistema operando normalmente |
| 🟡 Degraded | Performance reduzida ou warnings |
| 🔴 Unhealthy | Erros críticos ou sistema indisponível |

---

## 8. Perfis de Telemetria

### Estrutura de Perfil

```typescript
interface TelemetryProfile {
  [field: string]: {
    min: number;    // Valor mínimo gerado
    max: number;    // Valor máximo gerado
    unit: string;   // Unidade de medida
  }
}
```

### Exemplos de Perfis

```javascript
// Sensor de Temperatura
{
  temperature: { min: 18, max: 35, unit: '°C' }
}

// Sensor Multi-parâmetro
{
  temperature: { min: 20, max: 30, unit: '°C' },
  humidity: { min: 40, max: 80, unit: '%' },
  pressure: { min: 1000, max: 1020, unit: 'hPa' }
}

// Medidor de Energia
{
  power: { min: 0, max: 1000, unit: 'W' },
  voltage: { min: 110, max: 130, unit: 'V' },
  current: { min: 0, max: 10, unit: 'A' }
}
```

### Geração de Valores

A cada scan, o simulador gera valores usando:

```javascript
value = min + Math.random() * (max - min)
```

> **Dica:** Para garantir que alarmes disparem, configure o `max` acima do threshold da regra.

---

## 9. Isolamento e Segurança

### Garantias de Isolamento

O simulador foi projetado com segurança em mente:

1. **Fila Separada**: Alarmes vão para `alarm-candidates:simulated`, não para produção
2. **Metadados Explícitos**: Todos os eventos são marcados com:
   ```javascript
   {
     source: { type: 'SIMULATOR' },
     metadata: { simulated: true }
   }
   ```
3. **Auto-expire**: Sessões expiram automaticamente
4. **Rate Limiting**: Previne exaustão de recursos
5. **Tenant Isolation**: Sessões são isoladas por tenant

### Estrutura do Alarm Candidate

```javascript
{
  fingerprint: "abc123...",
  tenantId: "tenant-uuid",
  customerId: "customer-uuid",
  source: {
    type: "SIMULATOR",           // Sempre 'SIMULATOR'
    simulationId: "session-uuid",
    deviceId: "device-uuid",
    deviceIdentifier: "TEMP-A"
  },
  rule: {
    id: "rule-uuid",
    name: "High Temperature Alert",
    severity: "HIGH"
  },
  telemetry: {
    field: "temperature",
    value: 29.5,
    threshold: 28,
    operator: "gt",
    timestamp: "2026-01-27T14:32:15.000Z"
  },
  metadata: {
    simulated: true,             // Flag de simulação
    simulatedAt: "2026-01-27T14:32:15.000Z",
    bundleVersion: "1.2.3",
    sessionName: "Demo Session"
  }
}
```

---

## 10. API Endpoints

### Endpoints Públicos (Admin UI)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/admin/simulator` | UI do Cockpit (grid 2×3) |
| GET | `/admin/simulator/api/sessions` | Lista sessões |
| POST | `/admin/simulator/api/sessions/start` | Inicia sessão (aceita `centralIds`, `ruleIds`, `sessionDurationHours`, `description`) |
| POST | `/admin/simulator/api/sessions/:id/stop` | Para sessão |
| GET | `/admin/simulator/api/sessions/:id/monitor` | SSE stream |
| GET | `/admin/simulator/api/quotas` | Quotas do tenant |
| GET | `/admin/simulator/api/metrics` | Métricas globais |
| GET | `/admin/simulator/api/customers` | Lista customers |
| GET | `/admin/simulator/api/devices` | Lista devices |
| GET | `/admin/simulator/api/queue/stats` | Stats da fila |

### Endpoints do Wizard (Scenario Builder)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/admin/simulator/api/centrals?tenantId=X&customerId=X` | Lista centrais do customer (Step 1) |
| GET | `/admin/simulator/api/centrals/:id/devices?tenantId=X` | Lista devices da central, com channels para OUTLET (Step 2) |
| GET | `/admin/simulator/api/rules?tenantId=X&customerId=X` | Lista regras de alarme do customer (Step 3) |

### Endpoints DEMO

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/admin/simulator/api/demo/setup` | Cria ambiente demo |
| POST | `/admin/simulator/api/demo/start-session` | Inicia sessão demo |

### Exemplo: Iniciar Sessão via API (com Scenario Builder fields)

```bash
curl -X POST http://localhost:3015/admin/simulator/api/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "customerId": "22222222-2222-2222-2222-222222222222",
    "name": "API Test Session",
    "config": {
      "customerId": "22222222-2222-2222-2222-222222222222",
      "deviceScanIntervalMs": 60000,
      "bundleRefreshIntervalMs": 300000,
      "centralIds": ["central-uuid-1", "central-uuid-2"],
      "ruleIds": ["rule-uuid-1", "rule-uuid-2"],
      "sessionDurationHours": 4,
      "description": "Testing temperature rules on lab devices",
      "devices": [
        {
          "deviceId": "55555555-5555-5555-5555-555555555501",
          "telemetryProfile": {
            "temperature": { "min": 20, "max": 35, "unit": "°C" }
          }
        }
      ]
    }
  }'
```

> **Nota:** Os campos `centralIds`, `ruleIds`, `sessionDurationHours` e `description` são **opcionais** e backward-compatible. Sessões sem esses campos continuam funcionando normalmente.

---

## 11. Troubleshooting

### Problemas Comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| "No customers found" | Tenant ID incorreto ou sem customers | Verifique o UUID e se há customers cadastrados |
| "No devices" | Customer sem devices | Adicione devices ao customer |
| "Quota exceeded" | Limite de sessões atingido | Pare sessões existentes ou aguarde expiração |
| "Connection lost" | Timeout de SSE | Reconecta automaticamente; ou recarregue a página |
| "No alarms triggering" | Telemetria não excede threshold | Ajuste ranges para ultrapassar thresholds |
| "Bundle fetch failed" | Customer sem API Key ou regras | Verifique se há regras e API Key configurados |

### Verificando Dados de Demo

Se o DEMO não funcionar, verifique se os dados existem:

```bash
# Verificar customer demo
curl "http://localhost:3015/admin/simulator/api/customers?tenantId=11111111-1111-1111-1111-111111111111"

# Verificar devices demo
curl "http://localhost:3015/admin/simulator/api/devices?customerId=22222222-2222-2222-2222-222222222222"
```

### Logs do Servidor

```bash
# Docker
docker compose logs -f api | grep -i simulator

# Local
npm run dev
# Observe logs no console
```

### Limpando Sessões Antigas

Sessões expiram automaticamente, mas você pode parar manualmente:

```bash
# Parar sessão específica
curl -X POST http://localhost:3015/admin/simulator/api/sessions/{sessionId}/stop \
  -H "Content-Type: application/json" \
  -d '{"reason": "MANUAL_CLEANUP"}'
```

---

## Referências

- [RFC-0010: Premium Alarm Simulator](./RFC-0010-Premium-Alarm-Simulator.md) - Especificação técnica completa
- [RFC-0014: Simulator UI/UX Overhaul](./RFC-0014-FixSimulator-Implementation-Plan.md) - Grid 2×3 + Scenario Builder
- [ONBOARDING.md](./ONBOARDING.md) - Manual de onboarding do projeto
- [RULE-ENTITY.md](./RULE-ENTITY.md) - Documentação do motor de regras

---

**Última atualização:** Fevereiro 2026
