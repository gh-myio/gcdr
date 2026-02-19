# Backend Blockers - RFC-0018

> Issues identified during frontend QA that **cannot be resolved without backend changes**.
> Frontend code for these features is already implemented and functional -- the requests are correctly formed with proper authentication headers. The backend simply does not handle them.

---

## Issue 7: Role Creation - `POST /api/v1/roles` Not Found

**Error:** `Route POST /api/v1/roles not found`
**Severity:** Critical
**Frontend Status:** Complete (no changes needed)

### What the Frontend Sends

```
POST /api/v1/roles
Content-Type: application/json
Authorization: Bearer <accessToken>
x-tenant-id: <tenantId>
```

```json
{
  "key": "role:my-custom-role",
  "displayName": "My Custom Role",
  "description": "Optional description",
  "policies": ["policy:device-reader", "policy:alarm-manager"],
  "tags": ["custom"],
  "riskLevel": "medium"
}
```

### Expected Behavior

The endpoint should create a role and return the full `Role` entity:

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "key": "role:my-custom-role",
  "displayName": "My Custom Role",
  "description": "Optional description",
  "policies": ["policy:device-reader", "policy:alarm-manager"],
  "tags": ["custom"],
  "riskLevel": "medium",
  "isSystem": false,
  "status": "ACTIVE",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "createdBy": "userId",
  "version": 1
}
```

### Required Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/roles` | Create role |
| `GET` | `/api/v1/roles` | List roles (already works?) |
| `GET` | `/api/v1/roles/:id` | Get role by ID |
| `PUT` | `/api/v1/roles/:id` | Update role |
| `DELETE` | `/api/v1/roles/:id` | Delete role |

### DTO Reference

**CreateRoleDTO:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `key` | `string` | Yes | Must start with `role:`, e.g. `role:device-reader` |
| `displayName` | `string` | Yes | Human-readable name |
| `description` | `string` | No | |
| `policies` | `string[]` | Yes | Array of policy keys |
| `tags` | `string[]` | No | |
| `riskLevel` | `enum` | No | `low` \| `medium` \| `high` \| `critical` |

**UpdateRoleDTO:** Same fields as create, all optional (partial update).

### Frontend Files (for reference)

- Service: `src/services/api/authorizationService.ts`
- Hook: `src/hooks/useAuthorization.ts`
- Form: `src/pages/authorization/RoleForm.tsx`
- List: `src/pages/authorization/RoleList.tsx`
- Types: `src/types/authorization.ts`

---

## Issue 8: Policy Creation - `Token de acesso nao fornecido`

**Error:** `Token de acesso nao fornecido` ("Access token not provided")
**Severity:** Critical
**Frontend Status:** Complete (no changes needed)

### Root Cause Analysis

The frontend HTTP client (`src/services/api/httpClient.ts`) **does** attach the auth token on every request. The headers sent are:

```
Content-Type: application/json
Authorization: Bearer <accessToken>
x-tenant-id: <VITE_DEFAULT_TENANT_ID>
```

The token is retrieved from `localStorage` key `gcdr_tokens` and the `Authorization` header is set via `buildHeaders()` on every authenticated request. This same mechanism works correctly for all other modules (devices, groups, partners, integrations, etc.).

**Most likely causes:**

1. The `POST /api/v1/policies` endpoint **does not exist**, and the 404 response is being misinterpreted as an auth error
2. The policies endpoint has a **different auth middleware** configuration that doesn't read the `Authorization` header correctly
3. The policies endpoint expects the token in a different format or location (e.g., cookie-based instead of header-based)

### What the Frontend Sends

```
POST /api/v1/policies
Content-Type: application/json
Authorization: Bearer <accessToken>
x-tenant-id: <tenantId>
```

```json
{
  "key": "policy:device-reader",
  "displayName": "Device Reader",
  "description": "Read-only access to devices",
  "allow": ["devices.list.read", "devices.details.read", "devices.telemetry.read"],
  "deny": [],
  "riskLevel": "low"
}
```

### Expected Behavior

The endpoint should create a policy and return the full `Policy` entity:

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "key": "policy:device-reader",
  "displayName": "Device Reader",
  "description": "Read-only access to devices",
  "allow": ["devices.list.read", "devices.details.read", "devices.telemetry.read"],
  "deny": [],
  "conditions": null,
  "riskLevel": "low",
  "isSystem": false,
  "status": "ACTIVE",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "createdBy": "userId",
  "version": 1
}
```

### Required Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/policies` | Create policy |
| `GET` | `/api/v1/policies` | List policies (already works?) |
| `GET` | `/api/v1/policies/:id` | Get policy by ID |
| `PUT` | `/api/v1/policies/:id` | Update policy |
| `DELETE` | `/api/v1/policies/:id` | Delete policy |

### DTO Reference

**CreatePolicyDTO:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `key` | `string` | Yes | Must match `^policy:[a-z0-9-]+$` |
| `displayName` | `string` | Yes | Min 3 characters |
| `description` | `string` | No | |
| `allow` | `string[]` | Yes | At least 1 permission. Format: `domain.function.action` |
| `deny` | `string[]` | No | Explicit deny permissions (overrides allow) |
| `conditions` | `PolicyConditions` | No | See below |
| `riskLevel` | `enum` | No | `low` \| `medium` \| `high` \| `critical` |

**PolicyConditions (optional sub-object):**

| Field | Type | Notes |
|-------|------|-------|
| `requiresMFA` | `boolean` | |
| `onlyBusinessHours` | `boolean` | |
| `allowedDeviceTypes` | `string[]` | |
| `ipAllowlist` | `string[]` | |
| `maxSessionDuration` | `number` | In minutes |

**UpdatePolicyDTO:** Same fields as create, all optional (partial update).

### Permission String Format

Permissions follow the pattern `domain.function.action`. The frontend currently uses a hardcoded permission tree (in `src/types/authorization.ts`) with these domains:

| Domain | Example Permissions |
|--------|-------------------|
| `energy` | `energy.settings.read`, `energy.settings.write`, `energy.contracts.approve` |
| `devices` | `devices.list.read`, `devices.commands.execute`, `devices.firmware.deploy` |
| `alarms` | `alarms.list.read`, `alarms.acknowledge.write`, `alarms.rules.manage` |
| `identity` | `identity.users.read`, `identity.roles.manage`, `identity.sessions.revoke` |
| `customers` | `customers.list.read`, `customers.billing.manage` |
| `assets` | `assets.list.read`, `assets.maintenance.schedule` |
| `reports` | `reports.generate.execute`, `reports.templates.manage` |
| `dashboards` | `dashboards.list.read`, `dashboards.widgets.manage` |

Full wildcard: `*:*` (grants all permissions).

### Verification Steps

1. Check if `POST /api/v1/policies` route is registered in the backend router
2. Check if the policies controller/module auth middleware reads `Authorization: Bearer <token>` from headers (not from cookies or query params)
3. Verify using `curl` or Postman that the endpoint exists and accepts the token

### Frontend Files (for reference)

- Service: `src/services/api/authorizationService.ts`
- Hook: `src/hooks/useAuthorization.ts`
- Form: `src/pages/authorization/PolicyForm.tsx`
- List: `src/pages/authorization/PolicyList.tsx`
- Types: `src/types/authorization.ts`
- HTTP Client: `src/services/api/httpClient.ts` (token attachment logic)

---

## Issue 9: Maintenance Group Edit - `PATCH /api/v1/maintenance-groups/:id` Not Found

**Error:** `Route PATCH /api/v1/maintenance-groups/:id not found`
**Severity:** Critical
**Frontend Status:** Complete (no changes needed)

### What the Frontend Sends

```
PATCH /api/v1/maintenance-groups/:id
Content-Type: application/json
Authorization: Bearer <accessToken>
x-tenant-id: <tenantId>
```

```json
{
  "name": "Updated Group Name",
  "description": "Updated description"
}
```

For activate/deactivate actions:

```json
{
  "isActive": true
}
```

### Expected Behavior

The endpoint should partially update the maintenance group and return the full entity:

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "key": "group:my-group",
  "name": "Updated Group Name",
  "description": "Updated description",
  "customerId": "uuid",
  "customerName": "Customer Name",
  "members": [],
  "memberCount": 0,
  "isActive": true,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "version": 2
}
```

### Required Endpoints

The frontend uses the following endpoints. Verify which ones are implemented:

| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| `GET` | `/api/v1/maintenance-groups` | List groups | ? |
| `GET` | `/api/v1/maintenance-groups/:id` | Get by ID | ? |
| `GET` | `/api/v1/maintenance-groups/by-key/:key` | Get by key | ? |
| `POST` | `/api/v1/maintenance-groups` | Create group | ? |
| `PATCH` | `/api/v1/maintenance-groups/:id` | Update group | **Missing** |
| `DELETE` | `/api/v1/maintenance-groups/:id` | Delete group | ? |
| `POST` | `/api/v1/maintenance-groups/:id/members` | Add member | ? |
| `DELETE` | `/api/v1/maintenance-groups/:id/members/:userId` | Remove member | ? |
| `PATCH` | `/api/v1/maintenance-groups/:id/members/:userId` | Update member role | ? |
| `GET` | `/api/v1/users/:userId/maintenance-group` | Get user's group | ? |

### DTO Reference

**CreateMaintenanceGroupDTO:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `key` | `string` | Yes | Prefixed with `group:` in the UI |
| `name` | `string` | Yes | |
| `description` | `string` | No | |
| `customerId` | `string` | No | |

**UpdateMaintenanceGroupDTO:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | `string` | No | |
| `description` | `string` | No | |
| `isActive` | `boolean` | No | Used for activate/deactivate |

**MaintenanceGroupMember:**

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | |
| `userName` | `string` | |
| `userEmail` | `string` | |
| `role` | `enum` | `LEADER` \| `MEMBER` |
| `addedAt` | `string` | ISO-8601 |

### PATCH vs PUT Decision

The frontend currently uses `PATCH` for partial updates. If the backend convention is `PUT` for full replacement, please let us know and we will adjust the frontend HTTP method accordingly.

### Frontend Files (for reference)

- Service: `src/services/api/maintenanceGroupService.ts`
- Hook: `src/hooks/useMaintenanceGroups.ts`
- List: `src/pages/maintenanceGroups/MaintenanceGroupList.tsx`
- Detail: `src/pages/maintenanceGroups/MaintenanceGroupDetail.tsx`
- Types: `src/types/maintenanceGroup.ts`

---

## Summary

| Issue | Endpoint | Error | Action Required |
|-------|----------|-------|-----------------|
| #7 | `POST /api/v1/roles` | Route not found | Implement roles CRUD endpoints |
| #8 | `POST /api/v1/policies` | Token not provided | Implement policies CRUD endpoints + verify auth middleware |
| #9 | `PATCH /api/v1/maintenance-groups/:id` | Route not found | Implement PATCH endpoint (or PUT + notify frontend) |

All three features have **fully functional frontend forms, services, hooks, and pages**. The requests are properly authenticated with `Authorization: Bearer <token>` and `x-tenant-id` headers. No frontend changes are required -- only backend endpoint implementation.

### Request/Response Contract

All endpoints should follow the existing API pattern:

```json
// Success
{
  "success": true,
  "data": { /* entity */ }
}

// Error
{
  "success": false,
  "error": {
    "message": "Human-readable error message",
    "code": "ERROR_CODE"
  }
}

// List
{
  "success": true,
  "data": {
    "items": [ /* entities */ ],
    "hasMore": true,
    "nextCursor": "cursor-string"
  }
}
```
