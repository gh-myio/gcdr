# RFC-0027 — Include Internal Support Rules in `/alarm-rules/bundle/simple`

| Field       | Value |
|-------------|-------|
| **Status**  | Proposed |
| **Author**  | Rodrigo Lago |
| **Created** | 2026-04-08 |
| **Module**  | Alarm Bundle / Rules Engine |

---

## Summary

Rules flagged as `isInternalSupportRule: true` must be included in the
`/alarm-rules/bundle/simple` response so the alarm orchestrator can
consume them and trigger notifications to internal support groups.

Currently they are silently excluded because the bundle filter blocks
**all** rules where `internalRule: true`, regardless of `isInternalSupportRule`.

---

## Background

Two boolean flags control rule visibility:

| Flag | Purpose |
|------|---------|
| `internalRule` | Excludes rule from customer-facing bundle. Consumed only by internal services. |
| `isInternalSupportRule` | Marks the rule as an internal support monitoring rule. Included by default; can be excluded via `includeInternalSupportRule=false`. |

The design intent was:

- `internalRule: true` → rule is not for end-customers, but the alarm orchestrator still needs it.
- `isInternalSupportRule: true` → subset of internal rules specifically for support monitoring; always included in the orchestrator bundle unless explicitly opted out.

---

## Problem

`AlarmBundleService.ts` line 200:

```typescript
// Current — blocks ALL internalRule=true, including support rules
let alarmRules = allRules.filter(r => isAlarmRule(r) && !r.internalRule);

// This condition is never reached for isInternalSupportRule rules:
if (!includeInternalSupportRule) {
  alarmRules = alarmRules.filter(r => !r.isInternalSupportRule);
}
```

Rules with `internalRule: true && isInternalSupportRule: true` are removed at the
first filter, so the `includeInternalSupportRule` opt-out never has a chance to run.

### Affected rules (Myio customer)

| ID | Name |
|----|------|
| `407b48fe` | Caixa d'Água — Sem Leitura 12h |
| `091563a1` | Dispositivos de Água — Sem Leitura 12h |
| `cc404f82` | Dispositivos de Energia — Sem Leitura 12h |
| `3f9d29a0` | Dispositivos de Temperatura — Sem Leitura 12h |

---

## Proposed Solution

Change the first filter to **allow through** any rule that is an internal support rule,
even when `internalRule: true`:

```typescript
// RFC-0027: isInternalSupportRule overrides the internalRule exclusion
let alarmRules = allRules.filter(r =>
  isAlarmRule(r) && (!r.internalRule || r.isInternalSupportRule)
);

// Opt-out still works: pass includeInternalSupportRule=false to exclude them
if (!includeInternalSupportRule) {
  alarmRules = alarmRules.filter(r => !r.isInternalSupportRule);
}
```

### Filter matrix after change

| `internalRule` | `isInternalSupportRule` | `includeInternalSupportRule` param | Included in bundle? |
|:-:|:-:|:-:|:-:|
| false | false | true *(default)* | ✅ |
| false | false | false | ✅ |
| true  | false | true | ❌ |
| true  | false | false | ❌ |
| true  | true  | true *(default)* | ✅ ← **fixed** |
| true  | true  | false | ❌ |

---

## Alarm Backend Endpoint Analysis

Full review of all endpoints used by the alarm backend and their behaviour
regarding `isInternalSupportRule` rules.

### Endpoint matrix

| Endpoint | Used for | isInternalSupportRule rules included? | Notes |
|----------|----------|:-------------------------------------:|-------|
| `GET /customers/:id/alarm-rules/bundle/to-verify-service` | Verify worker | ❌ **BLOCKED** | Goes through `AlarmBundleService` — same `!r.internalRule` bug. Handler also ignores `includeInternalSupportRule` query param. |
| `GET /customers/:id/alarm-rules/bundle/simple` | Rule name enrichment | ❌ **BLOCKED** | Same `AlarmBundleService` bug. Reads `includeInternalSupportRule` but never reaches that check. |
| `GET /customers/:id/rules?type=&internalRule=true` | Device offline rules | ✅ **OK** | Queries `RuleRepository` directly with `internalRule=true`. Returns all internal rules including support ones. |
| `GET /rules?page=&pageSize=` | Tenant rules | ✅ **OK** | No `internalRule` filter applied by default. All rules returned. |
| `GET /rules/:id` | Debug / decision engine | ✅ **OK** | Single rule fetch — no filter. |
| `GET /customers?page=&pageSize=` | List customers | ✅ **OK** | No rule filtering. |
| `GET /customers/:id/children` | Daily summary multi | ✅ **OK** | No rule filtering. |
| `GET /customers/:id/channels` | Dispatch enrichment | ✅ **OK** | No rule filtering. |
| `GET /groups/:id/dispatch` | Channel enrichment | ✅ **OK** | No rule filtering. |
| `GET /devices?centralId=&slaveId=` | Device lookup | ✅ **OK** | No rule filtering. |
| `GET /devices?centralId=&page=` | Verify worker devices | ✅ **OK** | No rule filtering. |
| `POST /templates/render` | Telegram dispatch | ✅ **OK** | No rule filtering. |
| `POST /rules/:id/trigger` | Verify worker trigger | ✅ **OK** | Triggers by ID directly. |

### Critical path — verify worker

The verify worker flow that needs these rules:

```
verify worker
  → GET /customers/:id/alarm-rules/bundle/to-verify-service
      → alarmBundleService.verifyBundle()
          → this.generateSimplifiedBundle()   ← BUG: !r.internalRule blocks here
          → ruleRepository.getByCustomerId()  ← returns all rules (notifications map)
```

Result: the rule is excluded from the bundle (not evaluated) but its notification
config is correctly mapped. The verify worker never sees the rule to trigger it.

### Secondary bug — `to-verify-service` ignores `includeInternalSupportRule` param

The `/bundle/simple` handler reads `includeInternalSupportRule` from the query string.
The `/bundle/to-verify-service` handler does **not**:

```typescript
// bundle/simple handler — reads the param ✓
const includeInternalSupportRule = req.query.includeInternalSupportRule !== 'false';

// bundle/to-verify-service handler — does NOT read it ✗
const { domain, deviceType, includeDisabled } = req.query;
// includeInternalSupportRule is never parsed or forwarded
```

`GenerateBundleParams` also lacks the field, so even after the service-level fix,
the opt-out would not be available on this endpoint without this secondary fix.

---

## Implementation

Three changes required. No schema changes. No migration needed.

### Fix 1 — `AlarmBundleService.ts` (primary bug)

```typescript
// Before (~line 200)
let alarmRules = allRules.filter(r => isAlarmRule(r) && !r.internalRule);

// After
let alarmRules = allRules.filter(r =>
  isAlarmRule(r) && (!r.internalRule || r.isInternalSupportRule)
);
```

### Fix 2 — `GenerateBundleParams` — add missing field

**File:** `src/domain/entities/AlarmBundle.ts`

```typescript
// Add to GenerateBundleParams
includeInternalSupportRule?: boolean; // default: true
```

### Fix 3 — `bundle/to-verify-service` handler — read the param

**File:** `src/controllers/rules.controller.ts`

```typescript
// Before
const { domain, deviceType, includeDisabled } = req.query;

// After
const { domain, deviceType, includeDisabled, includeInternalSupportRule } = req.query;

// Forward to verifyBundle:
const bundle = await alarmBundleService.verifyBundle({
  tenantId,
  customerId,
  centralId,
  domain: domain as string | undefined,
  deviceType: deviceType as string | undefined,
  includeDisabled: includeDisabled === 'true',
  includeInternalSupportRule: includeInternalSupportRule !== 'false', // default true
});
```

---

## Impact

- **Bundle size:** Adds the support rules to the orchestrator's bundle. For Myio, +4 rules.
- **Alarm orchestrator:** Will now receive and evaluate these rules. Notifications will be dispatched to the Grupo Interno MYIO Alarmes via Telegram on OPEN/CLOSE/ESCALATE.
- **Customer-facing clients (Node-RED):** No impact — they use `includeInternalSupportRule=false` or the default which can be opted out per caller.
- **No breaking change.**

---

## Rollback

Revert the one-line change in `AlarmBundleService.ts`. No data changes involved.
