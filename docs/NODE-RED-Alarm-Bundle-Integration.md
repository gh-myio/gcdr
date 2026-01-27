# Node-RED - Integração com GCDR Alarm Bundle

Guia para integração do Node-RED com o GCDR para download do bundle de regras de alarme.

## Endpoints Disponíveis

| Endpoint | Descrição |
|----------|-----------|
| `/customers/{id}/alarm-rules/bundle` | Bundle completo (com rulesByDeviceType) |
| `/customers/{id}/alarm-rules/bundle/simple` | **Bundle simplificado (recomendado)** |

## Visão Geral

O GCDR (Global Central Data Registry) fornece um endpoint para download do bundle de regras de alarme que contém todas as configurações necessárias para o processamento de alarmes no Node-RED.

## Credenciais de Acesso

| Propriedade | Valor |
|-------------|-------|
| **API Key** | `gcdr_cust_78ce6aacbcbe9dca63149aa54829b86911a222f1bb75f985219e8d49d2275d08` |
| **Customer ID** | `33333333-3333-3333-3333-333333333333` |
| **Tenant ID** | `11111111-1111-1111-1111-111111111111` |
| **Scopes** | `bundles:read`, `rules:read` |

## Endpoint Simplificado (Recomendado)

```
GET /customers/{customerId}/alarm-rules/bundle/simple
```

### URL Completa (Ambiente de Desenvolvimento)

```
http://localhost:3015/customers/33333333-3333-3333-3333-333333333333/alarm-rules/bundle/simple
```

### Vantagens do Bundle Simplificado

- Sem `rulesByDeviceType` (redundante)
- Inclui `centralId` e `slaveId` no deviceIndex
- Rules sem campos `enabled` e `tags`
- Payload menor e mais direto

---

## Endpoint Completo (Legacy)

```
GET /customers/{customerId}/alarm-rules/bundle
```

## Headers Obrigatórios

| Header | Valor | Descrição |
|--------|-------|-----------|
| `X-API-Key` | `gcdr_cust_...` | Chave de API para autenticação |
| `X-Tenant-Id` | `11111111-1111-1111-1111-111111111111` | Identificador do tenant |

## Exemplo com cURL

```bash
curl -X GET "http://localhost:3015/customers/33333333-3333-3333-3333-333333333333/alarm-rules/bundle" \
  -H "X-API-Key: gcdr_cust_78ce6aacbcbe9dca63149aa54829b86911a222f1bb75f985219e8d49d2275d08" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111"
```

## Parâmetros de Query (Opcionais)

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `domain` | string | Filtrar por domínio específico |
| `deviceType` | string | Filtrar por tipo de dispositivo (SENSOR, GATEWAY, METER, etc.) |
| `includeDisabled` | boolean | Incluir regras desabilitadas (default: false) |

### Exemplo com Filtros

```bash
curl -X GET "http://localhost:3015/customers/33333333-3333-3333-3333-333333333333/alarm-rules/bundle?deviceType=SENSOR&includeDisabled=false" \
  -H "X-API-Key: gcdr_cust_78ce6aacbcbe9dca63149aa54829b86911a222f1bb75f985219e8d49d2275d08" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111"
```

## Estrutura da Resposta (Bundle Simplificado)

```json
{
  "success": true,
  "data": {
    "versionId": "0d86a623e23c463d",
    "deviceIndex": {
      "11110001-0001-0001-0001-000000000001": {
        "deviceName": "Temperature Sensor SRV-01",
        "centralId": "eeee1111-1111-1111-1111-111111111111",
        "slaveId": 1,
        "ruleIds": [
          "aaaa0001-0001-0001-0001-000000000001",
          "aaaa0001-0001-0001-0001-000000000002"
        ]
      },
      "11110001-0001-0001-0001-000000000003": {
        "deviceName": "Power Meter SRV-01",
        "centralId": "eeee1111-1111-1111-1111-111111111111",
        "slaveId": 2,
        "ruleIds": [
          "aaaa0001-0001-0001-0001-000000000001",
          "aaaa0001-0001-0001-0001-000000000002"
        ]
      }
    },
    "rules": {
      "aaaa0001-0001-0001-0001-000000000001": {
        "id": "aaaa0001-0001-0001-0001-000000000001",
        "name": "High Temperature Alert",
        "value": 28,
        "duration": 300,
        "aggregation": "AVG",
        "offset": 0,
        "startAt": "00:00",
        "endAt": "23:59",
        "daysOfWeek": [0, 1, 2, 3, 4, 5, 6]
      },
      "aaaa0001-0001-0001-0001-000000000002": {
        "id": "aaaa0001-0001-0001-0001-000000000002",
        "name": "Low Temperature Alert",
        "value": 18,
        "duration": 300,
        "aggregation": "AVG",
        "offset": 0,
        "startAt": "00:00",
        "endAt": "23:59",
        "daysOfWeek": [0, 1, 2, 3, 4, 5, 6]
      },
      "aaaa0001-0001-0001-0001-000000000003": {
        "id": "aaaa0001-0001-0001-0001-000000000003",
        "name": "High Humidity Alert",
        "value": 60,
        "hysteresis": 5,
        "startAt": "00:00",
        "endAt": "23:59",
        "daysOfWeek": [0, 1, 2, 3, 4, 5, 6]
      }
    }
  }
}
```

**Nota**: Os metadados do bundle (version, signature, etc.) são enviados via HTTP Headers:
- `ETag`: Versão do bundle
- `X-Bundle-Version`: Versão do bundle
- `X-Bundle-Signature`: Assinatura HMAC-SHA256
- `X-Bundle-Rules-Count`: Quantidade de regras
- `X-Bundle-Devices-Count`: Quantidade de dispositivos

### Campos do Device Index

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `deviceName` | string | Nome do dispositivo |
| `centralId` | uuid | ID da central associada |
| `slaveId` | number | Modbus slave ID (1-247) |
| `ruleIds` | array | IDs das regras aplicáveis |

### Campos das Rules

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | ID da regra |
| `name` | string | Nome da regra |
| `value` | number | Valor de threshold |
| `valueHigh` | number | Valor alto (para BETWEEN/OUTSIDE) |
| `duration` | number | Duração em segundos |
| `hysteresis` | number | Valor de histerese |
| `aggregation` | string | Tipo de agregação (AVG, MIN, MAX, etc) |
| `offset` | number | Offset de calibração (apenas para temperature) |
| `startAt` | string | Hora de início (HH:mm) |
| `endAt` | string | Hora de fim (HH:mm) |
| `daysOfWeek` | array | Dias da semana (0=Dom, 6=Sáb) |

## Cache e ETag

O endpoint suporta cache condicional usando ETag:

### Headers de Resposta

| Header | Descrição |
|--------|-----------|
| `ETag` | Versão do bundle (usar para cache) |
| `Cache-Control` | Tempo de cache recomendado |
| `X-Bundle-Version` | Versão do bundle |
| `X-Bundle-Signature` | Assinatura HMAC-SHA256 para validação |

### Requisição Condicional

Para evitar downloads desnecessários, use o header `If-None-Match`:

```bash
curl -X GET "http://localhost:3015/customers/33333333-3333-3333-3333-333333333333/alarm-rules/bundle" \
  -H "X-API-Key: gcdr_cust_78ce6aacbcbe9dca63149aa54829b86911a222f1bb75f985219e8d49d2275d08" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -H "If-None-Match: \"00eb2f223a8de6cd\""
```

Se o bundle não mudou, retorna `304 Not Modified` (sem body).

## Configuração no Node-RED

### 1. HTTP Request Node

Configure um nó `http request` com:

- **Method**: GET
- **URL**: `http://gcdr-api:3015/customers/33333333-3333-3333-3333-333333333333/alarm-rules/bundle`
- **Headers**:
  ```
  X-API-Key: gcdr_cust_78ce6aacbcbe9dca63149aa54829b86911a222f1bb75f985219e8d49d2275d08
  X-Tenant-Id: 11111111-1111-1111-1111-111111111111
  ```

### 2. Inject Node (Polling)

Configure um nó `inject` para fazer polling periódico:

- **Repeat**: interval
- **Every**: 5 minutes (ou conforme necessidade)

### 3. Exemplo de Flow

```json
[
  {
    "id": "inject-bundle",
    "type": "inject",
    "repeat": "300",
    "payload": "",
    "payloadType": "date"
  },
  {
    "id": "http-gcdr-bundle",
    "type": "http request",
    "method": "GET",
    "url": "http://gcdr-api:3015/customers/33333333-3333-3333-3333-333333333333/alarm-rules/bundle",
    "headers": {
      "X-API-Key": "gcdr_cust_78ce6aacbcbe9dca63149aa54829b86911a222f1bb75f985219e8d49d2275d08",
      "X-Tenant-Id": "11111111-1111-1111-1111-111111111111"
    }
  },
  {
    "id": "parse-bundle",
    "type": "json"
  },
  {
    "id": "store-rules",
    "type": "change",
    "rules": [
      {
        "t": "set",
        "p": "alarmRules",
        "pt": "flow",
        "to": "payload.data.rules",
        "tot": "msg"
      }
    ]
  }
]
```

## Códigos de Erro

| Código | Descrição |
|--------|-----------|
| `200` | Sucesso - Bundle retornado |
| `304` | Not Modified - Bundle não mudou (usar cache local) |
| `401` | Unauthorized - API Key inválida ou expirada |
| `403` | Forbidden - API Key não tem scope necessário |
| `404` | Not Found - Customer não encontrado |
| `500` | Internal Error - Erro interno do servidor |

## Troubleshooting

### Erro: "Token de acesso não fornecido"

Verifique se o header `X-API-Key` está sendo enviado corretamente.

### Erro: "Invalid API key"

Verifique se a API Key está correta e não expirou.

### Erro: "API key does not have required scope"

A API Key precisa ter o scope `bundles:read`.

## Contato

Em caso de dúvidas ou problemas, entre em contato com a equipe de backend.

---

**Última atualização**: 2026-01-26
