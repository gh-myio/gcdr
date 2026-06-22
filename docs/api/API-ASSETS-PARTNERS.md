# API Reference: Assets & Partners

## Assets API

Base URL: `/assets`

### List Assets

```http
GET /assets?customerId=xxx&type=BUILDING&limit=20&cursor=xxx
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| customerId | string (UUID) | No | Filter by customer |
| parentAssetId | string (UUID) | No | Filter by parent asset |
| type | string | No | Filter by type: `BUILDING`, `FLOOR`, `ROOM`, `EQUIPMENT`, `ZONE`, `OTHER` |
| status | string | No | Filter by status: `ACTIVE`, `INACTIVE` |
| limit | number | No | Max items per page (default: 20) |
| cursor | string | No | Pagination cursor |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "tenantId": "tenant-123",
        "customerId": "77777777-7777-7777-7777-777777777777",
        "parentAssetId": null,
        "name": "Main Building",
        "displayName": "Edificio Principal",
        "code": "BLD-001",
        "type": "BUILDING",
        "description": "Main corporate building",
        "location": {
          "address": "123 Main St",
          "city": "Sao Paulo",
          "state": "SP",
          "country": "Brazil",
          "coordinates": { "lat": -23.5505, "lng": -46.6333 }
        },
        "specs": {
          "area": 5000,
          "capacity": 500
        },
        "tags": ["corporate", "headquarters"],
        "status": "ACTIVE",
        "createdAt": "2024-01-15T10:00:00Z",
        "updatedAt": "2024-01-15T10:00:00Z"
      }
    ],
    "nextCursor": "eyJpZCI6Inh4eCJ9",
    "hasMore": true
  }
}
```

---

### Get Asset by ID

```http
GET /assets/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "tenantId": "tenant-123",
    "customerId": "77777777-7777-7777-7777-777777777777",
    "parentAssetId": null,
    "name": "Main Building",
    "type": "BUILDING",
    "status": "ACTIVE",
    ...
  }
}
```

---

### Create Asset

```http
POST /assets
```

**Request Body:**
```json
{
  "customerId": "77777777-7777-7777-7777-777777777777",
  "parentAssetId": null,
  "name": "Floor 1",
  "displayName": "Primeiro Andar",
  "code": "FLR-001",
  "type": "FLOOR",
  "description": "First floor with reception",
  "location": {
    "floor": "1",
    "zone": "A"
  },
  "specs": {
    "area": 1000,
    "capacity": 100
  },
  "tags": ["reception", "public-access"]
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "generated-uuid",
    "tenantId": "tenant-123",
    "customerId": "77777777-7777-7777-7777-777777777777",
    "name": "Floor 1",
    "type": "FLOOR",
    "status": "ACTIVE",
    "createdAt": "2024-01-15T10:00:00Z",
    ...
  }
}
```

---

### Update Asset

```http
PUT /assets/:id
```

**Request Body:**
```json
{
  "name": "Floor 1 - Updated",
  "description": "Updated description",
  "status": "INACTIVE"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Floor 1 - Updated",
    "status": "INACTIVE",
    ...
  }
}
```

---

### Delete Asset

```http
DELETE /assets/:id
```

**Response (204 No Content):** Empty body

**Error (400 Bad Request):** Cannot delete asset with children
```json
{
  "success": false,
  "error": {
    "message": "Cannot delete asset with children. Move or delete children first.",
    "code": "VALIDATION_ERROR"
  }
}
```

---

### Move Asset

```http
POST /assets/:id/move
```

**Request Body:**
```json
{
  "newParentAssetId": "new-parent-uuid",
  "newCustomerId": "optional-new-customer-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "parentAssetId": "new-parent-uuid",
    ...
  }
}
```

---

### Get Asset Children

```http
GET /assets/:id/children
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "child-uuid-1",
      "name": "Room 101",
      "type": "ROOM",
      "parentAssetId": "parent-uuid",
      ...
    },
    {
      "id": "child-uuid-2",
      "name": "Room 102",
      "type": "ROOM",
      ...
    }
  ]
}
```

---

### Get Asset Ancestors

```http
GET /assets/:id/ancestors
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "building-uuid",
      "name": "Main Building",
      "type": "BUILDING"
    },
    {
      "id": "floor-uuid",
      "name": "Floor 1",
      "type": "FLOOR"
    }
  ]
}
```

---

### Get Asset Descendants

```http
GET /assets/:id/descendants?maxDepth=3
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| maxDepth | number | No | Maximum depth to traverse |

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": "floor-1", "name": "Floor 1", "type": "FLOOR" },
    { "id": "room-101", "name": "Room 101", "type": "ROOM" },
    { "id": "room-102", "name": "Room 102", "type": "ROOM" }
  ]
}
```

---

### Get Asset Tree

```http
GET /assets/tree?customerId=xxx&rootAssetId=xxx
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| customerId | string (UUID) | No | Filter by customer |
| rootAssetId | string (UUID) | No | Start tree from specific asset |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "building-uuid",
      "name": "Main Building",
      "type": "BUILDING",
      "children": [
        {
          "id": "floor-uuid",
          "name": "Floor 1",
          "type": "FLOOR",
          "children": [
            {
              "id": "room-uuid",
              "name": "Room 101",
              "type": "ROOM",
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Partners API

Base URL: `/partners`

### List Partners

```http
GET /partners?status=ACTIVE&limit=20&cursor=xxx
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| status | string | No | Filter by status: `PENDING`, `APPROVED`, `ACTIVE`, `SUSPENDED`, `REJECTED` |
| limit | number | No | Max items per page |
| cursor | string | No | Pagination cursor |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "partner-uuid",
        "tenantId": "tenant-123",
        "status": "ACTIVE",
        "companyName": "Acme Corp",
        "companyWebsite": "https://acme.com",
        "companyDescription": "IoT solutions provider",
        "industry": "Technology",
        "country": "Brazil",
        "contactName": "John Doe",
        "contactEmail": "john@acme.com",
        "technicalContactEmail": "tech@acme.com",
        "scopes": ["devices:read", "telemetry:read"],
        "rateLimits": {
          "perMinute": 100,
          "perDay": 10000,
          "monthly": 100000
        },
        "createdAt": "2024-01-15T10:00:00Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

---

### Get Partner by ID

```http
GET /partners/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "partner-uuid",
    "status": "ACTIVE",
    "companyName": "Acme Corp",
    ...
  }
}
```

---

### Register Partner

```http
POST /partners
```

**Request Body:**
```json
{
  "companyName": "Acme Corp",
  "companyWebsite": "https://acme.com",
  "companyDescription": "We provide IoT solutions for smart buildings",
  "industry": "Technology",
  "country": "Brazil",
  "contactName": "John Doe",
  "contactEmail": "john@acme.com",
  "contactPhone": "+55 11 99999-9999",
  "technicalContactEmail": "tech@acme.com",
  "intendedUse": "We want to integrate our BMS system with your platform",
  "requestedScopes": ["devices:read", "telemetry:read", "alarms:read"]
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "generated-uuid",
    "status": "PENDING",
    "companyName": "Acme Corp",
    ...
  }
}
```

---

### Update Partner

```http
PUT /partners/:id
```

**Request Body:**
```json
{
  "companyName": "Acme Corporation",
  "contactPhone": "+55 11 88888-8888"
}
```

---

### Approve Partner

```http
POST /partners/:id/approve
```

**Request Body:**
```json
{
  "scopes": ["devices:read", "telemetry:read", "alarms:read"],
  "rateLimitPerMinute": 100,
  "rateLimitPerDay": 10000,
  "monthlyQuota": 100000
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "partner-uuid",
    "status": "APPROVED",
    "scopes": ["devices:read", "telemetry:read", "alarms:read"],
    ...
  }
}
```

---

### Reject Partner

```http
POST /partners/:id/reject
```

**Request Body:**
```json
{
  "reason": "Insufficient information provided about intended use case"
}
```

---

### Suspend Partner

```http
POST /partners/:id/suspend
```

**Request Body:**
```json
{
  "reason": "Violation of terms of service"
}
```

---

### Activate Partner

```http
POST /partners/:id/activate
```

**Request Body:** Empty

---

## Partner API Keys

### Create API Key

```http
POST /partners/:id/api-keys
```

**Request Body:**
```json
{
  "name": "Production API Key",
  "scopes": ["devices:read", "telemetry:read"],
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "partner": { ... },
    "apiKey": "gcdr_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "message": "Store this API key securely - it will not be shown again"
  }
}
```

---

### List API Keys

```http
GET /partners/:id/api-keys
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "key-uuid",
      "name": "Production API Key",
      "keyPrefix": "gcdr_liv",
      "scopes": ["devices:read", "telemetry:read"],
      "status": "ACTIVE",
      "createdAt": "2024-01-15T10:00:00Z",
      "expiresAt": "2025-12-31T23:59:59Z",
      "lastUsedAt": "2024-01-20T15:30:00Z"
    }
  ]
}
```

---

### Revoke API Key

```http
DELETE /partners/:id/api-keys/:keyId
```

**Response (204 No Content):** Empty body

---

### Rotate API Key

```http
POST /partners/:id/api-keys/:keyId/rotate
```

**Response:**
```json
{
  "success": true,
  "data": {
    "partner": { ... },
    "newApiKey": "gcdr_live_newkey123456789...",
    "message": "Store this new API key securely - it will not be shown again"
  }
}
```

---

## Partner OAuth Clients

### Create OAuth Client

```http
POST /partners/:id/oauth-clients
```

**Request Body:**
```json
{
  "name": "My OAuth App",
  "redirectUris": ["https://myapp.com/callback"],
  "scopes": ["devices:read", "telemetry:read"],
  "grantTypes": ["client_credentials"]
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "partner": { ... },
    "clientId": "gcdr_abc123xyz",
    "clientSecret": "gcdr_secret_longsecretstring...",
    "message": "Store the client secret securely - it will not be shown again"
  }
}
```

---

### List OAuth Clients

```http
GET /partners/:id/oauth-clients
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "clientId": "gcdr_abc123xyz",
      "name": "My OAuth App",
      "redirectUris": ["https://myapp.com/callback"],
      "scopes": ["devices:read", "telemetry:read"],
      "grantTypes": ["client_credentials"],
      "status": "ACTIVE",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### Revoke OAuth Client

```http
DELETE /partners/:id/oauth-clients/:clientId
```

**Response (204 No Content):** Empty body

---

## Partner Webhooks

### Create Webhook

```http
POST /partners/:id/webhooks
```

**Request Body:**
```json
{
  "url": "https://myapp.com/webhooks/gcdr",
  "events": ["alarm.created", "alarm.acknowledged", "device.offline"],
  "secret": "optional-custom-secret-min-16-chars",
  "enabled": true
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "webhook": {
      "id": "webhook-uuid",
      "url": "https://myapp.com/webhooks/gcdr",
      "events": ["alarm.created", "alarm.acknowledged", "device.offline"],
      "enabled": true,
      "createdAt": "2024-01-15T10:00:00Z"
    },
    "secret": "whsec_generatedsecret...",
    "message": "Store this webhook secret securely - it will not be shown again"
  }
}
```

---

### List Webhooks

```http
GET /partners/:id/webhooks
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "webhook-uuid",
      "url": "https://myapp.com/webhooks/gcdr",
      "events": ["alarm.created", "alarm.acknowledged"],
      "enabled": true,
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-15T10:00:00Z",
      "failureCount": 0,
      "lastDeliveryAt": "2024-01-20T15:30:00Z",
      "lastDeliveryStatus": "success"
    }
  ]
}
```

---

### Update Webhook

```http
PUT /partners/:id/webhooks/:webhookId
```

**Request Body:**
```json
{
  "url": "https://newurl.com/webhooks",
  "events": ["alarm.created"],
  "enabled": false
}
```

---

### Delete Webhook

```http
DELETE /partners/:id/webhooks/:webhookId
```

**Response (204 No Content):** Empty body

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": {
    "message": "Description of the error",
    "code": "ERROR_CODE",
    "details": { ... }
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2024-01-15T10:00:00Z"
  }
}
```

**Common Error Codes:**
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `CONFLICT_ERROR` | 409 | Resource already exists |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Insufficient permissions |
