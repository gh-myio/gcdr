# Guia: Buscar Device pelo ThingsBoard ID (externalId)

> Endpoint dedicado para a equipe do ThingsBoard buscar um device no GCDR
> a partir do ID interno do ThingsBoard (`externalId`).

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

| Parâmetro    | Tipo   | Local  | Descrição                                               |
|--------------|--------|--------|---------------------------------------------------------|
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
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "customerId": "22222222-2222-2222-2222-222222222222",
    "assetId": "33333333-3333-3333-3333-333333333333",
    "name": "Medidor-01",
    "serialNumber": "SN-0001",
    "type": "meter",
    "status": "active",
    "connectivityStatus": "online",
    "externalId": "<thingsboard-device-id>",
    "centralId": "9308af89-...",
    "slaveId": 1,
    "createdAt": "2024-01-15T10:00:00.000Z",
    "updatedAt": "2024-06-01T12:00:00.000Z"
  }
}
```

---

## Respostas de Erro

| Status | Código            | Quando ocorre                                          |
|--------|-------------------|--------------------------------------------------------|
| `400`  | `VALIDATION_ERROR`| `externalId` ausente na URL                            |
| `401`  | `UNAUTHORIZED`    | Token/API Key inválido ou ausente                      |
| `404`  | `NOT_FOUND`       | Nenhum device com esse `externalId` no tenant          |

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
Obtém o GCDR device ID (campo "id") e metadados
        │
        ▼
Usa o GCDR device ID para chamadas subsequentes
(enriquecimento de alarmes, regras, etc.)
```

---

## Notas

- O campo `externalId` é gravado no GCDR no momento do cadastro do device
  (campo `externalId` no `POST /api/v1/devices`).
- O índice `devices_external_id_idx` garante busca eficiente — não há overhead
  de full-scan mesmo com muitos devices por tenant.
- A rota `/external/:externalId` está registrada **antes** de `/:id` no router,
  então nunca há colisão com o endpoint de busca por UUID interno.
