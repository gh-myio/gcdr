# RFC-0059 — Auth0 Identity Platform & GCDR Grant Service

- **Feature Name:** `auth0_identity_platform`
- **Start Date:** 2026-08-19
- **RFC PR:** _(this PR)_
- **Tracking Issue:** _TBD_
- **Status:** Draft
- **Authors:** GCDR Core Team
- **Domain:** Authentication / Identity / Authorization / Centrals
- **Extends:** [RFC-0002 — GCDR Authorization Model](./RFC-0002-GCDR-Authorization-Model.md)
- **Supersedes (in part):** RFC-0003 (JWT Multiple Audience) — the HS256 shared-secret
  path for human users is replaced by RS256 against Auth0.
- **Related:** RFC-0011 (User Registration & Approval), RFC-0009 (Audit Logs),
  RFC-0056 (Central API Key Bootstrap), RFC-0025 (Notification Contacts).
- **Based on:** the MYIO platform RFC `features/05-auth0-identity-platform-rfc.md`
  (monorepo + centrals + GCDR). This RFC is the **GCDR slice** of that design.

---

## Summary

Make **GCDR the single authoritative directory of users** for the MYIO ecosystem,
adopt **Auth0 as the credential and authentication layer** in front of it, and add
a **Grant Service** in GCDR that exchanges an Auth0 access token for a short-lived,
ES256-signed **central grant** that a CM4 central verifies offline with a public
key alone. The split is strict: **GCDR owns _who exists, in which tenant, with
which roles over which centrals_; Auth0 owns only _the secret that proves you are
that person_; the central verifies a narrow, expiring, per-device authorization
without contacting either.** This retires GCDR's home-grown password/MFA/refresh
code — including an **unsalted SHA-256 password hash currently in production** —
and converges the ecosystem's parallel user stores into GCDR.

## Motivation

GCDR already declares itself the single global source of truth for master data and
already models `customers`, `roles`, `policies`, RBAC assignments, `centrals` and
audit logs (RFC-0002, RFC-0009). It is the correct home for **user identity**. Its
current authentication code, however, carries defects that are deployed today —
these are the motivation, not hypotheticals:

- **M1 — GCDR stores passwords as unsalted SHA-256** (`src/services/AuthService.ts`
  `hashPassword`): no salt, single round, non-constant-time compare. For any
  realistic password `security.passwordHash` is **plaintext-equivalent**. This is
  the single most severe finding and it drives the schedule.
- **M2 — GCDR's MFA does not interoperate with authenticator apps.** The hand-rolled
  TOTP uses a 4-byte counter (RFC 6238 requires 8-byte big-endian) and reads the
  secret as hex where apps provision base32. Google Authenticator / 1Password codes
  never validate — MFA is effectively unavailable.
- **M3 — refresh tokens live in process memory** (a `Map`). Every deploy invalidates
  all sessions, and it cannot work across replicas — a latent bug the moment GCDR
  scales horizontally.

Two more platform defects (documented in the source RFC) are addressed by the
central-grant design even though they live outside GCDR's code:

- **M4 — monorepo user tokens never expire** (no `exp`).
- **M5 — the central's verification key _is_ its signing key** — a stolen central
  can mint admin tokens for itself forever.

M1, M2 and M3 are **deleted, not patched**: the code that contains them is removed.

### Why an IdP alone is not enough

The CM4 central is designed to run fully hands-off **while offline** (self-provisions
its DB, pairs and polls products with no cloud contact). An Auth0 access token lives
for minutes-to-hours; a site can be dark for weeks. **Offline authorization must be
designed, not inherited** — which is exactly why M5 exists (a shared secret filled
the gap). The Grant Service is GCDR's answer.

## Guide-level explanation

Three planes; keeping them apart is the discipline that makes the design work.

```
PLANE 1 — AUTHENTICATION (is this really them?)              Auth0, cloud-only
  Mobile/Web ── PKCE ─► myio.auth0.com ─► access_token (RS256, ~15m)
  Services   ── client_credentials ─►
  Auth0 stores ONLY: credential, MFA enrolment, login events.
                                   │  access_token (sub = auth0|<gcdr uuid>)
                                   ▼
PLANE 2 — IDENTITY + AUTHORIZATION (who are they, what may they do?)   GCDR
  users · tenants · customers · roles · policies · centrals · audit
  THE SOURCE OF USERS. Provisions into Auth0; never the reverse.
  Grant Service: POST /v1/grants → ES256 central grant, signed by KMS.
                                   │  central grant
                                   ▼
PLANE 3 — OFFLINE VERIFICATION                                    CM4 Central
  erlradio verifies with a PINNED PUBLIC KEY in /data. No network.
  Holds no secret. Cannot mint a token even if fully compromised.
```

**GCDR is Plane 2.** The user record is created in GCDR and only in GCDR; GCDR then
provisions a matching credential in Auth0 via the Management API. Ownership admits
no exceptions:

| Fact | Owner |
|---|---|
| User exists, `id`, `tenantId`, `customerId`, `type`, `status` | **GCDR** |
| Roles, policies, per-central permissions | **GCDR** (RFC-0002) |
| Profile, preferences, contacts, `externalLinks` (personal data) | **GCDR** |
| Password / passkey / MFA enrolment | **Auth0** |
| Login history, breached-password / anomaly detection | **Auth0** |

**Nothing is dual-written.** A user is disabled by setting `status` in GCDR, which
propagates to Auth0. No Auth0 change ever flows back and becomes truth.

### The central grant

A small JWT, **signed by GCDR** (not Auth0), scoped to exactly one central,
verifiable with public-key crypto alone:

```json
{
  "iss": "https://gcdr.myio.com.br",
  "sub": "9f3c1e5a-...",            // GCDR user id
  "tid": "b21f...",                 // GCDR tenant id
  "aud": "central:2b7d4f10-...",    // exactly one central
  "scope": "device:read device:write config:write",
  "jti": "01J9X8...", "iat": 1785312000, "exp": 1785312900, "ver": 1
}
```
Header: `{"alg":"ES256","kid":"myio-grant-2026-08","typ":"JWT"}`.

- **`aud` names one central** — a grant lifted from one device is worthless against
  another.
- **The device holds only a public key** — a fully imaged central yields no forging
  ability (closes M5).
- **Lifetime is MYIO policy** — minutes online, deliberately longer for offline work.

### The rule developers must remember

**An Auth0 token is never accepted by a central, and a central grant is never
accepted by an API.** The Grant Service is the only component that touches both, and
the only place authorization policy lives.

### What existing GCDR code must unlearn

`AuthService.login`, `hashPassword`, `verifyPassword`, `verifyTOTP` and the in-memory
refresh map **cease to exist**. No MYIO code verifies a password again. Authorization
logic converges on GCDR's existing `AuthorizationService`, which already has a model
and a test suite.

## Reference-level explanation (GCDR scope)

### 1. Multi-tenancy: the hard constraint

GCDR keys users on `uniqueIndex('users_tenant_email_unique').on(tenantId, email)`
(`schema.ts`) — the same email may legitimately exist in two tenants. **Auth0
requires email unique within a Database Connection.** A real collision to settle
first:

- **(a) One Auth0 Connection per tenant** — preserves GCDR semantics exactly; users
  indicate their tenant before login; Auth0 Organizations become mandatory. Heavier.
- **(b) One connection, email globally unique** — one person, one account; tenant
  chosen after auth. Simpler UX; needs a uniqueness migration.

**Recommendation: (b)**, gated on a **Phase 0 audit of `(tenantId, email)`
collisions**. If legitimate collisions exist, fall back to (a). This is the first
Unresolved Question and it blocks the tenant Terraform. The `tid` claim is injected
by an Auth0 Action from `app_metadata`, but remains authoritative **only in GCDR**.

### 2. Credential migration: forced reset, not hash import

Auth0 bulk import accepts `custom_password_hash` with `algorithm: "sha256"`, so
importing GCDR's hashes is technically possible. **This RFC rejects it.** Unsalted
SHA-256 is plaintext-equivalent (M1); importing it carries a known-broken credential
forward. The migration is:

1. Import **identity only** into Auth0 — `user_id` (= GCDR `users.id`), `email`,
   `email_verified`, `name`. **No hash.**
2. Every user receives an Auth0 password-reset invitation at cutover.
3. GCDR `security.passwordHash` is **dropped**, not archived.

Setting `user_id` to the GCDR id makes the Auth0 `sub` claim `auth0|<gcdr-uuid>`; the
Grant Service strips the prefix to recover the GCDR id, with
`app_metadata.gcdr_user_id` as a cross-check — **no identity-mapping table.**
**CPF and profile data stay in GCDR;** Auth0 receives only the minimum authentication
requires (narrows the LGPD question).

### 3. Provisioning: GCDR → Auth0, one direction

A new `Auth0ProvisioningService` alongside `UserService` and `RegistrationService`
(RFC-0011):

| GCDR event | Auth0 Management API |
|---|---|
| User created / registration approved | `POST /api/v2/users` + password-reset ticket |
| `status → SUSPENDED/INACTIVE` | `PATCH /users/:id { blocked: true }` |
| `status → ACTIVE` | `PATCH { blocked: false }` |
| Email changed | `PATCH` email, `email_verified: false` |
| User deleted | `DELETE /users/:id` |

Calls are **enqueued and retried, idempotent on the GCDR user id** (the Management
API is rate-limited; provisioning must not fail a registration). A nightly
reconciliation job reports drift; **drift is always resolved in GCDR's favour.**
**Roles are NOT provisioned to Auth0** — Auth0 RBAC stays unused; GCDR
`roles`/`policies` remain the only authorization model (RFC-0002).

### 4. Token validation in GCDR

`src/middleware` replaces HS256 verification with **RS256 against Auth0's JWKS**,
cached (~12 h TTL), refreshed on unknown `kid` under a rate limit. Per request GCDR
resolves the user from `sub` and loads roles via `AuthorizationService` — the same
call login makes today, so authorization behaviour is unchanged.

The existing **Partner API Key** (`gcdr_pk_…`) and **Customer API Key** (`gcdr_cust_…`)
mechanisms are **out of scope and retained** — already scoped, already auditable,
and Node-RED bundles depend on them.

### 5. The Grant Service

New module in GCDR (correct home — it already owns `centrals`,
`CentralEnrollmentService`, the RFC-0056 bootstrap ladder):

```
POST /v1/grants
Authorization: Bearer <auth0 access token>
{ "central_uuid": "…", "scopes": ["device:read","device:write"],
  "offline": false, "justification": null }
```

1. Verify the Auth0 token (JWKS signature, `iss`, `aud`, `exp`).
2. Resolve the GCDR user from `sub`; confirm `status = ACTIVE`.
3. Ask `AuthorizationService` whether this subject may act on this central **in this
   tenant** — deny by default; reject cross-tenant before any policy evaluation.
4. **Intersect** requested scopes with granted scopes — never widen.
5. If `offline`, require the `offline_field` scope + justification, and cap `exp`.
6. Sign with the active **KMS** key (`ECC_NIST_P256`, `ECDSA_SHA_256`) —
   non-exportable, never in application memory.
7. Write `jti`, subject, central, scopes, expiry, justification to the RFC-0009 audit.

| Grant type | Max TTL | Required scope | Audit |
|---|---|---|---|
| Online (default) | 15 min | — | Standard |
| Offline, routine | 7 days | `offline_field` | Justification required |
| Offline, extended | 30 days | `offline_field` + `central:admin` | Justification + 2nd approver |

**30 days is a hard ceiling.** Longer is a field-ops problem; break-glass is the
answer, not a longer grant.

### 6. Out of GCDR's hands (delivered by the platform RFC)

- **Central verification** (`hubot_auth.erl` → ES256 with pinned `/data/grant-keys.json`),
  clock-skew handling (CM4 has no RTC), and **break-glass** (physical-button
  challenge/response). GCDR only signs; the central verifies.
- **Key rotation** (additive key set, ≥90-day publish-before-sign overlap, gated on
  100 % fleet acknowledgement). GCDR publishes new `kid`s; ops gates rotation.
- **Central-to-cloud mTLS** (dropping `Central.privKey`) — separate spec; must land
  together with this RFC's grant work.

### 7. Migration (GCDR-affecting phases)

| Phase | GCDR work |
|---|---|
| **0 — Prep** | Audit `(tenantId, email)` collisions (§1); provision KMS grant key; Terraform Auth0 tenants |
| **1 — Grant Service, dark** | Ship the Grant Service behind a flag; integration tests only |
| **3 — Consolidate users** | Migrate monorepo `Users` into GCDR; GCDR becomes the only user directory |
| **4 — Auth0 cutover** | Identity-only import; password reset for all; RS256 middleware; `/auth/login → 410 Gone`; **delete `hashPassword`/`verifyPassword`/`verifyTOTP`/refresh map → M1/M2/M3 close** |
| **6 — Removal** | Drop `security.passwordHash`, `JWT_SECRET`; remove dead auth deps |

(Phases 2 and 5 — central dual-acceptance burndown and service `client_credentials`
— are platform/central work; see the source RFC.)

## Drawbacks

- **Every user must reset their password** — the visible cost of fixing M1; a support
  and trust moment needing a clear, honest message.
- **Cost scales with MAU + M2M tokens** — model before signing.
- **Vendor lock-in on credentials** — Auth0 does not export hashes; the Grant Service
  confines the blast radius (device code never learns Auth0 exists), but the
  human-facing side is committed.
- **LGPD / residency** — Auth0 has no Brazilian region; email + name of Brazilian
  subjects are processed abroad. Excluding CPF/profile narrows but does not remove
  the international-transfer question — legal sign-off before Phase 4.
- **Auth0 outages block new logins** (existing grants keep working — the design's
  virtue). A new hot-path service (the Grant Service) must be as available as GCDR.
- **Genuinely more machinery** — two token types, a fleet key set, gated rotation,
  break-glass. Implemented halfway, worse than what it replaces.

## Rationale and alternatives

Separate questions with different answers: *is this really them* is commodity (buy
it); *who are they / what may they do* is master data GCDR already models (keep it);
*may they operate this device offline* is MYIO-specific (build it). The design fails
safe: a compromised central yields public keys; a stolen grant is one-device and
expires; a stolen Auth0 token cannot reach a device at all.

- **A — Auth0 tokens verified directly on the central.** Rejected: Auth0 lifetimes
  are hours (U1 needs weeks); Auth0 rotates keys on a schedule MYIO does not control
  → an offline central bricks fleet-wide on a third party's maintenance; no
  per-central audience.
- **B — Auth0 Custom DB Connection over GCDR.** Rejected on M1: preserves the broken
  hash, keeps password verification in MYIO code, exposes Postgres to Auth0 or puts a
  sandbox on every login.
- **C — Fix GCDR auth in place** (Argon2id + `otplib` + Redis refresh). The strongest
  alternative — cheapest, no residency/lock-in — rejected on the explicit direction
  to adopt Auth0. **Crucially, the Grant Service, offline grant format, rotation and
  break-glass are identical under C;** only the token feeding step 1 of §5 differs.
  That keeps the decision reversible.

**Doing nothing** leaves unsalted SHA-256 passwords, non-expiring tokens and a
signing key on every device in production. **M1 alone justifies acting this quarter**
regardless of which alternative wins.

## Prior art

Short-lived certificates for infra access (Netflix BLESS, HashiCorp Vault SSH CA,
Teleport) — a durable credential proves identity, a short-lived artifact authorizes
one target, with lifetime matched to the disconnection profile. Kubernetes bound
service-account tokens (KEP-1205) — audience-bound, short-lived, migrated via a long
dual-acceptance window on a legacy-use metric. SCIM directory-of-record — one-way
provisioning, drift resolved in the master's favour. Apple/Google digital car keys —
offline authorization against a device holding only public material, with a
physical-presence fallback. OAuth 2.0 Device Grant (RFC 8628) for the field CLI.
RFC 8693 Token Exchange — the Grant Service is a token exchange in all but name. The
cautionary cases: Mirai (M5 — a device secret that also authorizes access to it) and
the 2012 LinkedIn breach (M1 — unsalted single-round hashes).

## Unresolved questions

**Before acceptance:**
- **Tenancy model (§1):** audit `(tenantId, email)` collisions → one global-unique
  connection vs. one connection per tenant. Blocks the Terraform.
- **M1 disclosure obligations:** unsalted SHA-256 with unknown exposure may trigger
  LGPD notification — legal, not engineering, and independent of this RFC.
- **Auth0 region** + sign-off on international transfer of email/name.
- **Pricing** vs. a 3-year MAU/M2M projection (if untenable, Alternative C returns).
- **Does the 30-day offline ceiling match reality?** Field ops must confirm from the
  actual site-disconnection distribution.
- **Break-glass custody** — who holds the KMS key; on-call rotation.

**During implementation:**
- Revocation-list transport and size bounds (fleet-wide `jti` deny-list).
- Whether Partner/Customer API Keys eventually fold into Auth0 M2M.
- Whether the Grant Service ships inside GCDR or as a separate deployable.

**Out of scope:** central-to-cloud mTLS; KMS secrets management; the RFC-0032
QR-Checker field PIN (`woFieldPinHash`, bcrypt + HMAC — correctly implemented, **not
touched here**).

## Future possibilities

- **MFA that works + passkeys** — configuration once Auth0 is authoritative, closing
  M2 properly.
- **Enterprise SSO** — Auth0 Enterprise Connections (SAML/OIDC) per customer.
- **Fine-grained authorization** — if `roles`/`policies` grow hierarchical, OpenFGA
  models it; the Grant Service is the only consumer that changes.
- **Grants for machines** — the grant format is subject-agnostic; scheduled routines
  and exporter pulls can hold machine grants, retiring the last M2M shared secrets and
  possibly subsuming Customer API Keys.
- **Delegated, time-boxed customer access** — "let this installer into my central for
  4 hours" is a short-`exp`, narrow-scope grant issued by the customer; only the
  issuing UI is missing.
- **Offline audit reconciliation** — centrals accumulate an authenticated action log
  offline and upload on reconnect (pairs with RFC-0009).
