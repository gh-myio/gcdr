# Guia: Buscar Device pelo ThingsBoard ID (externalId)

> Endpoint dedicado para a equipe do ThingsBoard buscar um device no GCDR
> a partir do ID interno do ThingsBoard (`externalId`).
>
> O payload de retorno inclui os dados completos do device **e** os dados
> do asset e customer ao qual ele pertence, além das regras de alarme
> diretamente associadas a ele.

---

## Endpoint

```
GET /api/v1/devices/external/{externalId}
```

### Autenticação

O router `/devices` usa **hybrid auth** — aceita tanto JWT Bearer quanto API Key:

| Método         | Header                                      |
|----------------|---------------------------------------------|
| JWT Bearer     | `Authorization: Bearer <token>`             |
| API Key        | `X-API-Key: <key>` + `X-Tenant-ID: <uuid>` |

Para integrações server-to-server do ThingsBoard recomenda-se **API Key** com
scope `devices:write` (o scope mínimo exigido pelo middleware do router).

---

## Parâmetros

| Parâmetro    | Tipo   | Local  | Descrição                                                |
|--------------|--------|--------|----------------------------------------------------------|
| `externalId` | string | path   | ID do device no ThingsBoard (campo `externalId` no GCDR) |

---

## Exemplo de Requisição

```bash
curl -X GET \
  "https://<gcdr-host>/api/v1/devices/external/<thingsboard-device-id>" \
  -H "X-API-Key: <api-key>" \
  -H "X-Tenant-ID: <tenant-uuid>"
```

---

## Resposta de Sucesso — `200 OK`

```json
{
  "success": true,
  "requestId": "req-abc123",
  "data": {
    "device": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "tenantId": "11111111-1111-1111-1111-111111111111",
      "customerId": "22222222-2222-2222-2222-222222222222",
      "assetId": "33333333-3333-3333-3333-333333333333",
      "name": "Medidor-01",
      "displayName": "Medidor Principal",
      "label": "Bloco A",
      "type": "meter",
      "serialNumber": "SN-0001",
      "externalId": "<thingsboard-device-id>",
      "centralId": "9308af89-...",
      "slaveId": 1,
      "connectivityStatus": "online",
      "lastConnectedAt": "2025-02-21T10:00:00.000Z",
      "status": "active",
      "specs": {
        "manufacturer": "Acme",
        "model": "M100",
        "protocol": "modbus"
      },
      "telemetryConfig": {
        "reportingInterval": 60,
        "telemetryKeys": ["energy_consumption", "instantaneous_power"]
      },
      "tags": ["bloco-a", "energia"],
      "metadata": {},
      "attributes": {},
      "createdAt": "2024-01-15T10:00:00.000Z",
      "updatedAt": "2025-02-21T08:00:00.000Z"
    },
    "asset": {
      "id": "33333333-3333-3333-3333-333333333333",
      "name": "Bloco A",
      "displayName": "Bloco A — Edifício Central",
      "code": "BLOCO-A",
      "type": "building",
      "status": "active"
    },
    "customer": {
      "id": "22222222-2222-2222-2222-222222222222",
      "name": "Empresa XYZ",
      "displayName": "Empresa XYZ Ltda.",
      "code": "XYZ",
      "type": "corporate",
      "status": "active"
    },
    "rules": [
      {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "name": "Alerta consumo alto",
        "type": "ALARM_THRESHOLD",
        "priority": "HIGH",
        "enabled": true,
        "status": "active",
        "scope": {
          "type": "DEVICE",
          "entityId": "550e8400-e29b-41d4-a716-446655440000"
        },
        "alarmConfig": {
          "metricDomain": "energy_consumption",
          "operator": "GT",
          "threshold": 5000,
          "aggregation": "SUM",
          "windowSeconds": 3600
        },
        "notificationChannels": [
          { "type": "email", "recipients": ["ops@empresa.com"] }
        ],
        "tags": ["energia"],
        "lastTriggeredAt": "2025-02-20T14:30:00.000Z",
        "triggerCount": 12
      }
    ]
  }
}
```

### Campos de `asset` e `customer`

`null` quando o device não estiver associado a um asset ou customer.

### Campo `rules`

Lista de regras com **scope `DEVICE`** diretamente vinculadas a este device.
Pode ser vazia (`[]`) se nenhuma regra de escopo DEVICE estiver cadastrada.

> Regras de escopo `GLOBAL`, `CUSTOMER` ou `ASSET` **não** são retornadas aqui —
> elas se aplicam indiretamente via hierarquia, mas não fazem parte deste payload.

---

## Respostas de Erro

| Status | Código            | Quando ocorre                                   |
|--------|-------------------|-------------------------------------------------|
| `400`  | `VALIDATION_ERROR`| `externalId` ausente na URL                     |
| `401`  | `UNAUTHORIZED`    | Token/API Key inválido ou ausente               |
| `404`  | `NOT_FOUND`       | Nenhum device com esse `externalId` no tenant   |

### Exemplo 404

```json
{
  "success": false,
  "requestId": "req-abc123",
  "error": {
    "code": "NOT_FOUND",
    "message": "Device with external ID <thingsboard-device-id> not found"
  }
}
```

---

## Fluxo típico de integração ThingsBoard → GCDR

```
ThingsBoard recebe telemetria de um device
        │
        ▼
Usa o deviceId interno do TB como externalId
        │
        ▼
GET /api/v1/devices/external/{tb-device-id}
        │
        ▼
Obtém numa única chamada:
  • device  → id, tipo, serial, conectividade, atributos
  • asset   → nome, tipo, código do local físico
  • customer→ nome, código do cliente dono do device
  • rules   → regras de alarme ativas para esse device
        │
        ▼
Usa esses dados para enriquecer alarmes,
notificações e dashboards no ThingsBoard
```

---

## Notas

- O campo `externalId` é gravado no GCDR no momento do cadastro do device
  (campo `externalId` no `POST /api/v1/devices`).
- O índice `devices_external_id_idx` garante busca eficiente — não há overhead
  de full-scan mesmo com muitos devices por tenant.
- A rota `/external/:externalId` está registrada **antes** de `/:id` no router,
  então nunca há colisão com o endpoint de busca por UUID interno.
- As três buscas paralelas (asset, customer, rules) são feitas com `Promise.all`,
  minimizando latência total da resposta.
