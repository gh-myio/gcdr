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
| **Tempo Real** | Monitor SSE para visualização em tempo real |
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

### Interface Principal

```
┌─────────────────────────────────────────────────────────────────────┐
│  🎮 Simulator Cockpit [Premium]     📖 Manual  🚀 DEMO  [Tenant ID] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐  ┌─────────────────────────────────────┐  │
│  │  ➕ New Session     │  │  📋 Sessions                        │  │
│  │                     │  │                                     │  │
│  │  Session Name: ___  │  │  ● Demo Session    RUNNING  [Stop]  │  │
│  │  Customer: [▼]      │  │    Scans: 42  Alarms: 3   [Monitor] │  │
│  │  Devices: [Add...]  │  │                                     │  │
│  │                     │  │  ○ Old Session     STOPPED          │  │
│  │  [▶ Start Session]  │  │    Scans: 100 Alarms: 15            │  │
│  └─────────────────────┘  └─────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  🟢 Live Monitor - Demo Session                    [Stop]   │   │
│  │  ──────────────────────────────────────────────────────────  │   │
│  │  14:32:05 📦 Bundle updated - v1.2.3                        │   │
│  │  14:32:10 📡 Device scan: TEMP-A... (temperature=29.5)      │   │
│  │  14:32:10 🔔 ALARM: High Temperature - temp=29.5 (>28)      │   │
│  │  14:32:15 📡 Device scan: HUM-B... (humidity=65.2)          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────┐  ┌─────────────────────────────────────┐  │
│  │  📊 Quotas          │  │  📈 Metrics                         │  │
│  │                     │  │                                     │  │
│  │  Sessions: 1/3      │  │  Active: 1    Scans: 42             │  │
│  │  Max Devices: 50    │  │  Alarms: 3    Monitors: 1           │  │
│  │  Scans/hr: 1000     │  │                                     │  │
│  └─────────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

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

## 4. Configuração Manual

Se você quer usar seus próprios dados:

### Passo 1: Configurar Tenant

1. Digite seu **Tenant ID** (UUID) no campo do header
2. Clique em **Load**
3. Os dropdowns serão populados com seus dados

### Passo 2: Criar Nova Sessão

1. **Session Name**: Nome descritivo (ex: "QA Test Sprint 42")
2. **Customer**: Selecione o customer que tem as regras de alarme
3. **Scan Interval**: Intervalo entre scans de dispositivos
   - Mínimo: 10 segundos (premium) / 30 segundos (standard)
   - Recomendado: 60 segundos
4. **Bundle Refresh**: Intervalo para atualizar regras
   - Mínimo: 30 segundos (premium) / 60 segundos (standard)
   - Recomendado: 300 segundos (5 minutos)

### Passo 3: Adicionar Dispositivos

1. Selecione dispositivos no dropdown **Devices**
2. Cada dispositivo adicionado aparece como chip
3. Clique no **✕** para remover um dispositivo
4. Dispositivos usam perfil de telemetria padrão:
   ```javascript
   {
     temperature: { min: 20, max: 30, unit: '°C' },
     humidity: { min: 40, max: 70, unit: '%' }
   }
   ```

### Passo 4: Iniciar Sessão

1. Clique em **▶ Start Session**
2. A sessão aparece na lista de Sessions
3. O monitor conecta automaticamente

---

## 5. Live Monitor

O Live Monitor usa **Server-Sent Events (SSE)** para streaming em tempo real.

### Tipos de Eventos

| Ícone | Tipo | Descrição |
|-------|------|-----------|
| 📦 | `bundle:fetched` | Bundle de regras foi atualizado |
| 📡 | `device:scanned` | Dispositivo gerou telemetria |
| 🔔 | `alarm:candidate` | Regra disparou um alarme |
| ℹ️ | `session:*` | Eventos de ciclo de vida |

### Exemplo de Log

```
14:32:05  ℹ️  Connected to session monitor
14:32:05  📦  Bundle updated - v1.2.3
14:32:10  📡  Device scan: 55555555... (temperature=26.3, humidity=58.2)
14:32:15  📡  Device scan: 55555555... (temperature=29.1, humidity=62.4)
14:32:15  🔔  ALARM: High Temperature Alert - temperature=29.1 (threshold: 28)
14:32:20  📡  Device scan: 55555555... (temperature=27.8, humidity=71.3)
14:32:20  🔔  ALARM: High Humidity Warning - humidity=71.3 (threshold: 70)
```

### Controles do Monitor

- **Monitor**: Conecta ao stream de uma sessão
- **Stop Monitor**: Desconecta do stream atual
- O monitor mantém no máximo **100 entradas** visíveis
- Heartbeat a cada **30 segundos** mantém conexão viva

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
| GET | `/admin/simulator` | UI do Cockpit |
| GET | `/admin/simulator/api/sessions` | Lista sessões |
| POST | `/admin/simulator/api/sessions/start` | Inicia sessão |
| POST | `/admin/simulator/api/sessions/:id/stop` | Para sessão |
| GET | `/admin/simulator/api/sessions/:id/monitor` | SSE stream |
| GET | `/admin/simulator/api/quotas` | Quotas do tenant |
| GET | `/admin/simulator/api/metrics` | Métricas globais |
| GET | `/admin/simulator/api/customers` | Lista customers |
| GET | `/admin/simulator/api/devices` | Lista devices |
| GET | `/admin/simulator/api/queue/stats` | Stats da fila |

### Endpoints DEMO

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/admin/simulator/api/demo/setup` | Cria ambiente demo |
| POST | `/admin/simulator/api/demo/start-session` | Inicia sessão demo |

### Exemplo: Iniciar Sessão via API

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
- [ONBOARDING.md](./ONBOARDING.md) - Manual de onboarding do projeto
- [RULE-ENTITY.md](./RULE-ENTITY.md) - Documentação do motor de regras

---

**Última atualização:** Janeiro 2026
