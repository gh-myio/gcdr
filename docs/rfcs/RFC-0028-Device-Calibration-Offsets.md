# RFC-0028 — Device Calibration Offsets

- **Status:** Draft
- **Created:** 2026-04-09
- **Author:** MYIO Engineering
- **Domain:** Devices / Sensor Calibration

---

## Why this matters

Real-world IoT deployments are imperfect. A temperature sensor installed next to a
heat source reads 2 °C higher than the actual room temperature. A current transformer
rated at 600A outputs 1A — every raw reading must be multiplied by 600 before it
means anything. A water meter emits one pulse per 100 litres, but the alarm backend
only sees a "1".

Today, these corrections live outside GCDR: they are hardcoded in the alarm backend,
scattered across spreadsheets, or applied inconsistently by each integration team.
This creates a dangerous split — the device record says one thing, the alarm fires
on another. When a threshold rule is created in GCDR for `temperature > 30 °C`, the
engineer setting the rule has no visibility into whether the raw value already has a
systematic bias of +2 °C. The alarm either fires too early or too late.

**Device calibration belongs with the device.** GCDR is the single source of truth
for device configuration. Storing calibration here means:

- Every consumer (alarm backend, dashboards, reports) reads from the same source
  and applies the same correction — no divergence.
- A field technician who adjusts a CT ratio updates one record and all downstream
  systems immediately see the corrected value.
- Support teams can audit the calibration history (`changelog`) and know exactly
  who changed what and when, without digging through code or deployment configs.
- Time-windowed offsets handle the reality that calibration needs change throughout
  the day — peak load, cooling cycles, shift hours — without requiring separate
  device records or rule duplicates.
- **Date-range periods** allow historical recalculation: a specific set of offsets
  can be declared active only between two calendar dates, enabling retroactive
  correction of past readings without touching the current configuration.

This is not a new abstraction introduced for its own sake. It is the formalisation
of corrections that are already happening, brought into the right place.

---

## Summary

Introduces a `calibration` JSONB column on the `devices` table to store per-device
calibration rules. The column is an envelope containing:

- **`offsets`** — the currently active calibration rules, each with a weekly
  time-windowed schedule
- **`periods`** — optional date-range overrides that temporarily replace the active
  offsets during a specific calendar interval
- **`changelog`** — a bounded audit trail of recent changes (last 20 entries)

---

## Motivation

IoT sensors often require post-processing corrections before being used in alarm
evaluation, dashboards, or SLA calculations:

- **Temperature sensors** may have physical offsets due to mounting position, heat
  dissipation from nearby equipment, or factory calibration drift.
- **Energy meters (CTs)** require a multiplier to convert raw current-transformer
  ratios into real power/current/voltage values (e.g., a CT rated at 600A/1A implies
  a ×600 multiplier on current readings).
- **Water flow meters (hydrometers)** emit pulses where each pulse may represent
  10, 50, or 100 litres depending on the sensor model.

Calibration values are not always constant across time: a chiller room sensor may
need a different offset during peak cooling hours. And sometimes a correction must
apply only during a past calendar period for retroactive data recalculation.

---

## Guide-level explanation

### Concepts

#### Offset

An **offset** is a calibration rule applied to a specific metric domain:

| Field      | Description |
|------------|-------------|
| `domain`   | Metric domain: `temperature`, `energy`, `water_flow`, `humidity`, `water_level_continuous` |
| `metric`   | *(optional)* Sub-metric within domain (e.g. `power`, `current`, `voltage`) |
| `value`    | The calibration value (e.g. `-2`, `690`, `0.5`) |
| `type`     | How the value is applied: `SUM`, `MULTIPLIER`, or `DIVIDER` |
| `schedule` | A 7-day schedule defining when this offset is active |

**Transformation formulas:**
```
SUM:        calibrated = raw + value
MULTIPLIER: calibrated = raw × value
DIVIDER:    calibrated = raw ÷ value
```

#### Schedule

Each offset has a `schedule` keyed by day of week (`"0"` = Sunday … `"6"` = Saturday).
Each day is either `null` (offset inactive that day) or an array of time intervals.

#### Interval

| Field     | Type    | Description |
|-----------|---------|-------------|
| `start`   | `HH:mm` | Interval start time |
| `end`     | `HH:mm` | Interval end time |
| `overlap` | boolean | `true` if interval crosses midnight (e.g. `23:00`→`05:00`) |

#### Visual — weekly schedule

```
Temperature offset -2 (SUM):

         Sun        Mon        Tue        Wed        Thu        Fri        Sat
00:00  ░░░░░░░░░  ░░░░░░░░░  ████████  ████████  ░░░░░░░░░  ░░░░░░░░░  ░░░░░░░░░
03:00  ████████░  ░░░░░░░░░   (full)    (full)
06:00  ░░░░░░░░░  ░░░░░░░░░
09:00             ████████░
12:00  ████████░
15:00  ░░░░░░░░░  ░░░░░░░░░
18:00  ████████░
20:00  ░░░░░░░░░
23:00             ████████░ ←── overlap: true (continues to Mon 05:00)
00:00             ─────────

█ = offset active   ░ = offset inactive
```

```
Temperature offset -1 (SUM):

         Sun        Mon        Tue        Wed        Thu        Fri        Sat
00:00  ████████░  ░░░░░░░░░  ░░░░░░░░░  ░░░░░░░░░  ████████  ░░░░░░░░░  ░░░░░░░░░
02:00  ░░░░░░░░░   (full)
03:00             ████████░
08:00             ░░░░░░░░░
15:01  ████████░
17:00  ░░░░░░░░░
18:00             ████████░
21:00  ████████░
22:00  ░░░░░░░░░
23:00             ░░░░░░░░░

Note: Sun 00:00–02:00 and -2's 03:00–06:00 are adjacent, not overlapping.
      Combined, Sunday is fully covered between the two offsets.
```

#### Period (date-range override)

A **period** is a date-bounded set of offsets that takes precedence over the root
`offsets` during a specific calendar interval. Outside the period dates, the root
offsets apply normally.

| Field       | Type   | Description |
|-------------|--------|-------------|
| `id`        | uuid   | Unique identifier for this period |
| `validFrom` | `YYYY-MM-DD` | First day the period is active (inclusive) |
| `validUntil`| `YYYY-MM-DD` | Last day the period is active (inclusive) |
| `note`      | string | Human description of why this period exists |
| `offsets`   | array  | Offsets that replace the root offsets during this period |

**Visual — period precedence on the calendar:**

```
Jan 2026          Feb 2026               Mar 2026
─────────────────────────────────────────────────────────────▶ time
         │         │              │         │
         │◄── ROOT OFFSETS ──────►│         │
                   │              │
                   │◄── PERIOD ──►│
                   │  Feb 03–28   │
                   │  (overrides) │

Timeline:
Jan 01 ──── Feb 02 │ Feb 03 ──────────── Feb 28 │ Mar 01 ──── ...
    root offsets   │     period offsets          │   root offsets
                   │                             │
```

**Evaluation precedence rule:**

```
given: current_date, current_time, device.calibration

1. find active period:
   period = calibration.periods.find(p =>
     p.validFrom <= current_date <= p.validUntil
   )

2. pick offset source:
   source = period ? period.offsets : calibration.offsets

3. find matching offset in source:
   for each offset in source where domain+metric match:
     check schedule[current_day_of_week] intervals
     if current_time falls in any interval → apply offset

4. if no match → use raw value unchanged
```

#### Changelog

The `changelog` is a **bounded, append-only** audit trail of the last **20** changes.
It is stored inside the JSONB column alongside `offsets` and `periods`.

| Field     | Type   | Description |
|-----------|--------|-------------|
| `version` | number | Version produced by this change |
| `at`      | ISO 8601 | UTC timestamp |
| `by`      | uuid   | `userId` of the operator |
| `note`    | string | Free-text description of what changed |

**Why bounded at 20:**
PostgreSQL JSONB has a theoretical 1 GB limit per field, so volume is not the primary
concern. The real issues with an unbounded changelog are:

- Every query on `devices` loads the full changelog even when not needed
- Free-text `note` fields can grow large
- There is no way to index or query entries within the JSONB efficiently
- No referential integrity on `by` (userId is a loose UUID)

For **full audit history**, a separate `device_calibration_logs` table is the correct
long-term solution (see Alternatives). For v1, 20 entries cover years of calibration
changes at typical field-service frequency (monthly or less).

When the 21st entry is added, the oldest entry is dropped from the array. The `version`
counter on the envelope is never reset — it always reflects the true total number of
writes.

---

## Reference-level explanation

### Database schema

```sql
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS calibration JSONB;

COMMENT ON COLUMN devices.calibration IS
  'Per-device calibration offsets with time-windowed scheduling, date-range period '
  'overrides, and a bounded changelog (last 20 entries).';
```

### TypeScript types

```typescript
export type CalibrationDomain =
  | 'temperature'
  | 'energy'
  | 'water_flow'
  | 'humidity'
  | 'water_level_continuous';

export type CalibrationOffsetType = 'SUM' | 'MULTIPLIER' | 'DIVIDER';

export interface CalibrationInterval {
  start: string;    // "HH:mm"
  end: string;      // "HH:mm"
  overlap: boolean; // true = crosses midnight into the next calendar day
}

// Keyed "0" (Sunday) through "6" (Saturday). null = offset inactive that day.
export type CalibrationDaySchedule = {
  "0": CalibrationInterval[] | null;
  "1": CalibrationInterval[] | null;
  "2": CalibrationInterval[] | null;
  "3": CalibrationInterval[] | null;
  "4": CalibrationInterval[] | null;
  "5": CalibrationInterval[] | null;
  "6": CalibrationInterval[] | null;
};

export interface DeviceOffset {
  domain: CalibrationDomain;
  metric?: string;               // sub-metric: "power" | "current" | "voltage" | ...
  value: number;
  type: CalibrationOffsetType;
  schedule: CalibrationDaySchedule;
}

export interface CalibrationPeriod {
  id: string;                // uuid
  validFrom: string;         // "YYYY-MM-DD" inclusive
  validUntil: string | null; // "YYYY-MM-DD" inclusive, or null = open-ended (permanent)
  note: string;
  offsets: DeviceOffset[];
}

// Energy sub-metric (typed enum for domain: "energy")
export type EnergyMetric = 'power' | 'current' | 'voltage';

export interface CalibrationChangelogEntry {
  version: number;
  at: string;           // ISO 8601 UTC
  by: string;           // userId (uuid)
  note: string;
}

export interface DeviceCalibration {
  version: number;
  createdAt: string;                        // ISO 8601
  updatedAt: string;                        // ISO 8601
  changelog: CalibrationChangelogEntry[];   // max 20 entries, oldest first
  offsets: DeviceOffset[];                  // currently active offsets
  periods?: CalibrationPeriod[];            // optional date-range overrides
}
```

### Full example — temperature device with a February period override

```json
{
  "version": 4,
  "createdAt": "2026-01-10T08:00:00Z",
  "updatedAt": "2026-04-09T14:32:00Z",
  "changelog": [
    {
      "version": 1,
      "at": "2026-01-10T08:00:00Z",
      "by": "3f9d29a0-b293-4da9-83e4-0e2bc38566c7",
      "note": "Initial setup — temperature offset -2"
    },
    {
      "version": 2,
      "at": "2026-01-20T10:00:00Z",
      "by": "3f9d29a0-b293-4da9-83e4-0e2bc38566c7",
      "note": "Added offset -1 for complementary windows on Sunday and Monday"
    },
    {
      "version": 3,
      "at": "2026-02-03T09:00:00Z",
      "by": "3f9d29a0-b293-4da9-83e4-0e2bc38566c7",
      "note": "Added period Feb 03–28: chiller maintenance, sensor relocated temporarily"
    },
    {
      "version": 4,
      "at": "2026-04-09T14:32:00Z",
      "by": "3f9d29a0-b293-4da9-83e4-0e2bc38566c7",
      "note": "Added offset +1 active on Friday with overnight window"
    }
  ],
  "offsets": [
    {
      "domain": "temperature",
      "value": -2,
      "type": "SUM",
      "schedule": {
        "0": [
          { "start": "03:00", "end": "06:00", "overlap": false },
          { "start": "12:00", "end": "15:00", "overlap": false },
          { "start": "18:00", "end": "20:00", "overlap": false }
        ],
        "1": [
          { "start": "09:00", "end": "18:00", "overlap": false },
          { "start": "23:00", "end": "05:00", "overlap": true }
        ],
        "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "4": null,
        "5": null,
        "6": null
      }
    },
    {
      "domain": "temperature",
      "value": -1,
      "type": "SUM",
      "schedule": {
        "0": [
          { "start": "00:00", "end": "02:00", "overlap": false },
          { "start": "15:01", "end": "17:00", "overlap": false },
          { "start": "21:00", "end": "22:00", "overlap": false }
        ],
        "1": [
          { "start": "03:00", "end": "08:00", "overlap": false },
          { "start": "18:00", "end": "23:00", "overlap": false }
        ],
        "2": null,
        "3": null,
        "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "5": null,
        "6": null
      }
    },
    {
      "domain": "temperature",
      "value": 1,
      "type": "SUM",
      "schedule": {
        "0": null,
        "1": null,
        "2": null,
        "3": null,
        "4": null,
        "5": [
          { "start": "00:00", "end": "02:00", "overlap": false },
          { "start": "15:00", "end": "17:00", "overlap": false },
          { "start": "21:00", "end": "06:00", "overlap": true }
        ],
        "6": null
      }
    }
  ],
  "periods": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "validFrom": "2026-02-03",
      "validUntil": "2026-02-28",
      "note": "Chiller maintenance Feb/2026 — sensor temporarily relocated 1.5m closer to unit. Offset adjusted to compensate heat proximity.",
      "offsets": [
        {
          "domain": "temperature",
          "value": -4,
          "type": "SUM",
          "schedule": {
            "0": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "1": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "5": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "6": [{ "start": "00:00", "end": "23:59", "overlap": false }]
          }
        }
      ]
    },
    {
      "id": "f9e8d7c6-b5a4-3210-fedc-ba9876543210",
      "validFrom": "2026-03-01",
      "validUntil": null,
      "note": "Sensor permanently replaced with model HX-500 — new factory offset confirmed on-site. No end date: applies indefinitely.",
      "offsets": [
        {
          "domain": "temperature",
          "value": -3,
          "type": "SUM",
          "schedule": {
            "0": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "1": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "5": [{ "start": "00:00", "end": "23:59", "overlap": false }],
            "6": [{ "start": "00:00", "end": "23:59", "overlap": false }]
          }
        }
      ]
    }
  ]
}
```

### Visual — periods vs root offsets on the calendar

```
    Jan 2026      Feb 2026 (period -4)    Mar 2026 (period -3, open-ended)
────────────────────────────────────────────────────────────────────────────▶ time
Jan 01    Feb 02 │ Feb 03        Feb 28 │ Mar 01
                 │                     │
◄─ root ────────►│◄── period A (-4) ──►│◄──── period B (-3, validUntil: null) ──►
(-2,-1,+1 sched) │  flat -4, all days  │  flat -3, all days, permanent
                 │                     │
```

```
Date resolution summary:

  Jan 15  → no period active           → root offsets apply  (-2 / -1 / +1 windowed)
  Feb 15  → period A active (Feb 3–28) → period A offsets    (-4 flat all day)
  Mar 10  → period B active (Mar 1–∞)  → period B offsets    (-3 flat all day)
  Apr 30  → period B still active      → period B offsets    (-3 flat all day)
```

```
Example evaluation — what offset applies on 2026-02-15 at 14:00 (Wednesday)?

  Step 1: Is there an active period?
          periods[0].validFrom = "2026-02-03"
          periods[0].validUntil = "2026-02-28"
          "2026-02-15" is within range → YES, use period offsets

  Step 2: period.offsets[0] — domain: temperature, value: -4, type: SUM
          schedule["3"] (Wednesday) = [{ start: "00:00", end: "23:59" }]
          14:00 is within 00:00–23:59 → MATCH

  Result: calibrated = raw + (-4)
          raw = 28.0 °C → calibrated = 24.0 °C
```

```
Example evaluation — what offset applies on 2026-03-10 at 14:00 (Tuesday)?

  Step 1: Is there an active period?
          "2026-03-10" is outside all periods → NO, use root offsets

  Step 2: root offsets for domain: temperature on Tuesday ("2"):
          offset -2 → schedule["2"] = [{ start: "00:00", end: "23:59" }] → MATCH
          offset -1 → schedule["2"] = null → skip
          offset +1 → schedule["2"] = null → skip

  Result: calibrated = raw + (-2)
          raw = 28.0 °C → calibrated = 26.0 °C
```

### Validation rules

1. **No overlapping intervals within the same offset and day.**
2. **No overlapping intervals across different offsets for the same domain+metric on
   the same day** — this is a hard business rule; the API rejects the write with
   `400 CALIBRATION_INTERVAL_OVERLAP`.
3. **`value` must be non-zero** for `MULTIPLIER` and `DIVIDER` types.
4. **`overlap: true`** requires `end < start` (end is on the following day).
5. **All 7 days must be present** in every schedule object (values may be `null`).
6. **Period date ranges must not overlap** for the same domain+metric.
7. **`changelog` is capped at 20 entries** — when a new entry is added, the oldest
   is removed. The envelope `version` counter is never reset.
8. **At most one open-ended period** (`validUntil: null`) per domain+metric.
   The rules below govern conflicts between periods and open-ended periods.

#### Open-ended period conflict rules

**Case 1 — inserting a new open-ended period B when an open-ended period A already exists:**

The API offers two behaviours (caller chooses via request flag `autoCloseExisting`):

- `autoCloseExisting: true` → API automatically sets `A.validUntil = B.validFrom - 1 day`
  and inserts B. The changelog records both the auto-close of A and the creation of B.
- `autoCloseExisting: false` (default) → API rejects with `409 OPEN_PERIOD_CONFLICT`:

```json
{
  "code": "OPEN_PERIOD_CONFLICT",
  "message": "An open-ended period already exists for domain 'temperature'. Close it before inserting a new open-ended period, or use autoCloseExisting=true.",
  "existing": {
    "id": "a1b2c3d4-...",
    "validFrom": "2026-01-01",
    "validUntil": null,
    "note": "Sensor replaced with model HX-500"
  }
}
```

**Case 2 — inserting a bounded period A when an open-ended period B already exists
and B.validFrom falls within A's range:**

API rejects with `409 OPEN_PERIOD_CONFLICT`:

```json
{
  "code": "OPEN_PERIOD_CONFLICT",
  "message": "Open-ended period B (validFrom: '2026-03-01') overlaps with the period you are trying to insert. Set a validUntil before '2026-03-01' on your period and try again.",
  "existing": {
    "id": "b2c3d4e5-...",
    "validFrom": "2026-03-01",
    "validUntil": null,
    "note": "Sensor permanently replaced"
  }
}
```

**Visual — open-ended period conflict scenarios:**

```
Case 1 — two open-ended periods (CONFLICT):

  Period A:  validFrom: "2026-01-01"  validUntil: null
  Period B:  validFrom: "2026-03-01"  validUntil: null

  Jan          Mar
  ──────────────────────────────────────────────────▶
  │←── A (forever) ─────────────────────────────────
               │←── B (forever) ─────────────────────
                    AMBIGUOUS — rejected (or auto-close A)


Case 1 resolved with autoCloseExisting=true:

  Period A:  validFrom: "2026-01-01"  validUntil: "2026-02-28"  ← auto-closed
  Period B:  validFrom: "2026-03-01"  validUntil: null           ← inserted

  Jan 01      Mar 01
  ──────────────────────────────────────────────────▶
  │←── A ────►│←── B (forever) ─────────────────────
  VALID ✓


Case 2 — inserting A that conflicts with existing open-ended B (REJECTED):

  Period B (existing): validFrom: "2026-03-01"  validUntil: null
  Period A (new):      validFrom: "2026-02-01"  validUntil: "2026-04-30"

  Feb 01      Mar 01        Apr 30
  ──────────────────────────────────────────────────▶
               │←── B (forever) ─────────────────────
  │←────── A ──────────────►│
               OVERLAP — rejected

  Fix: set A.validUntil = "2026-02-28" (before B.validFrom)
```

---

## Drawbacks

- Interval overlap validation across multiple offsets is non-trivial, especially
  when `overlap: true` intervals from adjacent days are considered.
- Schedule objects are verbose for always-on multipliers (7 × `00:00–23:59`); a
  future shorthand (`"always": true`) could reduce boilerplate.
- The `changelog` cap of 20 means long-lived devices lose old change records over
  time. If full audit history is required, a `device_calibration_logs` table must
  be added.

---

## Alternatives considered

### Unbounded changelog in JSONB
Rejected: every query on `devices` loads the full changelog. Free-text notes can
grow arbitrarily. No efficient indexing on entries within JSONB. Bounded at 20
covers years of field-service frequency with negligible storage cost.

### Separate `device_calibration_logs` table
Deferred to a future RFC. Correct long-term solution for full audit history and
efficient querying by `userId`, `version`, or date range. Not needed for v1.

### `validFrom`/`validUntil` directly on each offset (instead of `periods`)
Rejected: mixing date-range fields into every offset conflates the weekly schedule
with the calendar override. The `periods` envelope keeps concerns separated —
root offsets are always the normal configuration; periods are explicit exceptions.

### Storing calibration inside `metadata`
Rejected: `metadata` is a generic catch-all. Calibration is a first-class concern
consumed on every reading evaluation; it warrants a dedicated column.

### Separate `device_calibrations` table
Rejected for this version: one-to-one nature and low cardinality (< 10 offsets
per device) make a JSONB column sufficient. Revisit if per-offset audit trails
or multi-version snapshots are required.

---

## Resolved decisions

| Question | Decision |
|----------|----------|
| Cross-offset non-overlap enforcement | **Hard business rule — API rejects with `400 CALIBRATION_INTERVAL_OVERLAP`.** No ambiguous state is ever persisted. |
| Timezone handling | **All timestamps stored in UTC.** The alarm backend is responsible for converting UTC to the customer's local timezone when resolving day-of-week and HH:mm boundaries. |
| Energy sub-metrics typing | **Typed enum** `EnergyMetric = 'power' \| 'current' \| 'voltage'`. New values require an explicit RFC update. |
| `validUntil: null` (open-ended periods) | **Supported.** At most one open-ended period per domain+metric. Conflicts resolved via `409 OPEN_PERIOD_CONFLICT` with optional `autoCloseExisting=true` flag. |

## Unresolved questions

- Should a `timezone` field be added to the **device** as a first-class column
  (benefiting rules, calibration, and schedules uniformly), rather than always
  inheriting from the customer? Deferred to a separate RFC covering device
  timezone configuration.
- Should `autoCloseExisting` be a request-level flag or a system-level tenant
  setting (i.e., always auto-close or always reject)?

---

## Implementation plan

1. **Migration** — `ALTER TABLE devices ADD COLUMN calibration JSONB`
2. **TypeScript types** — `DeviceCalibration`, `DeviceOffset`, `CalibrationPeriod`,
   `CalibrationInterval`, `CalibrationChangelogEntry` in `src/domain/entities/Device.ts`
3. **Zod schema** — `CalibrationSchema` in `src/dto/request/DeviceDTO.ts` with
   validation rules 1–7 enforced; changelog capped at 20 on write
4. **Repository** — `calibration` field in `DeviceRepository` create/update/map;
   changelog append logic with cap enforcement
5. **Alarm backend guide** — document period precedence evaluation algorithm
6. **Example files** — `docs/examples/device-calibration/` (temperature, energy,
   water-flow-hydrometer JSON examples)
