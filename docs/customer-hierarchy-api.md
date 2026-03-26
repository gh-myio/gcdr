# Customer Hierarchy API

GCDR models customers as a tree. Every customer has an optional `parentCustomerId` and a materialized `path` string that encodes its full ancestry — enabling efficient subtree queries without recursive joins.

---

## Hierarchy structure

```
Tenant (11111111-...)
└── Supervia Estações  [HOLDING]  01c0179c-...
    ├── Supervia CASCADURA         [COMPANY]  25ca2e5c-...
    ├── Supervia DEODORO           [COMPANY]  4fd8700d-...
    ├── Supervia ENG. DE DENTRO    [COMPANY]  0193eac5-...
    ├── Supervia MARACANÃ          [COMPANY]  46260fbb-...
    └── Supervia MÉIER             [COMPANY]  b718abd9-...
```

---

## Endpoints

### GET /customers/:id/children

Returns the **direct children** of a customer (one level only).

**Request**
```
GET /api/v1/customers/01c0179c-08d5-4bb8-9a3c-743327ac63d1/children
X-API-Key: <key>
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "count": 5,
    "items": [
      {
        "id": "25ca2e5c-7caa-4196-ba18-a973815cb2f4",
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "parentCustomerId": "01c0179c-08d5-4bb8-9a3c-743327ac63d1",
        "path": "/11111111-1111-1111-1111-111111111111/01c0179c-08d5-4bb8-9a3c-743327ac63d1/25ca2e5c-7caa-4196-ba18-a973815cb2f4",
        "depth": 0,
        "externalId": "a0007b30-8433-11f0-a06d-e9509531b1d5",
        "name": "Supervia CASCADURA",
        "displayName": "Supervia CASCADURA",
        "code": "SUPERVIA-CASCADURA",
        "type": "COMPANY",
        "address": null,
        "settings": {
          "locale": "en-US",
          "currency": "USD",
          "timezone": "UTC",
          "inheritFromParent": true
        },
        "theme": {
          "primaryColor": "#3B82F6",
          "secondaryColor": "#1E40AF"
        },
        "metadata": {},
        "status": "ACTIVE",
        "createdAt": "2026-03-25T17:14:08.279Z",
        "updatedAt": "2026-03-25T18:10:34.418Z",
        "createdBy": "00000000-0000-0000-0000-000000000001",
        "updatedBy": "00000000-0000-0000-0000-000000000001",
        "version": 2
      }
    ]
  },
  "meta": {
    "requestId": "...",
    "timestamp": "2026-03-26T05:17:01.167Z"
  }
}
```

---

### GET /customers/:id/descendants

Returns **all descendants** of a customer at any depth, ordered by path.

**Request**
```
GET /api/v1/customers/01c0179c-08d5-4bb8-9a3c-743327ac63d1/descendants
X-API-Key: <key>
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "count": 5,
    "items": [
      {
        "id": "25ca2e5c-7caa-4196-ba18-a973815cb2f4",
        "name": "Supervia CASCADURA",
        "type": "COMPANY",
        "path": "/11111111-1111-1111-1111-111111111111/01c0179c-08d5-4bb8-9a3c-743327ac63d1/25ca2e5c-7caa-4196-ba18-a973815cb2f4",
        "status": "ACTIVE"
      },
      {
        "id": "4fd8700d-7a86-438b-9d45-5c05b97b2a88",
        "name": "Supervia DEODORO",
        "type": "COMPANY",
        "path": "/11111111-1111-1111-1111-111111111111/01c0179c-08d5-4bb8-9a3c-743327ac63d1/4fd8700d-7a86-438b-9d45-5c05b97b2a88",
        "status": "ACTIVE"
      },
      {
        "id": "0193eac5-68ff-443b-baed-3cd61a5e6c37",
        "name": "Supervia ENG. DE DENTRO",
        "type": "COMPANY",
        "path": "/11111111-1111-1111-1111-111111111111/01c0179c-08d5-4bb8-9a3c-743327ac63d1/0193eac5-68ff-443b-baed-3cd61a5e6c37",
        "status": "ACTIVE"
      },
      {
        "id": "46260fbb-89b6-4166-b81e-7bca0b0dc78e",
        "name": "Supervia MARACANÃ",
        "type": "COMPANY",
        "path": "/11111111-1111-1111-1111-111111111111/01c0179c-08d5-4bb8-9a3c-743327ac63d1/46260fbb-89b6-4166-b81e-7bca0b0dc78e",
        "status": "ACTIVE"
      },
      {
        "id": "b718abd9-617a-4618-bdee-7154513224bf",
        "name": "Supervia MÉIER",
        "type": "COMPANY",
        "path": "/11111111-1111-1111-1111-111111111111/01c0179c-08d5-4bb8-9a3c-743327ac63d1/b718abd9-617a-4618-bdee-7154513224bf",
        "status": "ACTIVE"
      }
    ]
  },
  "meta": {
    "requestId": "...",
    "timestamp": "2026-03-26T05:17:01.167Z"
  }
}
```

---

### GET /customers/:id/ancestors

Returns the **ordered path from root to the direct parent** of a customer.
Returns an empty array if the customer is already a root node.

**Request — root node (no ancestors)**
```
GET /api/v1/customers/01c0179c-08d5-4bb8-9a3c-743327ac63d1/ancestors
X-API-Key: <key>
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "items": [],
    "count": 0
  }
}
```

---

**Request — child node**
```
GET /api/v1/customers/25ca2e5c-7caa-4196-ba18-a973815cb2f4/ancestors
X-API-Key: <key>
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "count": 1,
    "items": [
      {
        "id": "01c0179c-08d5-4bb8-9a3c-743327ac63d1",
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "parentCustomerId": null,
        "path": "/11111111-1111-1111-1111-111111111111/01c0179c-08d5-4bb8-9a3c-743327ac63d1",
        "depth": 0,
        "externalId": "9022dc60-8200-11f0-a06d-e9509531b1d5",
        "name": "Supervia Estações",
        "displayName": "Supervia Estações",
        "code": "SUPERVIA-ESTACOES",
        "type": "HOLDING",
        "address": null,
        "settings": {
          "locale": "en-US",
          "currency": "USD",
          "timezone": "UTC",
          "inheritFromParent": true
        },
        "theme": null,
        "metadata": {},
        "status": "ACTIVE",
        "createdAt": "2026-03-25T17:23:25.129Z",
        "updatedAt": "2026-03-25T17:23:25.129Z",
        "createdBy": "00000000-0000-0000-0000-000000000001",
        "version": 1
      }
    ]
  },
  "meta": {
    "requestId": "...",
    "timestamp": "2026-03-26T05:17:01.686Z"
  }
}
```

---

## Customer object fields

| Field | Type | Description |
|---|---|---|
| `id` | uuid | Customer unique identifier |
| `tenantId` | uuid | Tenant this customer belongs to |
| `parentCustomerId` | uuid \| null | Direct parent; `null` for root nodes |
| `path` | string | Materialized path: `/tenantId/[...ancestors]/id` |
| `depth` | integer | Nesting level (0 = root) |
| `externalId` | string \| null | ID in an external system (e.g. ThingsBoard) |
| `name` | string | Internal name |
| `displayName` | string | Display name (UI label) |
| `code` | string | Unique slug within the tenant |
| `type` | enum | `ROOT`, `HOLDING`, `COMPANY`, `RESELLER`, `INDIVIDUAL` |
| `status` | enum | `ACTIVE`, `INACTIVE`, `SUSPENDED` |
| `settings` | object | Locale, currency, timezone — can inherit from parent |
| `theme` | object \| null | `primaryColor`, `secondaryColor` |
| `metadata` | object | Arbitrary key-value pairs |
| `version` | integer | Optimistic concurrency version |

---

## List by parentCustomerId

The standard list endpoint also supports filtering by parent:

```
GET /api/v1/customers?parentCustomerId=01c0179c-08d5-4bb8-9a3c-743327ac63d1
```

This is equivalent to `/children` but supports pagination, `status`, `type`, and `search` filters.

To query root customers (no parent):

```
GET /api/v1/customers?parentCustomerId=null
```
