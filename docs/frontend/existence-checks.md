# Existence checks — customer code / asset code / device name

Lightweight **pre-submit validation** endpoints so a create/edit form can tell the
user "this code/name is already taken" **before** they submit (instead of failing
on a `409 Conflict` from the unique constraint).

> Status: **2 endpoints novos** (`customers`, `assets`) + **1 já existente**
> (`devices`, agora com `customerId` opcional). All are `GET`, authenticated
> (Bearer JWT), and inherit the entity's **read** permission.

These checks are **advisory** — the database unique index is the real guard. Always
still handle a `409` on submit (a name can be taken between the check and the save).

---

## Common response envelope

All three return the standard envelope; the payload is in `data`:

```jsonc
{
  "success": true,
  "data": { "exists": true, "count": 1 },   // device also returns "caseSensitive"
  "meta": { "requestId": "…", "timestamp": "2026-06-16T…Z" }
}
```

- `exists` — `true` if at least one row already uses the value (in the relevant scope).
- `count` — how many rows match (`0` or `1` for codes; can be `>1` for device name
  when not scoped to a single customer).
- `available` for the UI = `!exists`.

**Errors** (standard error envelope): missing/invalid query params →
`400 { success:false, error:{ code:"VALIDATION_ERROR", message } }`; no/!valid token
→ `401`.

---

## 1. Customer code — `GET /api/v1/customers/exists`

Unique scope: **per tenant** (`tenant_id, code`).

| Query param | Required | Notes |
|---|---|---|
| `code` | ✅ | trimmed, max 50 chars |

```bash
curl -H "Authorization: Bearer $JWT" \
  "https://gcdr-api.a.myio-bas.com/api/v1/customers/exists?code=DIMENSION"
# -> { "data": { "exists": true, "count": 1 }, … }
```

---

## 2. Asset code — `GET /api/v1/assets/exists`

Unique scope: **per customer** (`tenant_id, customer_id, code`) — so `customerId` is
**required**.

| Query param | Required | Notes |
|---|---|---|
| `customerId` | ✅ | UUID of the owning customer |
| `code` | ✅ | trimmed, max 50 chars |

```bash
curl -H "Authorization: Bearer $JWT" \
  "https://gcdr-api.a.myio-bas.com/api/v1/assets/exists?customerId=7777…&code=DIM-MAIN"
# -> { "data": { "exists": true, "count": 1 }, … }
```

---

## 3. Device name — `GET /api/v1/devices/exists`

Unique scope: **per customer** (`tenant_id, customer_id, name`). Already existed;
now accepts an optional `customerId` to narrow to a single customer (matching the
real constraint). Without it, the check is **tenant-wide** (narrowed to the caller's
allowed customers if they're restricted).

| Query param | Required | Notes |
|---|---|---|
| `name` | ✅ | trimmed, max 255 chars |
| `customerId` | ⬜ | UUID — scope to one customer (recommended on create/edit forms) |
| `caseSensitive` | ⬜ | default `true` (matches the index). `false`/`0` → treat `Foo`/`FOO`/`foo` as equal |

```bash
curl -H "Authorization: Bearer $JWT" \
  "https://gcdr-api.a.myio-bas.com/api/v1/devices/exists?customerId=7777…&name=Energy%20Laborat%C3%B3rio"
# -> { "data": { "exists": true, "count": 1, "caseSensitive": true }, … }
```

> ⚠️ `caseSensitive` defaults to **true** to mirror the DB index — `Foo` and `foo`
> are considered different names and both insertable. Pass `caseSensitive=false`
> for a friendlier "looks like a duplicate" warning.

---

## Frontend usage

Debounce the field, call on blur/change, show an inline warning. Example with the
existing `httpClient`/service pattern:

```ts
// services/api/validationService.ts
import { BaseService } from './baseService';
import { ApiResponse } from '@/types';

type ExistsResult = { exists: boolean; count: number; caseSensitive?: boolean };

class ValidationService extends BaseService {
  customerCode(code: string): Promise<ApiResponse<ExistsResult>> {
    return this.apiGet<ExistsResult>('/customers/exists', { code });
  }
  assetCode(customerId: string, code: string): Promise<ApiResponse<ExistsResult>> {
    return this.apiGet<ExistsResult>('/assets/exists', { customerId, code });
  }
  deviceName(name: string, opts?: { customerId?: string; caseSensitive?: boolean }) {
    return this.apiGet<ExistsResult>('/devices/exists', { name, ...opts });
  }
}

export const validationService = new ValidationService();
```

```tsx
// in a form field (pseudo):
const { data } = await validationService.assetCode(customerId, code);
if (data.exists) setError('code', t('validation.codeTaken'));
```

**Recommended UX**
- Run the check on blur / after a 300–400 ms debounce, not on every keystroke.
- For **edit** forms, the entity keeps its own code/name — treat `exists` as a
  warning only when the value differs from the original (the backend doesn't take
  an `excludeId`; the FE should skip the warning when the value is unchanged).
- Never block submit on the check alone — always handle the `409 Conflict` from
  `POST`/`PATCH` as the authoritative answer.
```
