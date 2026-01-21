# Manual de Onboarding - Alarm Rules Bundle para Node-RED

Este documento descreve como a equipe Node-RED pode consumir o **Alarm Rules Bundle** do GCDR para configurar regras de alarme nos fluxos.

## Sumario

1. [Visao Geral](#1-visao-geral)
2. [Endpoint do Bundle](#2-endpoint-do-bundle)
3. [Estrutura do Bundle](#3-estrutura-do-bundle)
4. [Gerenciamento de Versoes (ETag)](#4-gerenciamento-de-versoes-etag)
5. [Verificacao de Assinatura](#5-verificacao-de-assinatura)
6. [Exemplos Praticos](#6-exemplos-praticos)
7. [Estrategias de Cache](#7-estrategias-de-cache)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Visao Geral

### O que e o Alarm Rules Bundle?

O **Alarm Rules Bundle** e um pacote otimizado contendo todas as regras de alarme de um cliente, estruturado para consumo eficiente pelo Node-RED. Ele inclui:

- **Catalogo de regras** de alarme com thresholds e configuracoes
- **Mapeamento device-to-rules** para lookup rapido
- **Agrupamento por tipo de device** para configuracao em massa
- **Versionamento** para detectar mudancas
- **Assinatura HMAC** para garantir integridade

### Por que usar o Bundle?

| Sem Bundle | Com Bundle |
|------------|------------|
| Multiplas chamadas para buscar regras | Uma unica chamada retorna tudo |
| Logica de mapeamento no Node-RED | Mapeamento pre-calculado |
| Sem cache inteligente | Cache com ETag e versionamento |
| Sem garantia de integridade | Assinatura HMAC-SHA256 |

---

## 2. Endpoint do Bundle

### URL

```
GET /customers/{customerId}/alarm-rules/bundle
```

### Ambiente de Desenvolvimento

```
https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/customers/{customerId}/alarm-rules/bundle
```

### Headers Obrigatorios

```http
Content-Type: application/json
x-tenant-id: <uuid-do-tenant>
Authorization: Bearer <jwt-token>
```

### Query Parameters

| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| `domain` | string | Nao | Filtrar por dominio (ex: `energy`, `security`) |
| `deviceType` | string | Nao | Filtrar por tipo de device (ex: `STORE`, `ELEVATOR`) |
| `includeDisabled` | boolean | Nao | Incluir regras desabilitadas (default: `false`) |

### Exemplo de Requisicao

```bash
curl -X GET \
  "https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/customers/cust-123/alarm-rules/bundle?domain=energy" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-uuid" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## 3. Estrutura do Bundle

### Resposta Completa

```json
{
  "success": true,
  "data": {
    "meta": {
      "version": "a1b2c3d4e5f67890",
      "generatedAt": "2026-01-21T13:00:00.000Z",
      "customerId": "cust-123",
      "customerName": "Empresa ABC",
      "tenantId": "tenant-uuid",
      "signature": "9f8e7d6c5b4a3210...",
      "algorithm": "HMAC-SHA256",
      "ttlSeconds": 300,
      "rulesCount": 15,
      "devicesCount": 42
    },
    "rules": {
      "rule-001": {
        "id": "rule-001",
        "name": "Alta Temperatura",
        "priority": "HIGH",
        "metric": "temperature",
        "operator": "GREATER_THAN",
        "value": 30,
        "unit": "celsius",
        "duration": 300,
        "hysteresis": 2,
        "hysteresisType": "ABSOLUTE",
        "aggregation": "AVG",
        "aggregationWindow": 60,
        "enabled": true,
        "tags": ["critical", "temperature"]
      },
      "rule-002": {
        "id": "rule-002",
        "name": "Consumo Elevado",
        "priority": "MEDIUM",
        "metric": "power_consumption",
        "operator": "GREATER_THAN",
        "value": 1000,
        "unit": "kWh",
        "enabled": true,
        "tags": ["energy"]
      }
    },
    "rulesByDeviceType": {
      "STORE": {
        "deviceType": "STORE",
        "domain": "energy",
        "deviceCount": 10,
        "devices": [
          {
            "id": "dev-001",
            "name": "Loja Centro",
            "serialNumber": "SN-001",
            "externalId": "EXT-001"
          }
        ],
        "ruleIds": ["rule-001", "rule-002"]
      },
      "ELEVATOR": {
        "deviceType": "ELEVATOR",
        "domain": "facility",
        "deviceCount": 5,
        "devices": [
          {
            "id": "dev-010",
            "name": "Elevador A",
            "serialNumber": "SN-010"
          }
        ],
        "ruleIds": ["rule-001"]
      }
    },
    "deviceIndex": {
      "dev-001": {
        "deviceId": "dev-001",
        "deviceName": "Loja Centro",
        "deviceType": "STORE",
        "domain": "energy",
        "serialNumber": "SN-001",
        "externalId": "EXT-001",
        "ruleIds": ["rule-001", "rule-002"]
      },
      "dev-010": {
        "deviceId": "dev-010",
        "deviceName": "Elevador A",
        "deviceType": "ELEVATOR",
        "domain": "facility",
        "serialNumber": "SN-010",
        "ruleIds": ["rule-001"]
      }
    }
  }
}
```

### Descricao dos Campos

#### Meta

| Campo | Tipo | Descricao |
|-------|------|-----------|
| `version` | string | Hash SHA-256 do conteudo (16 chars) - use como ETag |
| `generatedAt` | ISO8601 | Timestamp de geracao |
| `customerId` | string | ID do cliente |
| `customerName` | string | Nome do cliente |
| `tenantId` | string | ID do tenant |
| `signature` | string | Assinatura HMAC-SHA256 para validacao |
| `algorithm` | string | Algoritmo usado (sempre `HMAC-SHA256`) |
| `ttlSeconds` | number | Tempo de vida sugerido para cache (default: 300s) |
| `rulesCount` | number | Total de regras no bundle |
| `devicesCount` | number | Total de devices no bundle |

#### Rules (Catalogo de Regras)

| Campo | Tipo | Descricao |
|-------|------|-----------|
| `id` | string | ID unico da regra |
| `name` | string | Nome descritivo |
| `priority` | enum | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `metric` | string | Metrica a ser avaliada (ex: `temperature`) |
| `operator` | enum | `EQUAL`, `NOT_EQUAL`, `GREATER_THAN`, `LESS_THAN`, `BETWEEN`, etc. |
| `value` | number | Valor do threshold |
| `valueHigh` | number | Valor alto (para `BETWEEN`) |
| `unit` | string | Unidade de medida |
| `duration` | number | Tempo em segundos para disparar |
| `hysteresis` | number | Valor de histerese para evitar flapping |
| `hysteresisType` | enum | `PERCENTAGE` ou `ABSOLUTE` |
| `aggregation` | enum | `AVG`, `MIN`, `MAX`, `SUM`, `COUNT`, `LAST` |
| `aggregationWindow` | number | Janela de agregacao em segundos |
| `enabled` | boolean | Se a regra esta ativa |
| `tags` | string[] | Tags para categorizacao |

#### Device Index

Mapeamento rapido de `deviceId` para suas regras aplicaveis. Use este indice quando receber telemetria de um device especifico.

#### Rules By Device Type

Agrupamento por tipo de device. Use para configuracao em massa ou quando precisar aplicar regras a todos os devices de um tipo.

---

## 4. Gerenciamento de Versoes (ETag)

O bundle suporta **conditional requests** para evitar transferencias desnecessarias.

### Como Funciona

1. Na primeira requisicao, guarde o header `ETag` da resposta
2. Nas proximas requisicoes, envie o header `If-None-Match` com o ETag
3. Se o bundle nao mudou, recebera `304 Not Modified` (sem body)
4. Se mudou, recebera `200 OK` com o novo bundle

### Exemplo com ETag

**Primeira requisicao:**

```bash
curl -i -X GET \
  "https://api.gcdr.io/dev/customers/cust-123/alarm-rules/bundle" \
  -H "Authorization: Bearer <token>"
```

**Resposta:**

```http
HTTP/1.1 200 OK
ETag: "a1b2c3d4e5f67890"
Cache-Control: private, max-age=300
X-Bundle-Version: a1b2c3d4e5f67890
X-Bundle-Signature: 9f8e7d6c5b4a3210...

{"success": true, "data": {...}}
```

**Requisicoes subsequentes:**

```bash
curl -i -X GET \
  "https://api.gcdr.io/dev/customers/cust-123/alarm-rules/bundle" \
  -H "Authorization: Bearer <token>" \
  -H "If-None-Match: \"a1b2c3d4e5f67890\""
```

**Se nao mudou:**

```http
HTTP/1.1 304 Not Modified
ETag: "a1b2c3d4e5f67890"
Cache-Control: private, max-age=300
```

**Se mudou:**

```http
HTTP/1.1 200 OK
ETag: "newversion12345678"
Cache-Control: private, max-age=300

{"success": true, "data": {...novo bundle...}}
```

### Implementacao no Node-RED

```javascript
// No function node
const cachedETag = flow.get('alarmBundleETag') || null;
const cachedBundle = flow.get('alarmBundle') || null;

msg.headers = {
    'Authorization': 'Bearer ' + env.get('GCDR_TOKEN'),
    'x-tenant-id': env.get('TENANT_ID')
};

if (cachedETag) {
    msg.headers['If-None-Match'] = cachedETag;
}

msg.url = env.get('GCDR_API_URL') + '/customers/' + env.get('CUSTOMER_ID') + '/alarm-rules/bundle';
return msg;
```

```javascript
// Apos o HTTP request node
if (msg.statusCode === 304) {
    // Usar bundle em cache
    msg.payload = flow.get('alarmBundle');
    node.status({fill:"green", shape:"dot", text:"Using cached bundle"});
} else if (msg.statusCode === 200) {
    // Atualizar cache
    const etag = msg.headers['etag'];
    flow.set('alarmBundleETag', etag);
    flow.set('alarmBundle', msg.payload.data);
    node.status({fill:"blue", shape:"dot", text:"Bundle updated"});
}
return msg;
```

---

## 5. Verificacao de Assinatura

O bundle inclui uma assinatura HMAC-SHA256 para garantir que os dados nao foram adulterados.

### Estrutura Assinada

A assinatura e calculada sobre:

```json
{
  "meta": {
    "version": "<version>",
    "generatedAt": "<timestamp>",
    "customerId": "<customerId>",
    "tenantId": "<tenantId>"
  },
  "rulesCount": <number>,
  "devicesCount": <number>
}
```

### Verificacao em JavaScript

```javascript
const crypto = require('crypto');

function verifyBundleSignature(bundle, secretKey) {
    const contentToSign = {
        meta: {
            version: bundle.meta.version,
            generatedAt: bundle.meta.generatedAt,
            customerId: bundle.meta.customerId,
            tenantId: bundle.meta.tenantId
        },
        rulesCount: bundle.meta.rulesCount,
        devicesCount: bundle.meta.devicesCount
    };

    const serialized = JSON.stringify(contentToSign);
    const expectedSignature = crypto
        .createHmac('sha256', secretKey)
        .update(serialized)
        .digest('hex');

    // Comparacao segura contra timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(bundle.meta.signature),
        Buffer.from(expectedSignature)
    );
}

// Uso
const isValid = verifyBundleSignature(bundle, process.env.BUNDLE_SIGNING_SECRET);
if (!isValid) {
    throw new Error('Bundle signature verification failed!');
}
```

### Verificacao no Node-RED (Function Node)

```javascript
const crypto = global.get('crypto');
const secretKey = env.get('BUNDLE_SIGNING_SECRET');
const bundle = msg.payload.data;

const contentToSign = {
    meta: {
        version: bundle.meta.version,
        generatedAt: bundle.meta.generatedAt,
        customerId: bundle.meta.customerId,
        tenantId: bundle.meta.tenantId
    },
    rulesCount: bundle.meta.rulesCount,
    devicesCount: bundle.meta.devicesCount
};

const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(JSON.stringify(contentToSign))
    .digest('hex');

if (bundle.meta.signature !== expectedSignature) {
    node.error('Bundle signature verification failed!');
    node.status({fill:"red", shape:"ring", text:"Invalid signature"});
    return null;
}

node.status({fill:"green", shape:"dot", text:"Signature valid"});
return msg;
```

---

## 6. Exemplos Praticos

### 6.1 Buscar Regras para um Device Especifico

Quando receber telemetria de um device, use o `deviceIndex` para lookup rapido:

```javascript
// Function node - processar telemetria
const bundle = flow.get('alarmBundle');
const deviceId = msg.payload.deviceId;
const telemetry = msg.payload.data;

// Lookup rapido no deviceIndex
const deviceMapping = bundle.deviceIndex[deviceId];

if (!deviceMapping) {
    node.warn('Device not found in bundle: ' + deviceId);
    return null;
}

// Buscar regras aplicaveis
const applicableRules = deviceMapping.ruleIds.map(ruleId => bundle.rules[ruleId]);

// Avaliar cada regra
const violations = [];
for (const rule of applicableRules) {
    if (!rule.enabled) continue;

    const metricValue = telemetry[rule.metric];
    if (metricValue === undefined) continue;

    if (evaluateThreshold(metricValue, rule)) {
        violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            priority: rule.priority,
            metric: rule.metric,
            threshold: rule.value,
            actualValue: metricValue,
            deviceId: deviceId,
            deviceName: deviceMapping.deviceName
        });
    }
}

msg.violations = violations;
return msg;

function evaluateThreshold(value, rule) {
    switch (rule.operator) {
        case 'GREATER_THAN': return value > rule.value;
        case 'LESS_THAN': return value < rule.value;
        case 'EQUAL': return value === rule.value;
        case 'BETWEEN': return value >= rule.value && value <= rule.valueHigh;
        default: return false;
    }
}
```

### 6.2 Configurar Todos os Devices de um Tipo

```javascript
// Function node - configurar devices por tipo
const bundle = flow.get('alarmBundle');
const targetDeviceType = 'STORE';

const deviceTypeGroup = bundle.rulesByDeviceType[targetDeviceType];

if (!deviceTypeGroup) {
    node.warn('Device type not found: ' + targetDeviceType);
    return null;
}

// Gerar configuracao para cada device
const configurations = deviceTypeGroup.devices.map(device => ({
    deviceId: device.id,
    serialNumber: device.serialNumber,
    rules: deviceTypeGroup.ruleIds.map(ruleId => {
        const rule = bundle.rules[ruleId];
        return {
            metric: rule.metric,
            operator: rule.operator,
            threshold: rule.value,
            duration: rule.duration || 0,
            priority: rule.priority
        };
    })
}));

msg.payload = configurations;
return msg;
```

### 6.3 Fluxo Completo de Sincronizacao

```
[Inject: Every 5min] --> [Build Request] --> [HTTP Request] --> [Handle Response] --> [Verify Signature] --> [Store Bundle]
                                                    |
                                              [304 Not Modified]
                                                    |
                                                    v
                                            [Use Cached Bundle]
```

---

## 7. Estrategias de Cache

### Recomendacoes

| Cenario | TTL Sugerido | Estrategia |
|---------|--------------|------------|
| Ambiente de producao | 5 min (300s) | Usar ETag + polling periodico |
| Desenvolvimento | 1 min (60s) | Recarregar mais frequente |
| Alta carga | 10 min (600s) | Reduzir chamadas a API |

### Invalidacao de Cache

O cache deve ser invalidado quando:

1. **ETag muda**: O servidor retornou 200 ao inves de 304
2. **Erro de assinatura**: Bundle pode estar corrompido
3. **Requisicao administrativa**: Operador forca refresh
4. **Timeout excedido**: TTL do bundle expirou

### Exemplo de Cache com TTL

```javascript
// Function node - verificar cache
const bundle = flow.get('alarmBundle');
const bundleTimestamp = flow.get('alarmBundleTimestamp');
const ttlSeconds = 300; // 5 minutos

const now = Date.now();
const cacheAge = bundleTimestamp ? (now - bundleTimestamp) / 1000 : Infinity;

if (bundle && cacheAge < ttlSeconds) {
    // Cache ainda valido
    msg.useCache = true;
    msg.cacheAge = Math.round(cacheAge);
    node.status({fill:"green", shape:"dot", text:"Cache hit (" + msg.cacheAge + "s)"});
} else {
    // Precisa atualizar
    msg.useCache = false;
    node.status({fill:"yellow", shape:"ring", text:"Cache miss"});
}

return msg;
```

---

## 8. Troubleshooting

### Erro: 404 Not Found

**Causa:** Customer ID invalido ou inexistente.

**Solucao:** Verificar se o `customerId` esta correto e se o customer existe no GCDR.

```bash
# Verificar customer
curl -X GET "https://api.gcdr.io/dev/customers/{customerId}" \
  -H "Authorization: Bearer <token>"
```

### Erro: 401 Unauthorized

**Causa:** Token JWT invalido ou expirado.

**Solucao:** Renovar o token de autenticacao.

### Erro: Bundle vazio (0 rules, 0 devices)

**Causa:** Customer nao tem regras ou devices cadastrados.

**Solucao:**
1. Verificar se existem devices no customer
2. Verificar se existem regras do tipo `ALARM_THRESHOLD`
3. Verificar filtros (`domain`, `deviceType`)

```bash
# Listar rules do customer
curl -X GET "https://api.gcdr.io/dev/customers/{customerId}/rules" \
  -H "Authorization: Bearer <token>"

# Listar devices do customer
curl -X GET "https://api.gcdr.io/dev/customers/{customerId}/assets" \
  -H "Authorization: Bearer <token>"
```

### Erro: Signature verification failed

**Causa:** Secret key incorreta ou bundle adulterado.

**Solucao:**
1. Verificar se `BUNDLE_SIGNING_SECRET` esta configurado corretamente
2. Verificar se o bundle nao foi modificado apos recebimento
3. Contatar equipe GCDR se o problema persistir

### Performance: Muitas chamadas a API

**Causa:** Cache nao esta sendo usado corretamente.

**Solucao:**
1. Implementar cache com ETag (ver secao 4)
2. Aumentar intervalo de polling
3. Usar TTL do bundle (`meta.ttlSeconds`)

---

## Contato

- **Equipe GCDR**: gcdr-team@myio.com.br
- **Slack**: #gcdr-support
- **Documentacao API**: https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/docs

---

*Ultima atualizacao: 2026-01-21*
