# GCDR — RBAC Access Control

## Overview

GCDR uses a **Role-Based Access Control (RBAC)** system with three core layers:

```
User  ──► RoleAssignment (with scope)  ──► Role  ──► Policies  ──► Permissions
```

- **Policies** define which permissions are allowed or explicitly denied.
- **Roles** group one or more policies and are assigned to users.
- **Assignments** bind a user to a role within a specific **scope** (e.g., a customer, a subtree, or `*` for global access).

All access decisions use a **deny-wins** rule: if any matched policy has the permission in its `deny` list, access is denied regardless of any `allow` entry.

---

## Permission Format

```
domain.function.action
```

Wildcards are supported at any level:

| Pattern         | Matches                                      |
|-----------------|----------------------------------------------|
| `*.*.*`         | Everything                                   |
| `*.*.read`      | Any domain, any function, read only          |
| `alarms.rules.*`| All actions on alarm rules                   |
| `alarms.*.*`    | Everything in the alarms domain              |
| `alarms.rules.delete` | Only that exact permission            |

**Examples from the catalog:**

```
devices.list.read           devices.telemetry.read      devices.commands.execute
assets.list.read            assets.details.read
alarms.rules.create         alarms.rules.delete         alarms.history.read
identity.users.invite       identity.assignments.revoke identity.users.delete
customers.apikeys.create    customers.hierarchy.delete
energy.settings.update      energy.alerts.read
reports.energy.export       analytics.dashboards.read
integrations.webhooks.create
```

---

## Scope Format

Scopes define the boundary within which an assignment is valid.

| Scope value                            | Meaning                                  |
|----------------------------------------|------------------------------------------|
| `*`                                    | Global — matches everything              |
| `customer:33333333-3333-...`           | A specific customer                      |
| `customer:33333333-.../asset:abc-...`  | A specific asset within a customer       |
| `customer:*`                           | Any customer (wildcard)                  |

**Hierarchical matching**: an assignment scoped to `customer:X` also covers `customer:X/asset:Y`.

---

## Data Model

### Policy

```typescript
{
  id: string;           // UUID
  key: string;          // e.g. "policy:alarm-management"
  displayName: string;
  description: string;
  allow: string[];      // permission patterns granted
  deny: string[];       // permission patterns blocked (wins over allow)
  conditions?: {
    requiresMFA?: boolean;
    onlyBusinessHours?: boolean;
    allowedDeviceTypes?: string[];
    ipAllowlist?: string[];
    maxSessionDuration?: number;   // milliseconds
  };
  riskLevel: "low" | "medium" | "high" | "critical";
  isSystem: boolean;    // true = immutable, cannot be modified or deleted
}
```

### Role

```typescript
{
  id: string;           // UUID
  key: string;          // e.g. "role:customer-admin"
  displayName: string;
  description: string;
  policies: string[];   // list of policy keys
  tags: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  isSystem: boolean;    // true = immutable
}
```

### RoleAssignment

```typescript
{
  id: string;           // UUID
  userId: string;
  roleKey: string;      // e.g. "role:technician"
  scope: string;        // e.g. "customer:33333333-..."
  status: "active" | "inactive" | "expired";
  expiresAt?: string;   // ISO 8601 — optional expiration
  grantedBy: string;    // userId of who granted
  grantedAt: string;
  reason?: string;
}
```

---

## Built-in Roles and Policies (seed data)

### Policies

| Key | Allow | Deny | Risk | System |
|-----|-------|------|------|--------|
| `policy:full-admin` | `*.*.*` | — | critical | yes |
| `policy:read-only` | `*.*.read`, `*.*.list` | `*.*.create`, `*.*.update`, `*.*.delete`, `*.*.execute`, `*.*.admin` | low | yes |
| `policy:device-management` | `devices.*.*`, `assets.*.read`, `centrals.*.read` | — | medium | no |
| `policy:user-management` | `identity.users.*` (no delete), `identity.assignments.*` | `identity.users.delete`, `identity.roles.create/update/delete` | high | no |
| `policy:alarm-management` | `alarms.*.*` | — | medium | no |
| `policy:reports` | `reports.*.*`, `analytics.*.*` | — | low | no |
| `policy:customer-management` | `customers.hierarchy.*` (no delete), `customers.apikeys.*` | `customers.hierarchy.delete` | high | no |
| `policy:energy-management` | `energy.*.*` | — | medium | no |
| `policy:integration-management` | `integrations.*.*` | — | medium | no |
| `policy:admin-approval` | `identity.users.approve/reject/unlock` | — | high | no |

### Roles

| Key | Policies | Risk | System |
|-----|----------|------|--------|
| `role:super-admin` | `policy:full-admin` | critical | yes |
| `role:viewer` | `policy:read-only`, `policy:reports` | low | yes |
| `role:customer-admin` | `user-management`, `device-management`, `alarm-management`, `reports`, `customer-management`, `admin-approval` | high | no |
| `role:operations-manager` | `device-management`, `alarm-management`, `reports` | medium | no |
| `role:technician` | `device-management` | low | no |
| `role:alarm-operator` | `alarm-management`, `reports` | medium | no |
| `role:energy-analyst` | `energy-management`, `reports` | low | no |
| `role:integration-manager` | `integration-management`, `reports` | medium | no |
| `role:user-admin` | `user-management`, `admin-approval` | high | no |

---

## Authentication

All endpoints require authentication via one of:

| Method | Header | Used by |
|--------|--------|---------|
| JWT Bearer | `Authorization: Bearer <token>` | Frontend, mobile, M2M partners |
| Customer API Key | `X-API-Key: gcdr_cust_*` | Node-RED bundles, M2M |
| Partner API Key | `X-API-Key: gcdr_pk_*` | Partner integrations |

The tenant is resolved from the JWT `tenant_id` claim or from the API key record. All RBAC operations are scoped to `req.context.tenantId`.

---

## Endpoints

### Policies

#### `POST /policies` — Create policy
**Status:** `201 Created`

**Request body:**
```json
{
  "key": "policy:maintenance-view",
  "displayName": "Maintenance View",
  "description": "Read access to devices and assets during maintenance windows",
  "allow": [
    "devices.details.read",
    "devices.telemetry.read",
    "assets.details.read"
  ],
  "deny": [
    "devices.commands.execute"
  ],
  "riskLevel": "low"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-0000-0000-0000-000000000001",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "key": "policy:maintenance-view",
    "displayName": "Maintenance View",
    "description": "Read access to devices and assets during maintenance windows",
    "allow": ["devices.details.read", "devices.telemetry.read", "assets.details.read"],
    "deny": ["devices.commands.execute"],
    "conditions": null,
    "riskLevel": "low",
    "isSystem": false,
    "version": 1,
    "createdAt": "2026-03-24T14:00:00.000Z",
    "updatedAt": "2026-03-24T14:00:00.000Z"
  }
}
```

**With conditions (MFA + IP allowlist):**
```json
{
  "key": "policy:sensitive-ops",
  "displayName": "Sensitive Operations",
  "allow": ["customers.hierarchy.delete", "identity.users.delete"],
  "deny": [],
  "riskLevel": "critical",
  "conditions": {
    "requiresMFA": true,
    "ipAllowlist": ["10.0.0.0/8", "192.168.1.0/24"],
    "onlyBusinessHours": true,
    "maxSessionDuration": 3600000
  }
}
```

**Errors:**
| Status | Reason |
|--------|--------|
| `400` | Validation error (invalid key format, missing required fields) |
| `409` | Key already exists for this tenant |
| `401` | Missing or invalid authentication |

---

#### `GET /policies` — List policies
**Status:** `200 OK`

**Query parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Page size (default: 20) |
| `cursor` | string | Pagination cursor |
| `riskLevel` | string | Filter: `low`, `medium`, `high`, `critical` |
| `isSystem` | boolean | Filter: `true` or `false` |

**Request:**
```
GET /policies?riskLevel=high&isSystem=false&limit=10
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cccc4444-4444-4444-4444-444444444444",
        "key": "policy:user-management",
        "displayName": "User Management",
        "allow": ["identity.users.list", "identity.users.create", "..."],
        "deny": ["identity.users.delete", "identity.roles.create"],
        "riskLevel": "high",
        "isSystem": false
      }
    ],
    "total": 3,
    "totalPages": 1,
    "nextCursor": null
  }
}
```

---

#### `GET /policies/:policyId` — Get policy by ID
**Status:** `200 OK` / `404 Not Found`

```
GET /policies/cccc5555-5555-5555-5555-555555555555
```

---

#### `GET /policies/key/:policyKey` — Get policy by key
**Status:** `200 OK` / `404 Not Found`

```
GET /policies/key/policy:alarm-management
```

---

#### `PUT /policies/:policyId` — Update policy
**Status:** `200 OK`

> System policies (`isSystem: true`) cannot be updated — returns `403 Forbidden`.

**Request body** (all fields optional):
```json
{
  "displayName": "Alarm Management (Updated)",
  "allow": [
    "alarms.rules.list",
    "alarms.rules.read",
    "alarms.rules.create",
    "alarms.rules.update",
    "alarms.rules.delete",
    "alarms.rules.toggle",
    "alarms.history.read",
    "alarms.notifications.read",
    "alarms.notifications.update",
    "alarms.dashboard.read",
    "alarms.escalations.read"
  ]
}
```

**Errors:**
| Status | Reason |
|--------|--------|
| `403` | Attempting to modify a system policy |
| `404` | Policy not found |
| `409` | Version conflict (optimistic locking) |

---

#### `DELETE /policies/:policyId` — Delete policy
**Status:** `204 No Content`

> Fails if any role still references this policy.

**Errors:**
| Status | Reason |
|--------|--------|
| `403` | System policy — cannot be deleted |
| `404` | Policy not found |
| `409` | Policy is still referenced by one or more roles |

---

### Roles

#### `POST /roles` — Create role
**Status:** `201 Created`

All referenced policy keys must exist before creating a role.

**Request body:**
```json
{
  "key": "role:energy-ops",
  "displayName": "Energy Operations",
  "description": "Access to energy monitoring and alarm operations",
  "policies": [
    "policy:energy-management",
    "policy:alarm-management",
    "policy:reports"
  ],
  "tags": ["energy", "operations"],
  "riskLevel": "medium"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "f1e2d3c4-0000-0000-0000-000000000001",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "key": "role:energy-ops",
    "displayName": "Energy Operations",
    "policies": ["policy:energy-management", "policy:alarm-management", "policy:reports"],
    "tags": ["energy", "operations"],
    "riskLevel": "medium",
    "isSystem": false,
    "version": 1,
    "createdAt": "2026-03-24T14:00:00.000Z",
    "updatedAt": "2026-03-24T14:00:00.000Z"
  }
}
```

**Validation rules:**
- `key` must match `/^[a-z][a-z0-9_]*$/` (lowercase letters, digits, underscores — no colons enforced by regex, but convention is `role:name`)
- `policies` must be a non-empty array of existing policy keys
- `riskLevel` defaults to `"low"` if omitted

**Errors:**
| Status | Reason |
|--------|--------|
| `400` | Invalid key format or missing required fields |
| `404` | One or more policy keys do not exist |
| `409` | Role key already exists for this tenant |

---

#### `GET /roles` — List roles
**Status:** `200 OK`

**Query parameters:** same as `/policies` (`limit`, `cursor`, `riskLevel`, `isSystem`)

```
GET /roles?isSystem=false&riskLevel=medium
```

---

#### `GET /roles/:roleId` — Get role by ID
```
GET /roles/dddd6666-6666-6666-6666-666666666666
```

---

#### `GET /roles/key/:roleKey` — Get role by key
```
GET /roles/key/role:alarm-operator
```

---

#### `PUT /roles/:roleId` — Update role
**Status:** `200 OK`

> System roles (`isSystem: true`) cannot be updated.

```json
{
  "policies": [
    "policy:alarm-management",
    "policy:reports",
    "policy:energy-management"
  ],
  "riskLevel": "high"
}
```

---

#### `DELETE /roles/:roleId` — Delete role
**Status:** `204 No Content`

> Fails if there are active role assignments for this role.

---

### Assignments

#### `POST /authorization/assignments` — Assign role to user
**Status:** `201 Created`

**Request body:**
```json
{
  "userId": "bbbb3333-3333-3333-3333-333333333333",
  "roleKey": "role:alarm-operator",
  "scope": "customer:33333333-3333-3333-3333-333333333333",
  "reason": "Promoted to alarm monitoring team"
}
```

**With expiration (temporary access):**
```json
{
  "userId": "bbbb4444-4444-4444-4444-444444444444",
  "roleKey": "role:viewer",
  "scope": "customer:33333333-3333-3333-3333-333333333333",
  "expiresAt": "2026-06-30T23:59:59.000Z",
  "reason": "Partner temporary read access for integration testing"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "eeee1111-0000-0000-0000-000000000001",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "userId": "bbbb3333-3333-3333-3333-333333333333",
    "roleKey": "role:alarm-operator",
    "scope": "customer:33333333-3333-3333-3333-333333333333",
    "status": "active",
    "expiresAt": null,
    "grantedBy": "bbbb1111-1111-1111-1111-111111111111",
    "grantedAt": "2026-03-24T14:00:00.000Z",
    "reason": "Promoted to alarm monitoring team",
    "version": 1,
    "createdAt": "2026-03-24T14:00:00.000Z"
  }
}
```

**Errors:**
| Status | Reason |
|--------|--------|
| `404` | Role key does not exist |
| `409` | Assignment already exists for this user + role + scope combination |

---

#### `GET /authorization/assignments` — List all assignments
**Status:** `200 OK`

```
GET /authorization/assignments?limit=20&cursor=<cursor>
```

---

#### `DELETE /authorization/assignments/:assignmentId` — Revoke assignment
**Status:** `200 OK`

Sets the assignment `status` to `"inactive"`. The record is preserved for audit.

```
DELETE /authorization/assignments/eeee6666-6666-6666-6666-666666666666
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "eeee6666-6666-6666-6666-666666666666",
    "status": "inactive",
    "userId": "bbbb3333-3333-3333-3333-333333333333",
    "roleKey": "role:alarm-operator",
    "scope": "customer:33333333-3333-3333-3333-333333333333"
  }
}
```

---

#### `GET /authorization/users/:userId/assignments` — Get user's active assignments
**Status:** `200 OK`

```
GET /authorization/users/bbbb3333-3333-3333-3333-333333333333/assignments
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "bbbb3333-3333-3333-3333-333333333333",
    "assignments": [
      {
        "id": "eeee5555-5555-5555-5555-555555555555",
        "roleKey": "role:technician",
        "scope": "customer:33333333-3333-3333-3333-333333333333",
        "status": "active",
        "grantedAt": "2026-02-07T12:00:00.000Z",
        "grantedBy": "bbbb2222-2222-2222-2222-222222222222",
        "expiresAt": null
      },
      {
        "id": "eeee6666-6666-6666-6666-666666666666",
        "roleKey": "role:alarm-operator",
        "scope": "customer:33333333-3333-3333-3333-333333333333",
        "status": "active",
        "grantedAt": "2026-02-22T12:00:00.000Z",
        "grantedBy": "bbbb2222-2222-2222-2222-222222222222",
        "expiresAt": null
      }
    ]
  }
}
```

---

#### `GET /authorization/users/:userId/permissions` — Get effective permissions
**Status:** `200 OK`

Optional query param `scope` filters assignments to a specific resource scope.

```
GET /authorization/users/bbbb3333-3333-3333-3333-333333333333/permissions?scope=customer:33333333-3333-3333-3333-333333333333
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "bbbb3333-3333-3333-3333-333333333333",
    "scope": "customer:33333333-3333-3333-3333-333333333333",
    "effectivePermissions": [
      "devices.list.read",
      "devices.details.read",
      "devices.settings.read",
      "devices.settings.update",
      "devices.telemetry.read",
      "devices.commands.execute",
      "assets.list.read",
      "assets.details.read",
      "centrals.list.read",
      "centrals.details.read",
      "alarms.dashboard.read",
      "alarms.rules.list",
      "alarms.rules.read",
      "alarms.rules.create",
      "alarms.rules.update",
      "alarms.rules.delete",
      "alarms.rules.toggle",
      "alarms.history.read",
      "alarms.notifications.read",
      "alarms.notifications.update",
      "reports.energy.read",
      "reports.energy.export",
      "reports.alarms.read",
      "reports.alarms.export",
      "reports.devices.read",
      "reports.devices.export",
      "analytics.dashboards.read",
      "analytics.metrics.read"
    ],
    "deniedPatterns": [],
    "roles": [
      {
        "roleKey": "role:technician",
        "scope": "customer:33333333-3333-3333-3333-333333333333",
        "grantedAt": "2026-02-07T12:00:00.000Z"
      },
      {
        "roleKey": "role:alarm-operator",
        "scope": "customer:33333333-3333-3333-3333-333333333333",
        "grantedAt": "2026-02-22T12:00:00.000Z"
      }
    ]
  }
}
```

---

#### `GET /authorization/users/:userId/roles` — Get roles summary
**Status:** `200 OK`

Same as `/permissions` but structured around assignments with permission totals.

```
GET /authorization/users/bbbb2222-2222-2222-2222-222222222222/roles
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "bbbb2222-2222-2222-2222-222222222222",
    "count": 2,
    "assignments": [
      {
        "id": "eeee3333-3333-3333-3333-333333333333",
        "roleKey": "role:customer-admin",
        "scope": "customer:33333333-3333-3333-3333-333333333333",
        "status": "active",
        "grantedAt": "2026-01-22T12:00:00.000Z",
        "grantedBy": "bbbb1111-1111-1111-1111-111111111111",
        "expiresAt": null
      },
      {
        "id": "eeee4444-4444-4444-4444-444444444444",
        "roleKey": "role:operations-manager",
        "scope": "customer:22222222-2222-2222-2222-222222222222",
        "status": "active",
        "grantedAt": "2026-02-22T12:00:00.000Z",
        "grantedBy": "bbbb1111-1111-1111-1111-111111111111",
        "expiresAt": null
      }
    ],
    "effectivePermissions": ["devices.list.read", "..."],
    "deniedPatterns": ["customers.hierarchy.delete", "identity.users.delete"]
  }
}
```

---

#### `GET /authorization/roles` — List roles (via authorization router)
**Status:** `200 OK`

Mirrors `GET /roles`. Useful for permission-checking frontends that only have access to the `/authorization` prefix.

---

### Permission Check

#### `POST /authorization/check` — Evaluate a single permission
**Status:** `200 OK`

**Request body:**
```json
{
  "userId": "bbbb3333-3333-3333-3333-333333333333",
  "permission": "alarms.rules.delete",
  "resourceScope": "customer:33333333-3333-3333-3333-333333333333"
}
```

**Response — allowed:**
```json
{
  "success": true,
  "data": {
    "allowed": true,
    "reason": "Permission granted by policy",
    "matchedPolicies": ["policy:alarm-management"],
    "evaluatedAt": "2026-03-24T14:00:00.000Z"
  }
}
```

**Response — denied (explicit deny):**
```json
{
  "success": true,
  "data": {
    "allowed": false,
    "reason": "Explicitly denied by policy: policy:user-management",
    "matchedPolicies": ["policy:user-management"],
    "evaluatedAt": "2026-03-24T14:00:00.000Z"
  }
}
```

**Response — denied (no assignments):**
```json
{
  "success": true,
  "data": {
    "allowed": false,
    "reason": "No active role assignments found for this scope",
    "matchedPolicies": [],
    "evaluatedAt": "2026-03-24T14:00:00.000Z"
  }
}
```

**Validation:**
- `permission` must match `/^[a-z]+\.[a-z]+\.[a-z]+$/` — lowercase, three dot-separated segments, no wildcards

---

#### `POST /authorization/check/batch` — Evaluate multiple permissions
**Status:** `200 OK`

**Request body:**
```json
{
  "userId": "bbbb3333-3333-3333-3333-333333333333",
  "resourceScope": "customer:33333333-3333-3333-3333-333333333333",
  "permissions": [
    "alarms.rules.read",
    "alarms.rules.delete",
    "identity.users.delete",
    "devices.commands.execute",
    "customers.hierarchy.delete"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": {
      "alarms.rules.read": {
        "allowed": true,
        "reason": "Permission granted by policy",
        "matchedPolicies": ["policy:alarm-management"],
        "evaluatedAt": "2026-03-24T14:00:00.000Z"
      },
      "alarms.rules.delete": {
        "allowed": true,
        "reason": "Permission granted by policy",
        "matchedPolicies": ["policy:alarm-management"],
        "evaluatedAt": "2026-03-24T14:00:00.000Z"
      },
      "identity.users.delete": {
        "allowed": false,
        "reason": "Permission not found in any assigned policies",
        "matchedPolicies": [],
        "evaluatedAt": "2026-03-24T14:00:00.000Z"
      },
      "devices.commands.execute": {
        "allowed": true,
        "reason": "Permission granted by policy",
        "matchedPolicies": ["policy:device-management"],
        "evaluatedAt": "2026-03-24T14:00:00.000Z"
      },
      "customers.hierarchy.delete": {
        "allowed": false,
        "reason": "Permission not found in any assigned policies",
        "matchedPolicies": [],
        "evaluatedAt": "2026-03-24T14:00:00.000Z"
      }
    },
    "summary": {
      "total": 5,
      "allowed": 3,
      "denied": 2
    }
  }
}
```

**Limits:** `permissions` array accepts 1–100 items.

---

## Evaluation Logic (step by step)

Given a call to `POST /authorization/check`:

1. Load all **active** `RoleAssignments` for the user.
2. Filter to assignments whose `scope` covers the `resourceScope`:
   - Exact match, wildcard (`customer:*`), hierarchical (`customer:X` covers `customer:X/asset:Y`), or global (`*`).
3. Resolve the `Role` for each matching assignment.
4. Collect all `Policy` keys from those roles.
5. For each policy, check **deny first**:
   - If the `permission` matches any entry in `policy.deny` → **denied immediately**. Short-circuits.
6. Then check **allow**:
   - If the `permission` matches any entry in `policy.allow` → **allowed**.
7. If no policy matched in either list → **denied** (`"Permission not found in any assigned policies"`).

**Wildcard matching within permission strings** follows three-segment logic:

```
policy deny/allow pattern     target permission           match?
─────────────────────────────────────────────────────────────────
"*.*.*"                       "alarms.rules.delete"       yes
"*.*.read"                    "alarms.rules.read"         yes
"*.*.read"                    "alarms.rules.delete"       no
"alarms.*.*"                  "alarms.rules.delete"       yes
"alarms.rules.*"              "alarms.rules.delete"       yes
"alarms.rules.delete"         "alarms.rules.delete"       yes
"alarms.rules.delete"         "alarms.history.read"       no
```

---

## Common Error Responses

All errors follow this envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "permission must match format domain.function.action"
  }
}
```

| Status | Code | Common causes |
|--------|------|---------------|
| `400` | `VALIDATION_ERROR` | Invalid field format, missing required field |
| `401` | `UNAUTHORIZED` | Missing, expired, or invalid token/API key |
| `403` | `FORBIDDEN` | Attempting to modify/delete a system role or policy |
| `404` | `NOT_FOUND` | Role, policy, or assignment not found |
| `409` | `CONFLICT` | Duplicate key, missing dependency, or optimistic lock version mismatch |
| `204` | — | Successful delete (no body) |

---

## Practical Scenarios

### Grant a user temporary admin access

```bash
POST /authorization/assignments
{
  "userId": "...",
  "roleKey": "role:customer-admin",
  "scope": "customer:33333333-...",
  "expiresAt": "2026-04-30T23:59:59.000Z",
  "reason": "Covering for João during vacation"
}
```

### Check before rendering a UI button

```bash
POST /authorization/check
{
  "userId": "...",
  "permission": "alarms.rules.delete",
  "resourceScope": "customer:33333333-..."
}
# → { "allowed": true/false }
```

### Load all permissions for a user on login

```bash
GET /authorization/users/:userId/permissions?scope=customer:33333333-...
# Returns effectivePermissions[] and deniedPatterns[]
# Frontend can store this and gate UI features accordingly
```

### Revoke an expired contractor's access

```bash
DELETE /authorization/assignments/:assignmentId
# Assignment status set to "inactive" — preserved in audit log
```
