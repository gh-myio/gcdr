# RFC-0056: Central API Key Bootstrap & Provisioning Ladder

- Feature Name: `central_api_key_bootstrap`
- Start Date: 2026-08-05
- RFC PR: (leave this empty)
- Tracking Issue: (leave this empty)
- Status: **Draft v5 — implemented.** GCDR-side bootstrap, reset, scopes, and
  the `sync-events` re-gate are built; DEC-9 (reset endpoint), the `409`
  decision, and concrete rate-limit numbers close the gaps v4 left open.
- Related package: `packages/backend` (GCDR)
- Primary files (new/changed): `src/domain/entities/CustomerApiKey.ts`, `src/dto/request/CustomerApiKeyDTO.ts`, `src/middleware/centralPreKeyAuth.ts` (new), `src/services/CentralInitialKeyService.ts` (new), `src/controllers/central-initial-key.controller.ts` (new), `src/app.ts`, `src/middleware/rateLimit.ts`, `src/repositories/CentralRepository.ts` (new `patchConfig`), `src/controllers/centrals.controller.ts` (new `POST /:id/reset-provisioning`, DEC-9), `src/controllers/customer-integrations.controller.ts` (sync-events/disable/reset extracted for the re-gate)
- **No database migration** — all new state is jsonb in `centrals.config` (see DEC-7).
- Builds on: Customer API Key infra (scopes; **recoverable** reveal — migration 0036), `centrals` table (a.k.a. gateways; `config` jsonb), central-agent identity (`centralAuth`, `agent_secret`, `POST /central-agent/enroll`)
- Client consumers: **Central firmware / Orange Pi** + **pre-setup provisioning tool**, GCDR Frontend (API Key scopes UI — see frontend RFC-0048)

> **Changelog v4 (topology fix):** the `environment` table lives **on the central
> (Orange Pi)**, not in GCDR — so `GET /state` and `POST /provision` are **central-
> hosted**, and GCDR needs **no `environment` table and no migration**. GCDR's role
> narrows to: the 5 scopes, the pre-key, the bootstrap exchange, and minting the full
> key. What was previously specced as GCDR endpoints (`/state`, `/provision`,
> allowlist, at-rest encryption, secret readback) is now documented as **central
> firmware responsibility**. v3 security findings (lifecycle gating, binding, split
> credentials, recoverable storage) are retained where they still apply to GCDR.
>
> **Changelog v5 (implementation — closes v4's open gaps):**
> - **DEC-9 (new)** specifies the operator reset endpoint v4 described but never
>   named: `POST /centrals/:id/reset-provisioning`.
> - **Contract**: `409` chosen over the "`409/423`" v4 left undecided.
> - **DEC-1 correction**: `central-data:write` moves from "enforced by GCDR" to
>   "enforced by central" (semantic-only on the GCDR key, same as
>   `central-state`/`central-environment`) — GCDR exposes **no** clear-data
>   endpoint; "clear data" is a central/device-local operation, out of GCDR
>   scope, same as `/state`/`/provision`.
> - **DEC-5**: concrete rate-limit numbers proposed (v4 only named the
>   dimensions).
> - Acceptance criteria extended with the reset endpoint and the no-clear-data
>   correction.

---

## Summary

Provision every central through a **three-key privilege ladder**:

1. **`CENTRAL_PRE_INITIAL_API_KEY`** — one shared constant hardcoded in firmware.
   Only power: fetch the initial key from GCDR while the central is awaiting provisioning.
2. **`CENTRAL_INITIAL_API_KEY`** — per-central, minted by GCDR (Trust-On-First-Use),
   bound to that central. The central uses it to authenticate its **own** local
   `GET /state` / `POST /provision` (which write the central's device-local
   `environment` table).
3. **`CENTRAL_API_KEY`** — per-central, full operational key. Created by an
   **operator/privileged flow** in GCDR, then pushed **into the central** by the
   pre-setup tool via the central's `POST /provision`.

All per-central keys are `gcdr_cust_*` keys owned by the **MYIO customer**
(`56614a70-326f-11ef-ad2c-53aeabe7d3fa`), individually revocable, bound to a central.

> **GCDR scope:** the 5 scopes, the pre-key, the bootstrap exchange, and minting the
> full key. The device-local `environment`, `GET /state`, `POST /provision`, and
> their at-rest encryption are **central firmware** work (documented below, not built
> by GCDR).

## Motivation

- Centrals need real GCDR credentials but can only ship **one shared constant** in
  firmware.
- We still want **per-central isolation, attribution and revocation**, and the
  powerful full credential must **never transit the bootstrap**.

## Guide-level explanation

| Key | Lives in | Role | Scopes |
|---|---|---|---|
| `CENTRAL_PRE_INITIAL_API_KEY` | firmware + GCDR **env var** | unlock the bootstrap while `awaiting_provisioning` | none in catalog (middleware) |
| `CENTRAL_INITIAL_API_KEY` | minted by GCDR, held by the central; id cached+bound in `centrals.config` | authenticate the central's local `/state` + `/provision` | `central-state:read`, `central-environment:read`, `central-environment:write` |
| `CENTRAL_API_KEY` | minted in GCDR (operator), pushed into the central's local `environment` | full GCDR operations (devices/environment/clear-data/mqtt-sync) | `central-state:read`, `central-environment:read`, `central-environment:write`, `devices:read`, `devices:write`, `central-data:write`, `central-sync:write` |

End-to-end sequence (GCDR steps marked ▣, central/device steps marked ▢):

```
① ▣ BOOTSTRAP    firmware holds PRE key; central state = awaiting_provisioning
     Central ─ GET /api/v1/public/central/initial-key   [X-Central-Pre-Key + uuid]
     GCDR ───► mint/reveal CENTRAL_INITIAL_API_KEY (TOFU, bound to uuid, lifecycle-gated)

② ▣ MINT FULL KEY   operator/privileged flow
     Operator ─ POST /api/v1/customers/:myio/api-keys  (full scopes) → CENTRAL_API_KEY
     GCDR binds it: centrals.config.centralApiKeyId = key.id ; provisioningState = provisioned
       └─ closes the bootstrap window (INITIAL reveal now reset-gated)

③ ▢ PROVISION DEVICE   central-hosted (Orange Pi) — OUT OF GCDR SCOPE
     Pre-setup ─ POST /provision  →  the CENTRAL   [auth: CENTRAL_INITIAL_API_KEY]
       └─ upsert CENTRAL_API_KEY into the central's LOCAL environment (encrypted on device)
     Pre-setup ─ GET /state  →  the CENTRAL

④ ▣ OPERATION    central → GCDR
     Central ─ devices / environment / clear-data / mqtt-sync … [X-API-Key: CENTRAL_API_KEY]
```

The INITIAL rung only authenticates the central's own local provisioning endpoints;
the full key never appears in the bootstrap; the pre-key is useless once the central
is `provisioned`.

## Reference-level explanation

### DEC-1 — New API-key scopes (5)

Added to `ApiKeyScope` (`CustomerApiKey.ts`) and `ApiKeyScopeSchema`
(`CustomerApiKeyDTO.ts`), grouped:

| Scope | Enforced by | Gates |
|---|---|---|
| `central-state:read` | **central** | central's `GET /state` |
| `central-environment:read` | **central** | reading the device-local `environment` |
| `central-environment:write` | **central** | central's `POST /provision` |
| `central-data:write` | **central** *(v5 correction)* | clear-data operations, device-local |
| `central-sync:write` | **GCDR** | mqtt sync-status operations |

The full key also reuses existing `devices:read` / `devices:write` (GCDR). The
`central-state` / `central-environment` / `central-data` scopes are semantic on
the GCDR key and **enforced by the central** when it validates the presented
key for its local endpoints. Additive; existing keys unaffected.

> **v5 correction:** v4 listed `central-data:write` as "enforced by GCDR",
> implying a GCDR clear-data endpoint. It doesn't exist and isn't being built —
> "clear data" is a central/device-local operation, same category as
> `/state`/`/provision` (see "Central firmware responsibilities" below). GCDR's
> only role for this scope is issuing it as a grant on the full key; only
> `central-sync:write` is actually enforced by GCDR-side authorization.

### DEC-2 — Pre-key is an env var, not a catalog key

`CENTRAL_PRE_INITIAL_API_KEY` validated by `centralPreKeyAuth` via **constant-time
compare** against `process.env.CENTRAL_PRE_INITIAL_API_KEY`. No `customer_api_keys`
row, no scope. Missing env var ⇒ bootstrap fails closed.

### DEC-3 — `gcdr_cust_*` storage is recoverable (enables cached reveal)

Customer API keys are stored as **hash for lookup + encrypted-recoverable
`keyPlain`** since migration 0036 (the audited reveal path). New keys minted here are
recoverable, so the cached-id reveal in DEC-4 is valid.

### DEC-4 — INITIAL key: per-central, TOFU, **lifecycle-gated & bound**

- Each central carries `centrals.config.provisioningState`
  (`awaiting_provisioning` → `provisioned`).
- `/initial-key` mints (first call) or **idempotently reveals** the cached INITIAL
  key **only while `awaiting_provisioning`** (tolerates firmware retries).
- Minted via `CustomerApiKeyService.createApiKey(...)` under
  `CENTRAL_INITIAL_KEY_CUSTOMER_ID` (default MYIO), name `Central Initial Key — <uuid>`,
  scopes = state-read + environment-read/write.
- Key id cached + bound on `centrals.config.centralInitialApiKeyId` (jsonb; no
  DB-level FK — accepted tradeoff).
- After the full key is bound (DEC-6) the state flips to `provisioned` and
  `/initial-key` is **reset-gated** (`409/423`) until an explicit operator reset
  re-opens the window and rotates the INITIAL key.

### DEC-5 — Bootstrap endpoint + rate-limit dimensions

`GET /api/v1/public/central/initial-key`, headers `X-Central-Pre-Key` + `uuid`.
Failures return a single generic `401` (bad pre-key / unknown central / malformed
uuid) or `409` (already provisioned — v5: chosen over v4's undecided `409/423`)
— no enumeration oracle. Rate limits keyed by **IP**, **central `uuid`**,
**pre-key failure count** (progressive lockout), and **successful reveal
count** per uuid. Audit carries IP/uuid/outcome — never plaintext.

**v5 — concrete numbers** (proposed by analogy to the existing
`centralEnrollRateLimiter`; no threshold was specified in v4, adjust freely):

| Dimension | Limit | Mechanism |
|---|---|---|
| Per IP | 20 / 10 min | `centralBootstrapIpRateLimiter` (plain request-entry window) |
| Per central `uuid` | 10 / 10 min | `centralBootstrapUuidRateLimiter` (plain request-entry window) |
| Pre-key failures | lockout after 5, `5min · 2^excess` capped at 60min, keyed by **IP** (the pre-key is one global secret, not per-central — locking by uuid alone wouldn't slow a rotating-uuid attacker, and a global/fleet-wide lock would let one attacker DoS every central's bootstrap) | `centralPreKeyAuth`'s own lockout store (resets on success) |
| Successful reveals per uuid | 5 / hour | `consumeIfAllowed('central-bootstrap-reveal', uuid, …)`, checked as a conservative pre-check before mint/reveal work (a call that later 409s on "already provisioned" still spends budget — a deliberate simplification) |

### DEC-6 — Full key: operator-gated mint, split credentials, bound

- Created by the **existing operator/JWT-gated** `POST /api/v1/customers/:myioId/api-keys`
  (full scope set), name `Central API Key — <uuid>`. **The INITIAL key cannot call
  this** (no operator permission) — INITIAL minting full keys is an explicit non-goal.
- GCDR **binds** it: `centrals.config.centralApiKeyId = key.id`, which also flips
  `provisioningState → provisioned` (closing the bootstrap window, DEC-4).
- The pre-setup tool holds **two** credentials: an **operator token** (to create the
  full key in GCDR) and the **INITIAL key** (to push it into the central via the
  central's `/provision`).

### DEC-7 — No GCDR migration (state is jsonb; `environment` is device-local)

- The `environment` table is **on the central (Orange Pi)**, not GCDR.
- The 5 scopes live in `customer_api_keys.scopes` (jsonb — additive).
- `provisioningState`, `centralInitialApiKeyId`, `centralApiKeyId` live in
  `centrals.config` (jsonb).
- Therefore **RFC-0056 introduces no schema migration** in GCDR.

### DEC-8 — Configuration

| Env var | Default | Purpose |
|---|---|---|
| `CENTRAL_PRE_INITIAL_API_KEY` | *(unset → bootstrap disabled)* | shared pre-key secret |
| `CENTRAL_INITIAL_KEY_CUSTOMER_ID` | `56614a70-326f-11ef-ad2c-53aeabe7d3fa` | owner of the minted per-central keys |

The `uuid` header is the same lowercase header the poll loop already sends (Express
lowercases header names) — no new normalization.

### DEC-9 — Operator reset endpoint *(v5, new)*

v4 said an "explicit operator reset" re-opens the bootstrap window and
rotates the INITIAL key, without naming an endpoint. That gap is filled by:

**`POST /api/v1/centrals/:id/reset-provisioning`** — operator JWT (same
`authMiddleware` as the rest of `/centrals`; not `X-API-Key`, this is an
admin action). Behavior:

1. Best-effort revokes **both** `centralInitialApiKeyId` and
   `centralApiKeyId` (if bound) via `customerApiKeyService.revokeApiKey`
   under the INITIAL-key tenant/customer (not the central's own tenant).
   Ignores `NotFoundError` (a key may already be gone).
2. Clears both fields in `centrals.config` and sets `provisioningState` back
   to `awaiting_provisioning`.
3. Audit-logs `CENTRAL_PROVISIONING_RESET`.

**Why both keys, not just the INITIAL**: `provisioningState = provisioned` is
driven by the presence of `centralApiKeyId` (DEC-6). Resetting only the
INITIAL key while leaving the full key bound would leave the state
inconsistent — `awaiting_provisioning` with a full key still live. Resetting
both fully reopens the ladder from scratch.

## Central firmware responsibilities (out of GCDR scope)

Documented here so the central team has the contract; **not built by GCDR**:

- Host `GET /state` and `POST /provision` locally; authenticate them with the
  `CENTRAL_INITIAL_API_KEY` the central fetched at bootstrap.
- `POST /provision` writes an **allowlist** of environment keys only — at minimum
  `CENTRAL_API_KEY` plus approved bootstrap fields; enforce value size limits,
  key-name rules, and require secret values to be stored **encrypted at rest** on the
  device (mirroring GCDR's `secretEnvelope` treatment of `agent_secret`).
- `GET /state` must **not** echo `CENTRAL_API_KEY` plaintext — report presence/status
  only.
- Persist the fetched `CENTRAL_INITIAL_API_KEY` and the provisioned `CENTRAL_API_KEY`
  in the local `environment` (the latter encrypted).

## Contract (HTTP) — GCDR only

### `GET /api/v1/public/central/initial-key`
Headers: `X-Central-Pre-Key`, `uuid`. → `200 { apiKey, scopes, customerId, cached }`
(wrapped in GCDR's standard `{ success, data, meta }` envelope, like every
other endpoint — `data` is the object above)
· `401` generic · `409` already provisioned (reset required — v5: decided over
v4's undecided `409/423`) · `429` rate-limited.

### `POST /api/v1/customers/:myioId/api-keys` (existing, operator-gated)
Used by pre-setup to mint the full `CENTRAL_API_KEY`; GCDR binds it to the central
and flips `provisioningState`.

### `POST /api/v1/centrals/:id/reset-provisioning` (v5, new — DEC-9)
Operator-gated (JWT). Revokes both per-central keys and reopens the bootstrap
window. See DEC-9.

> `GET /state` and `POST /provision` are **central-hosted** and specified by the
> central firmware team, not here. So is **clear-data** (v5: moved out of GCDR
> scope, see DEC-1 correction) — GCDR exposes no clear-data endpoint.

## Security considerations

- **Ladder = least privilege per rung** + **bounded bootstrap window** (DEC-4/6):
  a leaked PRE key + known `uuid` yields the INITIAL key only while the central is
  still awaiting provisioning; once a full key is bound, the window is reset-gated.
- **Residual (pre-claim):** an attacker who bootstraps a `uuid` before the real
  central would learn that central's INITIAL key — but it only authenticates the
  **central's own** local `/provision` (network access to the Orange Pi required),
  and the window closes on full-key bind. Optional hardening: a manufacturing/import
  claim secret as an extra bootstrap factor.
- **Split credentials** (DEC-6) keep the INITIAL rung from minting full keys.
- **Recoverable GCDR storage** (DEC-3) is encrypted (0036); **device-side** at-rest
  encryption of `CENTRAL_API_KEY` is the central's responsibility.
- **Rate limiting** (DEC-5) multi-dimensional, audited without plaintext.
- **Transport:** TLS mandatory on all hops; mTLS is an open question.

## Responsibility matrix

| # | Item | GCDR Backend | GCDR Frontend | Pre-setup tool | Central firmware (Orange Pi) |
|---|---|---|---|---|---|
| 1 | 5 new scopes (catalog + Zod) | **Owns** | API-key UI (RFC-0048) | — | enforces `central-state`/`central-environment`/`central-data` |
| 2 | `centralPreKeyAuth` + bootstrap + lifecycle | **Owns** | — | — | ships pre-key, calls it |
| 3 | INITIAL TOFU mint/cache/reveal + binding | **Owns** | — | — | stores + validates it locally |
| 4 | Mint `CENTRAL_API_KEY` (operator-gated) + bind | reuses create-api-key | operator UI | **drives it (operator token)** | — |
| 5 | `GET /state` + `POST /provision` + clear-data *(v5: moved here)* (+ allowlist, at-rest encryption, redaction) | — | — | calls `/provision` | **Owns (device-local)** |
| 6 | Downstream ops (devices/sync) gated by full scopes | **Owns** | — | — | consumes via `CENTRAL_API_KEY` |
| 7 | *(v5, new)* `POST /centrals/:id/reset-provisioning` (DEC-9) | **Owns** | — | operator drives it | — |

## Suggested acceptance criteria

- Bootstrap returns a key only while `awaiting_provisioning`; after a full key is
  bound, `/initial-key` is reset-gated (`409`).
- Minting `CENTRAL_API_KEY` binds it to the central and flips `provisioningState`.
- The INITIAL key **cannot** call the operator create-api-key endpoint.
- No schema migration is introduced (state is jsonb in `centrals.config`).
- Rate-limit + audit behave per DEC-5 (no plaintext in logs).
- *(v5)* `POST /centrals/:id/reset-provisioning` revokes both per-central keys
  and flips `provisioningState` back to `awaiting_provisioning`, reopening
  `/initial-key`.
- *(v5)* GCDR exposes no clear-data endpoint — `central-data:write` is issued
  as a grant only, enforced by the central.
- *(v5)* `sync-events`/`disable`/`reset` accept `central-sync:write` in
  addition to `customers:write`; every other route under
  `/customers/:id/integrations` (notably `PUT centrals/items`) still requires
  `customers:write` only.

## Drawbacks

- Three keys + a lifecycle state to reason about.
- A public secret-returning bootstrap endpoint (mitigated above).
- Provisioning correctness partly depends on the **central** implementing `/provision`
  safely (allowlist, encryption) — a contract, not code GCDR owns.

## Rationale and alternatives

- **Two-key model (v1).** No separation between provisioning and full power. Rejected.
- **GCDR-hosted `/state` + `/provision`.** Considered (v3); dropped because the
  `environment` table is device-local — hosting them in GCDR would duplicate state
  and add a migration for no benefit.
- **Reuse `central-agent/enroll`.** Stronger per-device but needs an operator token
  per central. Preferred where feasible.
- **mTLS device certs.** Best-in-class; larger PKI/firmware lift; later hardening RFC.

## Unresolved questions

- Pre-key rotation window mechanics (old+new simultaneously).
- Should bootstrap require an extra manufacturing/import claim secret?
- Should minted keys carry an expiry, or stay revocation-only?
- Should GCDR bind the **full** key on its operational endpoints (per-central) too,
  or is customer-scoping enough there?

## Future possibilities

- Migrate toward per-device enroll tokens / mTLS, demoting the shared pre-key.
- Scheduled auto-rotation of `CENTRAL_API_KEY` via re-provision (central + GCDR).
