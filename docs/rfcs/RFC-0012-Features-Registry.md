# RFC-0012: Features Registry

- **Feature Name:** `features-registry`
- **Start Date:** 2026-01-29
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** Draft
- **Authors:** MYIO Platform Team
- **Related RFCs:** [RFC-0002](./RFC-0002-GCDR-Authorization-Model.md) (Authorization Model)
- **Stakeholders:** Platform, Frontend, UX, Security

---

## Summary

This RFC proposes a **Features Registry** system that catalogs all application functionalities and maps them to permissions. This enables:

- Dynamic UI rendering based on user permissions
- Official documentation of all system features
- Admin interface for feature management
- Feature flags integration
- Clear mapping between permissions and user-facing functionality

---

## Motivation

### Current Problem

The current authorization model defines permissions in the format `domain.function.action` (e.g., `energy.reports.read`), but there's no registry that maps these permissions to actual UI features or functionalities.

**Current Gap:**

```
Permission: "energy.reports.read"
     │
     └──── ? ──── What UI feature does this control?
                  What menu item should be shown/hidden?
                  What is the route in the frontend?
```

### Challenges

1. **Frontend Guessing**: Developers hardcode permission checks without a central source of truth
2. **No Feature Documentation**: No official list of all features and what permissions they require
3. **Menu Management**: Each frontend must manually map routes to permissions
4. **Onboarding Difficulty**: New developers don't know what permissions control what
5. **Admin Blindness**: Admins can't easily see what features a role grants access to

### Goals

- Create a central registry of all application features
- Map features to required permissions
- Enable dynamic UI rendering based on user access
- Provide admin visibility into feature-permission relationships
- Support feature flags for gradual rollouts
- Enable module-based feature organization

### Non-Goals

- Replacing the existing permission evaluation engine
- Implementing the actual UI rendering (frontend responsibility)
- Real-time permission enforcement (handled by existing middleware)

---

## Guide-level Explanation

### Core Concepts

#### Permission

A **Permission** is a granular access right in the format `domain.function.action`.

```
energy.reports.read
│      │       │
│      │       └── Action: what operation (read, create, update, delete, execute)
│      └────────── Function: sub-area (reports, settings, rules)
└───────────────── Domain: business area (energy, alarms, devices)
```

#### Feature

A **Feature** is a user-facing functionality in the application. Features:

- Have a unique key (e.g., `energy-store-report`)
- Belong to a module (e.g., `energy`, `alarms`)
- Have a display name and description
- May have a route in the frontend
- Require one or more permissions to access
- Can be hierarchical (parent-child for menu structure)

#### Permissions Registry

A **Permissions Registry** is the official catalog of all valid permissions in the system, with descriptions and metadata.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Features Registry Flow                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. ADMIN SETUP                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  Register    │───►│  Register    │───►│  Map Features to             │  │
│  │  Permissions │    │  Features    │    │  Permissions                 │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────────┘  │
│                                                                              │
│  2. RUNTIME                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  User Login  │───►│  Evaluate    │───►│  Return Accessible           │  │
│  │              │    │  Permissions │    │  Features                    │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────────┘  │
│                                                                              │
│  3. UI RENDERING                                                            │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  Frontend    │───►│  Filter by   │───►│  Render Menu/Components      │  │
│  │  Receives    │    │  Accessible  │    │  Dynamically                 │  │
│  │  Features    │    │  Features    │    │                              │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Reference-level Explanation

### Data Model

#### Permissions Registry Table

Stores all valid permissions in the system.

```typescript
interface Permission {
  id: string;
  tenantId: string | null;      // null = global/system permission

  // Permission key components
  key: string;                   // "energy.reports.read"
  domain: string;                // "energy"
  function: string;              // "reports"
  action: string;                // "read"

  // Metadata
  displayName: string;           // "View Energy Reports"
  description: string;           // "Allows viewing energy consumption reports"

  // Categorization
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isSystem: boolean;             // Built-in vs custom
  isDeprecated: boolean;         // Mark for removal

  // Audit
  createdAt: string;
  updatedAt: string;
  version: number;
}
```

#### Features Table

Stores all application features.

```typescript
interface Feature {
  id: string;
  tenantId: string | null;       // null = global feature

  // Identification
  key: string;                    // "energy-store-report"

  // Display
  displayName: string;            // "Relatório de Energia de Lojas"
  description: string;            // "Visualize energy consumption by store"
  icon?: string;                  // "chart-bar" (icon library reference)

  // Organization
  module: string;                 // "energy"
  category?: string;              // "reports"
  parentFeatureId?: string;       // For hierarchical menu structure
  sortOrder: number;              // Display order within parent

  // Routing
  route?: string;                 // "/reports/energy/stores"
  routeParams?: Record<string, string>;  // Dynamic route params

  // Feature flags
  isActive: boolean;              // Enable/disable feature
  requiredPlan?: string;          // "premium", "enterprise"

  // Visibility
  showInMenu: boolean;            // Show in navigation menu
  showInSearch: boolean;          // Include in global search

  // Metadata
  tags: string[];
  metadata: Record<string, unknown>;

  // Audit
  createdAt: string;
  updatedAt: string;
  version: number;
}
```

#### Feature Permissions Table

Maps features to required permissions.

```typescript
interface FeaturePermission {
  id: string;
  featureId: string;
  permissionKey: string;

  // Requirement type
  requirement: 'required' | 'optional' | 'any_of';
  // required: Must have this permission
  // optional: Enhances feature if present
  // any_of: Need at least one in the group

  groupKey?: string;              // For "any_of" grouping

  // Audit
  createdAt: string;
}
```

### Database Schema

```sql
-- =============================================================================
-- PERMISSIONS REGISTRY
-- =============================================================================

CREATE TABLE permissions_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,  -- NULL for system permissions

  -- Permission key
  key VARCHAR(100) NOT NULL,
  domain VARCHAR(50) NOT NULL,
  function VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,

  -- Display
  display_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Metadata
  risk_level risk_level_enum NOT NULL DEFAULT 'low',
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_deprecated BOOLEAN NOT NULL DEFAULT false,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT permissions_registry_key_unique UNIQUE (tenant_id, key)
);

CREATE INDEX permissions_registry_domain_idx ON permissions_registry(domain);
CREATE INDEX permissions_registry_deprecated_idx ON permissions_registry(is_deprecated);

-- =============================================================================
-- FEATURES
-- =============================================================================

CREATE TABLE features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,  -- NULL for system features

  -- Identification
  key VARCHAR(100) NOT NULL,

  -- Display
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(50),

  -- Organization
  module VARCHAR(50) NOT NULL,
  category VARCHAR(50),
  parent_feature_id UUID REFERENCES features(id),
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Routing
  route VARCHAR(255),
  route_params JSONB,

  -- Feature flags
  is_active BOOLEAN NOT NULL DEFAULT true,
  required_plan VARCHAR(50),

  -- Visibility
  show_in_menu BOOLEAN NOT NULL DEFAULT true,
  show_in_search BOOLEAN NOT NULL DEFAULT true,

  -- Metadata
  tags JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT features_key_unique UNIQUE (tenant_id, key)
);

CREATE INDEX features_module_idx ON features(module);
CREATE INDEX features_parent_idx ON features(parent_feature_id);
CREATE INDEX features_active_idx ON features(is_active);

-- =============================================================================
-- FEATURE PERMISSIONS (Junction Table)
-- =============================================================================

CREATE TABLE feature_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  permission_key VARCHAR(100) NOT NULL,

  requirement VARCHAR(20) NOT NULL DEFAULT 'required',
  group_key VARCHAR(50),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT feature_permissions_unique UNIQUE (feature_id, permission_key)
);

CREATE INDEX feature_permissions_feature_idx ON feature_permissions(feature_id);
CREATE INDEX feature_permissions_permission_idx ON feature_permissions(permission_key);
```

### API Endpoints

#### Permissions Registry

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/permissions` | List all permissions |
| `GET` | `/permissions/:key` | Get permission by key |
| `GET` | `/permissions/domains` | List all domains |
| `GET` | `/permissions/domains/:domain` | List permissions in domain |
| `POST` | `/permissions` | Register new permission (admin) |
| `PUT` | `/permissions/:id` | Update permission (admin) |
| `DELETE` | `/permissions/:id` | Deprecate permission (admin) |

#### Features

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/features` | List all features |
| `GET` | `/features/:key` | Get feature by key |
| `GET` | `/features/modules` | List all modules |
| `GET` | `/features/modules/:module` | List features in module |
| `GET` | `/features/tree` | Get hierarchical feature tree |
| `POST` | `/features` | Create feature (admin) |
| `PUT` | `/features/:id` | Update feature (admin) |
| `DELETE` | `/features/:id` | Delete feature (admin) |

#### Feature Access

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/features/accessible` | Get features accessible to current user |
| `GET` | `/features/accessible/menu` | Get menu structure for current user |
| `POST` | `/features/:key/check` | Check if user can access feature |
| `GET` | `/users/:userId/features` | Get features accessible to specific user |

### Example API Responses

#### GET /features/accessible

Returns features the authenticated user can access.

```json
{
  "success": true,
  "data": {
    "features": [
      {
        "key": "energy-dashboard",
        "displayName": "Dashboard de Energia",
        "description": "Real-time energy monitoring dashboard",
        "icon": "lightning-bolt",
        "module": "energy",
        "route": "/dashboards/energy",
        "permissions": ["energy.dashboards.read"]
      },
      {
        "key": "energy-store-report",
        "displayName": "Relatório de Energia de Lojas",
        "description": "Energy consumption reports by store",
        "icon": "chart-bar",
        "module": "energy",
        "route": "/reports/energy/stores",
        "permissions": ["energy.reports.read"]
      },
      {
        "key": "alarm-rules",
        "displayName": "Regras de Alarme",
        "description": "Configure alarm rules and thresholds",
        "icon": "bell",
        "module": "alarms",
        "route": "/alarms/rules",
        "permissions": ["alarms.rules.read", "alarms.rules.update"]
      }
    ],
    "modules": ["energy", "alarms"],
    "evaluatedAt": "2026-01-29T10:30:00Z"
  }
}
```

#### GET /features/accessible/menu

Returns hierarchical menu structure.

```json
{
  "success": true,
  "data": {
    "menu": [
      {
        "key": "energy",
        "displayName": "Energia",
        "icon": "lightning-bolt",
        "children": [
          {
            "key": "energy-dashboard",
            "displayName": "Dashboard",
            "icon": "chart-pie",
            "route": "/dashboards/energy"
          },
          {
            "key": "energy-reports",
            "displayName": "Relatórios",
            "icon": "document-report",
            "children": [
              {
                "key": "energy-store-report",
                "displayName": "Por Loja",
                "route": "/reports/energy/stores"
              },
              {
                "key": "energy-consumption-report",
                "displayName": "Consumo Geral",
                "route": "/reports/energy/consumption"
              }
            ]
          }
        ]
      },
      {
        "key": "alarms",
        "displayName": "Alarmes",
        "icon": "bell",
        "children": [
          {
            "key": "alarm-dashboard",
            "displayName": "Painel de Alarmes",
            "route": "/alarms"
          },
          {
            "key": "alarm-rules",
            "displayName": "Regras",
            "route": "/alarms/rules"
          }
        ]
      }
    ]
  }
}
```

### Evaluation Logic

```typescript
async function getAccessibleFeatures(
  tenantId: string,
  userId: string,
  scope?: string
): Promise<Feature[]> {
  // 1. Get all active features
  const allFeatures = await featureRepository.getActive(tenantId);

  // 2. Get user's effective permissions
  const userPermissions = await authorizationService.getEffectivePermissions(
    tenantId,
    userId,
    scope
  );

  const allowedPermissions = new Set(
    userPermissions.filter(p => p.allowed).map(p => p.permission)
  );

  // 3. Filter features by permission requirements
  const accessibleFeatures = allFeatures.filter(feature => {
    const featurePerms = feature.permissions;

    // Check required permissions
    const required = featurePerms.filter(fp => fp.requirement === 'required');
    const hasAllRequired = required.every(fp =>
      allowedPermissions.has(fp.permissionKey)
    );

    if (!hasAllRequired) return false;

    // Check "any_of" groups
    const anyOfGroups = groupBy(
      featurePerms.filter(fp => fp.requirement === 'any_of'),
      'groupKey'
    );

    for (const [groupKey, perms] of Object.entries(anyOfGroups)) {
      const hasAny = perms.some(fp => allowedPermissions.has(fp.permissionKey));
      if (!hasAny) return false;
    }

    return true;
  });

  return accessibleFeatures;
}
```

---

## Seed Data

### Permissions Registry

```sql
-- Energy Domain
INSERT INTO permissions_registry (key, domain, function, action, display_name, description, risk_level) VALUES
('energy.dashboards.read', 'energy', 'dashboards', 'read', 'View Energy Dashboards', 'Access to energy monitoring dashboards', 'low'),
('energy.reports.read', 'energy', 'reports', 'read', 'View Energy Reports', 'Access to energy consumption reports', 'low'),
('energy.reports.export', 'energy', 'reports', 'export', 'Export Energy Reports', 'Export energy reports to CSV/PDF', 'low'),
('energy.settings.read', 'energy', 'settings', 'read', 'View Energy Settings', 'View energy configuration', 'low'),
('energy.settings.update', 'energy', 'settings', 'update', 'Update Energy Settings', 'Modify energy configuration', 'medium'),

-- Alarms Domain
('alarms.dashboards.read', 'alarms', 'dashboards', 'read', 'View Alarm Dashboard', 'Access to alarm monitoring panel', 'low'),
('alarms.rules.read', 'alarms', 'rules', 'read', 'View Alarm Rules', 'View alarm rule configurations', 'low'),
('alarms.rules.create', 'alarms', 'rules', 'create', 'Create Alarm Rules', 'Create new alarm rules', 'medium'),
('alarms.rules.update', 'alarms', 'rules', 'update', 'Update Alarm Rules', 'Modify existing alarm rules', 'medium'),
('alarms.rules.delete', 'alarms', 'rules', 'delete', 'Delete Alarm Rules', 'Remove alarm rules', 'high'),

-- Devices Domain
('devices.list.read', 'devices', 'list', 'read', 'List Devices', 'View device list', 'low'),
('devices.details.read', 'devices', 'details', 'read', 'View Device Details', 'View device information', 'low'),
('devices.commands.execute', 'devices', 'commands', 'execute', 'Execute Device Commands', 'Send commands to devices', 'high'),
('devices.settings.update', 'devices', 'settings', 'update', 'Update Device Settings', 'Modify device configuration', 'medium'),

-- Identity Domain
('identity.users.list', 'identity', 'users', 'list', 'List Users', 'View user list', 'low'),
('identity.users.read', 'identity', 'users', 'read', 'View User Details', 'View user information', 'low'),
('identity.users.create', 'identity', 'users', 'create', 'Create Users', 'Create new users', 'high'),
('identity.users.update', 'identity', 'users', 'update', 'Update Users', 'Modify user information', 'medium'),
('identity.users.delete', 'identity', 'users', 'delete', 'Delete Users', 'Remove users', 'critical'),
('identity.roles.read', 'identity', 'roles', 'read', 'View Roles', 'View role definitions', 'low'),
('identity.roles.manage', 'identity', 'roles', 'manage', 'Manage Roles', 'Create, update, delete roles', 'critical'),

-- Customers Domain
('customers.hierarchy.read', 'customers', 'hierarchy', 'read', 'View Customer Hierarchy', 'View customer tree structure', 'low'),
('customers.hierarchy.manage', 'customers', 'hierarchy', 'manage', 'Manage Customer Hierarchy', 'Modify customer structure', 'high');
```

### Features

```sql
-- =============================================================================
-- MODULE: Energy
-- =============================================================================

-- Parent: Energy Module
INSERT INTO features (key, display_name, description, icon, module, sort_order, show_in_menu, route) VALUES
('energy', 'Energia', 'Energy monitoring and management', 'lightning-bolt', 'energy', 1, true, NULL);

-- Energy > Dashboard
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('energy-dashboard', 'Dashboard de Energia', 'Real-time energy monitoring', 'chart-pie', 'energy',
  (SELECT id FROM features WHERE key = 'energy'), 1, '/dashboards/energy');

-- Energy > Reports (parent)
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('energy-reports', 'Relatórios de Energia', 'Energy consumption reports', 'document-report', 'energy',
  (SELECT id FROM features WHERE key = 'energy'), 2, NULL);

-- Energy > Reports > Store Report
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('energy-store-report', 'Relatório por Loja', 'Energy consumption by store location', 'building-storefront', 'energy',
  (SELECT id FROM features WHERE key = 'energy-reports'), 1, '/reports/energy/stores');

-- Energy > Reports > Consumption Report
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('energy-consumption-report', 'Relatório de Consumo', 'General energy consumption analysis', 'chart-bar', 'energy',
  (SELECT id FROM features WHERE key = 'energy-reports'), 2, '/reports/energy/consumption');

-- Energy > Settings
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('energy-settings', 'Configurações de Energia', 'Energy monitoring settings', 'cog', 'energy',
  (SELECT id FROM features WHERE key = 'energy'), 3, '/settings/energy');

-- =============================================================================
-- MODULE: Alarms
-- =============================================================================

-- Parent: Alarms Module
INSERT INTO features (key, display_name, description, icon, module, sort_order, route) VALUES
('alarms', 'Alarmes', 'Alarm management and monitoring', 'bell', 'alarms', 2, NULL);

-- Alarms > Dashboard
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('alarm-dashboard', 'Painel de Alarmes', 'Active alarms monitoring', 'bell-alert', 'alarms',
  (SELECT id FROM features WHERE key = 'alarms'), 1, '/alarms');

-- Alarms > Rules
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('alarm-rules', 'Regras de Alarme', 'Configure alarm rules and thresholds', 'adjustments', 'alarms',
  (SELECT id FROM features WHERE key = 'alarms'), 2, '/alarms/rules');

-- Alarms > History
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('alarm-history', 'Histórico de Alarmes', 'View past alarm events', 'clock', 'alarms',
  (SELECT id FROM features WHERE key = 'alarms'), 3, '/alarms/history');

-- =============================================================================
-- MODULE: Devices
-- =============================================================================

-- Parent: Devices Module
INSERT INTO features (key, display_name, description, icon, module, sort_order, route) VALUES
('devices', 'Dispositivos', 'Device management', 'cpu-chip', 'devices', 3, NULL);

-- Devices > List
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('device-list', 'Lista de Dispositivos', 'View all devices', 'queue-list', 'devices',
  (SELECT id FROM features WHERE key = 'devices'), 1, '/devices');

-- Devices > Commands
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('device-commands', 'Comandos', 'Send commands to devices', 'command-line', 'devices',
  (SELECT id FROM features WHERE key = 'devices'), 2, '/devices/commands');

-- =============================================================================
-- MODULE: Administration
-- =============================================================================

-- Parent: Admin Module
INSERT INTO features (key, display_name, description, icon, module, sort_order, route) VALUES
('admin', 'Administração', 'System administration', 'cog-6-tooth', 'admin', 10, NULL);

-- Admin > Users
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('admin-users', 'Gestão de Usuários', 'User management', 'users', 'admin',
  (SELECT id FROM features WHERE key = 'admin'), 1, '/admin/users');

-- Admin > Roles
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('admin-roles', 'Gestão de Perfis', 'Role and permission management', 'shield-check', 'admin',
  (SELECT id FROM features WHERE key = 'admin'), 2, '/admin/roles');

-- Admin > Customers
INSERT INTO features (key, display_name, description, icon, module, parent_feature_id, sort_order, route) VALUES
('admin-customers', 'Gestão de Clientes', 'Customer hierarchy management', 'building-office', 'admin',
  (SELECT id FROM features WHERE key = 'admin'), 3, '/admin/customers');
```

### Feature Permissions Mapping

```sql
-- Energy Dashboard
INSERT INTO feature_permissions (feature_id, permission_key, requirement) VALUES
((SELECT id FROM features WHERE key = 'energy-dashboard'), 'energy.dashboards.read', 'required');

-- Energy Store Report
INSERT INTO feature_permissions (feature_id, permission_key, requirement) VALUES
((SELECT id FROM features WHERE key = 'energy-store-report'), 'energy.reports.read', 'required');

INSERT INTO feature_permissions (feature_id, permission_key, requirement) VALUES
((SELECT id FROM features WHERE key = 'energy-store-report'), 'energy.reports.export', 'optional');

-- Energy Settings (requires both read AND update)
INSERT INTO feature_permissions (feature_id, permission_key, requirement) VALUES
((SELECT id FROM features WHERE key = 'energy-settings'), 'energy.settings.read', 'required'),
((SELECT id FROM features WHERE key = 'energy-settings'), 'energy.settings.update', 'required');

-- Alarm Rules (any edit permission grants access)
INSERT INTO feature_permissions (feature_id, permission_key, requirement, group_key) VALUES
((SELECT id FROM features WHERE key = 'alarm-rules'), 'alarms.rules.read', 'required', NULL),
((SELECT id FROM features WHERE key = 'alarm-rules'), 'alarms.rules.create', 'any_of', 'edit'),
((SELECT id FROM features WHERE key = 'alarm-rules'), 'alarms.rules.update', 'any_of', 'edit');

-- Device Commands
INSERT INTO feature_permissions (feature_id, permission_key, requirement) VALUES
((SELECT id FROM features WHERE key = 'device-commands'), 'devices.commands.execute', 'required');

-- Admin Users
INSERT INTO feature_permissions (feature_id, permission_key, requirement) VALUES
((SELECT id FROM features WHERE key = 'admin-users'), 'identity.users.list', 'required');

-- Admin Roles
INSERT INTO feature_permissions (feature_id, permission_key, requirement) VALUES
((SELECT id FROM features WHERE key = 'admin-roles'), 'identity.roles.read', 'required'),
((SELECT id FROM features WHERE key = 'admin-roles'), 'identity.roles.manage', 'optional');
```

---

## Integration with Frontend

### React Example

```typescript
// hooks/useFeatures.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useAccessibleFeatures() {
  return useQuery({
    queryKey: ['features', 'accessible'],
    queryFn: () => api.get('/features/accessible'),
  });
}

export function useMenuStructure() {
  return useQuery({
    queryKey: ['features', 'menu'],
    queryFn: () => api.get('/features/accessible/menu'),
  });
}

// components/Sidebar.tsx
function Sidebar() {
  const { data, isLoading } = useMenuStructure();

  if (isLoading) return <SidebarSkeleton />;

  return (
    <nav>
      {data.menu.map(module => (
        <MenuModule key={module.key} module={module} />
      ))}
    </nav>
  );
}

// components/FeatureGate.tsx
function FeatureGate({ feature, children, fallback }) {
  const { data } = useAccessibleFeatures();

  const hasAccess = data?.features.some(f => f.key === feature);

  if (!hasAccess) return fallback || null;

  return children;
}

// Usage
<FeatureGate feature="energy-store-report" fallback={<UpgradePrompt />}>
  <EnergyStoreReport />
</FeatureGate>
```

---

## Implementation Plan

### Phase 1: Database Schema (MVP)

1. Create `permissions_registry` table
2. Create `features` table
3. Create `feature_permissions` junction table
4. Create seed scripts with initial data

### Phase 2: API Endpoints

1. Implement Permissions Registry CRUD
2. Implement Features CRUD
3. Implement Feature-Permission mapping endpoints
4. Implement `GET /features/accessible` endpoint
5. Implement `GET /features/accessible/menu` endpoint

### Phase 3: Integration

1. Update `AuthorizationService` to use permissions registry
2. Add validation for permission keys against registry
3. Update seed scripts with comprehensive data
4. Create admin UI endpoints for management

### Phase 4: Documentation

1. Update AUTHORIZATION-MODEL.md
2. Update ONBOARDING.md
3. Create API documentation in OpenAPI
4. Create frontend integration guide

---

## Drawbacks

- Additional complexity in the authorization model
- Need to maintain feature-permission mappings
- Frontend teams need to adopt new patterns
- Migration effort for existing hardcoded permission checks

---

## Alternatives Considered

### 1. Hardcoded Feature Lists

Define features directly in code without database storage.

**Rejected because:**
- No runtime configurability
- Cannot add tenant-specific features
- Requires deployment for changes

### 2. Permission-Only Approach

Continue using only permissions without features abstraction.

**Rejected because:**
- Frontend must guess UI implications
- No standard for menu structure
- Difficult to document and maintain

### 3. External Feature Flag Service

Use a third-party feature flag service (LaunchDarkly, etc.).

**Rejected because:**
- Additional cost and dependency
- Doesn't integrate with our permission model
- Overkill for current needs

---

## Future Possibilities

- **Feature Analytics**: Track feature usage per user/customer
- **A/B Testing**: Test different feature configurations
- **Feature Bundles**: Group features for subscription plans
- **Feature Requests**: Allow users to request access to features
- **Conditional Features**: Features that depend on other features
- **Time-based Features**: Features available only during certain periods

---

## References

- [RFC-0002: Authorization Model](./RFC-0002-GCDR-Authorization-Model.md)
- [AUTHORIZATION-MODEL.md](./AUTHORIZATION-MODEL.md)
- [Feature Flags Best Practices](https://martinfowler.com/articles/feature-toggles.html)

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-29 | 0.1.0 | Initial draft |
