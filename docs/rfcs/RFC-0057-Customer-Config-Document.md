# RFC-0057: Customer Config Document & TB→GCDR Migration

- Feature Name: `customer_config_document`
- Start Date: 2026-08-10
- RFC PR: (leave this empty)
- Tracking Issue: (leave this empty)
- Status: **Draft v3 — feedback-v1 folded in (P0s resolved). For review, future implementation.**
- Related package: `packages/backend` (GCDR)
- Primary files (new/changed): `src/domain/entities/Customer.ts` (extend `CustomerConfig`), `src/dto/request/CustomerConfigDTO.ts` (new — read/write/patch schemas), `src/services/CustomerConfigService.ts` (new — normalize/defaults/mask), `src/controllers/customer-config.controller.ts` (new), `src/controllers/customers.controller.ts` (`?include=config`), `src/app.ts`, `src/shared/utils/secretEnvelope.ts` (reuse), OpenAPI spec
- **No schema migration** — config lives in `customers.config` jsonb (DEC-6). *(A data backfill from TB is separate — DEC-14.)*
- Builds on: `customers` table (`settings`, `theme`, `config`, `metadata` jsonb), `secretEnvelope` (secrets at rest, RFC-0056), hybrid auth, audit logs (RFC-0009)
- Client consumer: **`myio-js-library` RFC-0229** (Shopping dashboard). `featureButtons` uses the **same 2×3 checkbox matrix** as RFC-0229 §1.

> **Changelog v3 (feedback-v1):** single canonical `featureButtons` default (P0.1);
> secrets removed from the general write path + dedicated audited reveal (P0.2/P0.3);
> full authorization matrix (P0.4); per-method write-semantics table (P1.1); three
> separate DTOs (P1.2); backfill ops plan (P1.3); `CUSTOMER_CONFIG_UPDATED` audit
> (P1.4); inline config made opt-in without clobbering the existing raw `config`
> field (P1.5); size/temperature/unknown-key validation (P2.1–2.3); MVP split (P2.5);
> explicit acceptance criteria.

---

## Summary

Give each customer a **single, governed configuration document** in GCDR, exposed by
a consolidated endpoint, and **migrate the customer config that today lives in
ThingsBoard SERVER_SCOPE attributes** into it. Two coupled deliverables:

1. **Consolidated customer-config API** — `GET/PUT/PATCH/DELETE /customers/:id/config`,
   plus opt-in inline exposure on the customer resource.
2. **Granular demand / instant-telemetry buttons** — a per-customer **2×3 checkbox
   matrix** (2 features × 3 groups), each toggle independent. Its canonical default
   (used everywhere in this RFC) is:

   ```
   Pico de Demanda:          [x] Entrada   [x] Área Comum   [ ] Lojas
   Telemetrias Instantâneas: [x] Entrada   [x] Área Comum   [ ] Lojas
   ```

   Any combination is valid — including **none** (all off) and **all**. Matches
   **RFC-0229 §1**.

## Motivation

- **Customer config is fragmented** across four GCDR jsonb columns + TB SERVER_SCOPE
  (two mismatched schemas — RFC-0229). No single "give me this customer's setup" call.
- **TB attributes are hard to govern** — no versioning/audit, browser-readable.
- **The demand flag is too coarse** — the customer-wide `canShowDemandButtons` gates
  both buttons for everyone; operators need per-group, per-button control.

### Non-goals

- Client-side widget/modal/theme work (RFC-0229).
- Moving the **bootstrap** attrs out of TB (`gcdrCustomerId/TenantId/ApiKey/SyncedAt`).
- Absorbing goals/tariffs/channels/rules resources — they stay their own APIs.

## Guide-level explanation

### The consolidated config document (read model)

`GET /api/v1/customers/:id/config` returns one normalized document (defaults filled,
secrets masked). The **canonical default** shape:

```jsonc
{
  "version": 1,
  "featureButtons": {
    "demandPeak":       { "entrada": true, "areacomum": true, "lojas": false },
    "instantTelemetry": { "entrada": true, "areacomum": true, "lojas": false }
  },
  "alarms":      { "notificationsEnabled": true, "showOffline": false, "showInternalSupport": false },
  "tickets":     { "enabled": false, "onlyToMyio": true },
  "temperature": { "min": 18, "max": 27, "clampMin": 15, "clampMax": 40 },
  "display":     { "measurementDisplaySettings": null, "mapInstantaneousPower": null },
  "defaultDashboard": { "id": null, "cfg": null },
  "classificationProfile": null,       // RFC-0207 shape
  "locale":      { "timezone": "America/Sao_Paulo", "locale": "pt-BR", "currency": "BRL" },
  "theme":       { "primaryColor": "…", "secondaryColor": "…" },
  "ingestion":   { "clientId": "…", "clientSecret": "***" },   // secret — masked, read-only here
  "security":    { "masterAdminPassword": "***" },              // secret — masked, read-only here
  "metadata":    { "inaugurationDate": null, "obs": "" }
}
```

`locale` mirrors `customers.settings`; `theme` mirrors `customers.theme`. Everything
new lands in `customers.config` (DEC-6). **Secrets are masked and are NOT writable via
this document** — see DEC-7.

### Writing config

- `PATCH /customers/:id/config` — deep-merge (preferred).
- `PUT /customers/:id/config` — full replace of the writable sections.
- `DELETE /customers/:id/config` — reset to defaults.
- **Clear a feature to none:** set its three groups to `false`.
- **Secrets** are written only via the dedicated `PUT /customers/:id/config/secrets`
  (DEC-7) — never through PUT/PATCH `/config`.

Exact per-field behavior is in DEC-9.

## Reference-level explanation

### DEC-1 — Inventory of *current* GCDR customer config

| Column | Shape today | Disposition |
|---|---|---|
| `settings` | `{ timezone, locale, currency, inheritFromParent }` | surfaced as `config.locale` (kept in `settings`) |
| `theme` | `{ primaryColor, secondaryColor, logoUrl?, faviconUrl? }` | surfaced as `config.theme` (kept in `theme`) |
| `config` | `{ bundle?: { checkVersion? } }` | **extended** with new sections; `bundle` untouched |
| `metadata` | free-form `Record<string,unknown>` | holds orphans (`inaugurationDate`, `obs`) |

### DEC-2 — Inventory of *TB SERVER_SCOPE* attributes to migrate

From RFC-0229 §3.1. **GCDR** = into this document · **TB-BOOT** = stays in TB · **DROP** = legacy.

| TB attribute | → GCDR config path | Disposition |
|---|---|---|
| `alarmNotificationsEnabled` / `showOfflineAlarms` | `alarms.notificationsEnabled` / `.showOffline` | GCDR |
| `isInternalSupportRule` (customer attr) | `alarms.showInternalSupport` | GCDR — **renamed** to avoid colliding with the rule-level `rules.is_internal_support_rule` flag; this is a per-customer display toggle for alarms produced by internal-support rules |
| `canShowDemandButtons` | `featureButtons.*` (mapped, DEC-3) | GCDR (replaced) |
| `tickets_enabled` / `tickets_only_to_myio` | `tickets.enabled` / `.onlyToMyio` | GCDR |
| `minTemperature`/`maxTemperature`/`temperatureClampMin`/`…Max` | `temperature.*` | GCDR |
| `measurementDisplaySettings` / `mapInstantaneousPower` | `display.*` | GCDR |
| `customerDefaultDashboard` | `defaultDashboard.{id,cfg}` | GCDR |
| `deviceClassificationProfile` | `classificationProfile` | GCDR (RFC-0207) |
| `client_id` / `client_secret` 🔒 | `ingestion.clientId` / `.clientSecret` | GCDR (secret) |
| `master_admin_password` 🔒 | `security.masterAdminPassword` | GCDR (secret) |
| `inauguration_date` / `obs` | `metadata.*` | GCDR (metadata) |
| `gcdrCustomerId`/`gcdrTenantId`/`gcdrApiKey` 🔒/`gcdrSyncedAt` | — | **TB-BOOT** |
| `qt*` | — | **DROP** |

### DEC-3 — `featureButtons`: 2×3 checkbox matrix, single canonical default

```ts
type FeatureGroup = 'entrada' | 'areacomum' | 'lojas';
type FeatureGroupFlags = Record<FeatureGroup, boolean>;   // three independent toggles
interface FeatureButtons { demandPeak: FeatureGroupFlags; instantTelemetry: FeatureGroupFlags; }
```

Six independent booleans; any combination valid. **Legacy `canShowDemandButtons`
backfill mapping (the single source of truth for defaults, RFC-0229 §1):**

| legacy value | `demandPeak` **and** `instantTelemetry` (both identical) |
|---|---|
| `true`  | `{ entrada:true,  areacomum:true,  lojas:false }` … no — see note | 

> **Canonical (P0.1):** the three cases are:
> - `true` → **all three `true`** for both features
> - `false` → **all three `false`** for both features
> - **unset** → **`{ entrada:true, areacomum:true, lojas:false }`** for both features
>
> The **unset** value is also the default returned by the read model (DEC-5) and used
> in every example in this RFC. It reproduces the current `deviceProfile !== '3F_MEDIDOR'`
> fallback (Entrada/Área Comum on, Lojas off). This matrix is repeated verbatim in the
> Guide example, DEC-5, and the acceptance criteria — no other default appears anywhere.

### DEC-4 — Writable config sections (non-secret)

`CustomerConfig` (extended). **Secrets (`ingestion.clientSecret`,
`security.masterAdminPassword`) are excluded from this write path** (DEC-7).

```ts
interface CustomerConfig {
  bundle?: CustomerBundleConfig;                 // existing, never touched by /config
  featureButtons?: FeatureButtons;               // DEC-3
  alarms?: { notificationsEnabled?: boolean; showOffline?: boolean; showInternalSupport?: boolean };
  tickets?: { enabled?: boolean; onlyToMyio?: boolean };
  temperature?: { min?: number; max?: number; clampMin?: number; clampMax?: number };
  display?: { measurementDisplaySettings?: unknown; mapInstantaneousPower?: unknown };
  defaultDashboard?: { id?: string | null; cfg?: unknown };
  classificationProfile?: unknown;               // RFC-0207
  ingestion?: { clientId?: string };             // clientSecret NOT here (secrets endpoint)
  // security.masterAdminPassword lives only behind the secrets endpoint
}
```

### DEC-5 — Defaults

Read model fills: `featureButtons` per DEC-3 **unset** row (`{entrada:true,
areacomum:true, lojas:false}` for both), `alarms={notificationsEnabled:true, showOffline:false, showInternalSupport:false}`, `tickets={false,true}`,
`temperature={18,27,15,40}`, `display/defaultDashboard/classificationProfile=null`,
secrets masked `"***"`. Consumers never see `undefined`.

### DEC-6 — Storage: `customers.config` jsonb (no schema migration)

New sections live in the existing nullable `customers.config` jsonb. `settings`/
`theme`/`metadata` unchanged, merged into the read model. `PATCH` deep-merges;
`PUT` replaces writable sections; `DELETE` resets. `bundle` is **always preserved**
(it is not customer-facing config; no write path touches it). Deep-merge for
`featureButtons` is **per group key**: `PATCH { featureButtons:{ demandPeak:{ lojas:true }}}`
flips only that toggle.

### DEC-7 — Secrets (P0.2 + P0.3, resolved)

Secrets are **out of the general config document write path** entirely:

- **Read:** always masked `"***"` in `GET /config` and inline. `"***"` never round-trips
  as a value — because writes here reject secret fields (below), the read-masked →
  write-back overwrite bug **cannot occur**.
- **Write:** only via `PUT /api/v1/customers/:id/config/secrets` with a body of real
  values. Rules: a string ⇒ new secret, encrypted at rest via `secretEnvelope`; `null`
  ⇒ clear; **`"***"` ⇒ rejected `400`** (never persisted). Stored as ciphertext.
- **Reveal:** `GET /api/v1/customers/:id/config/secrets` — **JWT only** (no API key),
  gated by a named scope **`customers:secrets:read`**, **mandatory audit** (actor,
  credential, customer, tenant, fields revealed, requestId, timestamp).
- PUT/PATCH `/config` **ignore/reject** any `ingestion.clientSecret` /
  `security.masterAdminPassword` in the body (`400`).

### DEC-8 — Endpoints & authorization matrix (P0.4, resolved)

| Method | Route | JWT | API key | Notes |
|---|---|---|---|---|
| `GET` | `/customers/:id/config` | reader role | `customers:read` | masked secrets |
| `PUT`/`PATCH`/`DELETE` | `/customers/:id/config` | operator role | `customers:write` | non-secret only |
| `GET` | `/customers/:id/config/secrets` | operator + `customers:secrets:read` | **denied** | audited reveal |
| `PUT` | `/customers/:id/config/secrets` | operator + `customers:secrets:read` | **denied** | audited write |
| `GET` | `/customers/:id?include=config` | same as customer read | `customers:read` | masked; opt-in (DEC-11) |

**Hierarchy (API key):** `SELF` → only its own customer; `SUBTREE` → customer +
descendants; `TENANT` → any customer in tenant. **Cross-tenant → `404`** (no oracle),
consistent with existing resources. Inline config (DEC-11) requires **exactly the same
authorization** as `GET /customers/:id/config`. Integration tests required for: JWT
without permission, API key `SELF`/`SUBTREE`/`TENANT`, and cross-tenant.

### DEC-9 — Write semantics per method (P1.1, resolved)

| Input | `PATCH` | `PUT` |
|---|---|---|
| section **omitted** | preserved | **reset to default** |
| scalar field `null` (governed section) | **not accepted → `400`** (MVP) | **not accepted → `400`** (MVP) |
| empty object `{}` | **no-op** (not a clear) | replaces that section with defaults |
| `featureButtons` partial | per-group merge (`{}` = no-op) | full replace (all 6 required) |
| secret field present | `400` (use secrets endpoint) | `400` |

- **`null` on a governed section is NOT accepted in the MVP** (P1.1, decided
  2026-08-10): the governed schemas (`alarms`, `tickets`, `temperature`,
  `ingestion.clientId`) use optional-not-nullable fields, so a `null` returns
  `400`. To clear a value, PATCH it to its default explicitly, or `DELETE` the
  document to reset every section. (Explicitly-nullable fields — `defaultDashboard.id`,
  the free `display.*` values, `classificationProfile` — still accept `null`.)
  A future revision may introduce `null`=clear-to-default if a consumer needs it.
- **Secrets** are the exception: on the dedicated `PUT /config/secrets`, `null`
  **clears** the secret (DEC-7) — that path is not a governed config section.
- **`metadata`** is writable via `/config` and persists to `customers.metadata`
  (not `customers.config.metadata`); provided keys are merged (a PUT does not wipe
  unrelated metadata keys).
- **`DELETE`** returns the **full updated read-model document** (consistent with the
  other writes), config reset to defaults; `settings`/`theme`/`bundle` **and the
  at-rest secrets** untouched.
- All writes emit the audit event (DEC-12), which carries a **redacted
  `before`/`after`** read-model snapshot (secrets always masked) plus `changedPaths`.

### DEC-10 — Three DTOs (P1.2, resolved)

- `CustomerConfigReadDTO` — normalized, **all** keys present, secrets masked (GET).
- `CustomerConfigDTO` — full writable document, **strict**, all governed fields
  required for `PUT` (`FeatureGroupFlags` = exactly the three keys).
- `CustomerConfigPatchDTO` — deep-partial; subset of features/groups allowed
  (`featureButtons.demandPeak.lojas` alone is valid).

Storage may hold partial objects; the read model normalizes on the way out.

### DEC-11 — Inline config on the customer resource (P1.5, resolved)

The existing raw `config` field on `GET /customers/:id` (today `{ bundle }`) is **left
unchanged** for back-compat. The consolidated read model is exposed **opt-in** via
`GET /customers/:id?include=config`, under a **new** field `configResolved` (masked
secrets). No default-response size increase; no breakage of consumers reading raw
`config`.

### DEC-12 — Audit (P1.4 / P2.4, resolved)

Every write emits **`CUSTOMER_CONFIG_UPDATED`** (RFC-0009 audit + publishable event):
`tenantId`, `customerId`, `version`, `method`, `changedPaths` (path-level),
`before`/`after` **redacted for secrets**, actor + credential, `requestId`. Secret
writes emit `CUSTOMER_CONFIG_SECRET_UPDATED` / `…_REVEALED` (values never logged).

### DEC-13 — Validation (P2.1–2.3, resolved)

- **Temperature invariants:** `min ≤ max`, `clampMin ≤ min`, `max ≤ clampMax`;
  bounded ranges; ≤ 1 decimal.
- **Unknown keys:** governed sections are **`strict`** (`400` on unknown key, with the
  error path); explicitly-free sections (`display.*`, `classificationProfile`,
  `defaultDashboard.cfg`, `metadata`) are **`passthrough`** but size-capped.
- **Size limits:** per free section (e.g. ≤ 16 KB) and a total document cap
  (e.g. ≤ 64 KB), enforced even where the inner schema is `z.unknown()`.

### DEC-14 — Backfill (data migration, P1.3, resolved)

This is a **data** migration (not schema). Plan:

- source: TB flat attrs **and** nested `integration_setup` (reconciled per RFC-0229 §3.3);
- **idempotent** per customer (safe to re-run);
- **dry-run with diff** before writing;
- per-customer migration log; explicit **cutover criteria**;
- client **dual-read flag** during rollout (RFC-0229 §3.4);
- **rollback** procedure (revert client to TB reads);
- **sampling verification** across customers with `canShowDemandButtons` true/false/unset
  (each must produce exactly the DEC-3 matrix).

### DEC-15 — MVP vs Phase 2 (P2.5, resolved)

- **MVP:** `featureButtons` + non-secret fields RFC-0229 consumes; `GET`/`PATCH /config`;
  idempotent backfill of the needed attrs; `?include=config`.
- **Phase 2:** `PUT`/`DELETE /config`, the secrets endpoints + reveal, low-use sections,
  full audit diff.

## Contract (HTTP)

- `GET /customers/:id/config` → `200` normalized doc (masked). `404` unknown/cross-tenant.
- `PATCH /customers/:id/config` — e.g. `{ "featureButtons": { "demandPeak": { "lojas": true } } }` → `200` updated doc. `400` unknown group/type or secret field present.
- `PUT /customers/:id/config` → `200` full doc (writable sections replaced). `400` as above.
- `DELETE /customers/:id/config` → `200` full doc reset to defaults.
- `GET|PUT /customers/:id/config/secrets` → JWT + `customers:secrets:read`, audited.

## Acceptance criteria

1. `GET /config` returns complete defaults, never `undefined`.
2. `PATCH featureButtons.demandPeak.lojas=true` preserves the other five toggles.
3. Unknown `featureButtons` group → `400` with the error path.
4. Read-masked → `PUT`/`PATCH /config` never changes a secret (secrets rejected there).
5. `"***"` is never persisted as a real secret.
6. `null` for a secret (via secrets endpoint) clears it, tested.
7. API key `SELF` cannot access another customer's config in the same tenant.
8. API key `SUBTREE` reaches a permitted descendant, denies outside the subtree.
9. Cross-tenant returns `404`.
10. `DELETE /config` preserves `settings`, `theme`, and `bundle`.
11. Backfill of `canShowDemandButtons` true/false/unset yields exactly the DEC-3 matrix.
12. OpenAPI documents `GET/PUT/PATCH/DELETE`, the three DTOs, the secrets endpoints, and masked-secret examples.

## Responsibility matrix

| # | Item | GCDR Backend | myio-js-library (RFC-0229) | ThingsBoard |
|---|---|---|---|---|
| 1 | Config document + CRUD endpoints | **Owns** | consumes | — |
| 2 | `featureButtons` 2×3 matrix | **Owns** | renders checkboxes, gates buttons | — |
| 3 | Secrets endpoints + at-rest + audit | **Owns** | — | — |
| 4 | Opt-in inline (`?include=config`) | **Owns** | consumes | — |
| 5 | Backfill (DEC-14) | **Owns** (or setup-flow) | dual-read fallback | source until cutover |
| 6 | Bootstrap creds | — | reads from TB | **retains** |

## Drawbacks

- **Production impact of the `canShowDemandButtons` change** — the backfill mapping
  must be exact; staged rollout + per-customer verification (highest risk).
- Secrets traverse GCDR (neutral vs TB, but a new access-control surface).
- Backfill reconciles two TB schemas (flat vs `integration_setup`).
- Extra startup round-trip (config GET) — needs client caching (RFC-0229).

## Rationale and alternatives

- **2×3 matrix** — minimum that expresses per-button, per-group visibility; matches
  RFC-0229. Single-select can't express "Entrada **and** Área Comum"; one flag is the
  status quo replaced.
- **Secrets out of the general write path** — eliminates the masked-write-back overwrite
  class of bug at the contract level, rather than relying on a sentinel convention.
- **`customers.config` jsonb** — migration-free, matches how config already lives.
- **Opt-in inline (`configResolved`)** — reduces round-trips without changing the
  default customer response or the meaning of the existing raw `config`.

## Unresolved questions

- `customerDefaultDashboard` is a TB dashboard id — confirm it belongs in GCDR.
- Backfill ownership & timing — GCDR job vs widget-driven lazy migration on first load?
- Is per-button × per-group the final granularity, or is per-device-profile ever needed?

## Future possibilities

- Schema-driven customer-config editor UI (replaces TB modals).
- Full config version history table (beyond the audit event).
- Generalize per-group/per-feature flags beyond the demand buttons.
- Retire TB SERVER_SCOPE once every consumer reads GCDR config.
