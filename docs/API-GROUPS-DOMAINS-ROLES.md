# API Reference: Groups, Domains & Roles

## Domains API (Metrics for Rules)

Base URL: `/domains`

### Get All Domain Definitions

```http
GET /domains
```

**Response:**
```json
{
  "success": true,
  "data": {
    "metrics": [...],
    "operators": [...],
    "aggregations": [...],
    "priorities": [...]
  }
}
```

---

### List Metrics

```http
GET /domains/metrics?category=continuous
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| category | string | No | Filter: `continuous` or `discrete` |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "temperature",
      "name": "Temperature",
      "description": "Temperature sensor reading",
      "category": "continuous",
      "unit": "°C",
      "defaultAggregation": "AVG"
    },
    {
      "id": "humidity",
      "name": "Humidity",
      "description": "Relative humidity sensor reading",
      "category": "continuous",
      "unit": "%",
      "defaultAggregation": "AVG"
    },
    {
      "id": "instantaneous_power",
      "name": "Instantaneous Power",
      "description": "Current power consumption",
      "category": "continuous",
      "unit": "W",
      "defaultAggregation": "AVG"
    },
    {
      "id": "energy_consumption",
      "name": "Energy Consumption",
      "description": "Total energy consumed",
      "category": "continuous",
      "unit": "Wh",
      "defaultAggregation": "SUM"
    },
    {
      "id": "presence_sensor",
      "name": "Presence Sensor",
      "description": "Presence detection sensor",
      "category": "discrete",
      "defaultAggregation": "LAST",
      "values": [
        { "value": 0, "label": "Not Detected" },
        { "value": 1, "label": "Detected" }
      ]
    }
  ]
}
```

---

### Get Specific Metric

```http
GET /domains/metrics/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "temperature",
    "name": "Temperature",
    "description": "Temperature sensor reading",
    "category": "continuous",
    "unit": "°C",
    "defaultAggregation": "AVG",
    "applicableOperators": [
      { "id": "GT", "name": "Greater Than", "requiresValueHigh": false },
      { "id": "LT", "name": "Less Than", "requiresValueHigh": false },
      { "id": "BETWEEN", "name": "Between", "requiresValueHigh": true }
    ]
  }
}
```

---

### List Operators

```http
GET /domains/operators
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "GT",
      "name": "Greater Than",
      "description": "Value is greater than threshold",
      "requiresValueHigh": false,
      "applicableTo": ["continuous"]
    },
    {
      "id": "BETWEEN",
      "name": "Between",
      "description": "Value is between value and valueHigh (inclusive)",
      "requiresValueHigh": true,
      "applicableTo": ["continuous"]
    },
    {
      "id": "EQ",
      "name": "Equal",
      "description": "Value equals threshold",
      "requiresValueHigh": false,
      "applicableTo": ["continuous", "discrete"]
    }
  ]
}
```

---

### List Aggregations

```http
GET /domains/aggregations
```

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": "AVG", "name": "Average", "description": "Average of values in the window" },
    { "id": "MIN", "name": "Minimum", "description": "Minimum value in the window" },
    { "id": "MAX", "name": "Maximum", "description": "Maximum value in the window" },
    { "id": "SUM", "name": "Sum", "description": "Sum of values in the window" },
    { "id": "COUNT", "name": "Count", "description": "Count of values in the window" },
    { "id": "LAST", "name": "Last", "description": "Most recent value" }
  ]
}
```

---

### List Priorities

```http
GET /domains/priorities
```

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": "LOW", "name": "Low", "level": 1, "color": "#4CAF50" },
    { "id": "MEDIUM", "name": "Medium", "level": 2, "color": "#FF9800" },
    { "id": "HIGH", "name": "High", "level": 3, "color": "#F44336" },
    { "id": "CRITICAL", "name": "Critical", "level": 4, "color": "#9C27B0" }
  ]
}
```

---

## Groups API

Base URL: `/groups`

### List Groups

```http
GET /groups?customerId=xxx&type=USER&purpose=NOTIFICATION&limit=20
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| customerId | string (UUID) | No | Filter by customer |
| type | string | No | `USER`, `DEVICE`, `ASSET`, `MIXED` |
| purpose | string | No | `NOTIFICATION`, `ESCALATION`, `ACCESS_CONTROL`, `REPORTING`, `MAINTENANCE`, `MONITORING`, `CUSTOM` |
| status | string | No | `ACTIVE`, `INACTIVE` |
| parentGroupId | string (UUID) | No | Filter by parent group |
| tag | string | No | Filter by tag |
| search | string | No | Search in name/description |
| limit | number | No | Max items (default: 20, max: 100) |
| cursor | string | No | Pagination cursor |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "group-uuid",
        "name": "Operations Team",
        "displayName": "Equipe de Operações",
        "code": "OPS-TEAM",
        "type": "USER",
        "purposes": ["NOTIFICATION", "ESCALATION"],
        "memberCount": 5,
        "status": "ACTIVE",
        "createdAt": "2024-01-15T10:00:00Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

---

### Get Group by ID

```http
GET /groups/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "group-uuid",
    "tenantId": "tenant-123",
    "customerId": "customer-uuid",
    "name": "Operations Team",
    "displayName": "Equipe de Operações",
    "description": "Team responsible for daily operations",
    "code": "OPS-TEAM",
    "type": "USER",
    "purposes": ["NOTIFICATION", "ESCALATION"],
    "members": [
      { "id": "user-1", "type": "USER", "metadata": {} },
      { "id": "user-2", "type": "USER", "metadata": {} }
    ],
    "parentGroupId": null,
    "notificationSettings": {
      "channels": [
        { "type": "EMAIL", "enabled": true },
        { "type": "SMS", "enabled": false }
      ]
    },
    "tags": ["operations", "tier-1"],
    "status": "ACTIVE",
    "createdAt": "2024-01-15T10:00:00Z"
  }
}
```

---

### Create Group

```http
POST /groups
```

**Request Body:**
```json
{
  "customerId": "customer-uuid",
  "name": "Maintenance Team",
  "displayName": "Equipe de Manutenção",
  "description": "Team for maintenance tasks",
  "code": "MAINT-TEAM",
  "type": "USER",
  "purposes": ["NOTIFICATION", "MAINTENANCE"],
  "members": [
    { "id": "user-uuid-1", "type": "USER" },
    { "id": "user-uuid-2", "type": "USER" }
  ],
  "notificationSettings": {
    "channels": [
      { "type": "EMAIL", "enabled": true },
      { "type": "SLACK", "enabled": true, "config": { "channel": "#maintenance" } }
    ]
  },
  "tags": ["maintenance"]
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "new-group-uuid",
    "name": "Maintenance Team",
    ...
  }
}
```

---

### Update Group

```http
PUT /groups/:id
```

**Request Body:**
```json
{
  "name": "Maintenance Team - Updated",
  "status": "INACTIVE"
}
```

---

### Delete Group

```http
DELETE /groups/:id?soft=true
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| soft | boolean | No | If `true`, soft delete (mark inactive). Default: hard delete |

**Response (204 No Content):** Empty body

---

### Add Members to Group

```http
POST /groups/:id/members
```

**Request Body:**
```json
{
  "members": [
    { "id": "user-uuid-3", "type": "USER" },
    { "id": "device-uuid-1", "type": "DEVICE" }
  ]
}
```

---

### Remove Members from Group

```http
DELETE /groups/:id/members
```

**Request Body:**
```json
{
  "memberIds": ["user-uuid-3", "device-uuid-1"]
}
```

---

### Get Group Children

```http
GET /groups/:id/children
```

---

### Get Group Descendants

```http
GET /groups/:id/descendants
```

---

### Move Group

```http
POST /groups/:id/move
```

**Request Body:**
```json
{
  "newParentGroupId": "parent-group-uuid"
}
```

Set `newParentGroupId` to `null` to move to root.

---

### Get Groups by Member

```http
GET /groups/by-member/:memberId?memberType=USER
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| memberType | string | Yes | `USER`, `DEVICE`, or `ASSET` |

---

## Roles API

Base URL: `/authorization`

### List Roles

```http
GET /authorization/roles?riskLevel=HIGH&isSystem=false&limit=20
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| riskLevel | string | No | Filter by risk level |
| isSystem | boolean | No | Filter system roles |
| limit | number | No | Max items per page |
| cursor | string | No | Pagination cursor |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "role-uuid",
        "key": "admin",
        "name": "Administrator",
        "description": "Full system access",
        "permissions": ["*"],
        "riskLevel": "CRITICAL",
        "isSystem": true,
        "createdAt": "2024-01-01T00:00:00Z"
      },
      {
        "id": "role-uuid-2",
        "key": "operator",
        "name": "Operator",
        "description": "Operational access",
        "permissions": ["devices:read", "alarms:read", "alarms:acknowledge"],
        "riskLevel": "LOW",
        "isSystem": false
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

---

### Get User Roles

```http
GET /authorization/users/:userId/roles
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user-uuid",
    "assignments": [
      {
        "id": "assignment-uuid",
        "roleKey": "operator",
        "scope": "customer:77777777-7777-7777-7777-777777777777",
        "status": "ACTIVE",
        "grantedAt": "2024-01-15T10:00:00Z",
        "grantedBy": "admin-user-uuid"
      }
    ],
    "effectivePermissions": ["devices:read", "alarms:read", "alarms:acknowledge"],
    "deniedPatterns": [],
    "count": 1
  }
}
```

---

### Assign Role

```http
POST /authorization/assignments
```

**Request Body:**
```json
{
  "userId": "user-uuid",
  "roleKey": "operator",
  "scope": "customer:77777777-7777-7777-7777-777777777777",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

---

### Revoke Role Assignment

```http
DELETE /authorization/assignments/:assignmentId
```

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
