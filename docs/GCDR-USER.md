# GCDR-USER — Consolidated Guide for Users, Auth and Authorization

**Version**: 1.0
**Last updated**: 2026-04-16
**Status**: Canonical (verified against code)
**Author**: consolidation of existing docs + validation in `src/`

> **Scope**: this document consolidates everything in GCDR related to
> **users, auth, roles, policies, assignments, groups, maintenance-groups,
> access-bundle, domain-permissions and user-contacts**. It is the single
> reference for that subsystem. In case of divergence with older RFCs,
> **this doc wins** (it was verified endpoint-by-endpoint against
> `src/app.ts` and the controllers on 2026-04-16).

---

## 1. High-level map

```
                ┌──────────────────────────────────────┐
                │            USERS (identity)          │
                │  users • verification_tokens         │
                │  user_contacts                       │
                └──────────┬───────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
   ┌───────────────┐ ┌─────────────┐ ┌───────────────────┐
   │ AUTHORIZATION │ │   GROUPS    │ │ ACCESS BUNDLE     │
   │ (RBAC)        │ │ (notify/    │ │ (RFC-0013)        │
   │ roles         │ │  dispatch/  │ │ maintenance_groups│
   │ policies      │ │  org)       │ │ domain_permissions│
   │ assignments   │ │             │ │ user_bundle_cache │
   └───────────────┘ └─────────────┘ └───────────────────┘
```

**Layers**: Controllers → Services → Repositories → Drizzle/PostgreSQL.
**Per-request context**: `req.context = { tenantId, userId, requestId, ip }`
(populated by `contextMiddleware`).

---

## 2. `users` entity

### 2.1 Schema (`users`)

| Column            | Type      | Notes                                                              |
|-------------------|-----------|--------------------------------------------------------------------|
| `id`              | uuid PK   |                                                                    |
| `tenant_id`       | uuid      | multi-tenant isolation                                             |
| `customer_id`     | uuid FK   | `customers.id`                                                     |
| `partner_id`      | uuid      |                                                                    |
| `email`           | varchar   | unique per `(tenantId, email)`                                     |
| `email_verified`  | bool      | RFC-0011                                                           |
| `username`        | varchar   |                                                                    |
| `type`            | enum      | `INTERNAL` \| `CUSTOMER` \| `PARTNER` \| `SERVICE_ACCOUNT`         |
| `status`          | enum      | `UNVERIFIED` → `PENDING_APPROVAL` → `ACTIVE` \| `INACTIVE` \| `LOCKED` |
| `profile`         | jsonb     | `firstName, lastName, displayName, avatarUrl, phone, department, jobTitle, bio` |
| `security`        | jsonb     | `failedLoginAttempts, lockedAt, lockedReason, lockoutCount, approvedBy, rejectionReason, mfa{...}` |
| `preferences`     | jsonb     | `language, timezone, dateFormat, timeFormat, theme, notifications, dashboardLayout` |
| `active_sessions` | int       |                                                                    |
| `invited_by/at`, `invitation_accepted_at` | — |                                                    |
| `tags`, `metadata`, `external_links` | jsonb |  `external_links` (RFC-0016: ThingsBoard/Freshdesk/App/OS)    |
| audit             | createdAt/By, updatedAt/By, version |                                                      |

### 2.2 Status (lifecycle — RFC-0011)

```
   registers        verifies email       admin approves
UNVERIFIED ──────▶ PENDING_APPROVAL ──────▶ ACTIVE
                                          │
                          admin suspends  │
                          ◀───────────────┤
                           INACTIVE       │
                                          │
             6 failed logins ◀────────────┤
                    LOCKED                │
                    (auto-unlocks after   │
                     30min, or admin)     │
```

### 2.3 User endpoints

Base: `/api/v1/users` — **Auth**: JWT (`authMiddleware`).

| Method | Path                               | Description                                       |
|--------|------------------------------------|---------------------------------------------------|
| GET    | `/users/me`                        | authenticated user (from JWT)                     |
| GET    | `/users`                           | list (filters: `customerId`, `partnerId`, `type`, `status`, `search`; cursor pagination) |
| POST   | `/users`                           | create (admin)                                    |
| POST   | `/users/invite`                    | invite by email (accepts `roleKeys[]`)            |
| GET    | `/users/:id`                       | get by id                                         |
| PUT    | `/users/:id`                       | update profile/preferences/tags/metadata/external_links |
| DELETE | `/users/:id`                       | delete                                            |
| PATCH  | `/users/:id/status`                | change status (+ reason)                          |
| POST   | `/users/:id/unlock`                | unlock account                                    |
| POST   | `/users/:id/change-password`       | change password                                   |
| POST   | `/users/:id/mfa/setup`             | MFA setup (`totp`/`sms`/`email`)                  |
| POST   | `/users/:id/mfa/enable`            | confirm MFA with `secret` + `verificationCode`    |
| POST   | `/users/:id/mfa/disable`           | disable MFA                                       |
| PATCH  | `/users/:id/preferences`           | update preferences (partial)                      |
| PUT    | `/users/:id/default-customer`      | set/clear `preferences.defaultCustomerId` (validates user has an active assignment for that customer) |
| GET    | `/customers/:customerId/users`     | **nested**: list users of a customer              |

---

## 3. Authentication (`/auth`)

Base: `/api/v1/auth` — **public** (except `/logout`, which uses JWT).

| Method | Path                          | Description                                   |
|--------|-------------------------------|-----------------------------------------------|
| POST   | `/auth/login`                 | email + password (+ `mfaCode`, `deviceInfo`)  |
| POST   | `/auth/refresh`               | refresh token → new access token              |
| POST   | `/auth/mfa/verify`            | validate MFA after a temporary `mfaToken`     |
| POST   | `/auth/logout`                | `allDevices` or a specific refresh token      |
| GET    | `/auth/me`                    | **enriched hydrate** — JWT only, returns user + assignments with role + policies expanded + effective/denied permissions |
| POST   | `/auth/register`              | self-service (RFC-0011) → sends 6-digit code  |
| POST   | `/auth/verify-email`          | validates 6-digit code                        |
| POST   | `/auth/resend-verification`   | resends verification code                     |
| POST   | `/auth/forgot-password`       | requests reset (always 200 — anti-enumeration)|
| POST   | `/auth/reset-password`        | reset with 6-digit code                       |
| POST   | `/auth/validate-key`          | validates `X-API-Key` (Customer API Key M2M)  |

**`GET /auth/me` response shape**:
```json
{
  "user": { "id", "email", "profile", "preferences": { "defaultCustomerId", ... }, ... },
  "assignments": [
    {
      "id", "scope": "customer:<uuid>", "status", "expiresAt", "grantedAt", "grantedBy",
      "role": {
        "key", "displayName", "description", "riskLevel", "isSystem",
        "policies": [
          { "key", "displayName", "allow": [...], "deny": [...], "conditions": {...}, "riskLevel" }
        ]
      }
    }
  ],
  "effectivePermissions": ["devices.read.any", ...],
  "deniedPatterns": ["users.delete.any", ...]
}
```
Cost: 3 DB queries (assignments, roles by keys, policies by keys). Use this as the single hydrate call after login — front doesn't need to chain `/users/me` + `/authorization/users/:id/roles` + `/policies/key/:key`.

**Tokens**: JWT Bearer, audiences `gcdr-api`, `alarm-orchestrator`.
Expiration: short-lived access token + (rotating) refresh token.
**MFA**: 2-step flow — login returns `mfaToken`; client calls `/auth/mfa/verify`.

### 3.1 Admin user management (RFC-0011)

Base: `/admin/users` — **JWT required**, mounted outside `/api/v1/*`.

| Method | Path                                  | Description                          |
|--------|---------------------------------------|--------------------------------------|
| GET    | `/admin/users/pending-approval`       | users in `PENDING_APPROVAL`          |
| GET    | `/admin/users/locked`                 | users in `LOCKED`                    |
| POST   | `/admin/users/:userId/approve`        | approve (accepts `assignRoles[]`, TODO: not assigned yet) |
| POST   | `/admin/users/:userId/reject`         | reject with a required `reason`      |
| POST   | `/admin/users/:userId/unlock`         | unlock                               |

> **Heads up**: `POST /admin/users/:id/approve` accepts `assignRoles` in the
> body but the handler does not yet assign the roles (TODO flagged at
> `src/controllers/admin/user-admin.controller.ts:53`). To assign roles,
> call `POST /authorization/assignments` after approval.

### 3.2 Verification tokens (`verification_tokens`)

Used for email verify and password reset.
Fields: `userId`, `tokenType`, `codeHash (SHA-256)`, `expiresAt`,
`usedAt`, `attempts` (max 5), `ipAddress`, `userAgent`.
**TTL**: 15 minutes (900s) for reset.

---

## 4. Authorization (RBAC)

### 4.1 Model

- **Policy**: a declarative permission set with `allow[]` / `deny[]`.
- **Role**: references several `policies[]`. Roles are what you assign to
  a user.
- **Role Assignment**: binds `user → role → scope` (with expiration and
  reason).
- **Permission format**: `resource.action.target` as **3 snake-case parts**
  (regex `^[a-z]+\.[a-z]+\.[a-z]+$`), e.g. `users.create.customer`,
  `devices.read.own`. Wildcards: `*` in any segment.
- **Scope**: string (`*` global, `customer:<uuid>`, `asset:<uuid>`, etc.).
- **Deny wins**: any `deny` match overrides an `allow`.
- **Conditions (ABAC)** on policies: `requiresMFA`, `onlyBusinessHours`,
  `allowedDeviceTypes`, `ipAllowlist`, `maxSessionDuration`.

### 4.2 Schema

#### `roles`
`key` (unique per tenant), `displayName`, `description`, `policies[]`
(keys), `tags[]`, `riskLevel` (`low`/`medium`/`high`/`critical`), `isSystem`.

#### `policies`
`key` (unique per tenant), `displayName`, `description`, `allow[]`, `deny[]`,
`conditions` (jsonb), `riskLevel`, `isSystem`.

#### `role_assignments`
`userId`, `roleKey`, `scope`, `status` (`active`/`inactive`/`expired`),
`expiresAt` (nullable), `grantedBy`, `grantedAt`, `reason` (nullable).
Unique per `(tenantId, userId, roleKey, scope)`.

> Note: since commit `1067531` (2026-04), `expiresAt` and `reason` accept
> `null` — the service verifies the user exists before creating the
> assignment.

### 4.3 Endpoints — Policies

Base: `/api/v1/policies` — JWT.

| Method | Path                       | Description                  |
|--------|----------------------------|------------------------------|
| POST   | `/policies`                | create                       |
| GET    | `/policies`                | list (`riskLevel`, `isSystem`, cursor) |
| GET    | `/policies/:policyId`      | by id                        |
| GET    | `/policies/key/:policyKey` | by key                       |
| PUT    | `/policies/:policyId`      | update                       |
| DELETE | `/policies/:policyId`      | delete                       |

### 4.4 Endpoints — Roles

Base: `/api/v1/roles` — JWT.

| Method | Path                    | Description           |
|--------|-------------------------|-----------------------|
| POST   | `/roles`                | create                |
| GET    | `/roles`                | list                  |
| GET    | `/roles/:roleId`        | by id                 |
| GET    | `/roles/key/:roleKey`   | by key                |
| PUT    | `/roles/:roleId`        | update                |
| DELETE | `/roles/:roleId`        | delete                |

### 4.5 Endpoints — Authorization / Assignments / Check

Base: `/api/v1/authorization` — JWT.

| Method | Path                                              | Description                         |
|--------|---------------------------------------------------|-------------------------------------|
| POST   | `/authorization/check`                            | evaluate 1 permission               |
| POST   | `/authorization/check/batch`                      | evaluate up to 100 permissions      |
| POST   | `/authorization/assignments`                      | assign a role to a user             |
| GET    | `/authorization/assignments`                      | list (cursor)                       |
| DELETE | `/authorization/assignments/:assignmentId`        | revoke                              |
| GET    | `/authorization/users/:userId/assignments`        | user's assignments                  |
| GET    | `/authorization/users/:userId/permissions?scope=` | effective permissions (allow/deny)  |
| GET    | `/authorization/users/:userId/roles`              | roles + permissions + denied        |
| GET    | `/authorization/roles`                            | duplicate of `/roles` (kept for compat) |

**Payload `/check`**:
```json
{ "userId": "<uuid>", "permission": "users.create.customer", "resourceScope": "customer:<uuid>" }
```

**Payload `/check/batch`**:
```json
{ "userId": "<uuid>", "resourceScope": "*", "permissions": ["users.read.own", "devices.write.any"] }
```

**Payload `/assignments`**:
```json
{
  "userId": "<uuid>",
  "roleKey": "customer-admin",
  "scope": "customer:<uuid>",
  "expiresAt": null,
  "reason": null
}
```

---

## 5. Groups (organization + notification)

Base: `/api/v1/groups` — JWT. Table: `groups`.

### 5.1 Concept

Groups aggregate **members** (USER / DEVICE / ASSET / MIXED) with one or
more **purposes** (`purposes[]`). The purpose determines what the rest of
the platform does with the group (notify on alarm, escalate, bundle a
report, send welcome emails, etc.).

### 5.2 Key fields

- `customerId` (required)
- `type`: `USER` | `DEVICE` | `ASSET` | `MIXED`
- `purposes[]`: see catalog below (min 1)
- `members[]` (jsonb): `{ id, type: USER|DEVICE|ASSET, metadata?, addedAt }`
  > **Careful**: members live in JSONB with no FK. Deleting a user does
  > **not** remove the entry from the group — the
  > `GET /groups/:id/members` endpoint enriches with `users` and returns
  > `name/email = null` when the user vanished.
- `memberCount` (denormalized)
- `notificationSettings` (jsonb): `channels[]`,
  `schedule { timezone, quietHours, businessHours }`,
  **`escalationDelayMs`** (breaking change — was `escalationDelayMinutes`),
  `digestEnabled`, `digestIntervalMinutes`.
- `visibleToChildCustomers`, `editableByChildCustomers`

### 5.3 Purposes catalog (`GET /groups/purposes`)

| Value            | Label                                | Usage                                            |
|------------------|--------------------------------------|--------------------------------------------------|
| `ALARMS_NOTIFY`  | Alarms — Notification                | real-time notifications (RFC-0024)               |
| `ALARMS_REPORT`  | Alarms — Report                      | consolidated periodic reports                    |
| `ALARMS_INSIGHT` | Alarms — Insights                    | metrics/analytics                                |
| `WELCOME_USER`   | Welcome / Password Reset             | transactional access emails                      |
| `RELEASE_NOTE`   | New Feature Announcement             | release notes                                    |
| `NOTIFICATION`   | Notification                         | generic                                          |
| `ESCALATION`     | Escalation                           | escalation chain                                 |
| `ACCESS_CONTROL` | Access Control                       | grouping for permissions                         |
| `REPORTING`      | Reporting                            | grouping for report generation                   |
| `MAINTENANCE`    | Maintenance                          | maintenance team                                 |
| `MONITORING`     | Monitoring                           | dashboards/panels                                |
| `CUSTOM`         | Custom                               | free-form                                        |

### 5.4 Channels catalog (`GET /groups/channels`)

`EMAIL`, `EMAIL_RELAY`, `TELEGRAM`, `WHATSAPP`, `SMS`, `SLACK`, `TEAMS`,
`WEBHOOK`, `CUSTOM`.

> `EMAIL_RELAY` was added on 2026-03-16 (platform-shared relay).
> `gatewayToken` has been removed — do not use it anymore.

### 5.5 Endpoints

| Method | Path                                  | Description                                          |
|--------|---------------------------------------|------------------------------------------------------|
| POST   | `/groups`                             | create                                               |
| GET    | `/groups`                             | list (`customerId`, `type`, `purpose`, `status`, `tag`, `search`, cursor) |
| GET    | `/groups/purposes`                    | purposes catalog (hardcoded — 12 items)              |
| GET    | `/groups/channels`                    | channels catalog (9 items)                           |
| GET    | `/groups/:id`                         | by id                                                |
| PUT    | `/groups/:id`                         | update                                               |
| DELETE | `/groups/:id?soft=true`               | delete (`soft=true` → soft delete)                   |
| GET    | `/groups/:id/members`                 | members **enriched** with name/email from users      |
| POST   | `/groups/:id/members`                 | add (up to 100 per call)                             |
| DELETE | `/groups/:id/members`                 | remove by `memberIds[]`                              |
| GET    | `/groups/:id/children`                | direct children                                      |
| GET    | `/groups/:id/descendants`             | full subtree                                         |
| POST   | `/groups/:id/move`                    | move to another parent                               |
| GET    | `/groups/by-member/:memberId?memberType=USER` | groups a member belongs to                   |
| **RFC-0024 (nested)** |                            |                                                      |
| *      | `/groups/:groupId/dispatch`           | group dispatch matrix                                |
| *      | `/groups/:groupId/channels`           | group channel targets                                |

See `docs/alarms/GROUPS-CHANNELS-NOTIFICATIONS.md` and
`docs/rfcs/RFC-0024-Alarm-Dispatch-Config.md` for dispatch payloads.

---

## 6. Maintenance Groups (RFC-0013)

Base: `/api/v1/maintenance-groups` — JWT.
Tables: `maintenance_groups` (+ junction `user_maintenance_groups`).

**Difference vs generic Groups**: focused on **user maintenance teams**
with a business key (`key`), a junction with an FK (not JSONB), and
per-member **expiration** support (`user_maintenance_groups.expiresAt`).

### 6.1 Endpoints

| Method       | Path                                                       | Description                       |
|--------------|------------------------------------------------------------|-----------------------------------|
| POST         | `/maintenance-groups`                                      | create                            |
| GET          | `/maintenance-groups`                                      | list                              |
| GET          | `/maintenance-groups/:groupId`                             | by id                             |
| GET          | `/maintenance-groups/:groupId/details`                     | with members                      |
| GET          | `/maintenance-groups/key/:key`                             | by key                            |
| PUT/PATCH    | `/maintenance-groups/:groupId`                             | update (both methods accepted)    |
| DELETE       | `/maintenance-groups/:groupId`                             | delete                            |
| GET          | `/maintenance-groups/:groupId/members?includeExpired=`     | list members                      |
| POST         | `/maintenance-groups/:groupId/members`                     | add one (`userId`, `expiresAt?`)  |
| POST         | `/maintenance-groups/:groupId/members/bulk`                | add many (`userIds[]`)            |
| DELETE       | `/maintenance-groups/:groupId/members/:memberId`           | remove one                        |
| POST         | `/maintenance-groups/:groupId/members/remove`              | remove many (`userIds[]`)         |
| GET          | `/maintenance-groups/user/:userId?includeExpired=`         | user's groups                     |

---

## 7. Access Bundle + Domain Permissions (RFC-0013)

Base: `/api/v1/access-bundle` — JWT.
Tables: `domain_permissions`, `user_bundle_cache`.

### 7.1 Concept

Bundle = **snapshot** of the effective permissions a user has within a
scope, designed for mobile/offline/IoT consumption. Hierarchical
4-level permission: **`domain.equipment.location:action`**.

Examples:
- `energy.medidor.common_area:read`
- `water.hidrometro.stores:write`

**Caches**: `user_bundle_cache` with TTL + checksum. `invalidatedAt` flags
an explicit invalidation.

### 7.2 Endpoints — Bundle

| Method | Path                                               | Description                                  |
|--------|----------------------------------------------------|----------------------------------------------|
| GET    | `/access-bundle/me?scope=&includeFeatures=&includeDomains=&includeFlat=&ttl=&useCache=` | authenticated user's bundle |
| GET    | `/access-bundle/users/:targetUserId`               | someone else's bundle (admin)                |
| POST   | `/access-bundle/me/refresh`                        | force refresh (accepts `reason`)             |
| POST   | `/access-bundle/users/:targetUserId/refresh`       | force refresh for another user               |
| DELETE | `/access-bundle/users/:targetUserId/cache`         | invalidate cache (accepts `reason`, `scope`) |

### 7.3 Endpoints — Permission check

| Method | Path                                  | Description                            |
|--------|---------------------------------------|----------------------------------------|
| POST   | `/access-bundle/check`                | checks 1 permission (uses `userId` from JWT) |
| POST   | `/access-bundle/check-batch`          | checks several (**hyphen**, not `/batch`)    |
| POST   | `/access-bundle/check-feature`        | checks by `featureKey`                 |

### 7.4 Endpoints — Domain Permissions Registry

| Method | Path                                                                                | Description              |
|--------|-------------------------------------------------------------------------------------|--------------------------|
| GET    | `/access-bundle/domain-permissions`                                                 | list                     |
| POST   | `/access-bundle/domain-permissions`                                                 | create one               |
| POST   | `/access-bundle/domain-permissions/bulk`                                            | bulk create              |
| PUT    | `/access-bundle/domain-permissions/:permissionId`                                   | update                   |
| DELETE | `/access-bundle/domain-permissions/:permissionId`                                   | delete                   |
| GET    | `/access-bundle/domain-permissions/domains`                                         | domains catalog          |
| GET    | `/access-bundle/domain-permissions/domains/:domain/equipments`                      | equipments for a domain  |
| GET    | `/access-bundle/domain-permissions/domains/:domain/equipments/:equipment/locations` | locations for equipment  |

**Known catalogs** (RFC-0013):
- **Equipments**: `hidrometro`, `medidor`, `sensor`
- **Locations**: `entry`, `common_area`, `stores`, `internal`, `external`,
  `parking`, `roof`, `basement`

---

## 8. User Notification Contacts (RFC-0024 / RFC-0025)

Base: `/api/v1/users/:userId/contacts` — JWT (nested — **must be mounted
before** the general `/users`).

Table: `user_contacts` — unique per `(tenantId, userId, channel, value)`.

| Column    | Type     |
|-----------|----------|
| `channel` | varchar  | `EMAIL`, `SMS`, `TELEGRAM`, `WHATSAPP`, `SLACK`, `TEAMS`, `WEBHOOK`, `EMAIL_RELAY`, `CUSTOM` |
| `value`   | varchar  | email, chat_id, handle, URL, E.164 number, etc. |
| `label`   | varchar  | optional label                                |
| `verified`| bool     | verification flow (Phase 2)                   |
| `active`  | bool     |                                               |

| Method | Path                                        | Description                             |
|--------|---------------------------------------------|-----------------------------------------|
| GET    | `/users/:userId/contacts`                   | list                                    |
| POST   | `/users/:userId/contacts`                   | add (`channel`, `value`, `label?`, `active?`) |
| PATCH  | `/users/:userId/contacts/:contactId`        | update (`value?`, `label?`, `active?`)  |
| DELETE | `/users/:userId/contacts/:contactId`        | remove                                  |

> **Heads up**: the handler validates `userId` and `contactId` as **UUIDs**
> (internal regex). Invalid IDs → 400.

---

## 9. Router mount order (important)

In `src/app.ts` the order matters — **nested** routes come before the
general routes to avoid collisions:

```
/users/:userId/contacts          ← nested (RFC-0024)
/customers/:customerId/channels  ← nested (RFC-0024)
/customers (general router)
/users (general router)
/policies
/roles
/authorization
/groups/:groupId/dispatch        ← nested (RFC-0024)
/groups/:groupId/channels        ← nested (RFC-0024)
/groups (general router)
/maintenance-groups              ← RFC-0013
/access-bundle                   ← RFC-0013
```

---

## 10. Related docs matrix (review 2026-04-16)

| Doc                                                | Status      | Note                                                                                                |
|----------------------------------------------------|-------------|-----------------------------------------------------------------------------------------------------|
| `RFC-0002-GCDR-Authorization-Model.md`             | ⚠️ OUTDATED | Uses base `/api/v1/authz/*` and `/evaluate`, `/evaluate-batch`. **Real**: `/api/v1/authorization/check` and `/check/batch`. |
| `AUTHORIZATION-MODEL.md`                           | ⚠️ OUTDATED | Endpoints `/authorization/evaluate` / `/evaluate-batch`. **Real**: `/authorization/check` and `/check/batch`. Concepts OK. |
| `RBAC-ACCESS-CONTROL.md`                           | ✅ OK        | Endpoints match the code. Primary RBAC reference.                                                   |
| `RFC-0011-User-Registration-Approval-Workflow.md`  | ✅ OK        | `approve` still has a TODO for `assignRoles` (see §3.1).                                            |
| `RFC-0013-User-Access-Profile-Bundle.md`           | ✅ OK        | Implemented. Note: `check-batch` uses a hyphen (not `check/batch`).                                 |
| `RFC-0024-Alarm-Dispatch-Config.md`                | ✅ OK        | Matches groups/channels/dispatch.                                                                   |
| `RFC-0025-User-Notification-Contacts.md`           | ✅ OK (partial) | Phase 2 (verification) not implemented yet.                                                     |
| `API-GROUPS-DOMAINS-ROLES.md`                      | ⚠️ OUTDATED | Uses the older `permissions[]` format (pre-RFC-0002) and misses purposes added in 2026-03.          |
| `FRONTEND-Users-Groups-Roles.md`                   | ✅ OK        | Practical frontend guide. Consistent.                                                               |
| `FRONTEND-Groups-Purposes.md`                      | ✅ OK (1.0 2026-03-16) | Current purposes catalog.                                                                  |
| `FRONTEND-GroupChannels-Dispatch-Payloads.md`      | ✅ OK        | Breaking changes documented (`escalationDelayMs`, removal of `gatewayToken`).                       |
| `GROUPS-CHANNELS-NOTIFICATIONS.md`                 | ✅ OK        | Full notification architecture.                                                                     |

### 10.1 Recommended actions

1. **Deprecate** `API-GROUPS-DOMAINS-ROLES.md` or update it to use the
   `resource.action.target` format and reflect the 5 new purposes (2026-03).
2. **Update** `RFC-0002` and `AUTHORIZATION-MODEL.md` with the real paths
   (`/authorization/check` instead of `/authz/evaluate`), or add a banner
   pointing to this doc (GCDR-USER.md) as the canonical source (already
   done on 2026-04-16).
3. Keep `RBAC-ACCESS-CONTROL.md` as the operational RBAC reference
   (already correct).

---

## 11. Quick dev/QA checklist

- [ ] New endpoint touching a user? Goes through `authMiddleware` and uses
      `req.context.tenantId`.
- [ ] Change to user status? Update the enum in `UpdateUserStatusSchema`
      **and** in `ListUsersSchema` (both in `UserDTO.ts`).
- [ ] New permission? Format `resource.action.target` (3 lowercase parts).
- [ ] New group purpose? Add to `GroupPurposeEnum` + catalog in
      `groups.controller.ts` (`GET /groups/purposes`) + this doc §5.3.
- [ ] New channel? Add to `NotificationChannelSchema` + catalog in
      `groups.controller.ts` (`GET /groups/channels`) + this doc §5.4.
- [ ] Change affecting the bundle? Invalidate the cache via
      `DELETE /access-bundle/users/:userId/cache`.
- [ ] New audit event? Use the `logEvent({ eventType, ... })` decorator
      with `EventType` from `shared/types`.

---

## 12. Swagger audit (`docs/openapi.yaml`, 2026-04-17)

The Swagger file was **brought up to date on 2026-04-17** for the core
user/authz subsystem. Remaining gaps are minor.

### 12.1 Added on 2026-04-17

- `GET /auth/me` (+ `AuthMeResponse`, `EnrichedAssignment/Role/Policy` schemas)
- `PUT /users/{id}/default-customer` (+ `SetDefaultCustomerRequest`, plus
  `defaultCustomerId` on `UserPreferences`)
- Full `/access-bundle/*` family — 16 operations (bundle + refresh + cache
  + check/batch/check-feature + domain-permissions registry + catalog
  endpoints for domains/equipments/locations)
- Full `/maintenance-groups/*` family — 13 operations (CRUD + members + bulk
  + by key + by user)
- `/users/{userId}/contacts` — 4 operations
- `/customers/{customerId}/channels` — 4 operations
- 4 new tags: `Access Bundle`, `Maintenance Groups`, `User Contacts`,
  `Customer Channels`

### 12.2 Remaining gaps in Swagger (minor)

- `POST /auth/validate-key` — Customer API Key validation (M2M).
- `GET /groups/purposes` and `GET /groups/channels` (catalogs).
- `POST /groups/:id/move` (exists in code).
- `/admin/simulator`, `/admin/monitor`, `/admin/db` are admin-only (not
  public API) but could have a note.

### 12.2 Path divergences between Swagger and code

| Swagger (wrong)                                          | Code (correct)                                           |
|----------------------------------------------------------|----------------------------------------------------------|
| `POST /authorization/assignments/{assignmentId}/revoke`  | `DELETE /authorization/assignments/:assignmentId`        |
| `GET /groups/member/{memberId}`                          | `GET /groups/by-member/:memberId`                        |
| `/users/password-reset/request`, `/users/password-reset/confirm`, `/users/verify-email`, `/users/accept-invitation` | These flows live in `/auth/*` (register, verify-email, forgot-password, reset-password) |

### 12.3 Recommended actions

1. **Add** the missing blocks to `docs/openapi.yaml` (top priority for
   `/access-bundle`, `/maintenance-groups`, `/users/:userId/contacts` and
   `/customers/:customerId/channels` — full features currently invisible
   to API consumers).
2. **Rename** `POST .../revoke` to `DELETE` in Swagger.
3. **Move/remove** the reset/verify/accept-invitation endpoints out of the
   `/users` group (or drop them — they do not exist today).
4. Consider **auto-generating** the OpenAPI from the Zod schemas (e.g.
   with `zod-to-openapi`) to avoid future drift.

---

## 13. Useful IDs (seed)

- Default tenant: `11111111-1111-1111-1111-111111111111`
- Test customer: `33333333-3333-3333-3333-333333333333`
- Moxuara customer: `84e0370e-636a-4741-9874-504b5e0b3577`
- Test bundle API Key: `gcdr_cust_test_bundle_key_myio2026`
- Moxuara central: `e982edf9-edb1-4aa6-8a14-4782465ae5a3`
