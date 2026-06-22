# RFC-0014: Simulator UI/UX Overhaul — Scenario Builder & 2×3 Grid Layout

- **RFC**: 0014
- **Status**: Implemented
- **Created**: 2026-02-05
- **Implemented**: 2026-02-05
- **Depends on**: RFC-0010 (Premium Alarm Simulator — Implemented MVP)
- **Author**: GCDR Team

---

## Summary

Replace the current freeform simulator cockpit with a structured **2×3 grid layout** and a
**full-screen Scenario Builder wizard**. The wizard enforces a step-by-step configuration flow
(Centrals → Devices → Rules → Control → Review) before any simulation can start. The grid
blocks map 1-to-1 to the alarm lifecycle stages, making the simulator self-explanatory for
developers, QA, and demo operators.

---

## Motivation

The existing admin cockpit (`/admin/simulator`) is a single-page HTML with a flat form for
session creation. It provides no guided flow, no visual lifecycle, and no concept of a
reusable "scenario." Users must manually compose JSON-like device configs, which is error-prone
and hard to explain during demos.

Key problems:
1. **No guided workflow** — users must understand the full config schema upfront.
2. **No scenario reuse** — each session starts from scratch.
3. **Flat layout** — all information competes for attention; no visual lifecycle.
4. **No validation feedback** — invalid configs only fail at the API level.
5. **No clear state machine** — the UI does not reflect `Not Configured → Ready → Running → Stopped`.

This RFC addresses all five by introducing a wizard-driven scenario builder and a lifecycle-aware
grid layout.

---

## Guide-level Explanation

### The 2×3 Grid

After this RFC, the simulator page at `/admin/simulator` renders a fixed grid:

```
┌─────────────────────┬─────────────────────┬─────────────────────┐
│  Block 1            │  Block 2            │  Block 3            │
│  Scenario Overview  │  Bundle Status      │  Device Scanner     │
│  & Control Center   │  & Rules Catalog    │  & Telemetry Feed   │
├─────────────────────┼─────────────────────┼─────────────────────┤
│  Block 4            │  Block 5            │  Block 6            │
│  Rule Evaluator     │  Alarm Candidates   │  Session Metrics    │
│  Live Results       │  Queue & History    │  & Quotas           │
└─────────────────────┴─────────────────────┴─────────────────────┘
```

Each block maps to an alarm lifecycle stage and updates in real-time via SSE.

### The Scenario Builder

Clicking **"Configure Simulator"** in Block 1 opens a **full-screen modal wizard** with 5 steps:

| Step | Title              | Purpose                                           |
|------|--------------------|---------------------------------------------------|
| 1    | Centrals           | Select which centrals participate in the scenario  |
| 2    | Devices            | Pick devices per central, see channels/type        |
| 3    | Rules              | Choose alarm rules to evaluate (filtered by scope) |
| 4    | Simulation Control | Set intervals, scan frequency, session duration    |
| 5    | Review & Create    | Summary of entire scenario; validate & create      |

The wizard produces a `ScenarioConfig` object that is stored client-side and sent to
`POST /admin/simulator/api/sessions/start` when the user clicks **"Start Simulation"**.

---

## Reference-level Explanation

### 1. New Data Structures

#### 1.1 ScenarioConfig (client-side + API payload)

```typescript
interface ScenarioConfig {
  // Step 1: Centrals
  centralIds: string[];

  // Step 2: Devices (grouped by central)
  devices: SimulatedDeviceConfig[];  // existing type from RFC-0010

  // Step 3: Rules
  ruleIds: string[];                 // explicit rule selection

  // Step 4: Control
  bundleRefreshIntervalMs: number;
  deviceScanIntervalMs: number;
  sessionDurationHours: number;      // new: explicit duration (within quota)

  // Step 5: Metadata
  name: string;
  description?: string;
}
```

#### 1.2 SimulatorSessionStatus UI mapping

| Status           | Block 1 Badge | Block 1 Actions                      |
|------------------|---------------|--------------------------------------|
| `NOT_CONFIGURED` | Gray          | "Configure Simulator" (primary CTA)  |
| `READY`          | Blue          | "Start Simulation" + "Reconfigure"   |
| `RUNNING`        | Green pulse   | "Stop Simulation" + "Reconfigure" (disabled) |
| `STOPPED`        | Red           | "Reconfigure" + "Start Simulation"   |
| `ERROR`          | Red outline   | "Reconfigure" + error details        |

> Note: `NOT_CONFIGURED` and `READY` are **UI-only states** (no backend change needed).
> The backend status enum (`PENDING | RUNNING | STOPPED | EXPIRED | ERROR`) is unchanged.

---

### 2. Backend Changes

#### 2.1 New API Endpoints (admin controller)

| Method | Path                                          | Purpose                                   |
|--------|-----------------------------------------------|-------------------------------------------|
| GET    | `/admin/simulator/api/centrals`               | List centrals for a customer (wizard S1)  |
| GET    | `/admin/simulator/api/centrals/:id/devices`   | List devices under a central (wizard S2)  |
| GET    | `/admin/simulator/api/rules`                  | List alarm rules for a customer (wizard S3) |

These endpoints are **thin read-only proxies** that query existing repositories with
`tenantId` + `customerId` filters. No new services are required.

#### 2.2 Changes to Existing Endpoints

**`POST /admin/simulator/api/sessions/start`** — extend to accept:
- `centralIds: string[]` (stored in `config` JSONB, no schema migration)
- `ruleIds: string[]` (stored in `config` JSONB, no schema migration)
- `sessionDurationHours: number` (used to compute `expiresAt`)

The existing `SimulatorConfig` interface gains optional fields:

```typescript
interface SimulatorConfig {
  // existing fields (unchanged)
  bundleRefreshIntervalMs: number;
  deviceScanIntervalMs: number;
  devices: SimulatedDeviceConfig[];
  customerId: string;

  // new optional fields (backward-compatible)
  centralIds?: string[];
  ruleIds?: string[];
  sessionDurationHours?: number;
  description?: string;
}
```

No database migration is needed — `config` is already a JSONB column.

#### 2.3 SimulatorEngine Changes

When `ruleIds` is provided in config, the engine's rule evaluator **filters** the bundle's
rules catalog to only evaluate the selected rules. Currently it evaluates all rules in
the bundle. This is a small change in `SimulatorEngine.evaluateRules()`:

```typescript
// Before: evaluate all rules
const rulesToEvaluate = Object.values(bundle.rules);

// After: filter if scenario specifies ruleIds
const rulesToEvaluate = config.ruleIds
  ? Object.values(bundle.rules).filter(r => config.ruleIds!.includes(r.id))
  : Object.values(bundle.rules);
```

---

### 3. Frontend Changes (Admin Cockpit HTML)

The entire admin cockpit is a single inline HTML file served by
`simulator-admin.controller.ts`. All changes are within this file.

#### 3.1 Grid Layout

Replace the current flat layout with a CSS Grid:

```css
.simulator-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 16px;
  height: calc(100vh - 64px);  /* full viewport minus header */
}
```

Each `.grid-block` is a card with header, scrollable content area, and optional footer.

#### 3.2 Block Specifications

**Block 1 — Scenario Overview & Control**
- Shows: central count, device count, rule count, mode, status badge
- Buttons: "Configure Simulator" / "Reconfigure" / "Start" / "Stop"
- Updates on: scenario creation, session start/stop, SSE status events

**Block 2 — Bundle Status & Rules Catalog**
- Shows: bundle version, signature, last fetch time, rules count
- Lists: active rules with name, metric, operator, value
- Updates on: SSE `BUNDLE_FETCHED` / `BUNDLE_UNCHANGED` events

**Block 3 — Device Scanner & Telemetry Feed**
- Shows: scrolling feed of device scan results with telemetry values
- Color-coded: green (normal), yellow (near threshold), red (exceeds threshold)
- Updates on: SSE `DEVICE_SCANNED` events

**Block 4 — Rule Evaluator Live Results**
- Shows: real-time rule evaluation results per device
- Displays: rule name, device, metric value vs threshold, result (pass/fail)
- Updates on: SSE `RULE_EVALUATED` events

**Block 5 — Alarm Candidates Queue & History**
- Shows: alarm candidates raised, queue depth, processing status
- Lists: recent alarm candidates with fingerprint, device, rule, severity
- Updates on: SSE `ALARM_CANDIDATE_RAISED` / `ALARM_CREATED` events

**Block 6 — Session Metrics & Quotas**
- Shows: scans performed/remaining, alarms triggered, session uptime, time remaining
- Progress bars: quota usage visualization
- Updates on: SSE events + periodic refresh

#### 3.3 Scenario Builder Wizard

The wizard is an overlay modal (`position: fixed; inset: 0; z-index: 1000`) with:

- **Step indicator** (top bar): `1 → 2 → 3 → 4 → 5` with active/completed states
- **Content area** (center): step-specific form
- **Navigation** (bottom): "Back" / "Next" / "Create Scenario" buttons
- **Validation**: each step validates before allowing "Next"

##### Step 1: Centrals

- Fetches centrals via `GET /admin/simulator/api/centrals?customerId=X`
- Displays: checkbox list with central name, serial, status, device count
- Minimum: 1 central selected
- State: `selectedCentralIds: string[]`

##### Step 2: Devices

- Fetches devices via `GET /admin/simulator/api/centrals/:id/devices` for each selected central
- Displays: grouped by central, checkbox list with device name, type, serial
- For **OUTLET** devices: shows channel badges (e.g., `[flow] [temperature]`)
- Minimum: 1 device selected
- Auto-generates `telemetryProfile` from device specs/type (user can override min/max)
- State: `selectedDevices: SimulatedDeviceConfig[]`

##### Step 3: Rules

- Fetches rules via `GET /admin/simulator/api/rules?customerId=X`
- Displays: checkbox list with rule name, metric, operator, value, priority
- Filters: by metric domain, by priority, by scope
- Highlight: rules applicable to selected devices
- Minimum: 1 rule selected
- State: `selectedRuleIds: string[]`

##### Step 4: Simulation Control

- Form fields:
  - **Session name** (text, required)
  - **Description** (text, optional)
  - **Device scan interval** (dropdown: 10s/30s/60s/120s, default 60s)
  - **Bundle refresh interval** (dropdown: 30s/60s/300s, default 300s)
  - **Session duration** (dropdown: 1h/4h/12h/24h/72h, default 24h)
- Shows quota limits alongside each field
- State: `controlConfig: { name, description, intervals, duration }`

##### Step 5: Review & Create

- Read-only summary of all steps:
  - Centrals: count + names
  - Devices: count + grouped by central
  - Rules: count + names
  - Control: intervals + duration
- Validation: checks quotas (max devices, max sessions, intervals within limits)
- Button: **"Create Scenario"** → stores config in JS state, closes wizard, updates Block 1
- Does NOT start the session — user must click "Start Simulation" in Block 1

---

### 4. Implementation Plan

#### Phase 1: Backend — New Read Endpoints

**Files to modify:**
- `src/controllers/admin/simulator-admin.controller.ts`

**New routes:**

```
GET /admin/simulator/api/centrals?tenantId=X&customerId=X
GET /admin/simulator/api/centrals/:centralId/devices?tenantId=X
GET /admin/simulator/api/rules?tenantId=X&customerId=X
```

**Implementation:**
1. Import `CentralRepository`, `DeviceRepository`, `RuleRepository`
2. Add 3 route handlers that query existing repositories
3. For centrals: return `{ id, name, serialNumber, connectionStatus, type }`
4. For devices: filter by `centralId`, return `{ id, name, type, serialNumber, specs.channels }`
   - Include `channels` field for OUTLET devices
5. For rules: filter ALARM_THRESHOLD type, return `{ id, name, priority, alarmConfig summary }`

**Dependencies:** None (uses existing repos)

**Estimated scope:** ~80 lines of code

---

#### Phase 2: Backend — SimulatorConfig Extension

**Files to modify:**
- `src/domain/entities/Simulator.ts` — add optional fields to `SimulatorConfig`
- `src/dto/request/SimulatorDTO.ts` — add optional fields to `StartSimulationSchema`
- `src/services/SimulatorEngine.ts` — filter rules by `ruleIds` when evaluating

**Changes:**

1. **Simulator.ts**: Add to `SimulatorConfig`:
   ```typescript
   centralIds?: string[];
   ruleIds?: string[];
   sessionDurationHours?: number;
   description?: string;
   ```

2. **SimulatorDTO.ts**: Add to `StartSimulationSchema`:
   ```typescript
   centralIds: z.array(z.string().uuid()).optional(),
   ruleIds: z.array(z.string().uuid()).optional(),
   sessionDurationHours: z.number().int().min(1).max(72).optional(),
   description: z.string().max(500).optional(),
   ```

3. **SimulatorEngine.ts**: In the rule evaluation method, filter rules when `config.ruleIds`
   is present. Approximately 5 lines changed.

**Dependencies:** None (backward-compatible, JSONB config)

**Estimated scope:** ~30 lines of code

---

#### Phase 3: Frontend — Grid Layout Shell

**Files to modify:**
- `src/controllers/admin/simulator-admin.controller.ts` (HTML template)

**Changes:**

1. Replace the current HTML body with a 2×3 CSS Grid layout
2. Create 6 card components, each with:
   - Header (block title + status indicator)
   - Scrollable content area
   - Optional action footer
3. Block 1: static scenario summary + CTA buttons
4. Blocks 2-6: placeholder content with "Waiting for simulation..." empty states
5. Maintain existing SSE connection logic — rewire event handlers to target specific blocks

**Dependencies:** Phase 1 (centrals/devices/rules endpoints for wizard)

**Estimated scope:** ~400 lines HTML/CSS/JS (replacing existing ~600 lines)

---

#### Phase 4: Frontend — Scenario Builder Wizard

**Files to modify:**
- `src/controllers/admin/simulator-admin.controller.ts` (HTML template)

**Changes:**

1. Add wizard overlay HTML structure (5-step modal)
2. Implement step navigation state machine:
   ```
   STEP_CENTRALS → STEP_DEVICES → STEP_RULES → STEP_CONTROL → STEP_REVIEW
   ```
3. Each step: fetch data from Phase 1 endpoints, render selection UI, validate
4. Step 2 (Devices): special handling for OUTLET devices — display channel badges
5. Step 2 (Devices): auto-generate telemetry profiles from device metadata
6. Step 5 (Review): aggregate all state, validate against quotas
7. On "Create Scenario": store `ScenarioConfig` in JS variable, update Block 1 summary
8. Block 1 "Start Simulation" calls existing `/api/sessions/start` with the stored config

**Dependencies:** Phase 1, Phase 2, Phase 3

**Estimated scope:** ~500 lines HTML/CSS/JS

---

#### Phase 5: Frontend — Real-time Block Updates

**Files to modify:**
- `src/controllers/admin/simulator-admin.controller.ts` (HTML template)

**Changes:**

1. Rewire SSE `onmessage` handler to dispatch events to block-specific renderers:
   - `BUNDLE_FETCHED` / `BUNDLE_UNCHANGED` → Block 2
   - `DEVICE_SCANNED` → Block 3
   - `RULE_EVALUATED` → Block 4
   - `ALARM_CANDIDATE_RAISED` / `ALARM_CREATED` → Block 5
   - All events → Block 6 (metrics counters)
2. Block 3: implement color-coded telemetry feed (green/yellow/red based on proximity to threshold)
3. Block 4: implement rule evaluation result table with pass/fail badges
4. Block 5: implement alarm candidate list with severity badges
5. Block 6: implement progress bars for quotas, counters for scans/alarms

**Dependencies:** Phase 3, Phase 4

**Estimated scope:** ~300 lines JS

---

#### Phase 6: Integration Testing & Polish

**Tasks:**
1. Test full wizard flow: centrals → devices → rules → control → review → create → start → stop
2. Test OUTLET devices display channels correctly in wizard Step 2
3. Test rule filtering: only selected rules trigger alarm candidates
4. Test SSE event routing to correct grid blocks
5. Test edge cases: no centrals, no devices, no rules, quota exceeded
6. Test backward compatibility: old-style session start (without centralIds/ruleIds) still works
7. Test state transitions: Not Configured → Ready → Running → Stopped → Ready
8. Polish: responsive behavior, loading spinners, error toasts, empty states

**Dependencies:** All previous phases

---

### 5. File Change Summary

| File | Change Type | Phase |
|------|-------------|-------|
| `src/controllers/admin/simulator-admin.controller.ts` | Major rewrite (HTML + 3 new routes) | 1, 3, 4, 5 |
| `src/domain/entities/Simulator.ts` | Add 4 optional fields to `SimulatorConfig` | 2 |
| `src/dto/request/SimulatorDTO.ts` | Add 4 optional fields to `StartSimulationSchema` | 2 |
| `src/services/SimulatorEngine.ts` | Add rule filtering (~5 lines) | 2 |

**Total files modified:** 4

**No database migrations required** — all new config fields stored in existing JSONB `config` column.

**No new files required** — all changes fit within existing architecture.

---

## Drawbacks

1. **Single-file UI complexity**: The admin cockpit is inline HTML. Adding a 5-step wizard
   to an already large file pushes it toward ~1500 lines. If it grows further, extracting
   to a separate frontend build system should be considered.

2. **No scenario persistence**: Scenarios live in browser memory. Refreshing the page
   loses the configured scenario. This is acceptable for MVP but a future RFC could add
   scenario templates stored in the database.

3. **Telemetry profile auto-generation**: Step 2 guesses min/max from device type, which
   may not match real-world ranges. Users can override, but defaults may mislead.

---

## Rationale and Alternatives

### Why a wizard instead of a single form?

The wizard enforces a logical order (centrals → devices → rules) that mirrors the
physical alarm pipeline. This makes the simulator self-documenting for new users.

### Why not a separate React/Vue frontend?

The admin cockpit is an internal tool, not a customer-facing product. Inline HTML
keeps deployment simple (no build step, no static assets, no CORS). The grid layout
and wizard are achievable with vanilla JS and CSS Grid.

### Why not persist scenarios in the database?

Scenario persistence adds a new table, CRUD endpoints, and ownership logic. The
current MVP only needs session-scoped configuration. Persistence can be added in a
follow-up RFC without breaking changes.

---

## Unresolved Questions

1. Should the wizard pre-select "all devices" and "all rules" by default, or start empty?
2. Should Block 3 (Device Scanner) show a fixed-height scrolling feed or paginated table?
3. Should the Demo button (`POST /api/demo/setup`) also use the new scenario flow, or
   remain as a separate quick-start path?
4. Should we add a "Save Scenario as Template" button in Step 5 for future reuse?

---

## Implementation Checklist

### Phase 1: Backend Read Endpoints
- [x] Add `GET /admin/simulator/api/centrals` route
- [x] Add `GET /admin/simulator/api/centrals/:id/devices` route (include OUTLET channels)
- [x] Add `GET /admin/simulator/api/rules` route
- [x] Test endpoints with existing seed data

### Phase 2: SimulatorConfig Extension
- [x] Add `centralIds`, `ruleIds`, `sessionDurationHours`, `description` to `SimulatorConfig`
- [x] Add corresponding fields to `StartSimulationSchema` (Zod)
- [x] Add rule filtering in `SimulatorEngine.evaluateRules()`
- [x] Verify backward compatibility (start without new fields still works)
- [x] Run `npm run build`

### Phase 3: Grid Layout Shell
- [x] Replace cockpit HTML with 2×3 CSS Grid
- [x] Implement 6 block cards with headers and empty states
- [x] Wire Block 1 with scenario status badge and CTA buttons
- [x] Verify SSE connection still works after HTML restructure

### Phase 4: Scenario Builder Wizard
- [x] Implement wizard overlay modal (5-step navigation)
- [x] Step 1: Centrals selection (fetch + checkbox list)
- [x] Step 2: Devices selection (grouped by central, OUTLET channel badges)
- [x] Step 2: Auto-generate telemetry profiles with editable min/max
- [x] Step 3: Rules selection (filtered, with applicability highlight)
- [x] Step 4: Control configuration form
- [x] Step 5: Review summary + validation + "Create Scenario"
- [x] Wire "Create Scenario" to update Block 1 and enable "Start Simulation"

### Phase 5: Real-time Block Updates
- [x] Dispatch SSE events to block-specific renderers
- [x] Block 2: bundle status + rules catalog display
- [x] Block 3: color-coded telemetry feed
- [x] Block 4: rule evaluation results table
- [x] Block 5: alarm candidates list with severity badges
- [x] Block 6: metrics counters + quota progress bars

### Phase 6: Testing & Polish
- [x] End-to-end wizard flow test
- [x] OUTLET channel display test
- [x] Rule filtering test
- [x] Backward compatibility test
- [x] State transition test (Not Configured → Ready → Running → Stopped)
- [x] Edge case tests (empty data, quota exceeded)
- [x] UI polish (loading states, error handling, responsive behavior)
