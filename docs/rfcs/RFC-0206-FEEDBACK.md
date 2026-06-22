# Feedback (GCDR) — RFC-0206 Naming & Code Generators (Customer / Asset / Device)

GCDR-side review of [RFC-0206 — Shared Naming & Code-Generation Utilities]
(`myio-js-library/src/docs/rfcs/RFC-0206-...md`). RFC-0206 keeps **uniqueness
enforcement on the GCDR API** ("this library only *checks* and *suggests*"). This
doc maps each generated value to what GCDR can actually validate today, and what's
missing to fully back the library's `check*Available` / `pickUnique*` helpers.

Two questions per generated value:
- **"válido"** (format) — owned by the library (the `C-/A-/D-<plate>-<plate>` grammar regex). GCDR does not need to validate format.
- **"único"** (uniqueness) — owned by GCDR. The library calls an availability endpoint with `{ baseUrl, token }`.

---

## 1. Uniqueness model actually enforced in GCDR (DB constraints)

| Field | Unique index | Scope |
|---|---|---|
| `customers.code` | `customers_tenant_code_unique` | `(tenant_id, code)` |
| `customers.name` | — | **not unique** (names may repeat) |
| `assets.code` | `assets_tenant_customer_code_unique` | `(tenant_id, customer_id, code)` |
| `assets.name` | — | **not unique** |
| `devices.name` | `devices_tenant_customer_name_unique` | `(tenant_id, customer_id, name)` |
| `devices.serial_number` | `devices_tenant_serial_unique` | `(tenant_id, serial_number)` |
| **`devices.code`** | — | **not unique (no index today)** |

Source: `src/infrastructure/database/drizzle/schema.ts` (customers:193, assets:297, devices:387/410/413).

**Implication:** only **customer code**, **asset code** and **device name** are
DB-unique. **Customer/asset names are not unique by design**, and **`devices.code`
has no uniqueness today** — relevant because RFC-0206 Phase 3 mints device *codes*.

---

## 2. Validation endpoints that already exist (ready to back RFC-0206)

All return the standard envelope; payload is `data: { exists, count }`. Map
**`available = !data.exists`**. Auth: Bearer JWT (read scope); tenant is taken from
the token. Input is validated (≤ column length); missing params → `400 VALIDATION_ERROR`.

| RFC-0206 helper | GCDR endpoint | Validates | Source |
|---|---|---|---|
| `checkCustomerCodeAvailable(code)` | `GET /api/v1/customers/exists?code=<C-…-…>` | `(tenant, code)` | `customers.controller.ts:76` |
| `checkAssetCodeAvailable(code, customerId)` | `GET /api/v1/assets/exists?customerId=<uuid>&code=<A-…-…>` | `(tenant, customer, code)` | `assets.controller.ts:105` |
| *(device name — exists, but RFC keys on code)* | `GET /api/v1/devices/exists?name=<v>[&customerId][&caseSensitive]` | `(tenant, customer, name)`; returns `{exists,count,caseSensitive}` | `devices.controller.ts:126` |

**Note for asset:** the asset code endpoint is **per-customer** (`customerId`
required), matching its unique scope — `pickUniqueAssetCode` must therefore know the
target customer.

### Better-shaped precedent: `centrals/serial/available`
```
GET /api/v1/centrals/serial/available?value=S1.S2.S3.S4   ->  { value, valid, available }
```
(`centrals.controller.ts:432`, PUBLIC.) It returns **format + uniqueness in one
response** — exactly RFC-0206's "válido E único". Recommended shape for any new
generator-facing endpoint.

---

## 3. Gap: device code (RFC-0206 Phase 3)

RFC-0206 generates `D-<TYPE>-<plate>-<plate>` device **codes** and will want
`checkDeviceCodeAvailable` / `pickUniqueDeviceCode`. **GCDR has neither a uniqueness
constraint nor an endpoint for `devices.code`.** To back it:

1. **Migration** — add a unique index on `devices.code`. Recommended scope
   **`(tenant_id, code)`** (global per tenant — consistent with the opaque,
   tenant-wide `C-`/`A-`/`D-` grammar). `devices.code` is `varchar(50)` **nullable**,
   so the index must be **partial**:
   ```sql
   CREATE UNIQUE INDEX devices_tenant_code_unique
     ON devices (tenant_id, code) WHERE code IS NOT NULL;
   ```
   (Pre-flight: confirm no existing duplicate non-null codes per tenant before
   applying; backfill/dedupe if any.)
2. **Endpoint** — `GET /api/v1/devices/exists?code=<D-…>` (same controller, a `code`
   branch), `data: { exists, count }`. Optionally adopt the `{ value, valid, available }`
   shape so format+uniqueness come together.

---

## 4. Coverage summary vs RFC-0206 outputs

| Generated (RFC-0206) | "válido" (lib) | "único" (GCDR) |
|---|---|---|
| customer **code** `C-…-…` | regex | ✅ `/customers/exists?code=` |
| customer **name** (display via `slugifyCustomerName`) | lib | ❌ not unique by design |
| asset **code** `A-…-…` | regex | ✅ `/assets/exists?customerId=&code=` |
| asset **name** | lib | ❌ not unique |
| device **code** `D-<TYPE>-…-…` | regex | ⚠️ **missing** (§3: migration + endpoint) |
| *(device name)* | lib | ✅ `/devices/exists?name=&customerId=` |

---

## 5. Recommendations

1. **Phases 1 & 2 (customer/asset code)** can ship now against the existing
   `/customers/exists` and `/assets/exists` endpoints — map `available = !exists`.
   `pickUniqueAssetCode` must pass `customerId`.
2. **Phase 3 (device code)** is blocked on GCDR: implement the partial unique index
   + `/devices/exists?code=` first. Track as a small GCDR PR (migration + controller
   branch). Until then, the library can only validate device-code **format**, not
   uniqueness.
3. **Names are not a uniqueness surface** (except device name per customer). Don't
   build `check*NameAvailable` for customer/asset names expecting enforcement; if a
   soft "name already in use" warning is wanted, add a non-authoritative
   `name`-existence read, but it cannot guarantee uniqueness (the DB won't reject a
   duplicate name).
4. Prefer the **`{ value, valid, available }`** response shape (centrals precedent)
   for any new generator endpoint, so a single call answers "válido E único".

> GCDR action item if approved: a branch adding `devices_tenant_code_unique`
> (partial) + `GET /devices/exists?code=`. Say the word and I'll open it.
