# Devices — Frontend Search Guide

This document describes how to use the device listing endpoint with smart filters.

---

## Endpoint

```
GET /api/v1/devices
Authorization: Bearer <jwt>
```

> The same filters work on nested endpoints:
> - `GET /api/v1/assets/:assetId/devices`
> - `GET /api/v1/customers/:customerId/devices`

---

## Available Filters

### Smart full-text search

```
?search=<term>
```

Performs a **partial, case-insensitive** search simultaneously across:

| Field | Description |
|---|---|
| `name` | Technical name |
| `displayName` | Display name |
| `label` | Short label |
| `code` | Internal code |
| `serialNumber` | Serial number |
| `externalId` | External ID (e.g. ThingsBoard) |
| `identifier` | Integration identifier |
| `metadata` | JSON metadata content (text search) |

**Example:** `?search=elev` returns devices whose name, label, code or metadata contains "elev".

---

### Exact filters

| Query param | Type | Description |
|---|---|---|
| `customerId` | uuid | Filter by customer. **If omitted, returns devices from all customers in the tenant.** |
| `assetId` | uuid | Filter by asset |
| `centralId` | uuid | Filter by Modbus central/gateway |
| `slaveId` | number | Modbus slave ID of the device (1–247) |
| `deviceProfile` | string | Device profile (e.g. `"elevator"`, `"temp-sensor"`) |
| `identifier` | string | Integration unique identifier (exact match) |
| `ingestionId` | uuid | ID in the ingestion system |
| `ingestionGatewayId` | uuid | Ingestion gateway ID |
| `label` | string | Exact label match |
| `externalId` | string | Exact external ID match (ThingsBoard etc.) |
| `type` | enum | Device type |
| `status` | enum | `ACTIVE` \| `INACTIVE` \| `DELETED` |
| `connectivityStatus` | enum | `ONLINE` \| `OFFLINE` \| `UNKNOWN` |

---

### Pagination

| Param | Description | Default |
|---|---|---|
| `page` | Page number (1-based) | `1` |
| `pageSize` | Items per page | `20` |
| `cursor` | Numeric offset (alternative to `page`) | — |
| `limit` | Alternative to `pageSize` | `20` |

---

## Usage Examples

```bash
# Free text search across all tenant customers
GET /api/v1/devices?search=elevator

# Search within a specific customer
GET /api/v1/devices?customerId=e04046d4-baa4-44e9-a378-4dfebe4140f1&search=3F

# Filter by device profile + active status
GET /api/v1/devices?deviceProfile=elevator&status=ACTIVE

# All devices on a Modbus central
GET /api/v1/devices?centralId=e982edf9-edb1-4aa6-8a14-4782465ae5a3

# Specific device by slaveId within a central
GET /api/v1/devices?centralId=e982edf9-edb1-4aa6-8a14-4782465ae5a3&slaveId=85

# Online devices in an asset
GET /api/v1/devices?assetId=<uuid>&connectivityStatus=ONLINE

# Look up by external ID (ThingsBoard)
GET /api/v1/devices?externalId=tb-device-9048c4da

# Paginated results
GET /api/v1/devices?search=sensor&page=2&pageSize=50
```

---

## Response Payload

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "9048c4da-9c6e-429e-a214-2fc0bf6fde06",
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "assetId": "aaa00001-0001-0001-0001-000000000003",
        "customerId": "e04046d4-baa4-44e9-a378-4dfebe4140f1",

        "name": "3F ELEV. SCMAL2ACEL2",
        "displayName": "Elevator 3rd Floor - Access 2",
        "code": "ELEV-3F-AC2",
        "label": "elevator-3f",
        "type": "SENSOR",
        "description": "Elevator controller via Modbus",
        "serialNumber": "SN-00123456",
        "externalId": "tb-device-9048c4da",

        "connectivityStatus": "ONLINE",
        "status": "ACTIVE",

        "specs": {
          "manufacturer": "WEG",
          "model": "CFW500",
          "firmwareVersion": "3.2.1"
        },
        "telemetryConfig": {
          "interval": 30,
          "unit": "seconds"
        },
        "credentials": {
          "type": "ACCESS_TOKEN",
          "token": "..."
        },

        "tags": ["elevator", "3f", "modbus"],
        "metadata": {
          "floor": 3,
          "capacity_kg": 750
        },
        "attributes": {},

        "slaveId": 85,
        "centralId": "e982edf9-edb1-4aa6-8a14-4782465ae5a3",
        "identifier": "moxuara-elev-3f-ac2",
        "deviceProfile": "elevator",
        "deviceType": "ELEVATOR_CONTROLLER",
        "ingestionId": "550e8400-e29b-41d4-a716-446655440000",
        "ingestionGatewayId": "660e8400-e29b-41d4-a716-446655440001",

        "lastActivityTime": "2026-03-09T21:45:00.000Z",
        "lastAlarmTime": "2026-03-08T14:22:00.000Z",
        "lastConnectedAt": "2026-03-09T20:00:00.000Z",
        "lastDisconnectedAt": "2026-03-09T19:55:00.000Z",

        "createdAt": "2025-01-15T10:00:00.000Z",
        "updatedAt": "2026-03-09T20:00:00.000Z",
        "createdBy": "00000000-0000-0000-0000-000000000001",
        "version": 5
      }
    ],
    "pagination": {
      "total": 87,
      "totalPages": 5,
      "hasMore": true,
      "nextCursor": "20"
    }
  },
  "meta": {
    "requestId": "c3d4e5f6-...",
    "timestamp": "2026-03-09T22:00:00.000Z"
  }
}
```

---

## Optional Fields

These fields are omitted from the response when they have no value (`undefined`):

`code`, `label`, `description`, `externalId`, `slaveId`, `centralId`, `identifier`, `deviceProfile`, `deviceType`, `ingestionId`, `ingestionGatewayId`, `lastActivityTime`, `lastAlarmTime`, `lastConnectedAt`, `lastDisconnectedAt`, `createdBy`, `updatedBy`

---

## Frontend Usage Notes

- **Free-text search box** → use `search`. A single field covers name, label, code, serial number, external ID, and metadata.
- **Sidebar / panel filters** → use exact filters (`deviceProfile`, `connectivityStatus`, `status`, etc.) — more efficient as they use database indexes.
- **Combining filters** → `search` and exact filters can be used together. E.g. search for "elev" only among ONLINE devices of a specific customer.
- **Without `customerId`** → returns devices from all customers visible to the JWT token. Useful for global admin screens.
- **Pagination** → prefer `page` + `pageSize` for numeric pagination UIs. Use `cursor` + `limit` for infinite scroll.
