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
  metric?: EnergyMetric;         // required when domain === "energy"
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

// Energy sub-metric (typed enum for domain: "energy") — see Power Triangle section below.
// NOTE: power_factor is dimensionless [0..1] and must NOT use MULTIPLIER or DIVIDER offsets
// (a CT ratio multiplies P, Q, and S linearly, but never cos(φ)).
export type EnergyMetric =
  | 'active_power'      // P — real work delivered (W, kW)
  | 'reactive_power'    // Q — oscillating energy, not consumed as work (VAr, kVAr)
  | 'apparent_power'    // S — total demand on the generator/transformer (VA, kVA)
  | 'power_factor'      // cos(φ) — ratio P/S, dimensionless [0..1]; SUM only
  | 'current'           // I — ampere (A)
  | 'voltage';          // V — volt (V)

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

### The power triangle and energy calibration

Real-world energy meters measure electrical quantities that are geometrically related.
Understanding this relationship is essential for choosing the correct `metric` and
`type` for a `domain: "energy"` offset.

```
        |S| (VA)
       /|
      / |
     /  | Q (VAr)
    /   | reactive
   / φ  |
  ──────────── P (W)
     active
```

| Symbol | Metric | Unit | Description |
|--------|--------|------|-------------|
| **P** | `active_power` | W, kW | Real work — heat, motion, light |
| **Q** | `reactive_power` | VAr, kVAr | Oscillating energy — demanded but not consumed |
| **S** | `apparent_power` | VA, kVA | Total output required from the generator/transformer |
| **cos(φ)** | `power_factor` | — (0–1) | Ratio P/S; angle between voltage and current |
| **I** | `current` | A | Line current |
| **V** | `voltage` | V | Line voltage |

**Key formulas:**

```
S² = P² + Q²
P  = S × cos(φ)
Q  = S × sin(φ)
cos(φ) = P / S
```

#### CT ratio and the power triangle

A current transformer (CT) rated at 600A/1A means the meter's raw reading must be
multiplied by 600 to obtain the real current. Because P, Q, and S are all linear in I,
the **same multiplier applies to all three power quantities**:

```
I_real = I_raw × 600          → MULTIPLIER: 600, metric: "current"
P_real = P_raw × 600          → MULTIPLIER: 600, metric: "active_power"
Q_real = Q_raw × 600          → MULTIPLIER: 600, metric: "reactive_power"
S_real = S_raw × 600          → MULTIPLIER: 600, metric: "apparent_power"
```

`power_factor` (cos φ) is **dimensionless** and is not affected by the CT ratio —
a `MULTIPLIER` or `DIVIDER` offset on `power_factor` is rejected by the API with
`400 CALIBRATION_INVALID_METRIC_TYPE`.

#### Practical examples

| Sensor | What it reports | Offset needed | RFC fields |
|--------|----------------|---------------|------------|
| CT 600A/1A reporting raw current | `I_raw` (A) | × 600 | `domain: "energy"`, `metric: "current"`, `type: "MULTIPLIER"`, `value: 600` |
| CT 600A/1A reporting active power | `P_raw` (W) | × 600 | `domain: "energy"`, `metric: "active_power"`, `type: "MULTIPLIER"`, `value: 600` |
| Meter with factory offset on power factor | `cos(φ)_raw` | + 0.02 | `domain: "energy"`, `metric: "power_factor"`, `type: "SUM"`, `value: 0.02` |

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

---

### Full example — 3F SCSDIAC-TrafoCAG (three-phase, transformer site: ×1380 power, ×40 current, ×36.31 voltage)

This device is a three-phase energy meter installed downstream of a medium-voltage
transformer. The meter reports raw secondary-side values; three independent multipliers
convert them to real primary-side quantities:

- **×1380** — combined CT × PT constant applied to all power quantities (P, Q, S)
- **×40** — CT ratio for line current (e.g. 200A/5A = 40:1)
- **×36.31** — PT ratio for line voltage (e.g. 13.8kV / 380V ≈ 36.31)

Because P, Q, and S are all linear in both I and V, the same power multiplier (1380)
applies to `active_power`, `reactive_power`, and `apparent_power`. `power_factor`
(cos φ) is dimensionless and requires no calibration here.

All offsets are always-on (no time-windowing) — the CT and PT ratios are physical
constants that do not vary by time of day.

```json
{
  "version": 1,
  "createdAt": "2026-04-14T10:00:00Z",
  "updatedAt": "2026-04-14T10:00:00Z",
  "changelog": [
    {
      "version": 1,
      "at": "2026-04-14T10:00:00Z",
      "by": "3f9d29a0-b293-4da9-83e4-0e2bc38566c7",
      "note": "Initial setup — 3F SCSDIAC-TrafoCAG: power ×1380 (CT×PT), current ×40 (200A/5A CT), voltage ×36.31 (13.8kV/380V PT)"
    }
  ],
  "offsets": [
    {
      "domain": "energy",
      "metric": "active_power",
      "value": 1380,
      "type": "MULTIPLIER",
      "schedule": {
        "0": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "1": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "5": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "6": [{ "start": "00:00", "end": "23:59", "overlap": false }]
      }
    },
    {
      "domain": "energy",
      "metric": "reactive_power",
      "value": 1380,
      "type": "MULTIPLIER",
      "schedule": {
        "0": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "1": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "5": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "6": [{ "start": "00:00", "end": "23:59", "overlap": false }]
      }
    },
    {
      "domain": "energy",
      "metric": "apparent_power",
      "value": 1380,
      "type": "MULTIPLIER",
      "schedule": {
        "0": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "1": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "5": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "6": [{ "start": "00:00", "end": "23:59", "overlap": false }]
      }
    },
    {
      "domain": "energy",
      "metric": "current",
      "value": 40,
      "type": "MULTIPLIER",
      "schedule": {
        "0": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "1": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "5": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "6": [{ "start": "00:00", "end": "23:59", "overlap": false }]
      }
    },
    {
      "domain": "energy",
      "metric": "voltage",
      "value": 36.31,
      "type": "MULTIPLIER",
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
```

```
Evaluation example — 2026-04-14 at 09:30 (Tuesday):

  Step 1: no periods defined → use root offsets
  Step 2: domain=energy, metric=active_power, schedule["2"] = [00:00–23:59] → MATCH

  Result: calibrated_active_power  = raw_active_power  × 1380
          calibrated_current       = raw_current       × 40
          calibrated_voltage       = raw_voltage       × 36.31

  Consistency check (power triangle):
    S_cal = V_cal × I_cal = (V_raw × 36.31) × (I_raw × 40) = V_raw × I_raw × 1452
    P_cal = S_cal × cos(φ)

  Note: 1380 ≠ 40 × 36.31 (= 1452). If the meter reports power and current/voltage
  independently, the two multipliers may differ because the meter's internal arithmetic
  already applies partial scaling. Always confirm which quantities the meter reports
  raw vs. pre-scaled before setting calibration offsets.
```

---

### Full example — 3F SCSDI309C (three-phase, direct CT: ×16 power, ×16 current)

Simpler setup: the meter is on a low-voltage panel with a single CT ratio of 16:1.
Because the meter reports power already derived from the CT secondary, both the power
quantities and the current share the same multiplier of 16. No PT is involved —
voltage is measured directly (no calibration needed).

```json
{
  "version": 1,
  "createdAt": "2026-04-14T10:00:00Z",
  "updatedAt": "2026-04-14T10:00:00Z",
  "changelog": [
    {
      "version": 1,
      "at": "2026-04-14T10:00:00Z",
      "by": "3f9d29a0-b293-4da9-83e4-0e2bc38566c7",
      "note": "Initial setup — 3F SCSDI309C: power ×16 and current ×16 (CT 16:1, direct voltage)"
    }
  ],
  "offsets": [
    {
      "domain": "energy",
      "metric": "active_power",
      "value": 16,
      "type": "MULTIPLIER",
      "schedule": {
        "0": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "1": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "5": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "6": [{ "start": "00:00", "end": "23:59", "overlap": false }]
      }
    },
    {
      "domain": "energy",
      "metric": "reactive_power",
      "value": 16,
      "type": "MULTIPLIER",
      "schedule": {
        "0": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "1": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "5": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "6": [{ "start": "00:00", "end": "23:59", "overlap": false }]
      }
    },
    {
      "domain": "energy",
      "metric": "apparent_power",
      "value": 16,
      "type": "MULTIPLIER",
      "schedule": {
        "0": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "1": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "2": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "3": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "4": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "5": [{ "start": "00:00", "end": "23:59", "overlap": false }],
        "6": [{ "start": "00:00", "end": "23:59", "overlap": false }]
      }
    },
    {
      "domain": "energy",
      "metric": "current",
      "value": 16,
      "type": "MULTIPLIER",
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
```

---

### Full example — HIDR. SCMOXUARAQ214L2 (hydrometer pulse meter: ×10 L/pulse)

A pulse-output water meter where each pulse emitted to the IoT central represents
**10 litres**. The meter reports a raw pulse count; the calibration converts it to
the real volume in litres.

```
raw reading:  1 pulse
real volume:  1 × 10 = 10 L
```

No time-windowing — the conversion factor is a physical constant of the meter model.

```json
{
  "version": 1,
  "createdAt": "2026-04-14T10:00:00Z",
  "updatedAt": "2026-04-14T10:00:00Z",
  "changelog": [
    {
      "version": 1,
      "at": "2026-04-14T10:00:00Z",
      "by": "3f9d29a0-b293-4da9-83e4-0e2bc38566c7",
      "note": "Initial setup — HIDR. SCMOXUARAQ214L2: 1 pulse = 10 litres (meter model Q214L2)"
    }
  ],
  "offsets": [
    {
      "domain": "water_flow",
      "value": 10,
      "type": "MULTIPLIER",
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
```

```
Evaluation example — any day, any time:

  Step 1: no periods → root offsets
  Step 2: domain=water_flow, schedule[*] = [00:00–23:59] → always MATCH

  Result: calibrated_volume = raw_pulses × 10
          raw = 47 pulses → calibrated = 470 L
```

---

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
9. **`power_factor` only accepts `SUM` offsets.** `MULTIPLIER` and `DIVIDER` are
   rejected with `400 CALIBRATION_INVALID_METRIC_TYPE` because `cos(φ)` is
   dimensionless — a CT ratio scales P, Q, and S linearly but never the ratio itself.
10. **`metric` is required when `domain` is `"energy"`** and must be a valid
    `EnergyMetric` value. Omitting `metric` on an energy offset is rejected with
    `400 CALIBRATION_MISSING_METRIC`.

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
| Energy sub-metrics typing | **Typed enum** `EnergyMetric = 'active_power' \| 'reactive_power' \| 'apparent_power' \| 'power_factor' \| 'current' \| 'voltage'`. `power` was intentionally split into three distinct quantities (P, Q, S) derived from the power triangle. `power_factor` is restricted to `SUM` only — `MULTIPLIER`/`DIVIDER` on a dimensionless ratio is rejected (`400 CALIBRATION_INVALID_METRIC_TYPE`). New values require an explicit RFC update. |
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
   validation rules 1–10 enforced; changelog capped at 20 on write
4. **Repository** — `calibration` field in `DeviceRepository` create/update/map;
   changelog append logic with cap enforcement
5. **Response DTO** — `calibration?: DeviceCalibration` in `DeviceResponseDTO` and
   mapped in `toDeviceResponse()`
6. **Alarm backend guide** — document period precedence evaluation algorithm
7. **Example files** — `docs/examples/device-calibration/` (temperature, energy,
   water-flow-hydrometer JSON examples)

### API surface — read endpoints

`calibration` is a standard field on the device object. It is returned by both read
endpoints without any additional query parameter:

```
GET /api/v1/devices?customerId=<id>&limit=100&cursor=100
GET /api/v1/devices/:id
```

Both endpoints share the same `mapToEntity()` → `toDeviceResponse()` pipeline in
`DeviceRepository` and `DeviceResponseDTO`. Adding `calibration` to those two
functions is sufficient to expose it everywhere devices are listed or fetched.

When a device has no calibration configured, the field is omitted from the response
(`undefined` / not serialized). When configured, the full envelope is returned:

```json
{
  "id": "fdee257f-f11d-4293-9abd-9dcdf8b30416",
  "name": "SCSDIAC-TrafoCAG",
  ...
  "calibration": {
    "version": 1,
    "createdAt": "2026-04-14T10:00:00Z",
    "updatedAt": "2026-04-14T10:00:00Z",
    "changelog": [...],
    "offsets": [...],
    "periods": [...]
  }
}
```

### API surface — write

**Open question:** whether calibration is written via the general device update
(`PATCH /devices/:id` with `calibration` in the body) or via a dedicated endpoint
(`PUT /devices/:id/calibration`).

The general update is simpler for clients but requires the changelog append logic,
cap enforcement, period conflict detection, and `autoCloseExisting` flag to live
inside `DeviceService.update()`.

A dedicated endpoint isolates all calibration business rules in a focused handler
and allows the `autoCloseExisting` flag to be a natural query/body parameter
without polluting the general update schema.

Decision deferred pending frontend integration design.

---

## Calibration bundle endpoint

Inspired by `GET /customers/:customerId/alarm-rules/bundle/simple`, this endpoint
gives the alarm backend a single, cacheable payload with all calibration data it
needs to apply corrections at read time — without querying devices individually.

### URL

```
GET /customers/:customerId/calibration/bundle
```

Auth: Customer API Key M2M (`X-API-Key: gcdr_cust_*`) — same auth as the alarm bundle.

### Request headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Central-Id` | optional | Return only devices belonging to this central |
| `X-Version-Id` | optional | If provided and matches current version → `304 Not Modified` (no body) |

### Behaviour

1. Load all devices for the customer (filtered by `X-Central-Id` if present).
2. **Exclude devices without a `calibration` field** — only calibrated devices appear.
3. Strip `changelog` from each calibration envelope — changelog is audit data, not
   needed by the alarm backend at runtime. Only `version`, `offsets`, and `periods`
   are included.
4. Compute a SHA-256 version hash from the full bundle content (deterministic —
   same calibrations always produce the same hash).
5. If `X-Version-Id` matches the hash → return `304 Not Modified`.
6. Cache result in-memory for 5 minutes (TTL invalidated when any device calibration
   is updated).
7. Sign the bundle with HMAC-SHA256 (same mechanism as alarm bundle).

### Response shape

```json
{
  "meta": {
    "version": "v1-3f9a12bc7e04",
    "generatedAt": "2026-04-14T10:00:00Z",
    "customerId": "a4c64215-f7eb-4102-80b5-e10b98e2f94e",
    "customerName": "Shopping Moxuara",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "devicesCount": 3,
    "signature": "hmac-sha256-hex...",
    "algorithm": "HMAC-SHA256",
    "ttlSeconds": 300
  },
  "devices": {
    "fdee257f-f11d-4293-9abd-9dcdf8b30416": {
      "name": "SCSDIAC-TrafoCAG",
      "centralId": "e982edf9-edb1-4aa6-8a14-4782465ae5a3",
      "slaveId": 5,
      "calibration": {
        "version": 1,
        "offsets": [
          { "domain": "energy", "metric": "active_power",   "value": 1380, "type": "MULTIPLIER", "schedule": { ... } },
          { "domain": "energy", "metric": "reactive_power", "value": 1380, "type": "MULTIPLIER", "schedule": { ... } },
          { "domain": "energy", "metric": "apparent_power", "value": 1380, "type": "MULTIPLIER", "schedule": { ... } },
          { "domain": "energy", "metric": "current",        "value": 40,   "type": "MULTIPLIER", "schedule": { ... } },
          { "domain": "energy", "metric": "voltage",        "value": 36.31,"type": "MULTIPLIER", "schedule": { ... } }
        ],
        "periods": []
      }
    },
    "b1c2d3e4-f5a6-7890-bcde-f01234567890": {
      "name": "SCSDI309C",
      "centralId": "e982edf9-edb1-4aa6-8a14-4782465ae5a3",
      "slaveId": 12,
      "calibration": {
        "version": 1,
        "offsets": [
          { "domain": "energy", "metric": "active_power",   "value": 16, "type": "MULTIPLIER", "schedule": { ... } },
          { "domain": "energy", "metric": "reactive_power", "value": 16, "type": "MULTIPLIER", "schedule": { ... } },
          { "domain": "energy", "metric": "apparent_power", "value": 16, "type": "MULTIPLIER", "schedule": { ... } },
          { "domain": "energy", "metric": "current",        "value": 16, "type": "MULTIPLIER", "schedule": { ... } }
        ],
        "periods": []
      }
    },
    "c2d3e4f5-a6b7-8901-cdef-012345678901": {
      "name": "SCMOXUARAQ214L2",
      "centralId": "e982edf9-edb1-4aa6-8a14-4782465ae5a3",
      "slaveId": 22,
      "calibration": {
        "version": 1,
        "offsets": [
          { "domain": "water_flow", "value": 10, "type": "MULTIPLIER", "schedule": { ... } }
        ],
        "periods": []
      }
    }
  }
}
```

### Differences from `/alarm-rules/bundle/simple`

| Aspect | `/alarm-rules/bundle/simple` | `/calibration/bundle` |
|--------|------------------------------|----------------------|
| Primary data | `rules` catalog + `deviceIndex` with ruleIds | `devices` with inline calibration |
| Devices included | only devices with ≥1 applicable rule | only devices with `calibration != null` |
| Changelog | n/a | stripped — runtime consumers don't need it |
| `ruleIds` | yes | no |
| `deep` param | yes (aggregates descendants) | yes (same pattern) |
| Cache TTL | 5 min, invalidated on rule/device change | 5 min, invalidated on device calibration change |
| 304 caching | `X-Version-Id` | `X-Version-Id` (same) |
| Auth | `gcdr_cust_*` | `gcdr_cust_*` (same) |

### Alarm backend usage

```
1. On startup: fetch /calibration/bundle, store version in X-Version-Id
2. On each poll (every N minutes): send X-Version-Id → 304 if unchanged
3. On 200: replace local calibration map, update stored version
4. On telemetry reading:
   a. look up device.id in calibration map
   b. if not found → no calibration, use raw value
   c. if found → run period precedence algorithm (see Reference section)
   d. apply matching offset → calibrated value
```

### Cache invalidation

When any device's `calibration` field is written (create or update), the calibration
bundle cache for that customer is invalidated — same pattern as alarm bundle
invalidation on rule or device changes.
