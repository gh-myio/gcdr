# Scripts de Teste - GCDR

## Load Test Rules

Script para carga de testes de criacao de Rules.

### Requisitos

- Node.js 18+
- ts-node instalado (`npm install -g ts-node`)

### Configuracao

1. Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

2. Edite o `.env` com suas credenciais:

```env
API_URL=https://gcdr-server.apps.myio-bas.com
TENANT_ID=seu-tenant-id
AUTH_TOKEN=seu-jwt-token
CUSTOMER_ID=seu-customer-id
TOTAL_RULES=50
DELAY_MS=100
CONCURRENCY=5
```

### Como obter o JWT Token

```bash
curl -X POST https://gcdr-server.apps.myio-bas.com/auth/login \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: SEU_TENANT_ID" \
  -d '{
    "email": "seu-email@example.com",
    "password": "sua-senha"
  }'
```

### Execucao

```bash
cd scripts

# Com arquivo .env
npx ts-node load-test-rules.ts

# Ou com variaveis inline
API_URL=https://... TENANT_ID=... AUTH_TOKEN=... CUSTOMER_ID=... npx ts-node load-test-rules.ts
```

### Parametros

| Variavel | Descricao | Default |
|----------|-----------|---------|
| `API_URL` | URL base da API GCDR | `https://gcdr-server.apps.myio-bas.com` |
| `TENANT_ID` | ID do tenant | - |
| `AUTH_TOKEN` | JWT token de autenticacao | - |
| `CUSTOMER_ID` | ID do customer para criar rules | - |
| `TOTAL_RULES` | Quantidade de rules a criar | `50` |
| `DELAY_MS` | Delay entre batches (ms) | `100` |
| `CONCURRENCY` | Requisicoes simultaneas | `5` |

### Saida

O script gera:

1. **Progresso em tempo real** no terminal
2. **Relatorio final** com estatisticas
3. **Arquivo JSON** com resultados detalhados (`load-test-results-{timestamp}.json`)

### Exemplo de Saida

```
============================================================
SCRIPT DE CARGA DE TESTES - RULES
============================================================

Configuracao:
  API URL:      https://gcdr-server.apps.myio-bas.com
  Tenant ID:    abc12345...
  Customer ID:  cust1234...
  Total Rules:  50
  Concorrencia: 5
  Delay:        100ms

Iniciando carga...

Progresso: 50/50 (100.0%) | Sucesso: 48 | Falhas: 2

============================================================
RELATORIO FINAL
============================================================

Total de Rules:     50
Sucesso:            48 (96.0%)
Falhas:             2 (4.0%)

Tempo Total:        12.34s
Rules/segundo:      4.05

Tempo de Resposta (sucesso):
  Media:            245ms
  Minimo:           120ms
  Maximo:           890ms

Resultados salvos em: load-test-results-1705851234567.json
```

### Tipos de Rules Geradas

O script gera rules do tipo `ALARM_THRESHOLD` com:

- **Metricas variadas**: temperature, humidity, pressure, power_consumption, etc.
- **Operadores**: GT, GTE, LT, LTE, EQ, BETWEEN
- **Prioridades**: LOW, MEDIUM, HIGH, CRITICAL
- **Agregacoes**: AVG, MIN, MAX, LAST
- **Tags**: `load-test`, nome da metrica, prioridade, data do batch

### Limpeza

Para remover as rules criadas pelo teste:

```bash
# Listar rules com tag load-test
curl -X GET "https://gcdr-server.apps.myio-bas.com/rules?tags=load-test" \
  -H "x-tenant-id: SEU_TENANT_ID" \
  -H "Authorization: Bearer SEU_TOKEN"
```

Ou delete manualmente pelo ID de cada rule.
