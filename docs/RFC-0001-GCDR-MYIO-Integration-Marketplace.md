# RFC-0001: GCDR MYIO - Global Central Data Registry & Integration Marketplace

- **Feature Name:** `gcdr-myio-integration-marketplace`
- **Start Date:** 2026-01-12
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** In Progress (Phase 1 MVP ~60% complete)
- **Authors:** MYIO Platform Team
- **Related RFCs:** [RFC-0002](./RFC-0002-GCDR-Authorization-Model.md) (Authorization Model)
- **Stakeholders:** Platform, Ingestion, NodeHub, ThingsBoard, Operations, Partnerships

### Repositories

| Repository | Description | URL |
|------------|-------------|-----|
| **gcdr** | Backend (Serverless API) | https://github.com/gh-myio/gcdr.git |
| **gcdr-frontend** | Frontend (React SPA) | https://github.com/gh-myio/gcdr-frontend.git |

---

## Summary

This RFC proposes the creation of **GCDR MYIO (Global Central Data Registry)** as the **single source of truth** for all master data within the MYIO ecosystem, along with an **Integration & Connectivity Marketplace** that enables controlled, auditable, and scalable communication with internal and external platforms.

The GCDR MYIO will centralize identities, rules, configurations, and visual definitions, while the Marketplace will provide a standardized way to **expose APIs**, **consume external APIs**, and **orchestrate updates** across the ecosystem.

---

## Motivation

Today, the MYIO ecosystem operates with multiple platforms maintaining partial and duplicated data:

- ThingsBoard (telemetry, attributes, dashboards)
- Ingestion services (central data processing)
- NodeHub / Central logic
- Work Order and operational systems

This fragmentation leads to:

- Data divergence (names, contacts, rules)
- Inconsistent alarm behavior
- Manual synchronization
- Limited governance and auditability

The **GCDR MYIO** addresses this by becoming the **authoritative registry**, while the **Integration Marketplace** enables safe and scalable interoperability.

---

## Guide-level Explanation

### Goals

- Establish a **Single Source of Truth** for master data
- Enable **bidirectional integrations** via standardized connectors
- Provide **versioning, auditing, and permissions**
- Decouple platforms through **events and APIs**
- Support **offline and edge synchronization**
- Prepare the ecosystem for **self-service and partnerships**

### Non-Goals

- Replacing telemetry ingestion or time-series storage
- Acting as a real-time data stream processor
- Storing historical telemetry or alarm events
- Becoming a full ERP or CRM system
- UI-heavy management in the initial MVP

### Terminology

| Term | Definition |
|------|------------|
| **GCDR MYIO** | Global Central Data Registry, master data authority |
| **Integration Marketplace** | Registry and runtime for connectors |
| **Integration Package** | A versioned integration plugin |
| **Partner** | External company registered to use APIs or provide integrations |
| **Customer** | End customer entity (can have parent-child hierarchy) |
| **Source of Truth** | The authoritative data owner |
| **Consumer** | Any system reading or syncing data from GCDR |
| **Edge** | NodeHub or Central running with partial autonomy |

---

## Reference-level Explanation

### Core Domains

#### 1. Identity & Hierarchy

```
Tenant
  └── Customer (parentCustomerId: null)           # Root customer
        ├── Customer (parentCustomerId: parent)   # Child customer
        │     ├── Asset
        │     │     └── Device / Central
        │     └── Asset
        └── Customer (parentCustomerId: parent)   # Child customer
              └── Asset
                    └── Device / Central
```

**Customer Hierarchy Model:**

- Customers can have a `parentCustomerId` (nullable for root customers)
- Recursive hierarchy allows unlimited nesting levels
- API supports fetching all descendants (children, grandchildren, etc.)
- Permissions cascade down the hierarchy
- Root customers belong directly to a Tenant

**Entity Relationships:**

| Entity | Parent | Description |
|--------|--------|-------------|
| **Tenant** | - | Top-level organization (isolated data) |
| **Customer** | Tenant or Customer | End customer with optional parent hierarchy |
| **Asset** | Customer | Physical location or equipment group |
| **Device** | Asset | IoT device or sensor |
| **Central** | Asset | Edge controller (NodeHub) |

**Key Properties:**

- Global immutable IDs (UUID v4)
- Official names and aliases
- Relationships and ownership
- `parentCustomerId` for hierarchical relationships
- `path` field for efficient ancestor queries (e.g., `/tenant/customer1/customer2`)

#### 2. Partners & API Access

- Partner registration and onboarding
- API key management
- OAuth2 client credentials
- Usage quotas and rate limits
- Webhook configurations
- Integration package subscriptions

#### 3. Users & Access Control

> **See [RFC-0002: Authorization Model](./RFC-0002-GCDR-Authorization-Model.md)** for complete details.

- Users, groups, roles, and policies
- Permission model: `{domain}.{function}.{action}`
- Scope-aware authorization (customer hierarchy)
- Multi-tenant boundaries
- RBAC with lightweight ABAC conditions
- Full audit trail for all authorization decisions

#### 4. Operational Rules

- Alarm thresholds and hysteresis
- SLA definitions
- Escalation and routing
- Maintenance windows and silencing
- Rules can be scoped to customer hierarchy (inherited by children)

#### 5. Look & Feel

- Theme per customer
- Logos, colors, labels
- Ordering and grouping metadata
- Inherited from parent customer (can be overridden)

---

### Integration Marketplace Overview

The Integration Marketplace is a **first-class component** of GCDR MYIO, responsible for managing all inbound and outbound connectivity.

It enables:

- Controlled API exposure
- External API consumption
- Event-based propagation
- Scheduled synchronization
- Retry, rollback, and reconciliation
- **Partner registration and API access management**

---

### Partner Registration

Partners are external companies or developers who want to integrate with GCDR MYIO via APIs or provide integration packages.

#### Partner Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Register   │────▶│   Pending   │────▶│  Approved   │────▶│   Active    │
│  (Self)     │     │  (Review)   │     │  (Setup)    │     │  (Live)     │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                                       │
                           ▼                                       ▼
                    ┌─────────────┐                         ┌─────────────┐
                    │  Rejected   │                         │  Suspended  │
                    └─────────────┘                         └─────────────┘
```

#### Partner Entity Model

```typescript
interface Partner {
  id: string;                          // UUID
  tenantId: string;                    // GCDR tenant
  status: PartnerStatus;               // PENDING | APPROVED | ACTIVE | SUSPENDED | REJECTED

  // Company Info
  companyName: string;
  companyWebsite: string;
  companyDescription: string;
  industry: string;
  country: string;

  // Contact
  contactName: string;
  contactEmail: string;
  contactPhone?: string;

  // Technical
  technicalContactEmail: string;
  webhookUrl?: string;
  ipWhitelist?: string[];

  // API Access
  apiKeys: ApiKey[];
  oauthClients: OAuthClient[];
  scopes: string[];                    // Granted API scopes

  // Limits
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  monthlyQuota: number;

  // Integration Packages
  subscribedPackages: string[];        // Integration package IDs
  publishedPackages: string[];         // Packages created by partner

  // Audit
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

type PartnerStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

interface ApiKey {
  id: string;
  key: string;                         // Hashed, shown once on creation
  name: string;
  scopes: string[];
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  status: 'ACTIVE' | 'REVOKED';
}

interface OAuthClient {
  clientId: string;
  clientSecret: string;                // Hashed
  name: string;
  redirectUris: string[];
  scopes: string[];
  grantTypes: ('client_credentials' | 'authorization_code')[];
  createdAt: string;
  status: 'ACTIVE' | 'REVOKED';
}
```

#### Partner API Scopes

| Scope | Description |
|-------|-------------|
| `customers:read` | Read customer data |
| `customers:write` | Create/update customers |
| `customers:hierarchy` | Access customer hierarchy (descendants) |
| `assets:read` | Read assets |
| `assets:write` | Create/update assets |
| `devices:read` | Read devices |
| `devices:write` | Create/update devices |
| `rules:read` | Read operational rules |
| `rules:write` | Create/update rules |
| `integrations:read` | Read integration packages |
| `integrations:execute` | Execute integrations |
| `webhooks:manage` | Manage webhook subscriptions |
| `events:subscribe` | Subscribe to domain events |

#### Partner Registration Endpoints

```yaml
# Partner Registration API

# Self-registration (public)
POST /api/v1/partners/register
  body:
    companyName: string
    companyWebsite: string
    companyDescription: string
    contactName: string
    contactEmail: string
    technicalContactEmail: string
    intendedUse: string
    requestedScopes: string[]

# Partner management (admin)
GET    /api/v1/admin/partners
GET    /api/v1/admin/partners/{partnerId}
PATCH  /api/v1/admin/partners/{partnerId}/approve
PATCH  /api/v1/admin/partners/{partnerId}/reject
PATCH  /api/v1/admin/partners/{partnerId}/suspend
DELETE /api/v1/admin/partners/{partnerId}

# Partner self-service (authenticated partner)
GET    /api/v1/partners/me
PATCH  /api/v1/partners/me
GET    /api/v1/partners/me/api-keys
POST   /api/v1/partners/me/api-keys
DELETE /api/v1/partners/me/api-keys/{keyId}
GET    /api/v1/partners/me/oauth-clients
POST   /api/v1/partners/me/oauth-clients
DELETE /api/v1/partners/me/oauth-clients/{clientId}
GET    /api/v1/partners/me/usage
GET    /api/v1/partners/me/webhooks
POST   /api/v1/partners/me/webhooks
DELETE /api/v1/partners/me/webhooks/{webhookId}
```

#### Partner Authentication Flow

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│   Partner   │                    │ API Gateway │                    │    GCDR     │
└──────┬──────┘                    └──────┬──────┘                    └──────┬──────┘
       │                                  │                                  │
       │  POST /oauth/token               │                                  │
       │  grant_type=client_credentials   │                                  │
       │  client_id, client_secret        │                                  │
       │─────────────────────────────────▶│                                  │
       │                                  │  Validate credentials            │
       │                                  │─────────────────────────────────▶│
       │                                  │                                  │
       │                                  │  Partner + scopes                │
       │                                  │◀─────────────────────────────────│
       │  { access_token, expires_in }    │                                  │
       │◀─────────────────────────────────│                                  │
       │                                  │                                  │
       │  GET /api/v1/customers           │                                  │
       │  Authorization: Bearer {token}   │                                  │
       │─────────────────────────────────▶│                                  │
       │                                  │  Validate token + scopes         │
       │                                  │─────────────────────────────────▶│
       │                                  │                                  │
       │                                  │  Customer data                   │
       │                                  │◀─────────────────────────────────│
       │  { customers: [...] }            │                                  │
       │◀─────────────────────────────────│                                  │
       │                                  │                                  │
```

---

### Integration Types

#### Outbound (GCDR → External)

- Push updates to ThingsBoard, NodeHub, OS
- Publish events (`entity.updated`, `rule.changed`)
- Webhooks and event streams

#### Inbound (External → GCDR)

- Receive updates from ERP, OS, partners
- Normalize and validate incoming data
- Enforce permissions and schemas

#### Sync & Reconciliation

- Detect configuration drift
- Compare versions
- Trigger manual or automated resync

---

### Integration Package Model

```yaml
id: thingsboard-sync
type: outbound
version: 1.0.0
status: active
scopes:
  - assets:read
  - rules:write
capabilities:
  - pushAttributes
  - syncDevices
  - publishRules
auth:
  type: oauth2
events:
  - asset.updated
  - rule.changed
```

#### Characteristics

- Versioned
- Scoped permissions
- Tenant-aware
- Auditable
- Rollback capable

---

### Customer Hierarchy API

The Customer API provides full support for hierarchical relationships, allowing queries that traverse the parent-child structure.

#### Customer Entity Model

```typescript
interface Customer {
  id: string;                          // UUID
  tenantId: string;                    // Tenant this customer belongs to
  parentCustomerId: string | null;     // Parent customer (null for root)
  path: string;                        // Materialized path: /tenant/parent/child
  depth: number;                       // Hierarchy depth (0 for root)

  // Basic Info
  name: string;
  displayName: string;
  code: string;                        // Customer code/identifier
  type: CustomerType;                  // HOLDING | COMPANY | BRANCH | FRANCHISE

  // Contact
  email?: string;
  phone?: string;
  address?: Address;

  // Configuration
  settings: CustomerSettings;
  theme?: CustomerTheme;               // Inherited from parent if not set
  metadata: Record<string, unknown>;

  // Status
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

type CustomerType = 'HOLDING' | 'COMPANY' | 'BRANCH' | 'FRANCHISE';

interface CustomerSettings {
  timezone: string;
  locale: string;
  currency: string;
  inheritFromParent: boolean;          // Inherit settings from parent
}

interface CustomerTheme {
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  faviconUrl?: string;
}

interface Address {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  coordinates?: { lat: number; lng: number };
}
```

#### Customer API Endpoints

```yaml
# Customer CRUD
GET    /api/v1/customers                           # List root customers
POST   /api/v1/customers                           # Create root customer
GET    /api/v1/customers/{customerId}              # Get customer by ID
PUT    /api/v1/customers/{customerId}              # Update customer
DELETE /api/v1/customers/{customerId}              # Soft delete customer

# Hierarchy Operations
GET    /api/v1/customers/{customerId}/children     # Get direct children
GET    /api/v1/customers/{customerId}/descendants  # Get all descendants (recursive)
GET    /api/v1/customers/{customerId}/ancestors    # Get all ancestors up to root
GET    /api/v1/customers/{customerId}/siblings     # Get siblings (same parent)
GET    /api/v1/customers/{customerId}/tree         # Get full subtree as nested structure
POST   /api/v1/customers/{customerId}/children     # Create child customer
PATCH  /api/v1/customers/{customerId}/move         # Move to different parent

# Hierarchy Queries
GET    /api/v1/customers/tree                      # Get full hierarchy tree
GET    /api/v1/customers/roots                     # Get only root customers
GET    /api/v1/customers/search?q={query}&includeDescendants=true

# Assets by Customer Hierarchy
GET    /api/v1/customers/{customerId}/assets                    # Direct assets
GET    /api/v1/customers/{customerId}/assets?includeDescendants=true  # All descendant assets
```

#### Hierarchy Query Examples

**Get all descendants (children, grandchildren, etc.):**

```bash
GET /api/v1/customers/cust-123/descendants?depth=3&includeAssets=true

Response:
{
  "data": [
    {
      "id": "cust-456",
      "name": "Child Company",
      "parentCustomerId": "cust-123",
      "depth": 1,
      "path": "/tenant-1/cust-123/cust-456",
      "childrenCount": 2,
      "assetsCount": 5
    },
    {
      "id": "cust-789",
      "name": "Grandchild Branch",
      "parentCustomerId": "cust-456",
      "depth": 2,
      "path": "/tenant-1/cust-123/cust-456/cust-789",
      "childrenCount": 0,
      "assetsCount": 3
    }
  ],
  "pagination": {
    "total": 15,
    "hasMore": true,
    "nextCursor": "eyJsYXN0SWQiOiJjdXN0LTc4OSJ9"
  }
}
```

**Get hierarchy tree (nested structure):**

```bash
GET /api/v1/customers/cust-123/tree?maxDepth=3

Response:
{
  "data": {
    "id": "cust-123",
    "name": "Parent Holding",
    "type": "HOLDING",
    "children": [
      {
        "id": "cust-456",
        "name": "Child Company",
        "type": "COMPANY",
        "children": [
          {
            "id": "cust-789",
            "name": "Branch A",
            "type": "BRANCH",
            "children": []
          }
        ]
      },
      {
        "id": "cust-999",
        "name": "Another Company",
        "type": "COMPANY",
        "children": []
      }
    ]
  }
}
```

**Move customer to new parent:**

```bash
PATCH /api/v1/customers/cust-789/move
{
  "newParentCustomerId": "cust-999"
}

Response:
{
  "data": {
    "id": "cust-789",
    "parentCustomerId": "cust-999",
    "path": "/tenant-1/cust-123/cust-999/cust-789",
    "previousPath": "/tenant-1/cust-123/cust-456/cust-789"
  }
}
```

#### DynamoDB Schema for Hierarchy

```
┌───────────────────────────────────────────────────────────────────────┐
│                    Customer Hierarchy Table                           │
├───────────────────────────────────────────────────────────────────────┤
│  PK                    │  SK                     │  Attributes        │
├────────────────────────┼─────────────────────────┼────────────────────┤
│  TENANT#t1             │  CUSTOMER#cust-123      │  Root customer     │
│  TENANT#t1             │  CUSTOMER#cust-456      │  Child customer    │
│  TENANT#t1             │  CUSTOMER#cust-789      │  Grandchild        │
├───────────────────────────────────────────────────────────────────────┤
│  GSI1: Parent Index                                                   │
├────────────────────────┼─────────────────────────┼────────────────────┤
│  PARENT#cust-123       │  CHILD#cust-456         │  Direct child      │
│  PARENT#cust-456       │  CHILD#cust-789         │  Direct child      │
│  PARENT#ROOT           │  CHILD#cust-123         │  Root customer     │
├───────────────────────────────────────────────────────────────────────┤
│  GSI2: Path Index (for ancestor queries)                              │
├────────────────────────┼─────────────────────────┼────────────────────┤
│  PATH#/t1/cust-123     │  CUSTOMER#cust-123      │  Path lookup       │
│  PATH#/t1/cust-123/... │  CUSTOMER#cust-456      │  Descendant lookup │
└───────────────────────────────────────────────────────────────────────┘
```

#### Hierarchy Service Implementation

```typescript
// src/services/CustomerService.ts

export class CustomerService {
  constructor(
    private readonly repository: CustomerRepository,
    private readonly eventService: EventService
  ) {}

  /**
   * Get all descendants recursively
   */
  async getDescendants(
    tenantId: string,
    customerId: string,
    options?: { maxDepth?: number; includeAssets?: boolean }
  ): Promise<Customer[]> {
    const customer = await this.repository.findById(tenantId, customerId);
    if (!customer) throw new NotFoundError('Customer not found');

    // Use path prefix query for efficient descendant lookup
    return this.repository.findByPathPrefix(
      tenantId,
      customer.path,
      options?.maxDepth
    );
  }

  /**
   * Get ancestors up to root
   */
  async getAncestors(
    tenantId: string,
    customerId: string
  ): Promise<Customer[]> {
    const customer = await this.repository.findById(tenantId, customerId);
    if (!customer) throw new NotFoundError('Customer not found');

    // Parse path to get ancestor IDs
    const ancestorIds = customer.path.split('/').filter(Boolean).slice(1, -1);
    return this.repository.findByIds(tenantId, ancestorIds);
  }

  /**
   * Move customer to new parent
   */
  async moveCustomer(
    tenantId: string,
    customerId: string,
    newParentId: string | null
  ): Promise<Customer> {
    const customer = await this.repository.findById(tenantId, customerId);
    if (!customer) throw new NotFoundError('Customer not found');

    // Validate: can't move to own descendant
    if (newParentId) {
      const newParent = await this.repository.findById(tenantId, newParentId);
      if (newParent?.path.startsWith(customer.path)) {
        throw new ValidationError('Cannot move customer to its own descendant');
      }
    }

    // Update paths for customer and all descendants
    const oldPath = customer.path;
    const newPath = newParentId
      ? `${(await this.repository.findById(tenantId, newParentId))!.path}/${customerId}`
      : `/${tenantId}/${customerId}`;

    await this.repository.updatePathsRecursively(tenantId, oldPath, newPath);

    // Emit event
    await this.eventService.emit({
      type: 'CUSTOMER_MOVED',
      payload: { customerId, oldPath, newPath, newParentId },
    });

    return this.repository.findById(tenantId, customerId)!;
  }

  /**
   * Create child customer
   */
  async createChild(
    tenantId: string,
    parentCustomerId: string,
    dto: CreateCustomerDTO
  ): Promise<Customer> {
    const parent = await this.repository.findById(tenantId, parentCustomerId);
    if (!parent) throw new NotFoundError('Parent customer not found');

    const customer = CustomerFactory.create({
      ...dto,
      tenantId,
      parentCustomerId,
      path: `${parent.path}/${generateId()}`,
      depth: parent.depth + 1,
    });

    await this.repository.create(customer);

    await this.eventService.emit({
      type: 'CUSTOMER_CREATED',
      payload: { customer, parentCustomerId },
    });

    return customer;
  }
}
```

---

### Architecture

#### Core Components

**GCDR Core**

- Master data
- Versioning
- Audit log

**API Gateway**

- Authentication (JWT, OAuth2, API Keys)
- Rate limiting
- Scope enforcement

**Integration Marketplace**

- Connector registry
- Execution engine
- Scheduler
- Retry & DLQ

**Event Bus**

- Internal domain events
- Asynchronous delivery
- Loose coupling

---

### Technology Stack

The GCDR MYIO platform is built on a modern, serverless architecture using TypeScript throughout the entire stack.

#### Project Structure

```
gcdr/                                    # Backend repository
├── src/
│   ├── functions/                       # Lambda handlers (entry points)
│   │   ├── customers/                   # Customer hierarchy endpoints
│   │   │   ├── create.ts
│   │   │   ├── get.ts
│   │   │   ├── list.ts
│   │   │   ├── update.ts
│   │   │   ├── delete.ts
│   │   │   ├── children.ts              # Get/create children
│   │   │   ├── descendants.ts           # Get all descendants
│   │   │   ├── ancestors.ts             # Get ancestors
│   │   │   ├── tree.ts                  # Get hierarchy tree
│   │   │   └── move.ts                  # Move to new parent
│   │   ├── partners/                    # Partner registration endpoints
│   │   │   ├── register.ts
│   │   │   ├── me.ts
│   │   │   ├── apiKeys.ts
│   │   │   └── webhooks.ts
│   │   ├── authz/                       # Authorization endpoints (RFC-0002)
│   │   │   ├── evaluate.ts              # POST /authz/evaluate
│   │   │   ├── evaluateBatch.ts         # POST /authz/evaluate-batch
│   │   │   ├── permissions.ts           # GET /authz/users/{id}/permissions
│   │   │   ├── roles.ts                 # CRUD /authz/roles
│   │   │   ├── policies.ts              # CRUD /authz/policies
│   │   │   └── assignments.ts           # CRUD /authz/assignments
│   │   ├── assets/
│   │   ├── devices/
│   │   ├── rules/
│   │   ├── integrations/
│   │   ├── admin/                       # Admin endpoints
│   │   │   ├── partners.ts              # Partner approval/rejection
│   │   │   ├── roles.ts                 # System role management
│   │   │   └── policies.ts              # System policy management
│   │   └── health.ts
│   │
│   ├── controllers/                     # Request handling & validation
│   │   ├── CustomerController.ts
│   │   ├── PartnerController.ts
│   │   ├── AuthorizationController.ts   # Permission evaluation (RFC-0002)
│   │   ├── RoleController.ts            # Role management (RFC-0002)
│   │   ├── PolicyController.ts          # Policy management (RFC-0002)
│   │   ├── AssetController.ts
│   │   ├── DeviceController.ts
│   │   ├── RuleController.ts
│   │   ├── IntegrationController.ts
│   │   └── BaseController.ts
│   │
│   ├── services/                        # Business logic layer
│   │   ├── CustomerService.ts           # Customer hierarchy logic
│   │   ├── PartnerService.ts            # Partner registration logic
│   │   ├── AuthorizationService.ts      # Permission evaluation (RFC-0002)
│   │   ├── RoleService.ts               # Role management (RFC-0002)
│   │   ├── PolicyService.ts             # Policy management (RFC-0002)
│   │   ├── AssetService.ts
│   │   ├── DeviceService.ts
│   │   ├── RuleService.ts
│   │   ├── IntegrationService.ts
│   │   ├── AuditService.ts
│   │   └── EventService.ts
│   │
│   ├── repositories/                    # Data access layer
│   │   ├── CustomerRepository.ts        # Hierarchy queries
│   │   ├── PartnerRepository.ts
│   │   ├── RoleRepository.ts            # Roles (RFC-0002)
│   │   ├── PolicyRepository.ts          # Policies (RFC-0002)
│   │   ├── RoleAssignmentRepository.ts  # Role assignments (RFC-0002)
│   │   ├── AssetRepository.ts
│   │   ├── DeviceRepository.ts
│   │   ├── RuleRepository.ts
│   │   ├── AuditRepository.ts
│   │   └── BaseRepository.ts
│   │
│   ├── domain/                          # Domain models & business rules
│   │   ├── entities/
│   │   │   ├── Customer.ts              # Customer with parentCustomerId
│   │   │   ├── Partner.ts               # Partner registration
│   │   │   ├── Role.ts                  # Authorization role (RFC-0002)
│   │   │   ├── Policy.ts                # Authorization policy (RFC-0002)
│   │   │   ├── RoleAssignment.ts        # User-Role binding (RFC-0002)
│   │   │   ├── Permission.ts            # Permission registry (RFC-0002)
│   │   │   ├── Asset.ts
│   │   │   ├── Device.ts
│   │   │   ├── Central.ts
│   │   │   └── Rule.ts
│   │   ├── value-objects/
│   │   │   ├── CustomerId.ts
│   │   │   ├── PartnerId.ts
│   │   │   ├── TenantId.ts
│   │   │   ├── Path.ts                  # Materialized path
│   │   │   ├── Scope.ts                 # Authorization scope (RFC-0002)
│   │   │   └── Timestamp.ts
│   │   └── events/
│   │       ├── DomainEvent.ts
│   │       ├── CustomerEvents.ts
│   │       ├── PartnerEvents.ts
│   │       └── AuthorizationEvents.ts   # Role/Policy events (RFC-0002)
│   │
│   ├── factories/                       # Object creation
│   │   ├── CustomerFactory.ts
│   │   ├── PartnerFactory.ts
│   │   ├── RepositoryFactory.ts
│   │   └── ServiceFactory.ts
│   │
│   ├── adapters/                        # External system integrations
│   │   ├── ThingsBoardAdapter.ts
│   │   ├── NodeHubAdapter.ts
│   │   └── BaseAdapter.ts
│   │
│   ├── mappers/                         # Data transformation
│   │   ├── CustomerMapper.ts
│   │   ├── PartnerMapper.ts
│   │   ├── DynamoDBMapper.ts
│   │   └── DTOMapper.ts
│   │
│   ├── dto/                             # Data Transfer Objects
│   │   ├── request/
│   │   │   ├── CreateCustomerDTO.ts
│   │   │   ├── UpdateCustomerDTO.ts
│   │   │   ├── MoveCustomerDTO.ts
│   │   │   ├── RegisterPartnerDTO.ts
│   │   │   └── CreateApiKeyDTO.ts
│   │   └── response/
│   │       ├── CustomerResponseDTO.ts
│   │       ├── CustomerTreeDTO.ts
│   │       ├── PartnerResponseDTO.ts
│   │       └── PaginatedResponseDTO.ts
│   │
│   ├── middleware/                      # Request middleware
│   │   ├── logEvent.ts
│   │   ├── validateRequest.ts
│   │   ├── authenticate.ts
│   │   ├── authenticatePartner.ts       # Partner API key/OAuth
│   │   ├── authorize.ts
│   │   ├── authorizeScope.ts            # Scope-based authorization
│   │   ├── rateLimit.ts                 # Partner rate limiting
│   │   ├── errorHandler.ts
│   │   └── withMiddleware.ts
│   │
│   ├── validators/                      # Input validation
│   │   ├── CustomerValidator.ts
│   │   ├── PartnerValidator.ts
│   │   ├── AssetValidator.ts
│   │   ├── RuleValidator.ts
│   │   └── schemas/
│   │       ├── customerSchemas.ts
│   │       └── partnerSchemas.ts
│   │
│   ├── shared/                          # Shared utilities
│   │   ├── container/                   # Dependency Injection
│   │   │   ├── Container.ts
│   │   │   └── types.ts
│   │   ├── config/
│   │   │   └── Config.ts
│   │   ├── errors/
│   │   │   ├── AppError.ts
│   │   │   ├── NotFoundError.ts
│   │   │   └── ValidationError.ts
│   │   ├── events/
│   │   │   └── eventTypes.ts
│   │   ├── utils/
│   │   │   ├── idGenerator.ts
│   │   │   └── dateUtils.ts
│   │   └── types/
│   │       └── index.ts
│   │
│   └── infrastructure/                  # Infrastructure concerns
│       ├── database/
│       │   └── DynamoDBClient.ts
│       ├── cache/
│       │   └── CacheClient.ts
│       └── messaging/
│           └── EventBridgeClient.ts
│
├── tests/
│   ├── unit/                            # Unit tests
│   │   ├── services/
│   │   │   ├── CustomerService.test.ts
│   │   │   ├── PartnerService.test.ts
│   │   │   └── EventService.test.ts
│   │   ├── repositories/
│   │   │   └── CustomerRepository.test.ts
│   │   ├── controllers/
│   │   │   └── CustomerController.test.ts
│   │   ├── factories/
│   │   │   └── CustomerFactory.test.ts
│   │   └── middleware/
│   │       └── logEvent.test.ts
│   ├── integration/                     # Integration tests
│   │   ├── api/
│   │   │   ├── customers.test.ts
│   │   │   ├── partners.test.ts
│   │   │   └── health.test.ts
│   │   └── database/
│   │       └── dynamodb.test.ts
│   ├── e2e/                             # End-to-end tests
│   │   ├── customer-hierarchy.test.ts
│   │   └── partner-registration.test.ts
│   ├── fixtures/                        # Test data
│   │   ├── customers.ts
│   │   └── partners.ts
│   └── helpers/                         # Test utilities
│       ├── testContainer.ts
│       └── mockDynamoDB.ts
│
├── serverless.yml
├── tsconfig.json
├── package.json
├── jest.config.js
├── sonar-project.properties             # SonarQube config
└── README.md

gcdr-frontend/                           # Frontend repository
├── src/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── services/
│   └── types/
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
├── jest.config.js
├── sonar-project.properties
└── tsconfig.json
```

---

### Testing & Quality Assurance

The project enforces automated testing with a **minimum 50% code coverage** requirement and integrates with **SonarQube/SonarLint** for continuous code quality analysis.

#### Coverage Requirements

| Metric | Minimum | Target |
|--------|---------|--------|
| **Line Coverage** | 50% | 80% |
| **Branch Coverage** | 50% | 75% |
| **Function Coverage** | 50% | 80% |
| **Statement Coverage** | 50% | 80% |

#### Test Types

| Type | Purpose | Location | Coverage Target |
|------|---------|----------|-----------------|
| **Unit Tests** | Test individual functions/classes in isolation | `tests/unit/` | 60%+ |
| **Integration Tests** | Test API endpoints and database operations | `tests/integration/` | 40%+ |
| **E2E Tests** | Test complete user flows | `tests/e2e/` | Critical paths |

#### Jest Configuration

```javascript
// jest.config.js

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/shared/types/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/setup.ts'],
  testTimeout: 10000,
  verbose: true,
};
```

#### SonarQube Configuration

```properties
# sonar-project.properties

sonar.projectKey=gcdr-api
sonar.projectName=GCDR API
sonar.projectVersion=1.0.0

# Source
sonar.sources=src
sonar.tests=tests
sonar.sourceEncoding=UTF-8

# TypeScript
sonar.typescript.lcov.reportPaths=coverage/lcov.info
sonar.javascript.lcov.reportPaths=coverage/lcov.info

# Exclusions
sonar.exclusions=**/node_modules/**,**/dist/**,**/*.test.ts,**/coverage/**
sonar.test.inclusions=**/*.test.ts

# Coverage
sonar.coverage.exclusions=**/tests/**,**/fixtures/**,**/*.d.ts

# Quality Gate
sonar.qualitygate.wait=true
```

#### SonarLint Rules (IDE Integration)

```json
// .vscode/settings.json

{
  "sonarlint.connectedMode.project": {
    "connectionId": "gcdr-sonarqube",
    "projectKey": "gcdr-api"
  },
  "sonarlint.rules": {
    "typescript:S1854": "on",      // Dead stores
    "typescript:S3776": "on",      // Cognitive complexity
    "typescript:S1192": "on",      // String literals duplication
    "typescript:S4144": "on",      // Duplicate functions
    "typescript:S1172": "on",      // Unused parameters
    "typescript:S6544": "on",      // Promises rejection
    "typescript:S4326": "on",      // Await in loops
    "typescript:S6606": "on"       // Nullish coalescing
  }
}
```

#### NPM Scripts for Testing

```json
// package.json

{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:unit": "jest --testPathPattern=tests/unit",
    "test:integration": "jest --testPathPattern=tests/integration",
    "test:e2e": "jest --testPathPattern=tests/e2e",
    "test:ci": "jest --ci --coverage --reporters=default --reporters=jest-junit",
    "lint": "eslint src/ tests/ --ext .ts",
    "lint:fix": "eslint src/ tests/ --ext .ts --fix",
    "sonar": "sonar-scanner",
    "quality": "npm run lint && npm run test:coverage && npm run sonar"
  }
}
```

#### Unit Test Example

```typescript
// tests/unit/services/CustomerService.test.ts

import { CustomerService } from '@/services/CustomerService';
import { CustomerRepository } from '@/repositories/CustomerRepository';
import { EventService } from '@/services/EventService';
import { CustomerFactory } from '@/factories/CustomerFactory';
import { NotFoundError } from '@/shared/errors/NotFoundError';
import { ValidationError } from '@/shared/errors/ValidationError';

// Mock dependencies
jest.mock('@/repositories/CustomerRepository');
jest.mock('@/services/EventService');

describe('CustomerService', () => {
  let service: CustomerService;
  let mockRepository: jest.Mocked<CustomerRepository>;
  let mockEventService: jest.Mocked<EventService>;

  const tenantId = 'tenant-123';
  const mockCustomer = {
    id: 'cust-456',
    tenantId,
    parentCustomerId: null,
    path: '/tenant-123/cust-456',
    depth: 0,
    name: 'Test Customer',
    type: 'COMPANY' as const,
    status: 'ACTIVE' as const,
    version: 1,
    createdAt: '2026-01-12T00:00:00Z',
    updatedAt: '2026-01-12T00:00:00Z',
  };

  beforeEach(() => {
    mockRepository = new CustomerRepository() as jest.Mocked<CustomerRepository>;
    mockEventService = new EventService() as jest.Mocked<EventService>;
    service = new CustomerService(mockRepository, mockEventService);
    jest.clearAllMocks();
  });

  describe('getById', () => {
    it('should return customer when found', async () => {
      mockRepository.findById.mockResolvedValue(mockCustomer);

      const result = await service.getById(tenantId, 'cust-456');

      expect(result).toEqual(mockCustomer);
      expect(mockRepository.findById).toHaveBeenCalledWith(tenantId, 'cust-456');
    });

    it('should throw NotFoundError when customer not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.getById(tenantId, 'invalid-id'))
        .rejects
        .toThrow(NotFoundError);
    });
  });

  describe('getDescendants', () => {
    it('should return all descendants', async () => {
      const descendants = [
        { ...mockCustomer, id: 'child-1', parentCustomerId: 'cust-456', depth: 1 },
        { ...mockCustomer, id: 'child-2', parentCustomerId: 'cust-456', depth: 1 },
        { ...mockCustomer, id: 'grandchild-1', parentCustomerId: 'child-1', depth: 2 },
      ];

      mockRepository.findById.mockResolvedValue(mockCustomer);
      mockRepository.findByPathPrefix.mockResolvedValue(descendants);

      const result = await service.getDescendants(tenantId, 'cust-456');

      expect(result).toHaveLength(3);
      expect(mockRepository.findByPathPrefix).toHaveBeenCalledWith(
        tenantId,
        mockCustomer.path,
        undefined
      );
    });

    it('should respect maxDepth option', async () => {
      mockRepository.findById.mockResolvedValue(mockCustomer);
      mockRepository.findByPathPrefix.mockResolvedValue([]);

      await service.getDescendants(tenantId, 'cust-456', { maxDepth: 2 });

      expect(mockRepository.findByPathPrefix).toHaveBeenCalledWith(
        tenantId,
        mockCustomer.path,
        2
      );
    });
  });

  describe('create', () => {
    const createDto = {
      name: 'New Customer',
      type: 'COMPANY' as const,
    };

    it('should create customer and emit event', async () => {
      mockRepository.create.mockResolvedValue(mockCustomer);
      mockEventService.emit.mockResolvedValue();

      const result = await service.create(tenantId, createDto);

      expect(result).toBeDefined();
      expect(mockRepository.create).toHaveBeenCalled();
      expect(mockEventService.emit).toHaveBeenCalledWith({
        type: 'CUSTOMER_CREATED',
        payload: expect.objectContaining({ customer: expect.any(Object) }),
      });
    });
  });

  describe('moveCustomer', () => {
    it('should prevent moving customer to its own descendant', async () => {
      const parent = { ...mockCustomer, path: '/tenant-123/parent' };
      const descendant = {
        ...mockCustomer,
        id: 'descendant',
        path: '/tenant-123/parent/child/descendant',
      };

      mockRepository.findById
        .mockResolvedValueOnce(parent)           // Customer to move
        .mockResolvedValueOnce(descendant);      // New parent (is descendant)

      await expect(service.moveCustomer(tenantId, parent.id, 'descendant'))
        .rejects
        .toThrow(ValidationError);
    });
  });
});
```

#### Integration Test Example

```typescript
// tests/integration/api/customers.test.ts

import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler as listHandler } from '@/functions/customers/list';
import { handler as createHandler } from '@/functions/customers/create';
import { handler as getDescendantsHandler } from '@/functions/customers/descendants';
import { setupTestDatabase, teardownTestDatabase, seedCustomers } from '../../helpers/testDatabase';

describe('Customer API Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await seedCustomers();
  });

  const createMockEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/customers',
    pathParameters: null,
    queryStringParameters: null,
    body: null,
    headers: {
      Authorization: 'Bearer test-token',
    },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:tenantId': 'tenant-123',
        },
      },
    } as any,
    ...overrides,
  } as APIGatewayProxyEvent);

  const mockContext: Context = {
    awsRequestId: 'test-request-id',
  } as Context;

  describe('GET /customers', () => {
    it('should return list of root customers', async () => {
      const event = createMockEvent();

      const response = await listHandler(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('POST /customers', () => {
    it('should create new customer', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: 'New Test Customer',
          type: 'COMPANY',
        }),
      });

      const response = await createHandler(event, mockContext);

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('New Test Customer');
      expect(body.data.id).toBeDefined();
    });

    it('should return 400 for invalid request', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          // Missing required 'name' field
          type: 'COMPANY',
        }),
      });

      const response = await createHandler(event, mockContext);

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /customers/:id/descendants', () => {
    it('should return all descendants', async () => {
      const event = createMockEvent({
        pathParameters: { customerId: 'root-customer-id' },
        queryStringParameters: { maxDepth: '3' },
      });

      const response = await getDescendantsHandler(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
```

#### Test Fixtures

```typescript
// tests/fixtures/customers.ts

import { Customer } from '@/domain/entities/Customer';

export const createMockCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'cust-' + Math.random().toString(36).substr(2, 9),
  tenantId: 'tenant-123',
  parentCustomerId: null,
  path: '/tenant-123/cust-123',
  depth: 0,
  name: 'Test Customer',
  displayName: 'Test Customer',
  code: 'TC001',
  type: 'COMPANY',
  status: 'ACTIVE',
  settings: {
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    currency: 'BRL',
    inheritFromParent: false,
  },
  metadata: {},
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export const createCustomerHierarchy = () => {
  const root = createMockCustomer({
    id: 'root',
    path: '/tenant-123/root',
    depth: 0,
  });

  const child1 = createMockCustomer({
    id: 'child-1',
    parentCustomerId: 'root',
    path: '/tenant-123/root/child-1',
    depth: 1,
  });

  const child2 = createMockCustomer({
    id: 'child-2',
    parentCustomerId: 'root',
    path: '/tenant-123/root/child-2',
    depth: 1,
  });

  const grandchild = createMockCustomer({
    id: 'grandchild-1',
    parentCustomerId: 'child-1',
    path: '/tenant-123/root/child-1/grandchild-1',
    depth: 2,
  });

  return { root, child1, child2, grandchild };
};
```

#### Test Container (Dependency Injection for Tests)

```typescript
// tests/helpers/testContainer.ts

import { container, bootstrapContainer } from '@/shared/container/Container';
import { TYPES } from '@/shared/container/types';

// Mock implementations
class MockCustomerRepository {
  private customers: Map<string, Customer> = new Map();

  async findById(tenantId: string, id: string) {
    return this.customers.get(id) || null;
  }

  async create(customer: Customer) {
    this.customers.set(customer.id, customer);
    return customer;
  }

  // Reset for tests
  reset() {
    this.customers.clear();
  }
}

class MockEventService {
  public emittedEvents: any[] = [];

  async emit(event: any) {
    this.emittedEvents.push(event);
  }

  reset() {
    this.emittedEvents = [];
  }
}

export function setupTestContainer() {
  container.clear();

  const mockRepository = new MockCustomerRepository();
  const mockEventService = new MockEventService();

  container.register(TYPES.CustomerRepository, () => mockRepository);
  container.register(TYPES.EventService, () => mockEventService);

  return { mockRepository, mockEventService };
}

export function resetTestContainer() {
  container.clear();
  bootstrapContainer(); // Restore real implementations
}
```

#### GitHub Actions CI Pipeline

```yaml
# .github/workflows/ci.yml

name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run tests with coverage
        run: npm run test:ci

      - name: Check coverage threshold
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 50" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 50% threshold"
            exit 1
          fi
          echo "Coverage: $COVERAGE%"

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true

      - name: SonarQube Scan
        uses: sonarsource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}

      - name: SonarQube Quality Gate
        uses: sonarsource/sonarqube-quality-gate-action@master
        timeout-minutes: 5
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}

  build:
    needs: test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Serverless package
        run: npx serverless package
```

#### Quality Gate Metrics

SonarQube Quality Gate configuration with minimum thresholds:

| Metric | Condition | Threshold |
|--------|-----------|-----------|
| **Coverage** | is less than | 50% |
| **Duplicated Lines** | is greater than | 3% |
| **Maintainability Rating** | is worse than | A |
| **Reliability Rating** | is worse than | A |
| **Security Rating** | is worse than | A |
| **Security Hotspots Reviewed** | is less than | 100% |
| **Blocker Issues** | is greater than | 0 |
| **Critical Issues** | is greater than | 0 |

#### Pre-commit Hook

```json
// package.json - husky + lint-staged

{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged",
      "pre-push": "npm run test:coverage"
    }
  },
  "lint-staged": {
    "*.ts": [
      "eslint --fix",
      "jest --bail --findRelatedTests"
    ]
  }
}
```

---

### Design Patterns

The backend architecture implements the following design patterns to ensure maintainability, testability, and scalability.

#### Pattern Overview

| Pattern | Purpose | Location |
|---------|---------|----------|
| **Singleton** | Single instance for shared resources | `DynamoDBClient`, `Config`, `Container` |
| **Repository** | Data access abstraction | `src/repositories/` |
| **Service** | Business logic encapsulation | `src/services/` |
| **Controller** | Request handling & orchestration | `src/controllers/` |
| **Factory** | Complex object creation | `src/factories/` |
| **Adapter** | External system integration | `src/adapters/` |
| **Mapper** | Data transformation between layers | `src/mappers/` |
| **DTO** | Data transfer between layers | `src/dto/` |
| **Middleware** | Cross-cutting concerns | `src/middleware/` |
| **Dependency Injection** | Loose coupling & testability | `src/shared/container/` |
| **Strategy** | Interchangeable algorithms | Integration handlers |
| **Observer** | Domain event handling | `src/domain/events/` |
| **Builder** | Complex entity construction | Entity creation |
| **Value Object** | Immutable domain primitives | `src/domain/value-objects/` |

---

#### 1. Singleton Pattern

Single instance for shared resources like database clients and configuration.

```typescript
// src/infrastructure/database/DynamoDBClient.ts

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

class DynamoDBClientSingleton {
  private static instance: DynamoDBDocumentClient | null = null;

  private constructor() {}

  public static getInstance(): DynamoDBDocumentClient {
    if (!DynamoDBClientSingleton.instance) {
      const client = new DynamoDBClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });

      DynamoDBClientSingleton.instance = DynamoDBDocumentClient.from(client, {
        marshallOptions: {
          removeUndefinedValues: true,
          convertEmptyValues: true,
        },
      });
    }

    return DynamoDBClientSingleton.instance;
  }
}

export const dynamoDBClient = DynamoDBClientSingleton.getInstance();
```

```typescript
// src/shared/config/Config.ts

interface AppConfig {
  tableName: string;
  auditTableName: string;
  stage: string;
  region: string;
}

class ConfigSingleton {
  private static instance: AppConfig | null = null;

  public static getInstance(): AppConfig {
    if (!ConfigSingleton.instance) {
      ConfigSingleton.instance = {
        tableName: process.env.DYNAMODB_TABLE || 'gcdr-api-dev',
        auditTableName: process.env.AUDIT_TABLE || 'gcdr-api-dev-audit',
        stage: process.env.STAGE || 'dev',
        region: process.env.AWS_REGION || 'us-east-1',
      };
    }
    return ConfigSingleton.instance;
  }
}

export const config = ConfigSingleton.getInstance();
```

---

#### 2. Repository Pattern

Abstracts data access, making it easy to swap storage implementations.

```typescript
// src/repositories/BaseRepository.ts

export interface IBaseRepository<T> {
  findById(id: string): Promise<T | null>;
  findAll(params?: QueryParams): Promise<PaginatedResult<T>>;
  create(entity: T): Promise<T>;
  update(id: string, entity: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

export abstract class BaseRepository<T> implements IBaseRepository<T> {
  protected readonly client = dynamoDBClient;
  protected readonly tableName = config.tableName;

  abstract get entityType(): string;

  protected buildPK(tenantId: string): string {
    return `TENANT#${tenantId}`;
  }

  protected buildSK(id: string): string {
    return `${this.entityType}#${id}`;
  }

  // ... implementation
}
```

```typescript
// src/repositories/EntityRepository.ts

import { BaseRepository } from './BaseRepository';
import { Entity } from '../domain/entities/Entity';
import { EntityMapper } from '../mappers/EntityMapper';

export class EntityRepository extends BaseRepository<Entity> {
  get entityType(): string {
    return 'ENTITY';
  }

  async findById(tenantId: string, id: string): Promise<Entity | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildPK(tenantId),
          SK: this.buildSK(id),
        },
      })
    );

    return result.Item ? EntityMapper.toDomain(result.Item) : null;
  }

  async findByType(tenantId: string, type: string): Promise<Entity[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': this.buildPK(tenantId),
          ':sk': `${type.toUpperCase()}#`,
        },
      })
    );

    return (result.Items || []).map(EntityMapper.toDomain);
  }

  async create(entity: Entity): Promise<Entity> {
    const item = EntityMapper.toPersistence(entity);

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    return entity;
  }

  async update(entity: Entity): Promise<Entity> {
    const item = EntityMapper.toPersistence(entity);

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...item,
          updatedAt: new Date().toISOString(),
          version: (entity.version || 0) + 1,
        },
        ConditionExpression: 'version = :version',
        ExpressionAttributeValues: {
          ':version': entity.version || 0,
        },
      })
    );

    return entity;
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildPK(tenantId),
          SK: this.buildSK(id),
        },
        UpdateExpression: 'SET deletedAt = :deletedAt, #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':deletedAt': new Date().toISOString(),
          ':status': 'DELETED',
        },
      })
    );
  }
}
```

---

#### 3. Service Pattern

Encapsulates business logic, orchestrating repositories and domain rules.

```typescript
// src/services/EntityService.ts

import { EntityRepository } from '../repositories/EntityRepository';
import { EntityFactory } from '../factories/EntityFactory';
import { EventService } from './EventService';
import { AuditService } from './AuditService';
import { CreateEntityDTO } from '../dto/request/CreateEntityDTO';
import { Entity } from '../domain/entities/Entity';
import { NotFoundError } from '../shared/errors/NotFoundError';
import { ValidationError } from '../shared/errors/ValidationError';

export class EntityService {
  constructor(
    private readonly repository: EntityRepository,
    private readonly eventService: EventService,
    private readonly auditService: AuditService
  ) {}

  async getById(tenantId: string, id: string): Promise<Entity> {
    const entity = await this.repository.findById(tenantId, id);

    if (!entity) {
      throw new NotFoundError(`Entity ${id} not found`);
    }

    return entity;
  }

  async listByType(tenantId: string, type: string): Promise<Entity[]> {
    return this.repository.findByType(tenantId, type);
  }

  async create(tenantId: string, dto: CreateEntityDTO): Promise<Entity> {
    // Validate business rules
    await this.validateCreateRules(tenantId, dto);

    // Create entity using factory
    const entity = EntityFactory.create({
      tenantId,
      type: dto.type,
      name: dto.name,
      parentId: dto.parentId,
      metadata: dto.metadata,
    });

    // Persist
    const created = await this.repository.create(entity);

    // Emit domain event
    await this.eventService.emit({
      type: 'ENTITY_CREATED',
      payload: { entity: created },
    });

    return created;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateEntityDTO
  ): Promise<Entity> {
    const existing = await this.getById(tenantId, id);

    // Store before state for audit
    const beforeState = { ...existing };

    // Apply updates
    const updated = EntityFactory.update(existing, dto);

    // Persist
    await this.repository.update(updated);

    // Emit domain event
    await this.eventService.emit({
      type: 'ENTITY_UPDATED',
      payload: {
        entity: updated,
        changes: dto,
      },
    });

    // Audit log with before/after
    await this.auditService.logChange({
      entityId: id,
      entityType: existing.type,
      before: beforeState,
      after: updated,
    });

    return updated;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);

    // Check if can be deleted (no children, etc.)
    await this.validateDeleteRules(tenantId, existing);

    // Soft delete
    await this.repository.softDelete(tenantId, id);

    // Emit domain event
    await this.eventService.emit({
      type: 'ENTITY_DELETED',
      payload: { entityId: id, entityType: existing.type },
    });
  }

  private async validateCreateRules(
    tenantId: string,
    dto: CreateEntityDTO
  ): Promise<void> {
    // Check parent exists if provided
    if (dto.parentId) {
      const parent = await this.repository.findById(tenantId, dto.parentId);
      if (!parent) {
        throw new ValidationError(`Parent ${dto.parentId} not found`);
      }
    }

    // Check name uniqueness within scope
    // ... additional business rules
  }

  private async validateDeleteRules(
    tenantId: string,
    entity: Entity
  ): Promise<void> {
    // Check for children
    const children = await this.repository.findByParent(tenantId, entity.id);
    if (children.length > 0) {
      throw new ValidationError(
        `Cannot delete entity with ${children.length} children`
      );
    }
  }
}
```

---

#### 4. Controller Pattern

Handles HTTP requests, validates input, and delegates to services.

```typescript
// src/controllers/BaseController.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export abstract class BaseController {
  protected success<T>(data: T, statusCode = 200): APIGatewayProxyResult {
    return {
      statusCode,
      headers: this.corsHeaders(),
      body: JSON.stringify({ success: true, data }),
    };
  }

  protected created<T>(data: T): APIGatewayProxyResult {
    return this.success(data, 201);
  }

  protected noContent(): APIGatewayProxyResult {
    return {
      statusCode: 204,
      headers: this.corsHeaders(),
      body: '',
    };
  }

  protected error(
    message: string,
    statusCode = 500,
    code?: string
  ): APIGatewayProxyResult {
    return {
      statusCode,
      headers: this.corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: { message, code },
      }),
    };
  }

  protected getTenantId(event: APIGatewayProxyEvent): string {
    return event.requestContext.authorizer?.claims?.['custom:tenantId'];
  }

  protected getPathParam(event: APIGatewayProxyEvent, name: string): string {
    return event.pathParameters?.[name] || '';
  }

  protected parseBody<T>(event: APIGatewayProxyEvent): T {
    return JSON.parse(event.body || '{}');
  }

  private corsHeaders() {
    return {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
    };
  }
}
```

```typescript
// src/controllers/EntityController.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BaseController } from './BaseController';
import { EntityService } from '../services/EntityService';
import { CreateEntityDTO, UpdateEntityDTO } from '../dto/request';
import { EntityValidator } from '../validators/EntityValidator';
import { container } from '../shared/container/Container';

export class EntityController extends BaseController {
  private service: EntityService;

  constructor() {
    super();
    this.service = container.resolve<EntityService>('EntityService');
  }

  async list(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const tenantId = this.getTenantId(event);
    const type = this.getPathParam(event, 'type');

    const entities = await this.service.listByType(tenantId, type);

    return this.success(entities);
  }

  async get(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const tenantId = this.getTenantId(event);
    const id = this.getPathParam(event, 'id');

    const entity = await this.service.getById(tenantId, id);

    return this.success(entity);
  }

  async create(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const tenantId = this.getTenantId(event);
    const dto = this.parseBody<CreateEntityDTO>(event);

    // Validate input
    await EntityValidator.validateCreate(dto);

    const entity = await this.service.create(tenantId, dto);

    return this.created(entity);
  }

  async update(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const tenantId = this.getTenantId(event);
    const id = this.getPathParam(event, 'id');
    const dto = this.parseBody<UpdateEntityDTO>(event);

    // Validate input
    await EntityValidator.validateUpdate(dto);

    const entity = await this.service.update(tenantId, id, dto);

    return this.success(entity);
  }

  async delete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const tenantId = this.getTenantId(event);
    const id = this.getPathParam(event, 'id');

    await this.service.delete(tenantId, id);

    return this.noContent();
  }
}

// Export singleton instance
export const entityController = new EntityController();
```

---

#### 5. Factory Pattern

Creates complex objects with proper initialization and validation.

```typescript
// src/factories/EntityFactory.ts

import { Entity, EntityType } from '../domain/entities/Entity';
import { Group } from '../domain/entities/Group';
import { Shop } from '../domain/entities/Shop';
import { Store } from '../domain/entities/Store';
import { Asset } from '../domain/entities/Asset';
import { Device } from '../domain/entities/Device';
import { generateId } from '../shared/utils/idGenerator';

interface CreateEntityParams {
  tenantId: string;
  type: EntityType;
  name: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export class EntityFactory {
  static create(params: CreateEntityParams): Entity {
    const baseEntity = {
      id: generateId(),
      tenantId: params.tenantId,
      name: params.name,
      parentId: params.parentId,
      metadata: params.metadata || {},
      status: 'ACTIVE' as const,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    switch (params.type) {
      case 'GROUP':
        return new Group(baseEntity);
      case 'SHOP':
        return new Shop(baseEntity);
      case 'STORE':
        return new Store(baseEntity);
      case 'ASSET':
        return new Asset(baseEntity);
      case 'DEVICE':
        return new Device(baseEntity);
      default:
        throw new Error(`Unknown entity type: ${params.type}`);
    }
  }

  static update<T extends Entity>(entity: T, updates: Partial<T>): T {
    return {
      ...entity,
      ...updates,
      updatedAt: new Date().toISOString(),
      version: entity.version + 1,
    };
  }

  static fromPersistence(data: Record<string, unknown>): Entity {
    const type = data.entityType as EntityType;
    return EntityFactory.create({
      tenantId: data.tenantId as string,
      type,
      name: data.name as string,
      parentId: data.parentId as string,
      metadata: data.metadata as Record<string, unknown>,
    });
  }
}
```

```typescript
// src/factories/ServiceFactory.ts

import { EntityService } from '../services/EntityService';
import { RuleService } from '../services/RuleService';
import { EventService } from '../services/EventService';
import { AuditService } from '../services/AuditService';
import { RepositoryFactory } from './RepositoryFactory';

export class ServiceFactory {
  private static instances = new Map<string, unknown>();

  static getEntityService(): EntityService {
    if (!this.instances.has('EntityService')) {
      this.instances.set(
        'EntityService',
        new EntityService(
          RepositoryFactory.getEntityRepository(),
          this.getEventService(),
          this.getAuditService()
        )
      );
    }
    return this.instances.get('EntityService') as EntityService;
  }

  static getEventService(): EventService {
    if (!this.instances.has('EventService')) {
      this.instances.set('EventService', new EventService());
    }
    return this.instances.get('EventService') as EventService;
  }

  static getAuditService(): AuditService {
    if (!this.instances.has('AuditService')) {
      this.instances.set(
        'AuditService',
        new AuditService(RepositoryFactory.getAuditRepository())
      );
    }
    return this.instances.get('AuditService') as AuditService;
  }
}
```

---

#### 6. Dependency Injection Container

Provides loose coupling and easy testing through dependency injection.

```typescript
// src/shared/container/types.ts

export const TYPES = {
  // Repositories
  EntityRepository: Symbol.for('EntityRepository'),
  RuleRepository: Symbol.for('RuleRepository'),
  AuditRepository: Symbol.for('AuditRepository'),

  // Services
  EntityService: Symbol.for('EntityService'),
  RuleService: Symbol.for('RuleService'),
  EventService: Symbol.for('EventService'),
  AuditService: Symbol.for('AuditService'),

  // Adapters
  ThingsBoardAdapter: Symbol.for('ThingsBoardAdapter'),
  NodeHubAdapter: Symbol.for('NodeHubAdapter'),

  // Infrastructure
  DynamoDBClient: Symbol.for('DynamoDBClient'),
  EventBridgeClient: Symbol.for('EventBridgeClient'),
};
```

```typescript
// src/shared/container/Container.ts

type Constructor<T> = new (...args: unknown[]) => T;
type Factory<T> = () => T;

class DIContainer {
  private singletons = new Map<string | symbol, unknown>();
  private factories = new Map<string | symbol, Factory<unknown>>();

  register<T>(
    token: string | symbol,
    factory: Factory<T>,
    singleton = true
  ): void {
    if (singleton) {
      this.factories.set(token, () => {
        if (!this.singletons.has(token)) {
          this.singletons.set(token, factory());
        }
        return this.singletons.get(token);
      });
    } else {
      this.factories.set(token, factory);
    }
  }

  resolve<T>(token: string | symbol): T {
    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`No registration found for ${String(token)}`);
    }
    return factory() as T;
  }

  clear(): void {
    this.singletons.clear();
    this.factories.clear();
  }
}

export const container = new DIContainer();

// Bootstrap registrations
export function bootstrapContainer(): void {
  // Infrastructure
  container.register(TYPES.DynamoDBClient, () => dynamoDBClient);

  // Repositories
  container.register(TYPES.EntityRepository, () => new EntityRepository());
  container.register(TYPES.AuditRepository, () => new AuditRepository());

  // Services
  container.register(
    TYPES.EventService,
    () => new EventService()
  );
  container.register(
    TYPES.AuditService,
    () => new AuditService(container.resolve(TYPES.AuditRepository))
  );
  container.register(
    TYPES.EntityService,
    () =>
      new EntityService(
        container.resolve(TYPES.EntityRepository),
        container.resolve(TYPES.EventService),
        container.resolve(TYPES.AuditService)
      )
  );

  // Adapters
  container.register(
    TYPES.ThingsBoardAdapter,
    () => new ThingsBoardAdapter()
  );
}
```

---

#### 7. Adapter Pattern

Integrates with external systems using a common interface.

```typescript
// src/adapters/BaseAdapter.ts

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors: Array<{ id: string; error: string }>;
}

export interface IIntegrationAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  syncEntity(entity: Entity): Promise<boolean>;
  syncEntities(entities: Entity[]): Promise<SyncResult>;
  healthCheck(): Promise<boolean>;
}

export abstract class BaseAdapter implements IIntegrationAdapter {
  abstract name: string;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract syncEntity(entity: Entity): Promise<boolean>;

  async syncEntities(entities: Entity[]): Promise<SyncResult> {
    const results = await Promise.allSettled(
      entities.map((e) => this.syncEntity(e))
    );

    const errors: Array<{ id: string; error: string }> = [];
    let syncedCount = 0;
    let failedCount = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        syncedCount++;
      } else {
        failedCount++;
        errors.push({
          id: entities[index].id,
          error:
            result.status === 'rejected'
              ? result.reason.message
              : 'Sync returned false',
        });
      }
    });

    return { success: failedCount === 0, syncedCount, failedCount, errors };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.connect();
      await this.disconnect();
      return true;
    } catch {
      return false;
    }
  }
}
```

```typescript
// src/adapters/ThingsBoardAdapter.ts

import { BaseAdapter } from './BaseAdapter';
import { Entity } from '../domain/entities/Entity';

export class ThingsBoardAdapter extends BaseAdapter {
  name = 'ThingsBoard';
  private baseUrl: string;
  private token: string | null = null;

  constructor() {
    super();
    this.baseUrl = process.env.THINGSBOARD_URL || '';
  }

  async connect(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.THINGSBOARD_USER,
        password: process.env.THINGSBOARD_PASSWORD,
      }),
    });

    const data = await response.json();
    this.token = data.token;
  }

  async disconnect(): Promise<void> {
    this.token = null;
  }

  async syncEntity(entity: Entity): Promise<boolean> {
    if (!this.token) {
      await this.connect();
    }

    const tbEntity = this.mapToThingsBoard(entity);

    const response = await fetch(
      `${this.baseUrl}/api/asset/${entity.externalId || ''}`,
      {
        method: entity.externalId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify(tbEntity),
      }
    );

    return response.ok;
  }

  private mapToThingsBoard(entity: Entity): Record<string, unknown> {
    return {
      name: entity.name,
      type: entity.type.toLowerCase(),
      label: entity.name,
      additionalInfo: {
        gcdrId: entity.id,
        tenantId: entity.tenantId,
        ...entity.metadata,
      },
    };
  }
}
```

---

#### 8. Strategy Pattern

Used for interchangeable integration sync strategies.

```typescript
// src/services/integration/SyncStrategy.ts

export interface ISyncStrategy {
  name: string;
  canHandle(entity: Entity): boolean;
  sync(entity: Entity): Promise<SyncResult>;
}

export class FullSyncStrategy implements ISyncStrategy {
  name = 'full-sync';

  canHandle(): boolean {
    return true;
  }

  async sync(entity: Entity): Promise<SyncResult> {
    // Sync all fields
    return { success: true, syncedFields: Object.keys(entity) };
  }
}

export class DeltaSyncStrategy implements ISyncStrategy {
  name = 'delta-sync';

  canHandle(entity: Entity): boolean {
    return entity.version > 1;
  }

  async sync(entity: Entity, previousVersion?: Entity): Promise<SyncResult> {
    // Only sync changed fields
    const changedFields = this.getChangedFields(entity, previousVersion);
    return { success: true, syncedFields: changedFields };
  }

  private getChangedFields(current: Entity, previous?: Entity): string[] {
    if (!previous) return Object.keys(current);

    return Object.keys(current).filter(
      (key) => current[key] !== previous[key]
    );
  }
}

// Strategy context
export class IntegrationSyncService {
  private strategies: ISyncStrategy[] = [];

  registerStrategy(strategy: ISyncStrategy): void {
    this.strategies.push(strategy);
  }

  async sync(entity: Entity): Promise<SyncResult> {
    const strategy = this.strategies.find((s) => s.canHandle(entity));

    if (!strategy) {
      throw new Error('No suitable sync strategy found');
    }

    return strategy.sync(entity);
  }
}
```

---

#### 9. Observer Pattern (Domain Events)

Decoupled event handling for domain events.

```typescript
// src/domain/events/DomainEvent.ts

export interface DomainEvent {
  type: string;
  timestamp: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

class EventEmitter {
  private handlers = new Map<string, EventHandler[]>();

  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    this.handlers.set(eventType, [...existing, handler]);
  }

  off(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    this.handlers.set(
      eventType,
      existing.filter((h) => h !== handler)
    );
  }

  async emit(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) || [];
    await Promise.all(handlers.map((h) => h(event)));
  }
}

export const domainEventEmitter = new EventEmitter();
```

```typescript
// src/services/EventService.ts

import { domainEventEmitter, DomainEvent } from '../domain/events/DomainEvent';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export class EventService {
  private eventBridge: EventBridgeClient;

  constructor() {
    this.eventBridge = new EventBridgeClient({});
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Register internal handlers
    domainEventEmitter.on('ENTITY_CREATED', this.handleEntityCreated.bind(this));
    domainEventEmitter.on('ENTITY_UPDATED', this.handleEntityUpdated.bind(this));
  }

  async emit(event: Omit<DomainEvent, 'timestamp' | 'correlationId'>): Promise<void> {
    const fullEvent: DomainEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      correlationId: generateId(),
    };

    // Emit locally
    await domainEventEmitter.emit(fullEvent);

    // Publish to EventBridge for external consumers
    await this.publishToEventBridge(fullEvent);
  }

  private async publishToEventBridge(event: DomainEvent): Promise<void> {
    await this.eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'gcdr.myio',
            DetailType: event.type,
            Detail: JSON.stringify(event),
            EventBusName: process.env.EVENT_BUS_NAME,
          },
        ],
      })
    );
  }

  private async handleEntityCreated(event: DomainEvent): Promise<void> {
    console.log('Entity created:', event.payload);
    // Trigger sync to external systems
  }

  private async handleEntityUpdated(event: DomainEvent): Promise<void> {
    console.log('Entity updated:', event.payload);
    // Trigger sync to external systems
  }
}
```

---

#### 10. Mapper Pattern

Transforms data between layers (Domain ↔ Persistence ↔ DTO).

```typescript
// src/mappers/EntityMapper.ts

import { Entity } from '../domain/entities/Entity';
import { EntityResponseDTO } from '../dto/response/EntityResponseDTO';

export class EntityMapper {
  // Domain → Persistence (DynamoDB)
  static toPersistence(entity: Entity): Record<string, unknown> {
    return {
      PK: `TENANT#${entity.tenantId}`,
      SK: `${entity.type}#${entity.id}`,
      GSI1PK: `TYPE#${entity.type}`,
      GSI1SK: entity.createdAt,
      id: entity.id,
      tenantId: entity.tenantId,
      entityType: entity.type,
      name: entity.name,
      parentId: entity.parentId,
      metadata: entity.metadata,
      status: entity.status,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
    };
  }

  // Persistence (DynamoDB) → Domain
  static toDomain(item: Record<string, unknown>): Entity {
    return {
      id: item.id as string,
      tenantId: item.tenantId as string,
      type: item.entityType as EntityType,
      name: item.name as string,
      parentId: item.parentId as string | undefined,
      metadata: item.metadata as Record<string, unknown>,
      status: item.status as EntityStatus,
      version: item.version as number,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
      deletedAt: item.deletedAt as string | undefined,
    };
  }

  // Domain → Response DTO
  static toResponseDTO(entity: Entity): EntityResponseDTO {
    return {
      id: entity.id,
      type: entity.type,
      name: entity.name,
      parentId: entity.parentId,
      metadata: entity.metadata,
      status: entity.status,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  // Batch mapping
  static toResponseDTOList(entities: Entity[]): EntityResponseDTO[] {
    return entities.map(this.toResponseDTO);
  }
}
```

---

#### 11. DTO Pattern

Data Transfer Objects for request/response contracts.

```typescript
// src/dto/request/CreateEntityDTO.ts

export interface CreateEntityDTO {
  type: EntityType;
  name: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

// src/dto/request/UpdateEntityDTO.ts

export interface UpdateEntityDTO {
  name?: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  status?: EntityStatus;
}

// src/dto/response/EntityResponseDTO.ts

export interface EntityResponseDTO {
  id: string;
  type: EntityType;
  name: string;
  parentId?: string;
  metadata: Record<string, unknown>;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

// src/dto/response/PaginatedResponseDTO.ts

export interface PaginatedResponseDTO<T> {
  items: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}
```

---

#### 12. Middleware Pattern

Chain of responsibility for cross-cutting concerns.

```typescript
// src/middleware/withMiddleware.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

type Handler = (
  event: APIGatewayProxyEvent,
  context: Context
) => Promise<APIGatewayProxyResult>;

type Middleware = (
  event: APIGatewayProxyEvent,
  context: Context,
  next: () => Promise<APIGatewayProxyResult>
) => Promise<APIGatewayProxyResult>;

export function withMiddleware(
  handler: Handler,
  middlewares: Middleware[]
): Handler {
  return async (
    event: APIGatewayProxyEvent,
    context: Context
  ): Promise<APIGatewayProxyResult> => {
    let index = 0;

    const next = async (): Promise<APIGatewayProxyResult> => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++];
        return middleware(event, context, next);
      }
      return handler(event, context);
    };

    return next();
  };
}
```

```typescript
// src/middleware/errorHandler.ts

export const errorHandler: Middleware = async (event, context, next) => {
  try {
    return await next();
  } catch (error) {
    console.error('Error:', error);

    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: error.message }),
      };
    }

    if (error instanceof ValidationError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
```

---

#### Lambda Handler Integration

```typescript
// src/functions/entities/create.ts

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withMiddleware } from '../../middleware/withMiddleware';
import { logEvent } from '../../middleware/logEvent';
import { errorHandler } from '../../middleware/errorHandler';
import { authenticate } from '../../middleware/authenticate';
import { validateRequest } from '../../middleware/validateRequest';
import { entityController } from '../../controllers/EntityController';
import { EventType } from '../../shared/events/eventTypes';
import { createEntitySchema } from '../../validators/schemas/entitySchemas';
import { bootstrapContainer } from '../../shared/container/Container';

// Bootstrap DI container
bootstrapContainer();

const handler: APIGatewayProxyHandler = async (event, context) => {
  return entityController.create(event);
};

export const main = withMiddleware(handler, [
  errorHandler,
  authenticate,
  logEvent({
    eventType: EventType.ENTITY_CREATED.code,
    description: 'Create new entity',
  }),
  validateRequest(createEntitySchema),
]);
```

#### Language & Runtime

| Layer | Technology | Repository |
|-------|------------|------------|
| **Frontend** | TypeScript + React | `gcdr-frontend` |
| **Backend** | TypeScript + Node.js | `gcdr` |
| **Infrastructure** | AWS CDK (TypeScript) | `gcdr` |

#### AWS Services

```
┌─────────────────────────────────────────────────────────────────┐
│                         AWS Cloud                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  CloudFront  │───▶│   S3 Bucket  │    │   Route 53   │       │
│  │    (CDN)     │    │  (Frontend)  │    │    (DNS)     │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ API Gateway  │───▶│    Lambda    │───▶│   DynamoDB   │       │
│  │   (REST)     │    │  (Node.js)   │    │  (Database)  │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                                    │
│         ▼                   ▼                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Cognito    │    │  EventBridge │───▶│     SQS      │       │
│  │   (Auth)     │    │   (Events)   │    │    (DLQ)     │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│                             │                                    │
│                             ▼                                    │
│                      ┌──────────────┐                           │
│                      │     SNS      │                           │
│                      │ (Pub/Sub)    │                           │
│                      └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

#### Core AWS Services

| Service | Purpose |
|---------|---------|
| **Lambda** | Serverless compute for all backend functions |
| **API Gateway** | RESTful API management with rate limiting |
| **DynamoDB** | NoSQL database for master data storage |
| **EventBridge** | Event bus for domain events |
| **SQS** | Message queuing and dead-letter queues |
| **SNS** | Pub/Sub notifications and webhooks |
| **Cognito** | User authentication and authorization |
| **S3** | Frontend hosting and file storage |
| **CloudFront** | CDN for frontend distribution |
| **CloudWatch** | Logging, monitoring, and alerting |

#### DynamoDB Data Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GCDR Main Table                             │
├─────────────────────────────────────────────────────────────────────┤
│  PK (Partition Key)    │  SK (Sort Key)         │  Attributes       │
├────────────────────────┼────────────────────────┼───────────────────┤
│  TENANT#<tenantId>     │  CUSTOMER#<customerId> │  name, parentId   │
│  TENANT#<tenantId>     │  ASSET#<assetId>       │  name, customerId │
│  TENANT#<tenantId>     │  DEVICE#<deviceId>     │  name, assetId    │
│  TENANT#<tenantId>     │  RULE#<ruleId>         │  config, scope    │
│  TENANT#<tenantId>     │  USER#<userId>         │  email, status    │
│  TENANT#<tenantId>     │  PARTNER#<partnerId>   │  company, status  │
├─────────────────────────────────────────────────────────────────────┤
│  GSI1: Type Index                                                   │
├────────────────────────┼────────────────────────┼───────────────────┤
│  TYPE#CUSTOMER         │  <createdAt>           │  for listings     │
│  TYPE#ASSET            │  <createdAt>           │  for listings     │
├─────────────────────────────────────────────────────────────────────┤
│  GSI2: Parent Index (Customer Hierarchy)                            │
├────────────────────────┼────────────────────────┼───────────────────┤
│  PARENT#<customerId>   │  CHILD#<customerId>    │  for children     │
│  PARENT#ROOT           │  CHILD#<customerId>    │  root customers   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                   Authorization Tables (RFC-0002)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ROLES TABLE                                                        │
│  PK: TENANT#<tenantId>       SK: ROLE#<roleKey>                    │
│                                                                     │
│  POLICIES TABLE                                                     │
│  PK: TENANT#<tenantId>       SK: POLICY#<policyKey>#V<version>     │
│                                                                     │
│  ROLE_ASSIGNMENTS TABLE                                             │
│  PK: TENANT#<tenantId>       SK: ASSIGN#<userId>#<roleKey>#<scope> │
│  GSI1: USER#<userId>         GSI1SK: ASSIGN#<tenantId>#<scope>     │
│                                                                     │
│  PERMISSIONS TABLE (Registry)                                       │
│  PK: DOMAIN#<domain>         SK: PERM#<function>#<action>          │
│                                                                     │
│  AUTHZ_AUDIT TABLE                                                  │
│  PK: TENANT#<tenantId>       SK: AUDIT#<timestamp>#<correlationId> │
│  GSI1: USER#<userId>         GSI1SK: <timestamp>                   │
│  TTL: 90 days                                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Key Design Decisions

**Single-Table Design**
- All entities stored in a single DynamoDB table
- Efficient queries using composite keys
- Reduced operational overhead

**Serverless Benefits**
- Pay-per-use pricing model
- Auto-scaling without configuration
- Zero server management
- High availability by default

**TypeScript Everywhere**
- Shared types between frontend and backend
- Compile-time type safety
- Better developer experience
- Easier refactoring and maintenance

#### Deployment & Local Development

The backend uses **Serverless Framework** for infrastructure management, deployment, and local development.

**Available Commands:**

| Command | Description |
|---------|-------------|
| `npm run offline` | Run API locally with serverless-offline |
| `serverless deploy` | Deploy to AWS (default stage: dev) |
| `serverless deploy --stage prod` | Deploy to production |
| `serverless remove` | Remove stack from AWS |

**serverless.yml Configuration:**

```yaml
service: gcdr-api

frameworkVersion: '3'

provider:
  name: aws
  runtime: nodejs20.x
  stage: ${opt:stage, 'dev'}
  region: ${opt:region, 'us-east-1'}
  environment:
    DYNAMODB_TABLE: ${self:service}-${self:provider.stage}
    NODE_OPTIONS: --enable-source-maps
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - dynamodb:Query
            - dynamodb:Scan
            - dynamodb:GetItem
            - dynamodb:PutItem
            - dynamodb:UpdateItem
            - dynamodb:DeleteItem
          Resource:
            - !GetAtt GcdrTable.Arn
            - !Join ['/', [!GetAtt GcdrTable.Arn, 'index/*']]

plugins:
  - serverless-offline
  - serverless-esbuild

custom:
  esbuild:
    bundle: true
    minify: false
    sourcemap: true
    target: node20
    platform: node
  serverless-offline:
    httpPort: 3001
    lambdaPort: 3002

functions:
  # Health check
  health:
    handler: src/functions/health.handler
    events:
      - http:
          path: /health
          method: get
          cors: true

  # Entities CRUD
  getEntities:
    handler: src/functions/entities/list.handler
    events:
      - http:
          path: /entities/{type}
          method: get
          cors: true

  getEntity:
    handler: src/functions/entities/get.handler
    events:
      - http:
          path: /entities/{type}/{id}
          method: get
          cors: true

  createEntity:
    handler: src/functions/entities/create.handler
    events:
      - http:
          path: /entities/{type}
          method: post
          cors: true

  updateEntity:
    handler: src/functions/entities/update.handler
    events:
      - http:
          path: /entities/{type}/{id}
          method: put
          cors: true

  deleteEntity:
    handler: src/functions/entities/delete.handler
    events:
      - http:
          path: /entities/{type}/{id}
          method: delete
          cors: true

resources:
  Resources:
    GcdrTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.DYNAMODB_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: PK
            AttributeType: S
          - AttributeName: SK
            AttributeType: S
          - AttributeName: GSI1PK
            AttributeType: S
          - AttributeName: GSI1SK
            AttributeType: S
        KeySchema:
          - AttributeName: PK
            KeyType: HASH
          - AttributeName: SK
            KeyType: RANGE
        GlobalSecondaryIndexes:
          - IndexName: GSI1
            KeySchema:
              - AttributeName: GSI1PK
                KeyType: HASH
              - AttributeName: GSI1SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
        PointInTimeRecoverySpecification:
          PointInTimeRecoveryEnabled: true
```

**package.json Scripts:**

```json
{
  "scripts": {
    "offline": "serverless offline start",
    "deploy": "serverless deploy",
    "deploy:prod": "serverless deploy --stage prod",
    "remove": "serverless remove",
    "lint": "eslint src/",
    "test": "jest",
    "typecheck": "tsc --noEmit"
  }
}
```

**Local Development Workflow:**

```bash
# 1. Install dependencies
npm install

# 2. Start local API (runs on http://localhost:3001)
npm run offline

# 3. Test endpoints locally
curl http://localhost:3001/dev/health

# 4. Deploy to AWS
serverless deploy
```

---

### API Routes & Event Logging

All API routes use a `logEvent` middleware for audit trail and observability. Every request is logged with structured event data.

#### Event Types

```typescript
// src/shared/events/eventTypes.ts

export const EventType = {
  // Customer Operations
  CUSTOMER_CREATED: { code: 'CUSTOMER_CREATED', description: 'Customer created' },
  CUSTOMER_UPDATED: { code: 'CUSTOMER_UPDATED', description: 'Customer updated' },
  CUSTOMER_DELETED: { code: 'CUSTOMER_DELETED', description: 'Customer deleted' },
  CUSTOMER_RETRIEVED: { code: 'CUSTOMER_RETRIEVED', description: 'Customer retrieved' },
  CUSTOMER_LIST: { code: 'CUSTOMER_LIST', description: 'Customer list retrieved' },
  CUSTOMER_MOVED: { code: 'CUSTOMER_MOVED', description: 'Customer moved to new parent' },
  CUSTOMER_CHILDREN_RETRIEVED: { code: 'CUSTOMER_CHILDREN_RETRIEVED', description: 'Customer children retrieved' },
  CUSTOMER_DESCENDANTS_RETRIEVED: { code: 'CUSTOMER_DESCENDANTS_RETRIEVED', description: 'Customer descendants retrieved' },
  CUSTOMER_TREE_RETRIEVED: { code: 'CUSTOMER_TREE_RETRIEVED', description: 'Customer tree retrieved' },

  // Partner Operations
  PARTNER_REGISTERED: { code: 'PARTNER_REGISTERED', description: 'Partner registration submitted' },
  PARTNER_APPROVED: { code: 'PARTNER_APPROVED', description: 'Partner approved' },
  PARTNER_REJECTED: { code: 'PARTNER_REJECTED', description: 'Partner rejected' },
  PARTNER_SUSPENDED: { code: 'PARTNER_SUSPENDED', description: 'Partner suspended' },
  PARTNER_ACTIVATED: { code: 'PARTNER_ACTIVATED', description: 'Partner activated' },
  PARTNER_UPDATED: { code: 'PARTNER_UPDATED', description: 'Partner info updated' },
  PARTNER_API_KEY_CREATED: { code: 'PARTNER_API_KEY_CREATED', description: 'Partner API key created' },
  PARTNER_API_KEY_REVOKED: { code: 'PARTNER_API_KEY_REVOKED', description: 'Partner API key revoked' },
  PARTNER_OAUTH_CLIENT_CREATED: { code: 'PARTNER_OAUTH_CLIENT_CREATED', description: 'Partner OAuth client created' },
  PARTNER_WEBHOOK_CREATED: { code: 'PARTNER_WEBHOOK_CREATED', description: 'Partner webhook created' },

  // Asset Operations
  ASSET_CREATED: { code: 'ASSET_CREATED', description: 'Asset created' },
  ASSET_UPDATED: { code: 'ASSET_UPDATED', description: 'Asset updated' },
  ASSET_DELETED: { code: 'ASSET_DELETED', description: 'Asset deleted' },

  // Device Operations
  DEVICE_CREATED: { code: 'DEVICE_CREATED', description: 'Device created' },
  DEVICE_UPDATED: { code: 'DEVICE_UPDATED', description: 'Device updated' },
  DEVICE_DELETED: { code: 'DEVICE_DELETED', description: 'Device deleted' },

  // Rule Operations
  RULE_CREATED: { code: 'RULE_CREATED', description: 'Rule created' },
  RULE_UPDATED: { code: 'RULE_UPDATED', description: 'Rule updated' },
  RULE_DELETED: { code: 'RULE_DELETED', description: 'Rule deleted' },
  RULE_ACTIVATED: { code: 'RULE_ACTIVATED', description: 'Rule activated' },
  RULE_DEACTIVATED: { code: 'RULE_DEACTIVATED', description: 'Rule deactivated' },

  // Integration Operations
  INTEGRATION_SYNC_STARTED: { code: 'INTEGRATION_SYNC_STARTED', description: 'Integration sync started' },
  INTEGRATION_SYNC_COMPLETED: { code: 'INTEGRATION_SYNC_COMPLETED', description: 'Integration sync completed' },
  INTEGRATION_SYNC_FAILED: { code: 'INTEGRATION_SYNC_FAILED', description: 'Integration sync failed' },

  // Auth Operations
  USER_LOGIN: { code: 'USER_LOGIN', description: 'User logged in' },
  USER_LOGOUT: { code: 'USER_LOGOUT', description: 'User logged out' },
  TOKEN_REFRESHED: { code: 'TOKEN_REFRESHED', description: 'Token refreshed' },
  PARTNER_AUTH: { code: 'PARTNER_AUTH', description: 'Partner authenticated via API key/OAuth' },

  // Authorization Operations (RFC-0002)
  PERMISSION_EVALUATED: { code: 'PERMISSION_EVALUATED', description: 'Permission check performed' },
  ROLE_CREATED: { code: 'ROLE_CREATED', description: 'Role created' },
  ROLE_UPDATED: { code: 'ROLE_UPDATED', description: 'Role updated' },
  ROLE_DELETED: { code: 'ROLE_DELETED', description: 'Role deleted' },
  POLICY_CREATED: { code: 'POLICY_CREATED', description: 'Policy created' },
  POLICY_UPDATED: { code: 'POLICY_UPDATED', description: 'Policy updated' },
  POLICY_DELETED: { code: 'POLICY_DELETED', description: 'Policy deleted' },
  ROLE_ASSIGNED: { code: 'ROLE_ASSIGNED', description: 'Role assigned to user' },
  ROLE_REVOKED: { code: 'ROLE_REVOKED', description: 'Role revoked from user' },
} as const;

export type EventTypeCode = keyof typeof EventType;
```

#### LogEvent Middleware

```typescript
// src/shared/middleware/logEvent.ts

import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { EventType } from '../events/eventTypes';

interface LogEventOptions {
  eventType: string;
  description: string;
  extractPayload?: (event: APIGatewayProxyEvent) => Record<string, unknown>;
}

interface EventLog {
  eventType: string;
  description: string;
  timestamp: string;
  correlationId: string;
  actor: {
    userId: string | null;
    tenantId: string | null;
    ip: string;
  };
  request: {
    method: string;
    path: string;
    pathParameters: Record<string, string> | null;
    queryParameters: Record<string, string> | null;
  };
  payload?: Record<string, unknown>;
}

export const logEvent = (options: LogEventOptions) => {
  return async (
    event: APIGatewayProxyEvent,
    context: Context,
    next: () => Promise<unknown>
  ) => {
    const eventLog: EventLog = {
      eventType: options.eventType,
      description: options.description,
      timestamp: new Date().toISOString(),
      correlationId: context.awsRequestId,
      actor: {
        userId: event.requestContext.authorizer?.claims?.sub || null,
        tenantId: event.requestContext.authorizer?.claims?.['custom:tenantId'] || null,
        ip: event.requestContext.identity?.sourceIp || 'unknown',
      },
      request: {
        method: event.httpMethod,
        path: event.path,
        pathParameters: event.pathParameters,
        queryParameters: event.queryStringParameters,
      },
    };

    if (options.extractPayload) {
      eventLog.payload = options.extractPayload(event);
    }

    // Log to CloudWatch
    console.log(JSON.stringify({ level: 'INFO', event: eventLog }));

    // Store in DynamoDB for audit trail
    await storeAuditLog(eventLog);

    return next();
  };
};
```

#### Route Definitions with Event Logging

```typescript
// src/functions/entities/routes.ts

import { logEvent } from '../../shared/middleware/logEvent';
import { EventType } from '../../shared/events/eventTypes';
import * as EntityController from './controller';

export const routes = {
  // GET - List entities by type
  list: {
    handler: EntityController.list,
    middleware: [
      logEvent({
        eventType: EventType.ENTITY_LIST.code,
        description: 'List entities by type',
      }),
    ],
  },

  // GET - Get entity by ID
  get: {
    handler: EntityController.get,
    middleware: [
      logEvent({
        eventType: EventType.ENTITY_RETRIEVED.code,
        description: 'Retrieve single entity by ID',
      }),
    ],
  },

  // POST - Create new entity
  create: {
    handler: EntityController.create,
    middleware: [
      logEvent({
        eventType: EventType.ENTITY_CREATED.code,
        description: 'Create new entity',
        extractPayload: (event) => JSON.parse(event.body || '{}'),
      }),
    ],
  },

  // PUT - Update entity
  update: {
    handler: EntityController.update,
    middleware: [
      logEvent({
        eventType: EventType.ENTITY_UPDATED.code,
        description: 'Update existing entity',
        extractPayload: (event) => JSON.parse(event.body || '{}'),
      }),
    ],
  },

  // DELETE - Delete entity
  delete: {
    handler: EntityController.delete,
    middleware: [
      logEvent({
        eventType: EventType.ENTITY_DELETED.code,
        description: 'Delete entity (soft delete)',
      }),
    ],
  },
};
```

#### Lambda Handler with Middleware

```typescript
// src/functions/entities/create.ts

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withMiddleware } from '../../shared/middleware/withMiddleware';
import { logEvent } from '../../shared/middleware/logEvent';
import { EventType } from '../../shared/events/eventTypes';
import { EntityService } from '../../domain/services/EntityService';

const createHandler: APIGatewayProxyHandler = async (event) => {
  const { type } = event.pathParameters || {};
  const body = JSON.parse(event.body || '{}');
  const tenantId = event.requestContext.authorizer?.claims?.['custom:tenantId'];

  const entity = await EntityService.create({
    type,
    tenantId,
    ...body,
  });

  return {
    statusCode: 201,
    body: JSON.stringify(entity),
  };
};

export const handler = withMiddleware(createHandler, [
  logEvent({
    eventType: EventType.ENTITY_CREATED.code,
    description: 'Create new entity in GCDR',
    extractPayload: (event) => ({
      type: event.pathParameters?.type,
      body: JSON.parse(event.body || '{}'),
    }),
  }),
]);
```

#### Audit Log Table Structure

```yaml
# serverless.yml - Additional resource for audit logs

resources:
  Resources:
    # ... existing GcdrTable ...

    AuditLogTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:service}-${self:provider.stage}-audit
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: PK
            AttributeType: S
          - AttributeName: SK
            AttributeType: S
          - AttributeName: eventType
            AttributeType: S
          - AttributeName: timestamp
            AttributeType: S
        KeySchema:
          - AttributeName: PK    # TENANT#<tenantId>
            KeyType: HASH
          - AttributeName: SK    # EVENT#<timestamp>#<correlationId>
            KeyType: RANGE
        GlobalSecondaryIndexes:
          - IndexName: ByEventType
            KeySchema:
              - AttributeName: eventType
                KeyType: HASH
              - AttributeName: timestamp
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
        TimeToLiveSpecification:
          AttributeName: ttl
          Enabled: true
```

#### Event Log Query Examples

```typescript
// Query audit logs by tenant
const logs = await auditLogService.queryByTenant({
  tenantId: 'tenant-123',
  startDate: '2026-01-01',
  endDate: '2026-01-12',
});

// Query by event type
const entityCreations = await auditLogService.queryByEventType({
  eventType: EventType.ENTITY_CREATED.code,
  limit: 100,
});

// Query by correlation ID (trace single request)
const requestTrace = await auditLogService.getByCorrelationId({
  correlationId: 'abc-123-def-456',
});
```

---

### Security & Governance

- Least-privilege access per integration
- Explicit scopes per entity type
- Signed and versioned payloads
- Full audit trail:
  - Actor
  - Integration
  - Before / After
  - Timestamp
  - Correlation ID

---

### Versioning Strategy

Every entity includes:

- `version`
- `updatedAt`
- `source`

Consumers must be idempotent. Conflicts are resolved by Source of Truth priority.

---

### Offline & Edge Support

- Configuration snapshots delivered to NodeHub
- Versioned packages
- Local execution with fallback
- Periodic reconciliation when online

---

## Implementation Plan

### Phase 1 (MVP)

#### Core Infrastructure
- [x] Serverless Framework configuration (`serverless.yml`)
- [x] DynamoDB tables (Customers, Partners, Roles, Policies, RoleAssignments)
- [x] EventBridge event bus configuration
- [x] IAM permissions and security setup

#### Domain Entities
- [x] Customer entity (with hierarchy support: `parentCustomerId`, `path`, `depth`)
- [x] Partner entity (with API keys, OAuth clients, rate limits)
- [x] Role entity (with policies, risk levels)
- [x] Policy entity (with allow/deny patterns, conditions)
- [x] RoleAssignment entity (with scope-based assignments)

#### DTOs & Validation
- [x] Customer DTOs (Create, Update, Move) with Zod validation
- [x] Partner DTOs (Register, Approve, Reject, CreateApiKey)
- [x] Authorization DTOs (EvaluatePermission, AssignRole, CreateRole, CreatePolicy)

#### Repositories
- [x] IRepository interface (base CRUD)
- [x] ICustomerRepository interface (hierarchy operations)
- [x] CustomerRepository (DynamoDB implementation)
- [x] Mock data for development/testing

#### Services
- [x] CustomerService (CRUD + hierarchy logic)
- [ ] PartnerService (placeholder handlers created)
- [ ] AuthorizationService (basic mock implementation)

#### API Handlers (Lambda)
- [x] Health check endpoint
- [x] Customer CRUD (`POST/GET/PUT/DELETE /customers`)
- [x] Customer hierarchy (`/children`, `/descendants`, `/tree`, `/move`)
- [x] Customer listing with filters
- [x] Authorization check (`POST /authorization/check`)
- [x] Role listing (`GET /authorization/roles`)
- [x] Role assignment (`POST /authorization/assignments`)
- [x] User roles (`GET /authorization/users/{userId}/roles`)
- [ ] Partner registration (placeholder)
- [ ] Partner approval/rejection (placeholder)

#### Middleware
- [x] Response formatting (success, error, created, noContent)
- [x] Error handling (Zod, AppError, DynamoDB errors)
- [x] Request context extraction (tenantId, userId)

#### Events
- [x] Event types definition (Customer, Partner, Asset, Device, Auth operations)
- [x] EventService for EventBridge publication

#### Testing
- [x] Unit tests for CustomerService (18 tests passing)
- [ ] Integration tests
- [ ] Handler tests

#### Outbound Connectors
- [ ] ThingsBoard connector
- [ ] NodeHub connector

### Phase 2

- [ ] Inbound APIs (external systems → GCDR)
- [ ] Work Order integration
- [ ] Webhooks (outbound notifications)
- [ ] Marketplace UI (basic)
- [ ] Complete PartnerService implementation
- [ ] Complete AuthorizationService with DynamoDB

### Phase 3

- [ ] Partner integrations (self-service)
- [ ] Self-service onboarding portal
- [ ] Usage limits and billing hooks
- [ ] API versioning
- [ ] Multi-region support

---

## Drawbacks

- Initial complexity increase
- Requires strict governance
- Cultural shift from "local ownership" to "central authority"

---

## Rationale and Alternatives

### Why This Design?

The centralized registry pattern provides:

- Single source of truth for all master data
- Clear ownership and governance model
- Scalable integration architecture
- Audit trail and compliance support

### Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| Keeping master data inside ThingsBoard | Limited flexibility, vendor lock-in |
| Point-to-point integrations | Scalability and maintenance issues |
| Manual synchronization | Error-prone, governance risks |

---

## Prior Art

- [Rust RFC Process](https://rust-lang.github.io/rfcs/)
- Enterprise MDM (Master Data Management) patterns
- API Gateway and Service Mesh architectures
- Event-driven architecture patterns
- Authorization patterns (see [RFC-0002](./RFC-0002-GCDR-Authorization-Model.md) for detailed references):
  - [AWS IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/intro-structure.html)
  - [Google Cloud IAM](https://cloud.google.com/iam/docs/overview)
  - [Open Policy Agent (OPA)](https://www.openpolicyagent.org/)

---

## Unresolved Questions

- What is the exact conflict resolution strategy when multiple sources update the same entity?
- How should rate limiting be configured per integration?
- What is the SLA for event delivery guarantees?
- How will backward compatibility be maintained across API versions?
- See [RFC-0002](./RFC-0002-GCDR-Authorization-Model.md) for authorization-specific unresolved questions

---

## Future Possibilities

- Integration certification program
- Marketplace monetization
- Policy-as-code for rules
- AI-assisted validation and recommendations
- Multi-region replication
- Advanced authorization features (see [RFC-0002](./RFC-0002-GCDR-Authorization-Model.md)):
  - Policy simulation and dry-run mode
  - Permission delegation
  - Integration with external IdPs

---

## Conclusion

The GCDR MYIO Integration Marketplace transforms MYIO from a set of connected systems into a cohesive, governed platform, enabling scalability, consistency, and long-term ecosystem growth.

**GCDR MYIO becomes the brain of the platform**, while the **Marketplace acts as its nervous system**, connecting all operational components in a controlled and observable way.
