# RFC-0026: Device Availability Tracking

> **Status: SUPERSEDED**
>
> Este RFC foi superseded pela Alarms API Backend, que já implementa o cômputo de disponibilidade de dispositivos a partir dos alarmes `DEVICE_OFFLINE` existentes. O endpoint `GET /alarms/stats/availability` cobre availability %, MTBF, MTTR, failure count, status por device e agregado de frota — sem necessidade de nova tabela de eventos em GCDR nem de calls extras no orquestrador.
>
> Não há plano de implementação deste RFC.

- **Feature Name**: `device-availability-tracking`
- **Start Date**: 2026-03-25
- **RFC PR**: (pending)
- **Related RFCs**:
  - [RFC-0008 Device Attributes Extension](./RFC-0008-Device-Attributes-Extension.md)
  - [RFC-0024 Alarm Dispatch Configuration](./RFC-0024-Alarm-Dispatch-Config.md)

---

## Summary

Introduce a `device_availability_events` table in GCDR that records every offline/online state transition per device, fed by the alarm orchestrator as it opens and closes `DEVICE_OFFLINE` alarms. Expose a read endpoint that computes **availability %, MTBF, MTTR, and failure count** for any device over a requested time window. An optional aggregated `device_availability_stats` table provides pre-computed metrics for low-latency dashboard reads.

---

## Motivation

GCDR currently registers devices and assigns `DEVICE_OFFLINE` rules to customers, but it has no historical record of when a device was actually offline or for how long. The alarm orchestrator detects these transitions at runtime — it opens an alarm when a slave goes offline and closes it when the slave recovers — but this transient knowledge is never persisted as structured reliability data.

**Concrete gaps:**

- **No availability %**: there is no way to answer "Device X was online 98.7% of the time last month."
- **No MTBF**: the system cannot report average time between consecutive failures per device.
- **No MTTR**: there is no measurement of how long it typically takes a device to recover after going offline.
- **No failure count**: dashboards and reports cannot show how many disconnection events occurred in a period.
- **No trending**: without a history, it is impossible to detect degrading connectivity over weeks.
- **SLA reporting is blocked**: customers with connectivity SLAs have no data source to validate compliance.

The orchestrator already has all the information needed — it just does not store it. This RFC closes that gap by making GCDR the persistent store for device state transitions and the computation layer for reliability metrics.

---

## Guide-Level Explanation

### Conceptual model

Each time a device transitions between online and offline, a lightweight event record is appended to `device_availability_events`:

```
Device: Slave-42 (customer: Moxuara, central: e982edf9-...)

  OFFLINE   2026-03-01T02:14:00Z
  ONLINE    2026-03-01T02:31:00Z    ← downtime: 17 min
  OFFLINE   2026-03-15T09:05:00Z
  ONLINE    2026-03-15T09:11:00Z    ← downtime: 6 min
  OFFLINE   2026-03-20T14:30:00Z
  ONLINE    2026-03-20T14:35:00Z    ← downtime: 5 min
```

From this log, GCDR can compute for any requested window (e.g., March 2026):

```
availability  = 99.94 %
failure_count = 3
total_downtime = 28 min
mttr           = 9.3 min   (mean time to recovery)
mtbf           = 7 days    (mean time between failures)
```

### Orchestrator integration

The orchestrator calls two lightweight GCDR endpoints as part of its existing alarm lifecycle:

```
1. Slave goes OFFLINE
   → orchestrator opens alarm
   → POST /devices/:deviceId/availability-events
     { "event": "OFFLINE", "occurredAt": "2026-03-01T02:14:00Z", "centralId": "...", "slaveId": 42 }

2. Slave comes back ONLINE
   → orchestrator closes alarm
   → POST /devices/:deviceId/availability-events
     { "event": "ONLINE",  "occurredAt": "2026-03-01T02:31:00Z", "centralId": "...", "slaveId": 42 }
```

### Dashboard / reporting query

Any consumer can request device reliability metrics over a window:

```
GET /devices/:deviceId/availability?from=2026-03-01&to=2026-03-31

→ {
    "deviceId":     "uuid",
    "from":         "2026-03-01T00:00:00Z",
    "to":           "2026-03-31T23:59:59Z",
    "windowSeconds": 2678400,
    "availabilityPct": 99.94,
    "uptimeSeconds":   2676720,
    "downtimeSeconds": 1680,
    "failureCount":    3,
    "mttrSeconds":     560,
    "mtbfSeconds":     889200,
    "lastEvent":       "ONLINE",
    "lastEventAt":     "2026-03-20T14:35:00Z"
  }
```

A list endpoint allows bulk metrics for all devices of a customer:

```
GET /customers/:customerId/devices/availability?from=2026-03-01&to=2026-03-31

→ { "items": [ { "deviceId": "...", "availabilityPct": 99.94, ... }, ... ] }
```

---

## Reference-Level Explanation

### New table: `device_availability_events`

```sql
CREATE TABLE device_availability_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  customer_id uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_id   uuid        NOT NULL REFERENCES devices(id)   ON DELETE CASCADE,
  central_id  uuid        NOT NULL,
  slave_id    integer     NOT NULL,
  event       varchar(10) NOT NULL CHECK (event IN ('OFFLINE', 'ONLINE')),
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dae_device_time_idx    ON device_availability_events (device_id, occurred_at DESC);
CREATE INDEX dae_customer_time_idx  ON device_availability_events (customer_id, occurred_at DESC);
CREATE INDEX dae_central_time_idx   ON device_availability_events (central_id, occurred_at DESC);
CREATE INDEX dae_tenant_time_idx    ON device_availability_events (tenant_id, occurred_at DESC);
```

**Notes:**
- `occurred_at` is the timestamp reported by the orchestrator (heartbeat time), not `created_at`.
- No `rule_id` foreign key — events are device-scoped, not rule-scoped.
- `slave_id` is stored for reference even though `device_id` resolves the device, to aid debugging.

### Optional aggregated table: `device_availability_stats`

Pre-computed rolling stats updated incrementally by the orchestrator on each event. Allows O(1) dashboard reads without scanning `device_availability_events`.

```sql
CREATE TABLE device_availability_stats (
  device_id          uuid        PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  tenant_id          uuid        NOT NULL,
  customer_id        uuid        NOT NULL,
  last_event         varchar(10) NOT NULL DEFAULT 'ONLINE',
  last_event_at      timestamptz,
  total_events       integer     NOT NULL DEFAULT 0,
  -- rolling 30-day window (updated on each new event)
  failure_count_30d  integer     NOT NULL DEFAULT 0,
  downtime_secs_30d  bigint      NOT NULL DEFAULT 0,
  mttr_secs_30d      integer,
  mtbf_secs_30d      integer,
  availability_pct_30d numeric(5, 2),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

This table is optional for Phase 1 and can be added in Phase 2 if query performance on `device_availability_events` becomes a concern.

### Drizzle schema

```typescript
// src/infrastructure/database/drizzle/schema.ts

export const deviceAvailabilityEventTypeEnum = pgEnum(
  'device_availability_event_type',
  ['OFFLINE', 'ONLINE']
);

export const deviceAvailabilityEvents = pgTable('device_availability_events', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  deviceId:   uuid('device_id').notNull().references(() => devices.id,   { onDelete: 'cascade' }),
  centralId:  uuid('central_id').notNull(),
  slaveId:    integer('slave_id').notNull(),
  event:      deviceAvailabilityEventTypeEnum('event').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt:  timestamp('created_at',  { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  deviceTimeIdx:   index('dae_device_time_idx').on(table.deviceId,   table.occurredAt),
  customerTimeIdx: index('dae_customer_time_idx').on(table.customerId, table.occurredAt),
  centralTimeIdx:  index('dae_central_time_idx').on(table.centralId,  table.occurredAt),
  tenantTimeIdx:   index('dae_tenant_time_idx').on(table.tenantId,   table.occurredAt),
}));
```

### API Endpoints

#### Write (orchestrator → GCDR)

```
POST /api/v1/devices/:deviceId/availability-events
```

Auth: `X-API-Key: gcdr_alarm_integration_key_*` (existing orchestrator API key).

```json
// Request
{
  "event":       "OFFLINE",
  "occurredAt":  "2026-03-01T02:14:00Z",
  "centralId":   "e982edf9-edb1-4aa6-8a14-4782465ae5a3",
  "slaveId":     42
}

// Response 201
{
  "id":          "uuid",
  "deviceId":    "uuid",
  "event":       "OFFLINE",
  "occurredAt":  "2026-03-01T02:14:00Z"
}
```

Validation rules:
- `event` must be `OFFLINE` or `ONLINE`.
- `occurredAt` must not be in the future (max clock skew: 60 s).
- Duplicate detection: if the last recorded event for the device is already the same `event` type, the request is accepted with `200 OK` (idempotent) but not inserted again.

#### Read (dashboard / reports)

```
GET /api/v1/devices/:deviceId/availability?from=<ISO>&to=<ISO>
GET /api/v1/customers/:customerId/devices/availability?from=<ISO>&to=<ISO>&page=1&limit=50
GET /api/v1/devices/:deviceId/availability-events?from=<ISO>&to=<ISO>&page=1&limit=100
```

Auth: `Authorization: Bearer <jwt>` (standard GCDR RBAC).

#### Availability metrics computation (SQL sketch)

```sql
-- Compute downtime seconds within [from, to] for a given device
WITH events AS (
  SELECT
    event,
    occurred_at,
    LEAD(occurred_at) OVER (ORDER BY occurred_at) AS next_at
  FROM device_availability_events
  WHERE device_id  = $deviceId
    AND occurred_at BETWEEN $from AND $to
  ORDER BY occurred_at
)
SELECT
  COUNT(*) FILTER (WHERE event = 'OFFLINE')         AS failure_count,
  COALESCE(SUM(
    CASE WHEN event = 'OFFLINE' AND next_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (next_at - occurred_at))
    END
  ), 0)::bigint                                     AS downtime_seconds
FROM events;
```

MTTR = `downtime_seconds / failure_count`
MTBF = `(window_seconds - downtime_seconds) / failure_count`
Availability % = `(window_seconds - downtime_seconds) / window_seconds * 100`

### Migration

- **Migration 0018**: `0018_device_availability_events.sql` — creates `device_availability_events` table, `device_availability_event_type` enum, and all indexes.
- No data migration needed — history begins accumulating from the moment the orchestrator starts posting events.

### Orchestrator changes

Two POST calls are added to the existing alarm lifecycle hooks:

```
openAlarm(deviceId, ...)  → POST /devices/:deviceId/availability-events { event: "OFFLINE" }
closeAlarm(deviceId, ...) → POST /devices/:deviceId/availability-events { event: "ONLINE"  }
```

Failure of the GCDR call must **not** block alarm dispatch — the orchestrator should fire-and-forget or retry asynchronously. Availability tracking is an analytics concern, not a control-path concern.

---

## Drawbacks

- **Unbounded table growth**: `device_availability_events` grows forever. For flapping devices (repeated offline/online in a short window), this could accumulate thousands of rows per day. A retention policy (e.g., delete events older than 12 months) or partitioning by month is advisable before production rollout at scale.

- **Orchestrator coupling**: adding two GCDR calls to the alarm lifecycle slightly increases orchestrator latency and creates a new external dependency. A network partition between orchestrator and GCDR would cause availability events to be silently dropped unless retry logic is implemented.

- **Clock skew**: `occurredAt` comes from the orchestrator's system clock. If the orchestrator clock drifts relative to GCDR's clock, computed durations can be slightly inaccurate. NTP synchronization across services mitigates this.

- **Slave-to-device resolution lag**: the orchestrator resolves `slaveId → deviceId` via `GET /devices?centralId=...` before posting availability events. If a new device is registered mid-session and the orchestrator has a stale device map, events for that device may be dropped until the next cache refresh.

---

## Rationale and Alternatives

### Why persist events instead of computing from alarm history?

Alarm records are ephemeral operational artifacts — they may be deleted, archived, or moved to cold storage. Events in `device_availability_events` are compact, append-only, and purpose-built for time-series metric queries. Keeping concerns separate also lets the alarm system evolve without breaking availability reporting.

### Why not push events to a time-series database (InfluxDB, TimescaleDB)?

The GCDR ecosystem uses PostgreSQL exclusively. Introducing a second database engine adds operational burden (backup, auth, monitoring) and a new skill requirement. A standard PostgreSQL table with a `timestamptz` index is sufficient for the expected event volume (devices × events/day × retention period). TimescaleDB hypertables are noted as a future migration path if partitioning becomes necessary.

### Why not store a single `device_status` row updated in-place instead of an event log?

An in-place status row only answers "is the device online right now?" It cannot answer "how many times did this device go offline last quarter?" or "what was the longest outage in the past 6 months?" An event log is the minimal structure that supports both current-status reads and historical analysis.

### Why not compute metrics in the orchestrator and push them to GCDR?

The orchestrator is a control-plane service; GCDR is the data plane. Coupling metric computation to the orchestrator means reports are only as accurate as the orchestrator's in-memory state and lifetime. GCDR can recompute any metric from its event log at any time, including retroactively, which the orchestrator cannot.

### Why `occurred_at` vs `created_at` as the event timestamp?

`created_at` reflects when the row was inserted into GCDR. Network latency or retry backoff between the orchestrator and GCDR could shift this by seconds or minutes. `occurred_at` is the authoritative timestamp from the heartbeat processing moment, making downtime calculations accurate regardless of API latency.

---

## Unresolved Questions

1. **Retention policy**: what is the maximum history retention for `device_availability_events`? 6 months? 12 months? Should old events be archived to cold storage or simply deleted? A decision is required before production data grows significantly.

2. **Partition strategy**: should the table be range-partitioned by `occurred_at` month from day one, or is a simple index sufficient until a volume threshold is reached? Partitioning adds DDL complexity but avoids a painful migration later.

3. **Missing ONLINE close event**: if a device goes offline and is never confirmed online (e.g., permanently decommissioned), the last OFFLINE event has no matching ONLINE. How should the availability computation treat an open-ended offline period — as ongoing downtime up to `now()`, or capped at `to`?

4. **Orchestrator retry contract**: if the orchestrator fails to POST an event to GCDR (network error, 5xx), what is the retry window and backlog limit? Should undelivered events be queued locally and replayed, or dropped?

5. **Bulk ingest endpoint**: for customers with hundreds of slaves, a single heartbeat may trigger many simultaneous state transitions. Should a bulk endpoint `POST /devices/availability-events/batch` be provided to reduce HTTP overhead?

6. **Access control**: should customers be able to read their own device availability metrics, or is this an internal/admin-only view? If customers can access it, which RBAC permission guards these endpoints?

7. **Aggregated stats table (Phase 2)**: is `device_availability_stats` in scope for the initial implementation, or deferred? Pre-computed stats significantly improve dashboard load time but add update complexity on the write path.

---

## Future Possibilities

- **SLA contract enforcement**: link availability metrics to SLA rules (`MAINTENANCE_WINDOW` + target uptime %) and automatically generate breach alerts when availability falls below the contracted threshold.
- **TimescaleDB migration**: if event volume exceeds PostgreSQL's comfortable range, migrate `device_availability_events` to a TimescaleDB hypertable with automatic chunk compression, keeping the same API surface.
- **Streaming metrics**: expose a Server-Sent Events (SSE) endpoint `GET /devices/:deviceId/availability/stream` so dashboards receive live availability updates without polling.
- **Anomaly detection**: detect devices whose downtime frequency is increasing week-over-week and surface them as predictive maintenance candidates.
- **Export**: `GET /customers/:customerId/devices/availability/export?format=csv&from=...&to=...` for monthly SLA reports delivered to customer administrators.
- **Correlation with alarm types**: cross-reference `device_availability_events` with other alarm types (threshold breaches, SLA violations) to identify devices that go offline during peak load, suggesting power or connectivity issues.
