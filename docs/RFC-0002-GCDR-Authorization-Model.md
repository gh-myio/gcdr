# RFC-0002: GCDR Authorization Model

- **Feature Name:** `gcdr-authorization-model`
- **Start Date:** 2026-01-12
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** Draft
- **Authors:** MYIO Platform Team
- **Related RFCs:** [RFC-0001](./RFC-0001-GCDR-MYIO-Integration-Marketplace.md) (GCDR Core & Marketplace)
- **Stakeholders:** Platform, Security, Operations, Ingestion, ThingsBoard, NodeHub

---

## Summary

This RFC defines a **robust, scalable, and multi-tenant authorization model** for the MYIO ecosystem, implemented and governed by the **GCDR (Global Central Data Registry)**.

The model standardizes how **users, groups, roles, policies, domains, functions, and permissions** are defined, related, evaluated, and audited, ensuring consistent access control across all integrated platforms.

---

## Motivation

As MYIO scales across multiple tenants, customers, assets, and domains (energy, water, temperature, alarms, etc.), ad-hoc permission handling becomes unsustainable.

Key challenges addressed:

- Inconsistent permission logic across systems
- Role explosion and duplicated rules
- Lack of auditability and versioning
- Difficulty in enforcing least-privilege access
- Poor support for scoped access (customer hierarchy/asset)

This RFC establishes a **canonical authorization model** that balances **RBAC** (Role-Based Access Control) with **lightweight ABAC** (Attribute-Based Access Control).

---

## Guide-level Explanation

### Goals

- Centralize authorization metadata in the GCDR
- Provide deterministic permission evaluation
- Support hierarchical and scoped access (customer hierarchy)
- Enable reuse of roles and policies
- Allow explicit deny and override rules
- Ensure full auditability and versioning
- Be consumable by UI, APIs, widgets, and edge systems

### Non-Goals

- Implementing authentication (SSO, MFA, IdP)
- Replacing ThingsBoard or OS internal ACLs
- Runtime enforcement inside external systems
- Fine-grained row-level data security

### Core Principles

1. **Separation of concerns**
   - Users do not carry permissions directly
   - Permissions are granted through roles and policies

2. **Action-based permissions**
   - Permissions describe actions, not UI elements

3. **Explicit deny overrides allow**

4. **Scope-aware authorization**
   - Every permission is evaluated within a scope (customer hierarchy)

5. **Versioned and auditable metadata**

### Terminology

| Term | Description |
|------|-------------|
| **User** | An authenticated identity |
| **Group** | Logical grouping of users (teams, departments) |
| **Role** | A reusable access profile |
| **Policy** | A set of permissions with allow/deny semantics |
| **Domain** | Business domain (energy, water, alarms, etc.) |
| **Function** | Sub-area of a domain |
| **Action** | Operation performed on a function |
| **Permission** | `domain.function.action` |
| **Scope** | Context where permission applies (customer hierarchy) |

---

## Reference-level Explanation

### High-Level Model

```
User
├── belongs to Group(s)
├── assigned Role(s)
│   └── Role references Policy(s)
│       └── Policy grants Permissions
│           └── Permission = Domain.Function.Action
│
└── Assignment includes Scope and Constraints
```

---

### Domains

Domains represent **top-level business areas**.

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
| `lookandfeel` | UI customization and themes |

Domains are centrally registered in the GCDR.

---

### Functions

Functions are **sub-areas within a domain**.

| Function | Description |
|----------|-------------|
| `settings` | Configuration settings |
| `devices` | Device management |
| `rules` | Business rules |
| `dashboards` | Dashboard views |
| `reports` | Reporting and analytics |
| `maintenance` | Maintenance operations |
| `users` | User management |
| `exports` | Data exports |
| `hierarchy` | Hierarchy management |

---

### Actions

Actions represent **allowed operations**.

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

---

### Permission Model

Permissions are expressed as a **canonical string**:

```
{domain}.{function}.{action}
```

**Examples:**

| Permission | Description |
|------------|-------------|
| `energy.settings.read` | Read energy settings |
| `alarms.rules.update` | Update alarm rules |
| `workorders.orders.create` | Create work orders |
| `identity.users.assign` | Assign users to roles |
| `customers.hierarchy.read` | Read customer hierarchy |
| `customers.hierarchy.update` | Modify customer hierarchy |

Permissions are **atomic**, versioned, and immutable once published.

---

### Roles

Roles represent **reusable access profiles**.

#### Characteristics

- Do not reference scope directly
- Reference one or more policies
- Human-readable
- Reusable across tenants

#### Role Entity

```typescript
interface Role {
  id: string;
  key: string;                    // Unique identifier: "technician_maintenance"
  displayName: string;            // Human-readable: "Maintenance Technician"
  description: string;
  policies: string[];             // Policy keys
  tags: string[];                 // Categorization
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isSystem: boolean;              // Built-in vs custom
  tenantId: string | null;        // null = global
  version: number;
  createdAt: string;
  updatedAt: string;
}
```

#### Example Role

```json
{
  "id": "role-001",
  "key": "technician_maintenance",
  "displayName": "Maintenance Technician",
  "description": "Field technician with maintenance capabilities",
  "policies": ["policy_tech_maintenance_v1"],
  "tags": ["maintenance", "field"],
  "riskLevel": "medium",
  "isSystem": false,
  "tenantId": null
}
```

---

### Policies

Policies define **effective permissions**.

#### Policy Structure

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Unique identifier |
| `version` | number | Policy version |
| `allow` | string[] | List of permission keys |
| `deny` | string[] | List of permission keys or wildcards |
| `conditions` | object | Optional ABAC rules |

#### Policy Entity

```typescript
interface Policy {
  id: string;
  key: string;                    // "policy_tech_maintenance_v1"
  version: number;
  displayName: string;
  description: string;
  allow: string[];                // Allowed permissions
  deny: string[];                 // Denied permissions (supports wildcards)
  conditions?: PolicyConditions;  // Optional ABAC
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PolicyConditions {
  requiresMFA?: boolean;
  onlyBusinessHours?: boolean;
  allowedDeviceTypes?: string[];
  ipAllowlist?: string[];
  maxSessionDuration?: number;    // minutes
}
```

#### Example Policy

```json
{
  "id": "policy-001",
  "key": "policy_tech_maintenance_v1",
  "version": 1,
  "displayName": "Technician Maintenance Policy",
  "allow": [
    "energy.settings.read",
    "energy.devices.read",
    "energy.devices.list",
    "alarms.rules.read",
    "alarms.rules.list",
    "workorders.orders.create",
    "workorders.orders.read",
    "workorders.orders.update",
    "customers.hierarchy.read"
  ],
  "deny": [
    "identity.*",
    "integrations.*",
    "customers.hierarchy.update",
    "customers.hierarchy.delete"
  ],
  "conditions": {
    "requiresMFA": false,
    "onlyBusinessHours": false
  },
  "riskLevel": "medium"
}
```

---

### Scope Model

Scopes define **where permissions apply** within the customer hierarchy.

#### Scope Types

| Scope | Pattern | Description |
|-------|---------|-------------|
| **Tenant** | `tenant:*` | All resources in tenant |
| **Customer** | `customer:{customerId}` | Specific customer and descendants |
| **Asset** | `asset:{assetId}` | Specific asset |
| **Device** | `device:{deviceId}` | Specific device |

#### Scope Hierarchy

Scopes follow the customer hierarchy defined in RFC-0001:

```
tenant:*
  └── customer:{rootCustomerId}
        ├── customer:{childCustomerId}
        │     └── asset:{assetId}
        │           └── device:{deviceId}
        └── customer:{childCustomerId}
              └── asset:{assetId}
```

**Inheritance Rule:** A permission granted at `customer:parent` automatically applies to all descendants (child customers, assets, devices).

---

### Role Assignments

Role assignments bind **users to roles within scopes**.

#### Assignment Entity

```typescript
interface RoleAssignment {
  id: string;
  userId: string;
  roleKey: string;
  scope: string;                  // "customer:cust-123"
  status: 'active' | 'inactive' | 'expired';
  expiresAt: string | null;       // Optional expiration
  grantedBy: string;              // User who granted
  grantedAt: string;
  reason?: string;                // Why granted
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}
```

#### Example Assignment

```json
{
  "id": "assign-001",
  "userId": "user-joao",
  "roleKey": "technician_maintenance",
  "scope": "customer:customer-campinas",
  "status": "active",
  "expiresAt": null,
  "grantedBy": "user-admin",
  "grantedAt": "2026-01-12T10:00:00Z",
  "reason": "Assigned as field technician for Campinas region"
}
```

A user may have **multiple role assignments** with different scopes.

---

### Group Usage

Groups are **organizational constructs**, not permission carriers.

#### Group Entity

```typescript
interface Group {
  id: string;
  key: string;                    // "team_field_south"
  displayName: string;
  description: string;
  members: string[];              // User IDs
  parentGroupId: string | null;   // Group hierarchy
  metadata: Record<string, unknown>;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}
```

#### Best Practices

| Do | Don't |
|----|-------|
| Assign roles to **users** | Assign roles to groups |
| Use groups for UI filtering | Use groups for permission inheritance |
| Use groups for ownership | Grant permissions via group membership |
| Use groups for notification routing | |

---

### Lightweight ABAC (Optional)

Policies may include **conditional constraints** for additional security.

#### Supported Conditions

| Condition | Type | Description |
|-----------|------|-------------|
| `requiresMFA` | boolean | Require multi-factor authentication |
| `onlyBusinessHours` | boolean | Allow only during business hours |
| `allowedDeviceTypes` | string[] | Restrict to specific device types |
| `ipAllowlist` | string[] | Restrict to specific IP addresses |
| `maxSessionDuration` | number | Maximum session duration (minutes) |

#### Example with Conditions

```json
{
  "key": "policy_critical_operations",
  "allow": [
    "energy.settings.update",
    "alarms.rules.delete"
  ],
  "deny": [],
  "conditions": {
    "requiresMFA": true,
    "onlyBusinessHours": true,
    "ipAllowlist": ["10.0.0.0/8", "192.168.1.0/24"],
    "maxSessionDuration": 60
  }
}
```

---

### Permission Evaluation Algorithm

```typescript
async function evaluatePermission(
  userId: string,
  permission: string,
  resourceScope: string
): Promise<AuthzDecision> {
  // 1. Collect all role assignments for user within scope
  const assignments = await getRoleAssignments(userId, resourceScope);

  if (assignments.length === 0) {
    return { allowed: false, reason: 'no_role_assignments' };
  }

  // 2. Resolve policies for all assigned roles
  const policies = await resolvePolicies(assignments);

  // 3. Check explicit deny first (deny always wins)
  for (const policy of policies) {
    if (matchesPermission(policy.deny, permission)) {
      return {
        allowed: false,
        reason: `denied_by_${policy.key}`,
        policyVersion: policy.version,
      };
    }
  }

  // 4. Check allow rules
  for (const policy of policies) {
    if (matchesPermission(policy.allow, permission)) {
      // 5. Evaluate conditions if present
      if (policy.conditions) {
        const conditionResult = await evaluateConditions(policy.conditions, userId);
        if (!conditionResult.passed) {
          return {
            allowed: false,
            reason: `condition_failed_${conditionResult.failedCondition}`,
          };
        }
      }

      return {
        allowed: true,
        reason: `granted_by_${policy.key}`,
        policyVersion: policy.version,
        scopeMatched: findMatchingScope(assignments, resourceScope),
      };
    }
  }

  // 6. Default deny
  return { allowed: false, reason: 'no_matching_permission' };
}

function matchesPermission(patterns: string[], permission: string): boolean {
  return patterns.some(pattern => {
    if (pattern.endsWith('.*')) {
      // Wildcard match: "identity.*" matches "identity.users.read"
      const prefix = pattern.slice(0, -2);
      return permission.startsWith(prefix + '.');
    }
    return pattern === permission;
  });
}
```

#### Evaluation Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Permission Evaluation                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Request   │───▶│    Get      │───▶│   Resolve   │         │
│  │  (user,     │    │    Role     │    │   Policies  │         │
│  │   perm,     │    │ Assignments │    │             │         │
│  │   scope)    │    └─────────────┘    └──────┬──────┘         │
│  └─────────────┘                              │                 │
│                                               ▼                 │
│                    ┌─────────────────────────────────────┐     │
│                    │         Check DENY Rules            │     │
│                    │  (wildcards supported, wins always) │     │
│                    └──────────────┬──────────────────────┘     │
│                                   │                             │
│                         ┌─────────┴─────────┐                  │
│                         │                   │                   │
│                    Denied?            Not Denied                │
│                         │                   │                   │
│                         ▼                   ▼                   │
│                  ┌───────────┐    ┌─────────────────┐          │
│                  │  DENIED   │    │  Check ALLOW    │          │
│                  └───────────┘    │     Rules       │          │
│                                   └────────┬────────┘          │
│                                            │                    │
│                              ┌─────────────┴─────────────┐     │
│                              │                           │      │
│                         Allowed?                   Not Found    │
│                              │                           │      │
│                              ▼                           ▼      │
│                   ┌─────────────────┐           ┌───────────┐  │
│                   │    Evaluate     │           │  DENIED   │  │
│                   │   Conditions    │           │ (default) │  │
│                   └────────┬────────┘           └───────────┘  │
│                            │                                    │
│              ┌─────────────┴─────────────┐                     │
│              │                           │                      │
│         Conditions OK              Conditions Failed            │
│              │                           │                      │
│              ▼                           ▼                      │
│        ┌───────────┐              ┌───────────┐                │
│        │  ALLOWED  │              │  DENIED   │                │
│        └───────────┘              └───────────┘                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Authorization API

#### Evaluate Permission

```http
POST /api/v1/authz/evaluate
Content-Type: application/json
Authorization: Bearer {token}

{
  "userId": "user-joao",
  "permission": "energy.settings.read",
  "resourceScope": "customer:customer-loja-123"
}
```

**Response (Allowed):**

```json
{
  "allowed": true,
  "reason": "granted_by_policy_tech_maintenance_v1",
  "policyVersion": 1,
  "scopeMatched": "customer:customer-campinas",
  "evaluatedAt": "2026-01-12T10:30:00Z"
}
```

**Response (Denied):**

```json
{
  "allowed": false,
  "reason": "denied_by_policy_tech_maintenance_v1",
  "deniedPermission": "identity.*",
  "evaluatedAt": "2026-01-12T10:30:00Z"
}
```

#### Batch Evaluate

```http
POST /api/v1/authz/evaluate-batch
Content-Type: application/json

{
  "userId": "user-joao",
  "resourceScope": "customer:customer-loja-123",
  "permissions": [
    "energy.settings.read",
    "energy.settings.update",
    "alarms.rules.read",
    "identity.users.list"
  ]
}
```

**Response:**

```json
{
  "results": {
    "energy.settings.read": { "allowed": true },
    "energy.settings.update": { "allowed": false, "reason": "no_matching_permission" },
    "alarms.rules.read": { "allowed": true },
    "identity.users.list": { "allowed": false, "reason": "denied_by_policy" }
  },
  "evaluatedAt": "2026-01-12T10:30:00Z"
}
```

#### Get User Effective Permissions

```http
GET /api/v1/authz/users/{userId}/permissions?scope=customer:customer-123
```

**Response:**

```json
{
  "userId": "user-joao",
  "scope": "customer:customer-123",
  "effectivePermissions": [
    "energy.settings.read",
    "energy.devices.read",
    "energy.devices.list",
    "alarms.rules.read",
    "workorders.orders.create"
  ],
  "deniedPatterns": [
    "identity.*",
    "integrations.*"
  ],
  "roles": [
    {
      "roleKey": "technician_maintenance",
      "scope": "customer:customer-campinas",
      "grantedAt": "2026-01-12T10:00:00Z"
    }
  ]
}
```

---

### Audit & Governance

All authorization entities must include:

| Field | Type | Description |
|-------|------|-------------|
| `createdBy` | string | User who created |
| `updatedBy` | string | User who last updated |
| `createdAt` | string | Creation timestamp |
| `updatedAt` | string | Last update timestamp |
| `version` | number | Entity version |
| `source` | string | Always `gcdr` |

#### Authorization Audit Log

```typescript
interface AuthzAuditLog {
  id: string;
  timestamp: string;
  eventType: 'PERMISSION_EVALUATED' | 'ROLE_ASSIGNED' | 'ROLE_REVOKED' | 'POLICY_CHANGED';

  // Actor
  actorId: string;                // User or integration
  actorType: 'user' | 'partner' | 'system';

  // Target
  targetUserId?: string;
  targetResource?: string;

  // Evaluation details
  permission?: string;
  resourceScope?: string;
  decision?: 'allowed' | 'denied';
  reason?: string;
  policyVersion?: number;

  // Context
  ipAddress: string;
  userAgent: string;
  correlationId: string;
}
```

---

### DynamoDB Schema

```
┌───────────────────────────────────────────────────────────────────────┐
│                    Authorization Tables                               │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ROLES TABLE                                                          │
│  PK: TENANT#{tenantId}        SK: ROLE#{roleKey}                     │
│                                                                       │
│  POLICIES TABLE                                                       │
│  PK: TENANT#{tenantId}        SK: POLICY#{policyKey}#V{version}      │
│                                                                       │
│  ROLE_ASSIGNMENTS TABLE                                               │
│  PK: TENANT#{tenantId}        SK: ASSIGN#{userId}#{roleKey}#{scope}  │
│  GSI1: USER#{userId}          GSI1SK: ASSIGN#{tenantId}#{scope}      │
│                                                                       │
│  PERMISSIONS TABLE (Registry)                                         │
│  PK: DOMAIN#{domain}          SK: PERM#{function}#{action}           │
│                                                                       │
│  AUTHZ_AUDIT TABLE                                                    │
│  PK: TENANT#{tenantId}        SK: AUDIT#{timestamp}#{correlationId}  │
│  GSI1: USER#{userId}          GSI1SK: {timestamp}                    │
│  TTL: 90 days                                                         │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

### Security Considerations

| Rule | Description |
|------|-------------|
| **Explicit deny wins** | Deny rules always override allow rules |
| **Wildcards in deny only** | Allow rules must be explicit; deny can use `*` |
| **No implicit global access** | No permission = denied |
| **High-risk approval** | Critical policies require admin approval |
| **Audit everything** | All evaluations and changes are logged |
| **Scope validation** | Scopes must match customer hierarchy |

---

## Drawbacks

- Higher initial complexity
- Requires cultural discipline across teams
- Needs tooling for visibility and management
- Policy versioning adds overhead

---

## Rationale and Alternatives

### Why This Design?

- Clean separation between roles and policies enables reuse
- Scope-aware model fits customer hierarchy naturally
- Explicit deny prevents accidental over-permissioning
- ABAC conditions add flexibility without complexity

### Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| Flat RBAC without scope | Cannot handle customer hierarchy |
| Permissions embedded in users | Not scalable, hard to audit |
| Hardcoded rules per system | Inconsistent, maintenance nightmare |
| Full ABAC | Too complex for current needs |

---

## Prior Art

- [AWS IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/intro-structure.html) - Policy-based access control
- [Google Cloud IAM](https://cloud.google.com/iam/docs/overview) - Role and policy model
- [Open Policy Agent (OPA)](https://www.openpolicyagent.org/) - Policy as code
- [Casbin](https://casbin.org/) - Authorization library patterns

---

## Unresolved Questions

- How to handle cross-tenant permissions (partner access)?
- Should policies support time-based rules (schedules)?
- How to implement permission delegation?
- What is the maximum depth for customer hierarchy scopes?

---

## Future Possibilities

- Policy simulation and dry-run mode
- Permission recommendations based on usage
- Integration with external IdPs (Okta, Azure AD)
- Fine-grained data-level permissions
- Permission request and approval workflows
- Real-time permission revocation

---

## Conclusion

This authorization model establishes a **clean, auditable, and scalable foundation** for access control across the MYIO ecosystem.

By centralizing authorization metadata in the GCDR, MYIO ensures **consistency, security, and long-term maintainability** while remaining flexible for future growth.

**Key benefits:**

- Deterministic permission evaluation
- Hierarchical scope support (customer tree)
- Explicit deny for security
- Full audit trail
- Reusable roles and policies
