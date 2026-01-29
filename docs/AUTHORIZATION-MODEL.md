# GCDR Authorization Model

This document describes the authorization model implemented in GCDR, covering the relationship between Users, Roles, Policies, Permissions, and Scopes.

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Data Model](#data-model)
4. [Permission Format](#permission-format)
5. [Scope Hierarchy](#scope-hierarchy)
6. [Evaluation Algorithm](#evaluation-algorithm)
7. [API Endpoints](#api-endpoints)
8. [Seed Data Examples](#seed-data-examples)
9. [Implementation Status](#implementation-status)
10. [Best Practices](#best-practices)

---

## Overview

GCDR implements a **Role-Based Access Control (RBAC)** model with **scope-aware permissions** and **lightweight ABAC** (Attribute-Based Access Control) support.

### Key Principles

| Principle | Description |
|-----------|-------------|
| **Separation of Concerns** | Users don't carry permissions directly; permissions are granted through roles and policies |
| **Action-Based Permissions** | Permissions describe actions, not UI elements |
| **Explicit Deny Wins** | Deny rules always override allow rules |
| **Scope-Aware** | Every permission is evaluated within a scope (customer hierarchy) |
| **Default Deny** | If no permission matches, access is denied |

### High-Level Model

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         AUTHORIZATION MODEL                               │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│   USER                                                                    │
│     │                                                                     │
│     ├──── belongs to ──── CUSTOMER (hierarchy)                           │
│     │                                                                     │
│     └──── has ──── ROLE ASSIGNMENTS ─────┐                               │
│                    (with scope)          │                               │
│                         │                │                               │
│                         ▼                │                               │
│                       ROLES ─────────────┘                               │
│                         │                                                 │
│                         └──── references ──── POLICIES                   │
│                                                │                          │
│                                                ▼                          │
│                                          PERMISSIONS                      │
│                                     (domain.function.action)             │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### User

An authenticated identity in the system. Users have:

- **Status**: `UNVERIFIED`, `PENDING_APPROVAL`, `ACTIVE`, `INACTIVE`, `LOCKED`
- **Type**: `INTERNAL`, `CUSTOMER`, `PARTNER`, `SERVICE_ACCOUNT`
- **Customer Association**: Optional link to a customer in the hierarchy

```typescript
interface User {
  id: string;
  tenantId: string;
  email: string;
  status: UserStatus;
  type: UserType;
  customerId?: string;  // Which customer this user belongs to
  // ... other fields
}
```

### Role

A reusable access profile that groups multiple policies. Roles are:

- **Tenant-scoped**: Each tenant can define custom roles
- **Reusable**: Same role can be assigned to multiple users
- **Composable**: Reference one or more policies

```typescript
interface Role {
  id: string;
  tenantId: string;
  key: string;              // Unique identifier: "role:customer-admin"
  displayName: string;      // Human-readable: "Customer Administrator"
  description: string;
  policies: string[];       // Array of policy keys
  tags: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isSystem: boolean;        // Built-in vs custom
}
```

### Policy

A set of permissions with allow/deny semantics. Policies define **what actions are permitted or denied**.

```typescript
interface Policy {
  id: string;
  tenantId: string;
  key: string;              // "policy:device-management"
  displayName: string;
  description: string;
  allow: string[];          // Allowed permissions
  deny: string[];           // Denied permissions (supports wildcards)
  conditions?: PolicyConditions;  // Optional ABAC rules
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isSystem: boolean;
}

interface PolicyConditions {
  requiresMFA?: boolean;
  onlyBusinessHours?: boolean;
  allowedDeviceTypes?: string[];
  ipAllowlist?: string[];
  maxSessionDuration?: number;  // minutes
}
```

### Role Assignment

The binding between a **user** and a **role** within a specific **scope**.

```typescript
interface RoleAssignment {
  id: string;
  tenantId: string;
  userId: string;
  roleKey: string;
  scope: string;            // "customer:uuid" or "*" for global
  status: 'active' | 'inactive' | 'expired';
  expiresAt?: string;       // Optional expiration
  grantedBy: string;
  grantedAt: string;
  reason?: string;
}
```

**Important**: A user may have **multiple role assignments** with different scopes.

---

## Data Model

### Database Tables

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PostgreSQL Tables                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────────────┐  │
│  │    users     │      │    roles     │      │      policies        │  │
│  ├──────────────┤      ├──────────────┤      ├──────────────────────┤  │
│  │ id           │      │ id           │      │ id                   │  │
│  │ tenant_id    │      │ tenant_id    │      │ tenant_id            │  │
│  │ email        │      │ key          │      │ key                  │  │
│  │ status       │      │ display_name │      │ display_name         │  │
│  │ type         │      │ description  │      │ description          │  │
│  │ customer_id  │      │ policies[]   │──────│ allow[]              │  │
│  │ ...          │      │ tags[]       │      │ deny[]               │  │
│  └──────┬───────┘      │ risk_level   │      │ conditions           │  │
│         │              │ is_system    │      │ risk_level           │  │
│         │              └──────────────┘      │ is_system            │  │
│         │                                    └──────────────────────┘  │
│         │                                                               │
│         │              ┌────────────────────┐                          │
│         │              │  role_assignments  │                          │
│         │              ├────────────────────┤                          │
│         └──────────────│ user_id            │                          │
│                        │ role_key           │──────────────────────────│
│                        │ scope              │                          │
│                        │ status             │                          │
│                        │ expires_at         │                          │
│                        │ granted_by         │                          │
│                        │ granted_at         │                          │
│                        │ reason             │                          │
│                        └────────────────────┘                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Entity Relationships

```
User (1) ──────< (N) RoleAssignment (N) >────── (1) Role
                                                      │
                                                      │ policies[]
                                                      ▼
                                                   Policy (N)
                                                      │
                                                      │ allow[], deny[]
                                                      ▼
                                                 Permissions
```

---

## Permission Format

Permissions follow a **canonical string format**:

```
{domain}.{function}.{action}
```

### Domains

Top-level business areas:

| Domain | Description |
|--------|-------------|
| `energy` | Energy monitoring and management |
| `water` | Water consumption and monitoring |
| `temperature` | Temperature control and HVAC |
| `alarms` | Alarm rules and notifications |
| `workorders` | Work order management |
| `integrations` | External integrations and marketplace |
| `identity` | Users, roles, and permissions |
| `customers` | Customer hierarchy management |
| `assets` | Asset management |
| `devices` | Device management |
| `reports` | Reporting and analytics |
| `dashboards` | Dashboard views |

### Functions

Sub-areas within a domain:

| Function | Description |
|----------|-------------|
| `settings` | Configuration settings |
| `devices` | Device-specific operations |
| `rules` | Business rules |
| `users` | User management |
| `hierarchy` | Hierarchy operations |
| `exports` | Data exports |

### Actions

Operations that can be performed:

| Action | Description |
|--------|-------------|
| `read` | View single resource |
| `list` | List multiple resources |
| `create` | Create new resource |
| `update` | Modify existing resource |
| `delete` | Remove resource |
| `approve` | Approve pending action |
| `export` | Export data |
| `execute` | Execute operation |
| `assign` | Assign to user/resource |
| `*` | Wildcard (all actions) |

### Permission Examples

| Permission | Description |
|------------|-------------|
| `energy.settings.read` | Read energy settings |
| `alarms.rules.update` | Update alarm rules |
| `workorders.orders.create` | Create work orders |
| `identity.users.assign` | Assign users to roles |
| `customers.hierarchy.read` | Read customer hierarchy |
| `devices.*` | All device operations |
| `*:read` | Read access to everything |
| `*:*` | Full access (admin) |

### Wildcard Rules

- `domain.*` - All functions and actions in domain
- `domain.function.*` - All actions in function
- `*:action` - Action across all domains
- `*:*` - Full access

**Important**: Wildcards in **allow** must be explicit. Wildcards in **deny** are supported for broad restrictions.

---

## Scope Hierarchy

Scopes define **where permissions apply** within the customer hierarchy.

### Scope Types

| Scope | Pattern | Description |
|-------|---------|-------------|
| **Global** | `*` | All resources in tenant |
| **Customer** | `customer:{uuid}` | Specific customer and descendants |
| **Asset** | `asset:{uuid}` | Specific asset |
| **Device** | `device:{uuid}` | Specific device |

### Hierarchy Inheritance

```
*                                    ← Global (Super Admin)
└── customer:{holdingId}             ← Holding level
      ├── customer:{company1Id}      ← Company level
      │     ├── asset:{siteId}       ← Site level
      │     │     └── device:{id}    ← Device level
      │     └── asset:{buildingId}
      │           └── device:{id}
      └── customer:{company2Id}
            └── asset:{siteId}
```

**Inheritance Rule**: A permission granted at `customer:parent` automatically applies to all descendants (child customers, assets, devices).

### Scope Matching Logic

```typescript
function scopeMatches(assignmentScope: string, resourceScope: string): boolean {
  // Exact match
  if (assignmentScope === resourceScope) return true;

  // Global scope
  if (assignmentScope === '*') return true;

  // Wildcard match: "customer:*" matches "customer:123"
  if (assignmentScope.endsWith('*')) {
    const prefix = assignmentScope.slice(0, -1);
    return resourceScope.startsWith(prefix);
  }

  // Hierarchical match: "customer:123" matches "customer:123/asset:456"
  if (resourceScope.startsWith(assignmentScope + '/')) return true;

  return false;
}
```

---

## Evaluation Algorithm

The permission evaluation follows a deterministic algorithm:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Permission Evaluation Flow                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐                                                    │
│  │ 1. Get User's   │                                                    │
│  │ Role Assignments│                                                    │
│  └────────┬────────┘                                                    │
│           │                                                              │
│           ▼                                                              │
│  ┌─────────────────┐     ┌───────────────┐                             │
│  │ 2. Filter by    │────▶│ No matches?   │────▶ DENIED                 │
│  │    Scope        │     │               │      "No role assignments"   │
│  └────────┬────────┘     └───────────────┘                             │
│           │                                                              │
│           ▼                                                              │
│  ┌─────────────────┐                                                    │
│  │ 3. Resolve      │                                                    │
│  │ Roles → Policies│                                                    │
│  └────────┬────────┘                                                    │
│           │                                                              │
│           ▼                                                              │
│  ┌─────────────────┐     ┌───────────────┐                             │
│  │ 4. Check DENY   │────▶│ Match found?  │────▶ DENIED                 │
│  │    Rules First  │     │               │      "Explicitly denied"     │
│  └────────┬────────┘     └───────────────┘                             │
│           │ No deny                                                      │
│           ▼                                                              │
│  ┌─────────────────┐     ┌───────────────┐                             │
│  │ 5. Check ALLOW  │────▶│ Match found?  │────▶ ALLOWED                │
│  │    Rules        │     │               │      "Granted by policy"     │
│  └────────┬────────┘     └───────────────┘                             │
│           │ No match                                                     │
│           ▼                                                              │
│  ┌─────────────────┐                                                    │
│  │ 6. Default DENY │────▶ DENIED                                       │
│  │                 │      "Permission not found"                        │
│  └─────────────────┘                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Algorithm Implementation

```typescript
async function evaluatePermission(
  tenantId: string,
  userId: string,
  permission: string,
  resourceScope: string
): Promise<PermissionEvaluationResult> {

  // 1. Get user's active role assignments
  const assignments = await getRoleAssignments(userId);

  // 2. Filter by scope (hierarchical matching)
  const relevantAssignments = assignments.filter(a =>
    scopeMatches(a.scope, resourceScope)
  );

  if (relevantAssignments.length === 0) {
    return { allowed: false, reason: 'No role assignments for scope' };
  }

  // 3. Resolve roles → policies
  const roleKeys = relevantAssignments.map(a => a.roleKey);
  const roles = await getRolesByKeys(roleKeys);
  const policyKeys = roles.flatMap(r => r.policies);
  const policies = await getPoliciesByKeys(policyKeys);

  // 4. Check DENY first (deny always wins)
  for (const policy of policies) {
    if (permissionMatches(policy.deny, permission)) {
      return {
        allowed: false,
        reason: `Denied by policy: ${policy.key}`
      };
    }
  }

  // 5. Check ALLOW
  for (const policy of policies) {
    if (permissionMatches(policy.allow, permission)) {
      return {
        allowed: true,
        reason: `Granted by policy: ${policy.key}`
      };
    }
  }

  // 6. Default deny
  return { allowed: false, reason: 'Permission not found in policies' };
}
```

### Permission Matching

```typescript
function permissionMatches(patterns: string[], target: string): boolean {
  const [targetDomain, targetFunc, targetAction] = target.split('.');

  for (const pattern of patterns) {
    const [domain, func, action] = pattern.split('.');

    // Check each segment (with wildcard support)
    if (domain !== '*' && domain !== targetDomain) continue;
    if (func !== '*' && func !== targetFunc) continue;
    if (action !== '*' && action !== targetAction) continue;

    return true;
  }

  return false;
}
```

---

## API Endpoints

### Role Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/roles` | Create a new role |
| `GET` | `/roles` | List all roles |
| `GET` | `/roles/:id` | Get role by ID |
| `GET` | `/roles/key/:key` | Get role by key |
| `PUT` | `/roles/:id` | Update role |
| `DELETE` | `/roles/:id` | Delete role |

### Policy Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/policies` | Create a new policy |
| `GET` | `/policies` | List all policies |
| `GET` | `/policies/:id` | Get policy by ID |
| `GET` | `/policies/key/:key` | Get policy by key |
| `PUT` | `/policies/:id` | Update policy |
| `DELETE` | `/policies/:id` | Delete policy |

### Role Assignments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/authorization/assign` | Assign role to user |
| `POST` | `/authorization/revoke/:id` | Revoke assignment |
| `GET` | `/authorization/assignments` | List all assignments |
| `GET` | `/authorization/users/:userId/assignments` | Get user's assignments |

### Permission Evaluation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/authorization/evaluate` | Evaluate single permission |
| `POST` | `/authorization/evaluate-batch` | Evaluate multiple permissions |
| `GET` | `/authorization/users/:userId/permissions` | Get effective permissions |

### Example Requests

#### Evaluate Permission

```http
POST /authorization/evaluate
Content-Type: application/json
Authorization: Bearer {token}
X-Tenant-Id: {tenantId}

{
  "userId": "user-uuid",
  "permission": "devices.settings.update",
  "resourceScope": "customer:customer-uuid"
}
```

**Response (Allowed):**

```json
{
  "success": true,
  "data": {
    "allowed": true,
    "reason": "Granted by policy: policy:device-management",
    "matchedPolicies": ["policy:device-management"],
    "evaluatedAt": "2026-01-29T10:30:00Z"
  }
}
```

**Response (Denied):**

```json
{
  "success": true,
  "data": {
    "allowed": false,
    "reason": "Explicitly denied by policy: policy:read-only",
    "matchedPolicies": ["policy:read-only"],
    "evaluatedAt": "2026-01-29T10:30:00Z"
  }
}
```

#### Batch Evaluation

```http
POST /authorization/evaluate-batch
Content-Type: application/json

{
  "userId": "user-uuid",
  "resourceScope": "customer:customer-uuid",
  "permissions": [
    "devices.settings.read",
    "devices.settings.update",
    "identity.users.delete"
  ]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "results": {
      "devices.settings.read": { "allowed": true, "reason": "..." },
      "devices.settings.update": { "allowed": true, "reason": "..." },
      "identity.users.delete": { "allowed": false, "reason": "..." }
    },
    "summary": {
      "total": 3,
      "allowed": 2,
      "denied": 1
    }
  }
}
```

---

## Seed Data Examples

### Policies

| Key | Allow | Deny | Risk |
|-----|-------|------|------|
| `policy:full-admin` | `*:*` | - | critical |
| `policy:read-only` | `*:read`, `*:list` | `*:write`, `*:delete`, `*:admin` | low |
| `policy:device-management` | `devices:*`, `assets:read`, `telemetry:*`, `commands:*` | - | medium |
| `policy:user-management` | `users:*`, `roles:read`, `role-assignments:*` | `users:delete-admin`, `roles:write` | high |
| `policy:alarm-management` | `alarms:*`, `rules:*`, `notifications:*` | - | medium |
| `policy:reports` | `reports:*`, `analytics:read`, `dashboards:read` | - | low |

### Roles

| Key | Display Name | Policies | Risk |
|-----|--------------|----------|------|
| `role:super-admin` | Super Administrator | full-admin | critical |
| `role:customer-admin` | Customer Administrator | user-management, device-management, alarm-management, reports | high |
| `role:operations-manager` | Operations Manager | device-management, alarm-management, reports | medium |
| `role:technician` | Field Technician | device-management | low |
| `role:viewer` | Viewer | read-only, reports | low |

### Role Assignments

| User | Role | Scope | Status |
|------|------|-------|--------|
| admin@myio.com | super-admin | `*` | active |
| joao@empresa.com | customer-admin | `customer:{company1}` | active |
| joao@empresa.com | operations-manager | `customer:{holding}` | active |
| maria@empresa.com | technician | `customer:{company1}` | active |
| partner@external.com | viewer | `customer:{company1}` | active (expires in 90 days) |

---

## Implementation Status

### Implemented Features

| Feature | Status | Location |
|---------|--------|----------|
| Role CRUD | ✅ | `AuthorizationService.ts` |
| Policy CRUD | ✅ | `AuthorizationService.ts` |
| Role Assignments | ✅ | `AuthorizationService.ts` |
| Permission Evaluation | ✅ | `AuthorizationService.ts:330` |
| Batch Evaluation | ✅ | `AuthorizationService.ts:355` |
| Effective Permissions | ✅ | `AuthorizationService.ts:399` |
| Scope Matching (hierarchy) | ✅ | `AuthorizationService.ts:540` |
| Wildcard Permissions | ✅ | `AuthorizationService.ts:565` |
| Deny > Allow Rule | ✅ | `AuthorizationService.ts:498` |
| Audit Events | ✅ | Via EventService |
| System Role Protection | ✅ | Cannot modify/delete system roles |

### Pending Features

| Feature | Status | Notes |
|---------|--------|-------|
| ABAC Conditions | ⚠️ Schema exists | `requiresMFA`, `onlyBusinessHours` not enforced |
| Authorization Middleware | ❌ | No automatic permission check on endpoints |
| Permissions Registry | ❌ | No official list of all permissions |
| Management UI | ❌ | No admin interface for roles/policies |

---

## Best Practices

### Role Design

| Do | Don't |
|----|-------|
| Create roles based on job functions | Create roles for individual users |
| Use meaningful, descriptive names | Use cryptic abbreviations |
| Start with minimal permissions | Start with admin and restrict |
| Document the purpose of each role | Create roles without documentation |

### Policy Design

| Do | Don't |
|----|-------|
| Keep policies focused and cohesive | Create monolithic policies |
| Use explicit allow rules | Rely on implicit permissions |
| Use deny for security restrictions | Use deny as primary access control |
| Version policies when changing | Modify production policies directly |

### Scope Assignment

| Do | Don't |
|----|-------|
| Assign narrowest scope needed | Give global scope by default |
| Use customer hierarchy for inheritance | Create duplicate assignments |
| Set expiration for temporary access | Leave temporary access active |
| Document the reason for assignment | Assign without justification |

### Security Guidelines

| Rule | Description |
|------|-------------|
| **Least Privilege** | Grant minimum permissions needed |
| **Explicit Deny** | Use deny rules for sensitive operations |
| **Audit Everything** | All evaluations and changes are logged |
| **Regular Review** | Periodically review assignments |
| **No Shared Accounts** | Each user has individual account |

---

## Related Documentation

- [RFC-0002: GCDR Authorization Model](./RFC-0002-GCDR-Authorization-Model.md) - Full specification
- [RFC-0011: User Registration Workflow](./RFC-0011-User-Registration-Approval-Workflow.md) - User lifecycle
- [ONBOARDING.md](./ONBOARDING.md) - Developer guide

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-29 | 1.0.0 | Initial documentation |
