# Backend Response to RFC-0018 Issues

> Responses to each issue raised in `BACKEND-ISSUES-RFC0018.md`.

---

## Issue 7: Role Creation — RESOLVED

The roles CRUD endpoints have been implemented and are now available at `/api/v1/roles`.

### New Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/roles` | Create role |
| `GET` | `/api/v1/roles` | List roles (with `limit`, `cursor`, `riskLevel`, `isSystem` query params) |
| `GET` | `/api/v1/roles/:roleId` | Get role by ID |
| `GET` | `/api/v1/roles/key/:roleKey` | Get role by key |
| `PUT` | `/api/v1/roles/:roleId` | Update role |
| `DELETE` | `/api/v1/roles/:roleId` | Delete role |

All endpoints require `Authorization: Bearer <token>` and `x-tenant-id` headers (standard `authMiddleware`).

### Key Format Discrepancy (ACTION REQUIRED by Frontend)

The frontend doc states keys should be formatted as `role:my-custom-role`. However, the backend `CreateRoleSchema` validates keys with the regex `^[a-z][a-z0-9_]*$`.

This means:
- The `:` character is **NOT allowed** in role keys
- Hyphens (`-`) are **NOT allowed** — use underscores (`_`) instead
- No prefix is expected

**Frontend must send:** `my_custom_role` (not `role:my-custom-role`)

The same applies to policy keys — the backend regex is `^[a-z][a-z0-9_]*$`, so `policy:device-reader` would fail validation. Send `device_reader` instead.

---

## Issue 8: Policy Creation — NOT A BACKEND ISSUE

The `POST /api/v1/policies` endpoint **already exists** and has been working since it was implemented. It uses the same `authMiddleware` as all other protected routes, which reads the `Authorization: Bearer <token>` header.

### Verification

- Route is registered at `app.ts`: `apiV1Router.use('/policies', authMiddleware, policiesController)`
- Auth middleware is the standard `authMiddleware` — identical to devices, groups, partners, etc.
- All CRUD operations (POST, GET, GET by ID, GET by key, PUT, DELETE) are implemented in `policies.controller.ts`

### Likely Cause

The "Token de acesso nao fornecido" error is most likely caused by one of:

1. **Frontend key format mismatch**: The frontend sends `policy:device-reader` but the backend expects `device_reader` (see regex `^[a-z][a-z0-9_]*$`). A Zod validation error might be surfacing as a confusing error message.
2. **Token not being attached for this specific request**: Debug the actual network request in the browser DevTools (Network tab) to verify the `Authorization` header is present.
3. **CORS preflight issue**: If the browser is sending an OPTIONS request first and the preflight fails, the subsequent POST won't include credentials.

### Recommended Frontend Debug Steps

1. Open browser DevTools > Network tab
2. Trigger the policy creation
3. Inspect the actual request headers — confirm `Authorization: Bearer <token>` is present
4. Check the response status code — is it 401, 404, or 400?
5. Try the same request via `curl` to isolate browser vs code issues

---

## Issue 9: Maintenance Group PATCH — RESOLVED

A `PATCH` alias has been added that routes to the exact same handler as `PUT`. Both methods now work identically for partial updates.

### Available Methods

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `PUT` | `/api/v1/maintenance-groups/:groupId` | Update group (partial) |
| `PATCH` | `/api/v1/maintenance-groups/:groupId` | Update group (partial, alias for PUT) |

Both accept the same `UpdateMaintenanceGroupSchema` body with all fields optional.

### Path Discrepancy (Frontend should verify)

The frontend doc lists `GET /api/v1/maintenance-groups/by-key/:key`, but the backend implements `GET /api/v1/maintenance-groups/key/:key` (no `by-` prefix). Please verify the frontend is using the correct path.

### Full Maintenance Groups Endpoint Map

| Method | Backend Endpoint | Notes |
|--------|-----------------|-------|
| `POST` | `/api/v1/maintenance-groups` | Create group |
| `GET` | `/api/v1/maintenance-groups` | List groups |
| `GET` | `/api/v1/maintenance-groups/:groupId` | Get by ID |
| `GET` | `/api/v1/maintenance-groups/:groupId/details` | Get with members |
| `GET` | `/api/v1/maintenance-groups/key/:key` | Get by key (NOT `by-key`) |
| `PUT` | `/api/v1/maintenance-groups/:groupId` | Update group |
| `PATCH` | `/api/v1/maintenance-groups/:groupId` | Update group (alias) |
| `DELETE` | `/api/v1/maintenance-groups/:groupId` | Delete group |
| `GET` | `/api/v1/maintenance-groups/:groupId/members` | List members |
| `POST` | `/api/v1/maintenance-groups/:groupId/members` | Add single member |
| `POST` | `/api/v1/maintenance-groups/:groupId/members/bulk` | Add multiple members |
| `DELETE` | `/api/v1/maintenance-groups/:groupId/members/:memberId` | Remove member |
| `POST` | `/api/v1/maintenance-groups/:groupId/members/remove` | Remove multiple members |
| `GET` | `/api/v1/maintenance-groups/user/:userId` | Get user's groups |

---

## Summary

| Issue | Status | Action |
|-------|--------|--------|
| #7 — Roles CRUD | **Resolved** | Frontend must fix key format: use `my_custom_role` not `role:my-custom-role` |
| #8 — Policies auth | **Not a backend issue** | Frontend should debug token attachment and fix key format |
| #9 — Maintenance Groups PATCH | **Resolved** | Frontend should verify path: `key/:key` not `by-key/:key` |
