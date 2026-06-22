# Rule Entity - Documentacao Tecnica

## Visao Geral

A entidade `Rule` e o componente central do sistema de regras do GCDR, responsavel por definir condicoes de alarme, SLAs, escalacoes e janelas de manutencao. Esta documentacao descreve a estrutura da entidade, suas referencias no codigo e a justificativa para uso do DynamoDB.

**Arquivo Principal:** `src/domain/entities/Rule.ts`

---

## Estrutura da Entidade

### Tipos de Regra (RuleType)

```typescript
type RuleType = 'ALARM_THRESHOLD' | 'SLA' | 'ESCALATION' | 'MAINTENANCE_WINDOW';
```

| Tipo | Descricao |
|------|-----------|
| `ALARM_THRESHOLD` | Regras de alarme baseadas em limiares de metricas |
| `SLA` | Acordos de nivel de servico com metas e periodos |
| `ESCALATION` | Regras de escalonamento para notificacoes |
| `MAINTENANCE_WINDOW` | Janelas de manutencao programadas |

### Prioridades (RulePriority)

```typescript
type RulePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
```

### Operadores de Comparacao (ComparisonOperator)

```typescript
type ComparisonOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'NEQ' | 'BETWEEN' | 'OUTSIDE';
```

---

## Configuracoes por Tipo

### 1. AlarmThresholdConfig

Configuracao para regras de alarme baseadas em metricas.

```typescript
interface AlarmThresholdConfig {
  metric: string;              // Nome da metrica (ex: "temperature", "cpu_usage")
  operator: ComparisonOperator;
  value: number;               // Valor de limiar
  valueHigh?: number;          // Para BETWEEN/OUTSIDE
  unit?: string;               // Unidade (ex: "celsius", "%")
  hysteresis?: number;         // Evita flapping
  hysteresisType?: 'PERCENTAGE' | 'ABSOLUTE';
  duration?: number;           // Tempo (s) que condicao deve persistir
  aggregation?: 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT' | 'LAST';
  aggregationWindow?: number;  // Janela (s) para agregacao
}
```

**Casos de Uso:**
- Alarme quando temperatura > 80C
- Alarme quando CPU entre 80% e 100%
- Alarme quando vazao < 10 L/min por 5 minutos

### 2. SLAConfig

Configuracao para acordos de nivel de servico.

```typescript
interface SLAConfig {
  metric: string;
  target: number;              // Meta do SLA
  unit: string;                // 'percent', 'ms', 'count'
  period: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  calculationMethod: 'AVAILABILITY' | 'RESPONSE_TIME' | 'ERROR_RATE' | 'THROUGHPUT' | 'CUSTOM';
  excludeMaintenanceWindows?: boolean;
  breachNotification?: boolean;
  warningThreshold?: number;   // % do target para warning
}
```

**Casos de Uso:**
- Disponibilidade >= 99.9% mensal
- Tempo de resposta < 200ms
- Taxa de erro < 0.1%

### 3. EscalationConfig

Configuracao para niveis de escalonamento.

```typescript
interface EscalationLevel {
  level: number;               // Nivel do escalonamento
  delayMinutes: number;        // Atraso antes de escalar
  notifyChannels: string[];    // Canais de notificacao
  notifyUsers?: string[];
  notifyGroups?: string[];
  autoAcknowledge?: boolean;
  repeatInterval?: number;     // Minutos entre repeticoes
  maxRepeats?: number;
}

interface EscalationConfig {
  levels: EscalationLevel[];
  autoResolveAfterMinutes?: number;
  businessHoursOnly?: boolean;
  businessHours?: {
    timezone: string;
    start: string;             // HH:mm
    end: string;
    workdays: number[];        // 0-6 (domingo-sabado)
  };
}
```

**Casos de Uso:**
- Nivel 1: SMS para operador apos 5 min
- Nivel 2: Email para supervisor apos 15 min
- Nivel 3: Ligacao para gerente apos 30 min

### 4. MaintenanceWindowConfig

Configuracao para janelas de manutencao.

```typescript
interface MaintenanceWindowConfig {
  startTime: string;           // ISO 8601 ou cron
  endTime?: string;            // ISO 8601 (para one-time)
  duration?: number;           // Duracao em minutos
  recurrence?: 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  recurrenceDays?: number[];   // Dias da semana/mes
  timezone: string;
  suppressAlarms?: boolean;
  suppressNotifications?: boolean;
  affectedRules?: string[];    // IDs das rules afetadas
}
```

**Casos de Uso:**
- Manutencao semanal todo domingo 02:00-06:00
- Parada programada dia 15/01 das 10:00-14:00

---

## Interface Principal (Rule)

```typescript
interface Rule extends BaseEntity {
  customerId: string;
  name: string;
  description?: string;
  type: RuleType;
  priority: RulePriority;
  scope: RuleScope;

  // Configuracoes (apenas uma preenchida baseada no type)
  alarmConfig?: AlarmThresholdConfig;
  slaConfig?: SLAConfig;
  escalationConfig?: EscalationConfig;
  maintenanceConfig?: MaintenanceWindowConfig;

  notificationChannels?: NotificationChannel[];
  tags: string[];
  status: EntityStatus;
  enabled: boolean;
  lastTriggeredAt?: string;
  triggerCount?: number;
}
```

### Campos Herdados de BaseEntity

- `id`: Identificador unico
- `tenantId`: ID do tenant (multi-tenancy)
- `version`: Controle de versao otimista
- `createdAt`, `updatedAt`: Timestamps
- `createdBy`, `updatedBy`: Usuarios responsaveis

---

## Type Guards

Funcoes auxiliares para verificar o tipo de regra com type narrowing:

```typescript
isAlarmRule(rule: Rule)       // Verifica se e ALARM_THRESHOLD
isSLARule(rule: Rule)         // Verifica se e SLA
isEscalationRule(rule: Rule)  // Verifica se e ESCALATION
isMaintenanceRule(rule: Rule) // Verifica se e MAINTENANCE_WINDOW
```

---

## Referencias no Codigo

### Camada de Dominio

| Arquivo | Descricao |
|---------|-----------|
| `src/domain/entities/Rule.ts` | Definicao da entidade principal |
| `src/domain/entities/index.ts` | Export da entidade |
| `src/domain/entities/AlarmBundle.ts` | Referencia Rules em bundles |

### Camada de Dados (DTOs)

| Arquivo | Descricao |
|---------|-----------|
| `src/dto/request/RuleDTO.ts` | Schemas Zod para validacao de entrada |
| `src/dto/request/index.ts` | Export dos DTOs |
| `src/dto/response/RuleResponseDTO.ts` | Formato de resposta da API |
| `src/dto/response/index.ts` | Export dos DTOs de resposta |

### Camada de Repositorio

| Arquivo | Descricao |
|---------|-----------|
| `src/repositories/RuleRepository.ts` | Implementacao DynamoDB |
| `src/repositories/interfaces/IRuleRepository.ts` | Interface do repositorio |
| `src/repositories/interfaces/index.ts` | Export da interface |
| `src/repositories/index.ts` | Export do repositorio |

### Camada de Servico

| Arquivo | Descricao |
|---------|-----------|
| `src/services/RuleService.ts` | Logica de negocios |
| `src/services/AlarmBundleService.ts` | Integracao com AlarmBundle |
| `src/services/index.ts` | Export do servico |

### Handlers (API Endpoints)

| Arquivo | Endpoint | Metodo |
|---------|----------|--------|
| `src/handlers/rules/create.ts` | POST /rules | Criar regra |
| `src/handlers/rules/get.ts` | GET /rules/{id} | Buscar por ID |
| `src/handlers/rules/list.ts` | GET /rules | Listar regras |
| `src/handlers/rules/update.ts` | PUT /rules/{id} | Atualizar regra |
| `src/handlers/rules/delete.ts` | DELETE /rules/{id} | Remover regra |
| `src/handlers/rules/toggle.ts` | POST /rules/{id}/toggle | Ativar/desativar |
| `src/handlers/rules/evaluate.ts` | POST /rules/{id}/evaluate | Avaliar regra |
| `src/handlers/rules/listByCustomer.ts` | GET /customers/{id}/rules | Listar por customer |
| `src/handlers/rules/getStatistics.ts` | GET /rules/statistics | Estatisticas |
| `src/handlers/rules/getMaintenanceWindows.ts` | GET /rules/maintenance-windows | Janelas ativas |
| `src/handlers/rules/getAlarmBundle.ts` | GET /alarm-bundle | Bundle de alarmes |

### Scripts de Teste

| Arquivo | Descricao |
|---------|-----------|
| `scripts/load-test-rules.ts` | Script de carga de testes |

---

## DynamoDB vs PostgreSQL

### Por que DynamoDB e Melhor para Rules

#### 1. Schema Flexivel (Schemaless)

**DynamoDB:**
```json
{
  "id": "rule_123",
  "type": "ALARM_THRESHOLD",
  "alarmConfig": {
    "metric": "temperature",
    "operator": "GT",
    "value": 80,
    "customField": "qualquer_campo_novo"
  }
}
```

**PostgreSQL exigiria:**
```sql
-- Tabela principal
CREATE TABLE rules (
  id UUID PRIMARY KEY,
  type VARCHAR(50),
  ...
);

-- Tabelas separadas para cada config
CREATE TABLE alarm_configs (...);
CREATE TABLE sla_configs (...);
CREATE TABLE escalation_configs (...);
CREATE TABLE maintenance_configs (...);

-- Ou coluna JSONB (perde validacao de schema)
ALTER TABLE rules ADD COLUMN config JSONB;
```

**Vantagem DynamoDB:** Cada tipo de regra tem configuracoes diferentes e podem evoluir independentemente. Adicionar novos campos nao requer migracao de schema.

#### 2. Acesso por Padrao de Leitura com GSIs

O sistema consulta regras por:
- `tenantId` (partition key principal)
- `customerId` (GSI gsi-customer)
- `type` (GSI gsi-type)

**DynamoDB:**
```typescript
// Query eficiente por GSI
const result = await dynamoDb.send(new QueryCommand({
  TableName: 'rules',
  IndexName: 'gsi-customer',
  KeyConditionExpression: 'tenantId = :t AND customerId = :c',
  ExpressionAttributeValues: {
    ':t': tenantId,
    ':c': customerId,
  },
}));
```

**PostgreSQL:**
```sql
-- Requer indices compostos
CREATE INDEX idx_rules_tenant_customer ON rules(tenant_id, customer_id);
CREATE INDEX idx_rules_tenant_type ON rules(tenant_id, type);

-- Queries ainda precisam de JOIN para configs
SELECT r.*, ac.*, sc.*, ec.*, mc.*
FROM rules r
LEFT JOIN alarm_configs ac ON r.id = ac.rule_id
LEFT JOIN sla_configs sc ON r.id = sc.rule_id
...
```

**Vantagem DynamoDB:** GSIs permitem queries eficientes sem JOINs, com dados desnormalizados.

#### 3. Escalabilidade Horizontal Automatica

| Aspecto | DynamoDB | PostgreSQL |
|---------|----------|------------|
| Escala | Automatica (on-demand) | Manual (replicas, sharding) |
| Capacidade | Ilimitada | Limitada pelo hardware |
| Particionamento | Automatico por tenant | Manual (pg_partman, Citus) |
| Latencia | Consistente <10ms | Varia com carga |

**Cenario Real:**
- 1000 tenants
- 10.000 rules por tenant
- 10.000.000 rules total

**DynamoDB:** Escala automaticamente, cada tenant isolado por partition key.
**PostgreSQL:** Requer planejamento de particoes, indices parciais, possivelmente sharding.

#### 4. Custo em Arquitetura Serverless

**DynamoDB On-Demand:**
- Paga apenas pelo que usa
- Sem custo quando ocioso
- Ideal para cargas variaveis

**PostgreSQL (RDS/Aurora):**
- Instancia sempre rodando
- Custo minimo ~$15/mes (t3.micro)
- Custo real ~$50-200/mes para producao

**Calculo para GCDR:**
```
DynamoDB (estimativa):
- 100.000 rules
- 1.000 writes/dia
- 10.000 reads/dia
= ~$5/mes

PostgreSQL RDS:
- db.t3.micro (dev): $15/mes
- db.t3.small (prod): $30/mes
- Backup, IOPS: +$10-20/mes
= $25-50/mes minimo
```

#### 5. Multi-Tenancy Nativo

**DynamoDB:**
```typescript
// Isolamento natural por partition key
Key: { tenantId: 'tenant_abc', id: 'rule_123' }
```

Cada tenant tem suas proprias particoes fisicas. Impossivel acessar dados de outro tenant.

**PostgreSQL:**
```sql
-- Row-level security requer configuracao
CREATE POLICY tenant_isolation ON rules
  USING (tenant_id = current_setting('app.tenant_id'));
```

Mais complexo de implementar e auditar.

#### 6. Integracao com AWS Lambda

**DynamoDB:**
- SDK nativo AWS
- Conexao stateless
- Sem pool de conexoes
- Streams para eventos

**PostgreSQL:**
- Requer connection pooling (RDS Proxy: +$20/mes)
- Conexoes persistentes consomem memoria
- Cold starts impactados

```typescript
// DynamoDB - simples
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
const client = DynamoDBDocument.from(new DynamoDBClient({}));

// PostgreSQL - requer pooling
import { Pool } from 'pg';
const pool = new Pool({ max: 10, connectionTimeoutMillis: 5000 });
```

#### 7. Modelo de Consistencia

**DynamoDB:**
- Eventually consistent reads (default, mais barato)
- Strongly consistent reads (opcional)
- Transacoes ACID disponiveis

**PostgreSQL:**
- Sempre strongly consistent
- Overhead de WAL/replicacao

Para Rules, consistencia eventual e aceitavel na maioria dos casos.

---

## Quando PostgreSQL Seria Melhor

1. **Queries complexas com JOINs:** Relatorios que cruzam muitas entidades
2. **Agregacoes avancadas:** GROUP BY, HAVING, window functions
3. **Full-text search:** Busca em descricoes com ranking
4. **Transacoes longas:** Operacoes que modificam muitas entidades

**Para o caso de Rules:** Nenhum desses cenarios e necessario. As queries sao simples: buscar por ID, listar por tenant, filtrar por tipo/customer.

---

## Conclusao

O DynamoDB e a escolha ideal para a entidade Rule no GCDR devido a:

1. **Flexibilidade de schema** para diferentes tipos de configuracao
2. **Performance previsivel** com GSIs para padroes de acesso conhecidos
3. **Escalabilidade automatica** sem gerenciamento de infraestrutura
4. **Custo otimizado** para arquitetura serverless
5. **Multi-tenancy nativo** com isolamento por partition key
6. **Integracao perfeita** com AWS Lambda

A arquitetura atual com DynamoDB permite que o sistema escale de dezenas a milhoes de regras sem alteracoes de codigo ou infraestrutura.

---

## Referencias

- [AWS DynamoDB Developer Guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/)
- [DynamoDB vs PostgreSQL Comparison](https://aws.amazon.com/dynamodb/resources/dynamodb-vs-relational/)
- [Serverless Framework DynamoDB](https://www.serverless.com/framework/docs/providers/aws/guide/resources/)
