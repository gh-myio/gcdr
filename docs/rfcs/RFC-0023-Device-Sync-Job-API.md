# RFC-0023 — Device Sync Job API

- **Feature name:** `device-sync-job-api`
- **Start date:** 2026-03-10
- **Status:** Draft
- **Authors:** MYIO Platform Team

---

## Summary

Introduce a first-class async Job API within GCDR that replicates the full
pipeline currently executed by the shell scripts in
`scripts/api/engine-check-inconformidades/` — conformity check, action-plan
classification, relocation detection, device relocation, field patching, and
device creation — as a single HTTP-initiated background job with live status
polling and a structured log endpoint.

---

## Motivation

The existing shell-script pipeline (`run-all.sh` → `apply-updates.sh` →
`consolidate-creates.sh`) works well for ad-hoc operator use but has several
limitations that block wider adoption:

1. **Operator dependency.** Every sync requires an operator with shell access,
   the correct `config.env`, and all seven `device-map-*.txt` files on disk.

2. **No observability.** Progress is visible only in the terminal; logs are
   local `.log` files with no API surface.

3. **Slow feedback loop.** The scripts call the GCDR REST API over HTTPS for
   every individual device operation — one HTTP round-trip per `PATCH` or
   `POST`. A 200-device sync involves 200+ outbound HTTP calls.

4. **Non-replayable.** Re-running after a partial failure requires manual
   inspection of the log to know which devices succeeded.

5. **Not embeddable.** Third-party integrations (e.g. ThingsBoard sync
   automation, Node-RED flows) cannot trigger or monitor a sync without shell
   access.

This RFC proposes moving the pipeline into GCDR as an internal service, making
it callable via a standard REST endpoint, executing all repository operations
in-process (no self-HTTP), and persisting a structured log queryable by job ID.

---

## Guide-level explanation

### Starting a sync job

An operator (or automated system) submits a multipart or JSON request:

```http
POST /api/v1/device-sync/jobs
X-API-Key: gcdr_pk_...
Content-Type: application/json

{
  "customerId":      "a4c64215-f7eb-4102-80b5-e10b98e2f94e",
  "defaultAssetId":  "3b7f1e20-0000-0000-0000-000000000001",
  "dryRun":          false,
  "files": [
    {
      "name":    "energy-commonarea",
      "content": "tbId|deviceName|label|identifier|deviceType|deviceProfile|slaveId|centralId|gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt\n64fb3820-...|3F SCMSROOFTOP 07|ROOFTOP 7|CAG|..."
    },
    {
      "name":    "water-stores",
      "content": "..."
    }
  ]
}
```

The server responds immediately with `202 Accepted`:

```json
{
  "success": true,
  "data": {
    "jobId":  "d3b8a1f0-0000-0000-0000-000000000099",
    "status": "QUEUED"
  }
}
```

### Polling job status

```http
GET /api/v1/device-sync/jobs/d3b8a1f0-...
X-API-Key: gcdr_pk_...
```

```json
{
  "success": true,
  "data": {
    "jobId":        "d3b8a1f0-...",
    "status":       "RUNNING",
    "currentPhase": "APPLY_UPDATES",
    "dryRun":       false,
    "summary": {
      "check": {
        "conformant": 120,
        "divergent":   37,
        "notLinked":    4
      },
      "actionPlan": {
        "create":           0,
        "update":          28,
        "updateIdentifier": 9,
        "skip":           120
      },
      "detectRelocations": {
        "relocate":        0,
        "genuineCreates":  0
      },
      "relocate":           { "ok": 0, "fail": 0 },
      "applyUpdates":       { "ok": 21, "fail": 0 },
      "consolidateCreates": { "ok": 0,  "fail": 0 }
    },
    "createdAt":   "2026-03-10T18:00:00.000Z",
    "updatedAt":   "2026-03-10T18:00:04.123Z",
    "completedAt": null,
    "durationMs":  null
  }
}
```

`status` values: `QUEUED` → `RUNNING` → `DONE` | `PARTIAL` | `FAILED`

### Retrieving the full log

```http
GET /api/v1/device-sync/jobs/d3b8a1f0-.../log
X-API-Key: gcdr_pk_...
```

```json
{
  "success": true,
  "data": {
    "jobId":  "d3b8a1f0-...",
    "status": "DONE",
    "entries": [
      { "ts": "2026-03-10T18:00:00.100Z", "phase": "CHECK",        "level": "INFO",  "message": "Fetching devices for customer a4c64215 — 179 devices loaded" },
      { "ts": "2026-03-10T18:00:00.850Z", "phase": "CHECK",        "level": "INFO",  "message": "energy-commonarea: 120 CONFORMANT, 21 DIVERGENT, 0 NOT_LINKED" },
      { "ts": "2026-03-10T18:00:01.200Z", "phase": "ACTION_PLAN",  "level": "INFO",  "message": "Classified 21 UPDATE, 9 UPDATE_IDENTIFIER, 120 SKIP" },
      { "ts": "2026-03-10T18:00:02.400Z", "phase": "APPLY_UPDATES","level": "OK",    "message": "3F SCMSROOFTOP 07 — patched: displayName, identifier, label" },
      { "ts": "2026-03-10T18:00:02.401Z", "phase": "APPLY_UPDATES","level": "FAIL",  "message": "3F MOTR. SCMSAC-AR4_L1 — Not found" },
      { "ts": "2026-03-10T18:00:04.800Z", "phase": "DONE",         "level": "INFO",  "message": "Job complete — 37 OK, 0 FAIL" }
    ]
  }
}
```

`level` values per entry: `INFO` | `WARN` | `OK` | `FAIL` | `ERROR`

---

## Reference-level explanation

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/device-sync/jobs` | Partner API Key | Create and enqueue a new sync job |
| `GET` | `/api/v1/device-sync/jobs/:jobId` | Partner API Key | Get job status and per-phase summary |
| `GET` | `/api/v1/device-sync/jobs/:jobId/log` | Partner API Key | Get full structured log |
| `GET` | `/api/v1/device-sync/jobs` | Partner API Key | List jobs (paginated, filterable by customerId/status) |

All endpoints require a **Partner API Key** (`gcdr_pk_*`) and are scoped to
the tenant derived from that key.

### Database — `device_sync_jobs`

```sql
CREATE TABLE device_sync_jobs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  customer_id      UUID        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'QUEUED',
    -- QUEUED | RUNNING | DONE | PARTIAL | FAILED
  current_phase    TEXT        NOT NULL DEFAULT 'QUEUED',
    -- QUEUED | CHECK | ACTION_PLAN | DETECT_RELOCATIONS
    -- | RELOCATE | APPLY_UPDATES | CONSOLIDATE_CREATES | DONE
  dry_run          BOOLEAN     NOT NULL DEFAULT FALSE,
  input_config     JSONB       NOT NULL DEFAULT '{}',
    -- { defaultAssetId: string }
  input_files      JSONB       NOT NULL DEFAULT '[]',
    -- [{ name: string, content: string }]
  phases_summary   JSONB       NOT NULL DEFAULT '{}',
    -- { check: {...}, actionPlan: {...}, ... }
  log_entries      JSONB       NOT NULL DEFAULT '[]',
    -- [{ ts, phase, level, message }]
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX device_sync_jobs_tenant_customer_idx
  ON device_sync_jobs (tenant_id, customer_id);

CREATE INDEX device_sync_jobs_tenant_status_idx
  ON device_sync_jobs (tenant_id, status);
```

### Request schema (`POST /device-sync/jobs`)

```typescript
const DeviceSyncFileSchema = z.object({
  name:    z.string().min(1).max(255),  // logical name, no extension needed
  content: z.string().min(1),           // raw pipe-delimited text
});

const CreateDeviceSyncJobSchema = z.object({
  customerId:     z.string().uuid(),
  defaultAssetId: z.string().uuid().optional(),
  dryRun:         z.boolean().default(false),
  files:          z.array(DeviceSyncFileSchema).min(1).max(20),
});
```

### Device-map file format

Same pipe-delimited format used by the shell scripts — no migration required
for existing device-map files:

```
tbId|deviceName|label|identifier|deviceType|deviceProfile|slaveId|centralId|gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt
```

Lines starting with `[` or blank lines are ignored (section headers).

### Pipeline phases

Each phase is a pure TypeScript function that receives the accumulated job
state and returns an updated state. All repository calls go directly to the
database — no outbound HTTP to `localhost`.

#### Phase 1 — CHECK

1. Parse all `files[*].content` into in-memory device records.
2. Collect all unique customer UUIDs from column 9 (`gcdrCustomerId`) and
   from `customerId` in the job config.
3. Bulk-fetch all devices per customer via `DeviceRepository.findByCustomerId()`.
4. For each device in the file, resolve against the in-memory GCDR dataset:
   - By `gcdrDeviceId` (column 11) → exact match on `id`
   - By `tbId` (column 1) → match on `externalId`
   - By `identifier` (column 4) → case-insensitive match
5. Classify each device as `CONFORMANT`, `DIVERGENT`, or `NOT_LINKED`.
6. Emit one log entry per device + one summary entry per file.

#### Phase 2 — ACTION_PLAN

For each `DIVERGENT` or `NOT_LINKED` device from Phase 1:

| Status | Divergences | Action |
|---|---|---|
| `NOT_LINKED` | — | `CREATE` |
| `DIVERGENT` | only `identifier` | `UPDATE_IDENTIFIER` |
| `DIVERGENT` | other fields | `UPDATE` |
| `CONFORMANT` | — | `SKIP` |

#### Phase 3 — DETECT_RELOCATIONS

For each `CREATE` action:
1. Query `DeviceRepository.findByExternalId(tenantId, tbId)`.
2. If found in a different customer → reclassify as `RELOCATE`.
3. Else query `DeviceRepository.findByCentralAndSlave(tenantId, centralId, slaveId)`.
4. If found in a different customer → reclassify as `RELOCATE`.
5. Remaining `CREATE`s are genuine new devices.

#### Phase 4 — RELOCATE

For each `RELOCATE` device:
- Call `DeviceRepository.move(tenantId, deviceId, targetAssetId, targetCustomerId, systemUserId)`.
- Log `OK` or `FAIL` per device.

If `dryRun = true`, log the intended operation without calling the repository.

#### Phase 5 — APPLY_UPDATES

For each `UPDATE` and `UPDATE_IDENTIFIER` device:
- Build a patch object containing only TB-owned divergent fields
  (`identifier`, `label`, `displayName`, `deviceProfile`, `slaveId`, `externalId`).
- Call `DeviceRepository.update(tenantId, deviceId, patch, systemUserId)`.
- Log `OK` or `FAIL` per device.

Fields **never patched**: `customerId`, `assetId`, `centralId` (GCDR-owned).

If `dryRun = true`, log without writing.

#### Phase 6 — CONSOLIDATE_CREATES

For each genuine `CREATE` device:
- Build a `CreateDeviceDTO` from the device-map line.
- Fall back to `defaultAssetId` when column 10 (`gcdrAssetId`) is empty.
- Call `DeviceRepository.create(tenantId, dto, systemUserId)`.
- Log `OK` (with the new `gcdrDeviceId`) or `FAIL` per device.

If `dryRun = true`, log without writing.

### Execution model

Jobs execute asynchronously using Node.js's event loop — no external queue or
worker process is required:

```typescript
// controller
const job = await syncJobService.create(tenantId, dto);
setImmediate(() => syncJobService.run(job.id).catch(console.error));
res.status(202).json(sendCreated(res, { jobId: job.id, status: 'QUEUED' }));
```

`syncJobService.run()` runs each phase sequentially, persisting `current_phase`,
`phases_summary`, and `log_entries` to the database after every phase so that
callers polling `GET /jobs/:jobId` see live progress.

### Job status transitions

```
QUEUED ──► RUNNING ──► DONE
                  └──► PARTIAL   (completed with ≥1 FAIL entries)
                  └──► FAILED    (fatal error — exception thrown in a phase)
```

`PARTIAL` is used when the job ran to completion but one or more individual
device operations failed. Callers can inspect `log_entries` filtered by
`level=FAIL` to identify which devices need attention.

### Authorization

- Endpoint accepts **Partner API Keys** (`gcdr_pk_*`) only.
- The `tenantId` and permission scope are derived from the API key, consistent
  with all other protected endpoints.
- A job is only readable by keys belonging to the same tenant.

---

## Drawbacks

1. **In-process async.** Using `setImmediate` means a server restart loses
   in-flight jobs mid-execution. Jobs remain `RUNNING` in the database until
   manually resolved. A future RFC may introduce a proper job queue (BullMQ).

2. **Large `log_entries` JSONB.** For a 500-device sync with 7 files, the log
   array may grow to several hundred entries. A future improvement is to store
   logs in a separate `device_sync_job_logs` table with an index on `job_id`.

3. **File content in DB.** Storing raw device-map file content in `input_files`
   JSONB is convenient but increases row size. Files should be capped at 20 and
   `content` at 500 KB per file.

---

## Rationale and alternatives

### Alternative A — Keep shell scripts, add a webhook trigger

Add a thin `/trigger-sync` endpoint that writes the files to disk and spawns
the shell scripts as a child process. Simpler to implement but inherits all
observability and replayability limitations of the current approach.

**Rejected** because it ties GCDR to a filesystem layout and does not solve
the HTTP-overhead or the log-accessibility problems.

### Alternative B — External job queue (BullMQ + Redis)

Use BullMQ for proper job scheduling, retries, and worker isolation.
More robust but introduces a Redis dependency that the current GCDR deployment
does not have.

**Deferred** to a follow-up RFC once in-process jobs prove the value of the
feature.

### Chosen approach

In-process async with `setImmediate` + direct repository calls. Zero new
infrastructure dependencies, significant performance improvement over shell
scripts (no self-HTTP), and full observability via structured DB logs.

---

## Prior art

- **`scripts/api/engine-check-inconformidades/`** — the shell-script pipeline
  this RFC supersedes. All logic and file formats are preserved.
- **Sidekiq (Ruby), BullMQ (Node.js), Celery (Python)** — established patterns
  for background job processing. This RFC intentionally avoids their
  infrastructure requirements for the initial implementation.
- **GitHub Actions job steps** — the phase/step model mirrors how CI pipelines
  expose per-step status and logs, which informed the `current_phase` and
  `log_entries` design.

---

## Unresolved questions

1. **Job retention policy.** How long should completed jobs be kept in the
   database? 30 days? Configurable per tenant?

2. **Concurrent jobs.** Should GCDR allow multiple simultaneous sync jobs for
   the same `customerId`? Or enforce a single active job per customer to avoid
   conflicting writes?

3. **File upload vs. inline content.** The current design uses inline
   `content` strings in JSON. Should we support multipart file uploads instead
   for very large device-map files?

4. **Retry endpoint.** Should `POST /jobs/:jobId/retry` re-run only the failed
   phases, or always re-run the full pipeline from `CHECK`?

5. **`systemUserId`** for audit trail. Jobs write devices on behalf of a system
   principal. Should a dedicated system user ID be used, or the API key owner's
   user ID?

---

## Future possibilities

- **Webhook on completion.** `POST` a configurable callback URL when the job
  reaches `DONE` or `PARTIAL`.
- **Scheduled sync.** Add a cron-like `schedule` field to
  `POST /device-sync/jobs` so the pipeline runs automatically (e.g. nightly).
- **BullMQ migration.** Replace `setImmediate` with a proper queue once Redis
  is part of the infrastructure.
- **Diff preview endpoint.** `POST /device-sync/jobs` with `dryRun: true`
  returns a full preview of all planned operations without writing anything —
  useful for UI-based operator approval flows.
- **Per-file streaming log.** Stream `log_entries` via Server-Sent Events
  during job execution instead of requiring polling.
