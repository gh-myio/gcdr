# RFC-0013: User Access Profile Bundle

- **Feature Name:** `user-access-profile-bundle`
- **Start Date:** 2026-01-29
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** Draft
- **Authors:** MYIO Platform Team
- **Related RFCs:** [RFC-0002](./RFC-0002-GCDR-Authorization-Model.md) (Authorization Model), [RFC-0012](./RFC-0012-Features-Registry.md) (Features Registry)
- **Stakeholders:** Platform, Frontend, Mobile, IoT Integration

---

## Summary

This RFC proposes a **User Access Profile Bundle** - a consolidated JSON structure that provides a complete snapshot of a user's access rights, including:

- User and customer identification
- Maintenance group assignment
- Domain-based permissions (hierarchical: domain → equipment → location → actions)
- Feature-based permissions (dashboard access, UI capabilities)

The bundle enables M2M (machine-to-machine) integrations, offline-capable clients, and efficient permission evaluation without repeated API calls.

---

## Motivation

### Current Problem

The current authorization model evaluates permissions on-demand via API calls. While this works for web applications, it creates challenges for:

1. **Mobile Apps**: Need to cache permissions for offline mode
2. **IoT Devices**: Limited connectivity, need bundled permissions
3. **Node-RED Flows**: Need to know user capabilities at flow design time
4. **Third-Party Integrations**: Need a single payload with all access rights

**Current Flow (Multiple API Calls):**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────>│  Evaluate   │────>│  Evaluate   │────> ... N calls
│             │     │  Permission │     │  Permission │
└─────────────┘     │     #1      │     │     #2      │
                    └─────────────┘     └─────────────┘
```

**Proposed Flow (Single Bundle):**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────>│  Get Access │────>│   Client    │
│             │     │   Bundle    │     │   Caches    │
└─────────────┘     └─────────────┘     │   Bundle    │
                                        └─────────────┘
```

### Use Cases

| Use Case | Problem | Solution |
|----------|---------|----------|
| **Mobile Offline** | No API access when offline | Cache bundle locally |
| **Node-RED Integration** | Need permissions at design time | Bundle defines available actions |
| **Multi-tenant Dashboard** | Different permissions per location | Bundle has location-based permissions |
| **IoT Gateway** | Limited bandwidth, need efficient payload | Compact bundle format |
| **Audit/Compliance** | Need snapshot of user permissions | Bundle is auditable artifact |

### Goals

- Provide a single endpoint to fetch complete user access profile
- Support hierarchical domain permissions (domain → equipment → location)
- Support feature-based permissions (UI capabilities)
- Enable offline caching with expiration
- Maintain compatibility with existing authorization model
- Support scope filtering (customer hierarchy)

### Non-Goals

- Replacing real-time permission evaluation (bundle is a snapshot)
- Implementing client-side permission enforcement (client responsibility)
- Token generation (uses existing JWT)

---

## Guide-level Explanation

### Core Concepts

#### User Access Profile Bundle

A **Bundle** is a JSON document that contains everything needed to determine what a user can do. It's generated on-demand and can be cached by clients.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        USER ACCESS PROFILE BUNDLE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐                                                        │
│  │    PROFILE      │  userId, customerId, maintenanceGroup                  │
│  └─────────────────┘                                                        │
│                                                                              │
│  ┌─────────────────┐                                                        │
│  │ DOMAIN POLICIES │  Hierarchical: domain → equipment → location → actions │
│  │                 │                                                        │
│  │  water          │                                                        │
│  │   └─ hidrometro │                                                        │
│  │       ├─ entry      → [read, update]                                     │
│  │       ├─ common_area → [read, update]                                    │
│  │       └─ stores     → [read, update]                                     │
│  │                 │                                                        │
│  │  energy         │                                                        │
│  │   ├─ hidrometro │                                                        │
│  │   │   ├─ entry      → [read, update]                                     │
│  │   │   └─ stores     → [read, update]                                     │
│  │   └─ temperature│                                                        │
│  │       ├─ internal   → [read, update]                                     │
│  │       └─ external   → [read, update]                                     │
│  └─────────────────┘                                                        │
│                                                                              │
│  ┌─────────────────┐                                                        │
│  │FEATURE POLICIES │  UI capabilities and dashboard access                  │
│  │                 │                                                        │
│  │  dashboard_operational_indicators → guaranteed                           │
│  │  dashboard_head_office            → guaranteed                           │
│  │  alarm_management                 → conditional                          │
│  └─────────────────┘                                                        │
│                                                                              │
│  ┌─────────────────┐                                                        │
│  │    METADATA     │  version, generatedAt, expiresAt, scope                │
│  └─────────────────┘                                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Permission Hierarchy

The bundle uses a **4-level hierarchy** for domain permissions:

```
Level 1: Domain      (water, energy, gas, temperature)
Level 2: Equipment   (hidrometro, medidor, sensor, termometro)
Level 3: Location    (entry, common_area, stores, internal, external)
Level 4: Actions     (read, update, create, delete, execute)
```

This extends the current `domain.function.action` format to support location-based access control, which is critical for multi-site customers.

#### Feature Access Types

| Access Type | Description |
|-------------|-------------|
| `guaranteed` | Always accessible, cannot be revoked |
| `granted` | Currently accessible via role/policy |
| `conditional` | Accessible under certain conditions (time, location, MFA) |
| `denied` | Explicitly denied |
| `not_granted` | Not in user's permissions (default deny) |

---

## Reference-level Explanation

### Bundle JSON Schema

```typescript
interface UserAccessProfileBundle {
  // Schema version
  version: "1.0";

  // User identification
  profile: {
    userId: string;
    userEmail: string;
    customerId: string;
    customerName: string;
    maintenanceGroup: {
      id: string;
      key: string;
      name: string;
    } | null;
  };

  // Hierarchical domain permissions
  domainPolicies: {
    [domain: string]: {
      [equipment: string]: {
        [location: string]: {
          actions: string[];
          conditions?: PolicyConditions;
        };
      };
    };
  };

  // Feature-based permissions
  featurePolicies: {
    [featureKey: string]: {
      access: "guaranteed" | "granted" | "conditional" | "denied" | "not_granted";
      conditions?: PolicyConditions;
      expiresAt?: string;
    };
  };

  // Flat permission list (for quick lookup)
  permissions: {
    allowed: string[];
    denied: string[];
  };

  // Bundle metadata
  metadata: {
    generatedAt: string;
    expiresAt: string;
    ttlSeconds: number;
    scope: string;
    sourceRoles: string[];
    sourcePolicies: string[];
    checksum: string;
  };
}

interface PolicyConditions {
  requiresMFA?: boolean;
  onlyBusinessHours?: boolean;
  allowedIPs?: string[];
  maxSessionDuration?: number;
}
```

### Example Bundle

```json
{
  "version": "1.0",

  "profile": {
    "userId": "usr_abc123",
    "userEmail": "joao.silva@empresa.com",
    "customerId": "cust_xyz789",
    "customerName": "Empresa ABC - Filial Centro",
    "maintenanceGroup": {
      "id": "grp_mnt001",
      "key": "group:maintenance-team-alpha",
      "name": "Equipe de Manutencao Alpha"
    }
  },

  "domainPolicies": {
    "water": {
      "hidrometro": {
        "entry": {
          "actions": ["read", "update"]
        },
        "common_area": {
          "actions": ["read", "update"]
        },
        "stores": {
          "actions": ["read", "update"]
        }
      }
    },
    "energy": {
      "hidrometro": {
        "entry": {
          "actions": ["read", "update"]
        },
        "common_area": {
          "actions": ["read", "update"]
        },
        "stores": {
          "actions": ["read", "update"]
        }
      },
      "temperature": {
        "internal": {
          "actions": ["read", "update"]
        },
        "external": {
          "actions": ["read", "update"]
        }
      }
    }
  },

  "featurePolicies": {
    "dashboard_operational_indicators": {
      "access": "guaranteed"
    },
    "dashboard_head_office": {
      "access": "guaranteed"
    },
    "alarm_management": {
      "access": "granted"
    },
    "user_administration": {
      "access": "denied"
    },
    "reports_export": {
      "access": "conditional",
      "conditions": {
        "onlyBusinessHours": true
      }
    }
  },

  "permissions": {
    "allowed": [
      "water.hidrometro.entry:read",
      "water.hidrometro.entry:update",
      "water.hidrometro.common_area:read",
      "water.hidrometro.common_area:update",
      "water.hidrometro.stores:read",
      "water.hidrometro.stores:update",
      "energy.hidrometro.entry:read",
      "energy.hidrometro.entry:update",
      "energy.hidrometro.common_area:read",
      "energy.hidrometro.common_area:update",
      "energy.hidrometro.stores:read",
      "energy.hidrometro.stores:update",
      "energy.temperature.internal:read",
      "energy.temperature.internal:update",
      "energy.temperature.external:read",
      "energy.temperature.external:update",
      "feature.dashboard_operational_indicators:access",
      "feature.dashboard_head_office:access",
      "feature.alarm_management:access"
    ],
    "denied": [
      "feature.user_administration:access"
    ]
  },

  "metadata": {
    "generatedAt": "2026-01-29T14:30:00Z",
    "expiresAt": "2026-01-29T15:30:00Z",
    "ttlSeconds": 3600,
    "scope": "customer:cust_xyz789",
    "sourceRoles": [
      "role:field-technician",
      "role:dashboard-viewer"
    ],
    "sourcePolicies": [
      "policy:water-management",
      "policy:energy-management",
      "policy:dashboard-access"
    ],
    "checksum": "sha256:a1b2c3d4e5f6..."
  }
}
```

### Database Schema Extensions

```sql
-- =============================================================================
-- MAINTENANCE GROUPS
-- =============================================================================

CREATE TABLE maintenance_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,

  -- Identification
  key VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Scope
  customer_id UUID REFERENCES customers(id),

  -- Members (denormalized for performance)
  member_count INTEGER NOT NULL DEFAULT 0,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,

  CONSTRAINT maintenance_groups_key_unique UNIQUE (tenant_id, key)
);

CREATE INDEX maintenance_groups_customer_idx ON maintenance_groups(customer_id);

-- =============================================================================
-- USER MAINTENANCE GROUP ASSIGNMENTS
-- =============================================================================

CREATE TABLE user_maintenance_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES maintenance_groups(id) ON DELETE CASCADE,

  -- Assignment metadata
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID,
  expires_at TIMESTAMPTZ,

  CONSTRAINT user_maintenance_groups_unique UNIQUE (user_id, group_id)
);

CREATE INDEX user_maintenance_groups_user_idx ON user_maintenance_groups(user_id);
CREATE INDEX user_maintenance_groups_group_idx ON user_maintenance_groups(group_id);

-- =============================================================================
-- DOMAIN PERMISSION DEFINITIONS
-- =============================================================================

CREATE TYPE equipment_type AS ENUM (
  'hidrometro',
  'medidor',
  'sensor',
  'termometro',
  'analisador',
  'controlador',
  'gateway',
  'other'
);

CREATE TYPE location_type AS ENUM (
  'entry',
  'common_area',
  'stores',
  'internal',
  'external',
  'parking',
  'roof',
  'basement',
  'other'
);

CREATE TABLE domain_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,

  -- Permission components
  domain VARCHAR(50) NOT NULL,
  equipment VARCHAR(50) NOT NULL,
  location VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,

  -- Full permission key (computed)
  permission_key VARCHAR(200) GENERATED ALWAYS AS (
    domain || '.' || equipment || '.' || location || ':' || action
  ) STORED,

  -- Metadata
  display_name VARCHAR(255),
  description TEXT,
  risk_level risk_level_enum NOT NULL DEFAULT 'low',

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT domain_permissions_unique UNIQUE (tenant_id, domain, equipment, location, action)
);

CREATE INDEX domain_permissions_domain_idx ON domain_permissions(domain);
CREATE INDEX domain_permissions_equipment_idx ON domain_permissions(equipment);
CREATE INDEX domain_permissions_key_idx ON domain_permissions(permission_key);

-- =============================================================================
-- BUNDLE CACHE (Optional - for performance)
-- =============================================================================

CREATE TABLE user_bundle_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(255) NOT NULL,

  -- Cached bundle
  bundle JSONB NOT NULL,
  checksum VARCHAR(64) NOT NULL,

  -- Validity
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Invalidation tracking
  invalidated_at TIMESTAMPTZ,
  invalidation_reason VARCHAR(255),

  CONSTRAINT user_bundle_cache_unique UNIQUE (tenant_id, user_id, scope)
);

CREATE INDEX user_bundle_cache_expires_idx ON user_bundle_cache(expires_at);
CREATE INDEX user_bundle_cache_user_idx ON user_bundle_cache(user_id);
```

### API Endpoints

#### Bundle Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/users/me/access-bundle` | Get bundle for authenticated user |
| `GET` | `/users/:userId/access-bundle` | Get bundle for specific user (admin) |
| `POST` | `/users/:userId/access-bundle/refresh` | Force refresh cached bundle |
| `DELETE` | `/users/:userId/access-bundle/cache` | Invalidate cached bundle |

#### Bundle Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `scope` | string | Filter by scope (e.g., `customer:uuid`) |
| `includeFeatures` | boolean | Include feature policies (default: true) |
| `includeDomains` | boolean | Include domain policies (default: true) |
| `includeFlat` | boolean | Include flat permission list (default: true) |
| `ttl` | number | Custom TTL in seconds (max: 86400) |

#### Maintenance Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/maintenance-groups` | List all groups |
| `POST` | `/maintenance-groups` | Create group |
| `GET` | `/maintenance-groups/:id` | Get group by ID |
| `PUT` | `/maintenance-groups/:id` | Update group |
| `DELETE` | `/maintenance-groups/:id` | Delete group |
| `POST` | `/maintenance-groups/:id/members` | Add user to group |
| `DELETE` | `/maintenance-groups/:id/members/:userId` | Remove user from group |
| `GET` | `/users/:userId/maintenance-groups` | Get user's groups |

### Example API Requests

#### GET /users/me/access-bundle

```http
GET /users/me/access-bundle?scope=customer:cust_xyz789
Authorization: Bearer {token}
X-Tenant-Id: {tenantId}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "version": "1.0",
    "profile": { ... },
    "domainPolicies": { ... },
    "featurePolicies": { ... },
    "permissions": { ... },
    "metadata": { ... }
  }
}
```

#### POST /users/:userId/access-bundle/refresh

Force regeneration of cached bundle.

```http
POST /users/usr_abc123/access-bundle/refresh
Authorization: Bearer {token}
X-Tenant-Id: {tenantId}

{
  "reason": "Role assignment changed"
}
```

### Bundle Generation Algorithm

```typescript
async function generateAccessBundle(
  tenantId: string,
  userId: string,
  options: BundleOptions
): Promise<UserAccessProfileBundle> {

  // 1. Get user profile
  const user = await userRepository.getById(tenantId, userId);
  const customer = user.customerId
    ? await customerRepository.getById(tenantId, user.customerId)
    : null;

  // 2. Get maintenance group
  const maintenanceGroup = await maintenanceGroupRepository.getByUserId(
    tenantId,
    userId
  );

  // 3. Get effective permissions from authorization service
  const effectivePermissions = await authorizationService.getEffectivePermissions(
    tenantId,
    userId,
    options.scope
  );

  // 4. Build domain policies (hierarchical)
  const domainPolicies = buildDomainPolicies(effectivePermissions);

  // 5. Build feature policies
  const featurePolicies = await buildFeaturePolicies(
    tenantId,
    effectivePermissions
  );

  // 6. Build flat permission lists
  const permissions = {
    allowed: effectivePermissions
      .filter(p => p.allowed)
      .map(p => p.permission),
    denied: effectivePermissions
      .filter(p => !p.allowed && p.explicitlyDenied)
      .map(p => p.permission)
  };

  // 7. Generate metadata
  const now = new Date();
  const expiresAt = new Date(now.getTime() + options.ttl * 1000);

  const bundle: UserAccessProfileBundle = {
    version: "1.0",
    profile: {
      userId: user.id,
      userEmail: user.email,
      customerId: customer?.id ?? null,
      customerName: customer?.displayName ?? null,
      maintenanceGroup: maintenanceGroup ? {
        id: maintenanceGroup.id,
        key: maintenanceGroup.key,
        name: maintenanceGroup.name
      } : null
    },
    domainPolicies,
    featurePolicies,
    permissions,
    metadata: {
      generatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: options.ttl,
      scope: options.scope,
      sourceRoles: effectivePermissions.sourceRoles,
      sourcePolicies: effectivePermissions.sourcePolicies,
      checksum: generateChecksum(bundle)
    }
  };

  // 8. Cache bundle (optional)
  if (options.cache) {
    await bundleCacheRepository.upsert(tenantId, userId, options.scope, bundle);
  }

  return bundle;
}

function buildDomainPolicies(
  permissions: EffectivePermission[]
): DomainPolicies {
  const domainPolicies: DomainPolicies = {};

  for (const perm of permissions) {
    if (!perm.allowed) continue;

    // Parse permission: "domain.equipment.location:action"
    const match = perm.permission.match(/^(\w+)\.(\w+)\.(\w+):(\w+)$/);
    if (!match) continue;

    const [, domain, equipment, location, action] = match;

    // Build hierarchy
    if (!domainPolicies[domain]) {
      domainPolicies[domain] = {};
    }
    if (!domainPolicies[domain][equipment]) {
      domainPolicies[domain][equipment] = {};
    }
    if (!domainPolicies[domain][equipment][location]) {
      domainPolicies[domain][equipment][location] = {
        actions: [],
        conditions: perm.conditions
      };
    }

    domainPolicies[domain][equipment][location].actions.push(action);
  }

  return domainPolicies;
}
```

### Bundle Invalidation

Bundles should be invalidated when:

| Event | Trigger |
|-------|---------|
| Role assignment changed | `ROLE_ASSIGNED`, `ROLE_REVOKED` |
| Policy updated | `POLICY_UPDATED`, `POLICY_DELETED` |
| Role updated | `ROLE_UPDATED`, `ROLE_DELETED` |
| User moved to different customer | `USER_CUSTOMER_CHANGED` |
| Maintenance group changed | `USER_GROUP_CHANGED` |
| Feature flags changed | `FEATURE_TOGGLED` |

```typescript
// Event handler for bundle invalidation
eventService.subscribe([
  EventType.ROLE_ASSIGNED,
  EventType.ROLE_REVOKED,
  EventType.POLICY_UPDATED,
  EventType.USER_CUSTOMER_CHANGED
], async (event) => {
  const userId = event.payload.userId;
  if (userId) {
    await bundleCacheRepository.invalidate(event.tenantId, userId);

    // Optionally notify connected clients
    await notificationService.send(userId, {
      type: 'BUNDLE_INVALIDATED',
      reason: event.type
    });
  }
});
```

---

## Client Integration

### Mobile App (React Native)

```typescript
// services/accessBundle.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const BUNDLE_KEY = '@access_bundle';

export async function getAccessBundle(): Promise<UserAccessProfileBundle> {
  // Check cache first
  const cached = await AsyncStorage.getItem(BUNDLE_KEY);
  if (cached) {
    const bundle = JSON.parse(cached) as UserAccessProfileBundle;
    if (new Date(bundle.metadata.expiresAt) > new Date()) {
      return bundle;
    }
  }

  // Fetch from API
  const response = await api.get('/users/me/access-bundle');
  const bundle = response.data;

  // Cache locally
  await AsyncStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle));

  return bundle;
}

export function canAccess(
  bundle: UserAccessProfileBundle,
  domain: string,
  equipment: string,
  location: string,
  action: string
): boolean {
  return bundle.domainPolicies[domain]
    ?.[equipment]
    ?.[location]
    ?.actions.includes(action) ?? false;
}

export function hasFeature(
  bundle: UserAccessProfileBundle,
  featureKey: string
): boolean {
  const policy = bundle.featurePolicies[featureKey];
  return policy?.access === 'guaranteed' || policy?.access === 'granted';
}
```

### Node-RED Integration

```javascript
// Function node to check permissions from bundle
const bundle = flow.get('userAccessBundle');

const domain = msg.payload.domain;
const equipment = msg.payload.equipment;
const location = msg.payload.location;
const action = msg.payload.action;

const allowed = bundle.domainPolicies?.[domain]
  ?.[equipment]
  ?.[location]
  ?.actions?.includes(action) ?? false;

if (allowed) {
  return [msg, null]; // Output 1: allowed
} else {
  return [null, msg]; // Output 2: denied
}
```

---

## Seed Data

### Domain Permissions

```sql
-- Water domain
INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name) VALUES
(NULL, 'water', 'hidrometro', 'entry', 'read', 'Leitura Hidrometro Entrada'),
(NULL, 'water', 'hidrometro', 'entry', 'update', 'Atualizar Hidrometro Entrada'),
(NULL, 'water', 'hidrometro', 'common_area', 'read', 'Leitura Hidrometro Area Comum'),
(NULL, 'water', 'hidrometro', 'common_area', 'update', 'Atualizar Hidrometro Area Comum'),
(NULL, 'water', 'hidrometro', 'stores', 'read', 'Leitura Hidrometro Lojas'),
(NULL, 'water', 'hidrometro', 'stores', 'update', 'Atualizar Hidrometro Lojas'),

-- Energy domain - hidrometro
(NULL, 'energy', 'hidrometro', 'entry', 'read', 'Leitura Medidor Energia Entrada'),
(NULL, 'energy', 'hidrometro', 'entry', 'update', 'Atualizar Medidor Energia Entrada'),
(NULL, 'energy', 'hidrometro', 'common_area', 'read', 'Leitura Medidor Energia Area Comum'),
(NULL, 'energy', 'hidrometro', 'common_area', 'update', 'Atualizar Medidor Energia Area Comum'),
(NULL, 'energy', 'hidrometro', 'stores', 'read', 'Leitura Medidor Energia Lojas'),
(NULL, 'energy', 'hidrometro', 'stores', 'update', 'Atualizar Medidor Energia Lojas'),

-- Energy domain - temperature
(NULL, 'energy', 'temperature', 'internal', 'read', 'Leitura Temperatura Interna'),
(NULL, 'energy', 'temperature', 'internal', 'update', 'Atualizar Temperatura Interna'),
(NULL, 'energy', 'temperature', 'external', 'read', 'Leitura Temperatura Externa'),
(NULL, 'energy', 'temperature', 'external', 'update', 'Atualizar Temperatura Externa');
```

### Maintenance Groups

```sql
INSERT INTO maintenance_groups (tenant_id, key, name, description) VALUES
('tenant_001', 'group:maintenance-team-alpha', 'Equipe de Manutencao Alpha', 'Equipe responsavel pela regiao Sul'),
('tenant_001', 'group:maintenance-team-beta', 'Equipe de Manutencao Beta', 'Equipe responsavel pela regiao Norte'),
('tenant_001', 'group:maintenance-external', 'Terceirizados', 'Equipe de manutencao terceirizada');
```

### Policies with Domain Permissions

```sql
-- Policy for water technicians
INSERT INTO policies (tenant_id, key, display_name, description, allow, deny, risk_level, is_system) VALUES
('tenant_001', 'policy:water-technician', 'Water Technician Policy', 'Access to water equipment',
  ARRAY[
    'water.hidrometro.entry:read',
    'water.hidrometro.entry:update',
    'water.hidrometro.common_area:read',
    'water.hidrometro.common_area:update',
    'water.hidrometro.stores:read',
    'water.hidrometro.stores:update'
  ],
  ARRAY[]::text[],
  'low',
  true
);

-- Policy for energy technicians
INSERT INTO policies (tenant_id, key, display_name, description, allow, deny, risk_level, is_system) VALUES
('tenant_001', 'policy:energy-technician', 'Energy Technician Policy', 'Access to energy equipment',
  ARRAY[
    'energy.hidrometro.entry:read',
    'energy.hidrometro.entry:update',
    'energy.hidrometro.common_area:read',
    'energy.hidrometro.common_area:update',
    'energy.hidrometro.stores:read',
    'energy.hidrometro.stores:update',
    'energy.temperature.internal:read',
    'energy.temperature.internal:update',
    'energy.temperature.external:read',
    'energy.temperature.external:update'
  ],
  ARRAY[]::text[],
  'low',
  true
);

-- Policy for dashboard access
INSERT INTO policies (tenant_id, key, display_name, description, allow, deny, risk_level, is_system) VALUES
('tenant_001', 'policy:dashboard-viewer', 'Dashboard Viewer Policy', 'Access to operational dashboards',
  ARRAY[
    'feature.dashboard_operational_indicators:access',
    'feature.dashboard_head_office:access'
  ],
  ARRAY[]::text[],
  'low',
  true
);
```

---

## Implementation Plan

### Phase 1: Database Schema

1. Create `maintenance_groups` table
2. Create `user_maintenance_groups` junction table
3. Create `domain_permissions` table
4. Create `user_bundle_cache` table
5. Add seed data

### Phase 2: Core Services

1. Implement `MaintenanceGroupService`
2. Implement `BundleGeneratorService`
3. Implement `BundleCacheService`
4. Add bundle invalidation event handlers

### Phase 3: API Endpoints

1. Implement `/users/me/access-bundle` endpoint
2. Implement `/users/:userId/access-bundle` endpoint
3. Implement maintenance group CRUD endpoints
4. Add OpenAPI documentation

### Phase 4: Integration

1. Update `AuthorizationService` to support new permission format
2. Add support for hierarchical permission matching
3. Create client SDKs (TypeScript, React Native)
4. Create Node-RED integration nodes

### Phase 5: Documentation & Testing

1. Update AUTHORIZATION-MODEL.md
2. Create integration guide
3. Add unit tests for bundle generation
4. Add integration tests for API endpoints

---

## Drawbacks

- Increased complexity in permission format (4-level vs 3-level)
- Bundle caching requires invalidation logic
- Clients must handle bundle expiration
- Additional database tables and maintenance

---

## Alternatives Considered

### 1. Extend Current Permission Format

Keep `domain.function.action` and add location as metadata.

**Rejected because:**
- Doesn't support hierarchical queries
- Breaking change to existing policies
- Less intuitive for location-based access

### 2. GraphQL for Permission Queries

Use GraphQL to allow flexible permission queries.

**Rejected because:**
- Adds complexity for simple use case
- Not suitable for offline caching
- Harder to validate and audit

### 3. JWT Claims with Permissions

Include permissions directly in JWT token.

**Rejected because:**
- Token size limits
- Cannot update without re-authentication
- Security concerns with exposing all permissions

---

## Future Possibilities

- **Bundle Diffing**: Compare bundles to detect permission changes
- **Bundle Signing**: Cryptographically sign bundles for integrity
- **Partial Bundles**: Request only specific domains/features
- **Bundle Streaming**: Real-time updates via WebSocket
- **Bundle Analytics**: Track which permissions are actually used
- **Permission Recommendations**: Suggest optimal permissions based on usage

---

## References

- [RFC-0002: Authorization Model](./RFC-0002-GCDR-Authorization-Model.md)
- [RFC-0012: Features Registry](./RFC-0012-Features-Registry.md)
- [AUTHORIZATION-MODEL.md](./AUTHORIZATION-MODEL.md)
- [AWS IAM Policy Evaluation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-29 | 0.1.0 | Initial draft |
