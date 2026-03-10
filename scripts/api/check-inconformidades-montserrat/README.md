# check-inconformidades

Toolset for investigating and resolving device registration non-conformities between ThingsBoard and GCDR.

---

## Scripts overview

| Script | Purpose |
|---|---|
| `check-inconformidades.sh` | Runs the conformity check for a single device-map file → produces a JSON report |
| `run-all.sh` | Full pipeline: runs Steps 1–3 sequentially (check → action-plan → relocation detection) |
| `generate-action-plan.sh` | Reads all `inconformidades-report-*.json` → produces one `action-plan-*.json` per report |
| `detect-relocations.sh` | Reads all `action-plan-*.json` CREATEs → queries GCDR to find devices in the wrong customer → produces `relocation-plan-*.json` |
| `relocate-devices.sh` | Reads the latest `relocation-plan-*.json` → PATCHes `customerId`/`assetId` to move devices to the correct customer |
| `consolidate-creates.sh` | Reads all `action-plan-*.json` → POSTs each genuine CREATE to GCDR → builds a consolidated TXT with real `gcdrDeviceId` |
| `apply-updates.sh` | Reads all `action-plan-*.json` → PATCHes UPDATE + UPDATE_IDENTIFIER actions to GCDR |

---

## End-to-end workflow

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                        INPUT — device-map files                     │
 │                                                                     │
 │  device-map-energy-...-energy-entry.txt        (Energy · Entry)     │
 │  device-map-energy-...-energy-commonarea.txt   (Energy · Common)    │
 │  device-map-energy-...-energy-stores.txt       (Energy · Stores)    │
 │  device-map-water-...-water-entry.txt          (Water  · Entry)     │
 │  device-map-water-...-water-commonarea.txt     (Water  · Common)    │
 │  device-map-water-...-water-stores.txt         (Water  · Stores)    │
 │  device-map-temperature-...-temperature-commonarea.txt  (Temp)      │
 └──────────────────────────────┬──────────────────────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │      run-all.sh        │  ← orchestrates Steps 1-3
                    │  (or per-file with     │
                    │  check-inconfor-.sh)   │
                    └──────┬────────┬────────┘
                           │        │
              ─────────────┘        └─────────────────────
             Step 1                                  Steps 2+3
              │                                       (auto after checks)
              │  bulk-fetch GCDR devices per customer
              │  compare in memory
              │
 ┌────────────▼───────────────────────────────┐
 │   inconformidades-report-device-map-*.json  │
 │                                             │
 │  per device:                                │
 │    CONFORMANT  → all fields match           │
 │    DIVERGENT   → fields differ              │
 │    NOT_LINKED  → not found in GCDR          │
 └────────────┬───────────────────────────────┘
              │
 ┌────────────▼──────────────┐
 │   generate-action-plan.sh │  ← Step 2 (auto via run-all.sh)
 └────────────┬──────────────┘
              │  classify each device
              │
 ┌────────────▼──────────────────────────────────────┐
 │         action-plan-device-map-*.json              │
 │                                                    │
 │  CREATE            → device missing in GCDR        │
 │  UPDATE            → fields diverging (real diff)  │
 │  UPDATE_IDENTIFIER → only identifier has suffix    │
 │  SKIP              → conformant, no action needed  │
 └──────┬──────────────────────┬─────────────────────┘
        │ CREATE               │ UPDATE + UPDATE_IDENTIFIER
        │                      │
        │    ┌─────────────────▼──────────────┐
        │    │   detect-relocations.sh         │  ← Step 3 (auto via run-all.sh)
        │    │   queries GCDR by externalId    │
        │    │   and centralId+slaveId         │
        │    └─────────────────┬──────────────┘
        │                      │
        │    ┌─────────────────▼──────────────────────────┐
        │    │        relocation-plan-*.json               │
        │    │                                             │
        │    │  RELOCATE → device exists in wrong customer │
        │    └─────────────────┬──────────────────────────┘
        │                      │
        │          ┌───────────▼────────────┐
        │          │  relocate-devices.sh   │  PATCH customerId + assetId
        │          │  (dry-run available)   │
        │          └────────────────────────┘
        │
        │  (genuine CREATEs only — after relocations resolved)
        │
 ┌──────▼──────────┐         ┌────────────────────────┐
 │consolidate-      │         │   apply-updates.sh     │
 │creates.sh        │         │  PATCH /api/v1/devices │
 │POST /api/v1/     │         │  TB-owned fields only  │
 │devices           │         │  (dry-run available)   │
 │(dry-run avail.)  │         └────────────┬───────────┘
 └──────┬───────────┘                      │
        │                                  │
 ┌──────▼──────────────────┐  ┌────────────▼────────────────┐
 │  consolidated-creates-  │  │  apply-updates-*.log        │
 │  *.txt                  │  │                             │
 │                         │  │  timestamp|action|          │
 │  gcdrDeviceId|assetId|  │  │  gcdrDeviceId|deviceName|   │
 │  central_id|slave_id|   │  │  status|fields_patched|err  │
 │  name|display_name|tbId │  └─────────────────────────────┘
 └─────────────────────────┘
```

---

## config.env

Each customer directory contains a `config.env` file that overrides defaults for all scripts. Environment variables set in the shell still take precedence.

```bash
# API key used by all scripts
GCDR_API_KEY=gcdr_myio_tenant_bundle_key_2026

# GCDR customer UUID — used when device-map files don't have gcdrCustomerId (column 9)
GCDR_CUSTOMER_ID=<uuid>

# Fallback asset UUID — used by consolidate-creates.sh when gcdrAssetId (column 10) is empty
DEFAULT_GCDR_ASSET_ID=<uuid>

# Uncomment to target a different environment
# GCDR_API_URL=https://gcdr-api.a.myio-bas.com
```

---

## Input file format

All `device-map-*.txt` files use the same pipe-delimited header:

```
tbId|deviceName|label|identifier|deviceType|deviceProfile|slaveId|centralId|gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt
```

| Column | Source | Description |
|---|---|---|
| `tbId` | ThingsBoard | Device UUID in ThingsBoard |
| `deviceName` | ThingsBoard | Device name |
| `label` | TB `server_scope` | Short label |
| `identifier` | TB `server_scope` | Legacy system identifier |
| `deviceType` | TB `server_scope` | Device type |
| `deviceProfile` | TB `server_scope` | Device profile slug |
| `slaveId` | TB `server_scope` | Modbus slave ID |
| `centralId` | TB `server_scope` | UUID of the GCDR central/gateway |
| `gcdrCustomerId` | TB `server_scope` | Expected GCDR customer UUID (overridden by `GCDR_CUSTOMER_ID` in config.env when empty) |
| `gcdrAssetId` | TB `server_scope` | Expected GCDR asset UUID (overridden by `DEFAULT_GCDR_ASSET_ID` in config.env when empty) |
| `gcdrDeviceId` | TB `server_scope` | Known GCDR device UUID (if synced) |
| `gcdrSyncAt` | TB `server_scope` | ISO timestamp of last sync |

Blank lines and lines starting with `[` are ignored.

---

## Device map files

| File | Domain | Scope |
|---|---|---|
| `device-map-energy-2026-03-10-energy-entry.txt` | Energy | Entry point |
| `device-map-energy-2026-03-10-energy-commonarea.txt` | Energy | Common areas |
| `device-map-energy-2026-03-10-energy-stores.txt` | Energy | Stores |
| `device-map-water-2026-03-10-water-entry.txt` | Water | Entry point |
| `device-map-water-2026-03-10-water-commonarea.txt` | Water | Common areas |
| `device-map-water-2026-03-10-water-stores.txt` | Water | Stores |
| `device-map-temperature-2026-03-10-temperature-commonarea.txt` | Temperature | Common areas |

---

## Step 1 — check-inconformidades.sh

Bulk-fetches all GCDR devices per customer and compares them in memory — one API call per customer instead of one per device.

```bash
# Single file
./check-inconformidades.sh --file device-map-energy-2026-03-10-energy-commonarea.txt

# With JWT auth
./check-inconformidades.sh --file device-map-water-2026-03-10-water-stores.txt --auth jwt

# Against local dev server
GCDR_API_URL=http://localhost:3015 ./check-inconformidades.sh --file device-map-energy-2026-03-10-energy-entry.txt
```

**Output:** `inconformidades-report-<input-basename>-<timestamp>.json`

**Device status values:**

| Status | Meaning |
|---|---|
| `CONFORMANT` | All compared fields match |
| `DIVERGENT` | Device found in GCDR but one or more fields differ |
| `NOT_LINKED` | Device not found in GCDR by any lookup method (may be in wrong customer — see `detect-relocations.sh`) |

**Device resolution order:**

1. `gcdrDeviceId` → exact match on GCDR `id`
2. `tbId` → match on GCDR `externalId`
3. `identifier` → case-insensitive exact match on GCDR `identifier`
4. None found → `NOT_LINKED`

> **Note:** The bulk-fetch is scoped to the customer IDs found in the device-map files (column 9) plus `GCDR_CUSTOMER_ID` from `config.env`. Devices belonging to a different customer will appear as `NOT_LINKED` and should be handled by `detect-relocations.sh`.

**Fields compared:**

| Field | Flagged when |
|---|---|
| `label` | TB value non-empty and differs from GCDR |
| `deviceProfile` | TB value non-empty and differs from GCDR |
| `slaveId` | TB value is numeric and differs from GCDR |
| `centralId` | TB value non-empty and differs from GCDR |
| `customerId` | `gcdrCustomerId` attr differs from GCDR `customerId` |
| `assetId` | `gcdrAssetId` attr differs from GCDR `assetId` |
| `externalId` | GCDR `externalId` doesn't match TB `tbId` |
| `identifier` | Both non-empty and differ (case-insensitive) |

**Exit codes:** `0` = all conformant · `2` = divergences/missing found · `1` = fatal error

---

## Step 2 — run-all.sh

Orchestrates the full pipeline: runs the conformity check for all `device-map-*.txt` files, then automatically calls `generate-action-plan.sh` and `detect-relocations.sh`.

```bash
./run-all.sh

# With JWT
./run-all.sh --auth jwt

# Checks only (skip action-plan and relocation detection)
./run-all.sh --checks-only

# Against local
GCDR_API_URL=http://localhost:3015 ./run-all.sh
```

All flags (except `--checks-only`) are forwarded to each `check-inconformidades.sh` invocation.

**Pipeline steps executed:**

| Step | Script | Skipped with `--checks-only` |
|---|---|---|
| 1 | `check-inconformidades.sh` × N files | — |
| 2 | `generate-action-plan.sh` | ✅ |
| 3 | `detect-relocations.sh` | ✅ |

---

## Step 3 — generate-action-plan.sh

Reads all `inconformidades-report-device-map-*.json` and classifies each device into an action:

| Status | Divergences | Action | Has `line`? |
|---|---|---|---|
| `NOT_LINKED` | — | `CREATE` | ✅ insert line |
| `DIVERGENT` | only `identifier` | `UPDATE_IDENTIFIER` | ❌ |
| `DIVERGENT` | other fields | `UPDATE` | ❌ |
| `CONFORMANT` | — | `SKIP` | ❌ |

```bash
./generate-action-plan.sh

# From a different directory
./generate-action-plan.sh --reports-dir /path/to/reports
```

**Output:** `action-plan-<basename>.json` per report, structured as:

```json
{
  "meta": {
    "generatedAt": "...",
    "sourceReport": "inconformidades-report-device-map-energy-....json",
    "summary": { "create": 2, "update": 4, "update_identifier": 59, "skip": 3 }
  },
  "actions": {
    "create":            [{ "action": "CREATE", "line": "...", "tbId": "...", ... }],
    "update":            [{ "action": "UPDATE", "gcdrDeviceId": "...", "divergences": [...], ... }],
    "update_identifier": [{ "action": "UPDATE_IDENTIFIER", "gcdrDeviceId": "...", "identifierTb": "...", "identifierGcdr": "...", ... }],
    "skip":              [{ "action": "SKIP", ... }]
  }
}
```

---

## Step 4 — detect-relocations.sh

Reads all `action-plan-*.json`, inspects each `CREATE` item, and queries GCDR by `externalId` (then `centralId+slaveId`) to detect devices that already exist under the wrong customer.

```bash
./detect-relocations.sh
```

**Output:** `relocation-plan-<timestamp>.json`

```json
{
  "meta": {
    "generatedAt": "...",
    "targetCustomerId": "a4c64215-...",
    "summary": { "relocate": 4, "genuineCreates": 0 }
  },
  "actions": {
    "relocate": [
      {
        "action": "RELOCATE",
        "gcdrDeviceId": "...",
        "deviceName": "...",
        "tbId": "...",
        "matchMethod": "externalId",
        "currentCustomerId": "e04046d4-...",
        "targetCustomerId": "a4c64215-...",
        "currentAssetId": "...",
        "targetAssetId": "...",
        "sourcePlan": "action-plan-device-map-....json"
      }
    ]
  }
}
```

**Exit codes:** `0` = no relocations needed · `2` = relocations detected · `1` = fatal error

---

## Step 5 — relocate-devices.sh

Reads the latest `relocation-plan-*.json` and PATCHes each `RELOCATE` device with the correct `customerId` (and `assetId` when available).

> **Run this before `consolidate-creates.sh`** — after relocation, the re-check will reclassify these devices as `CONFORMANT` or `DIVERGENT` instead of `NOT_LINKED`, so they won't be incorrectly re-created.

```bash
# Dry-run: shows what would be patched, no actual requests
./relocate-devices.sh --dry-run

# Apply relocations
./relocate-devices.sh
```

The `targetAssetId` in the relocation plan defaults to `DEFAULT_GCDR_ASSET_ID` from `config.env` when not set per device.

**Exit codes:** `0` = all relocated · `2` = one or more failures · `1` = fatal error

---

## Step 6 — consolidate-creates.sh

Reads all `action-plan-*.json`, POSTs each genuine `CREATE` action to `POST /api/v1/devices`, and writes the final TXT with the real `gcdrDeviceId` returned by the API.

> Run after `relocate-devices.sh` to avoid re-creating devices that were merely in the wrong customer.

```bash
# Dry-run: prints POST bodies without creating anything
./consolidate-creates.sh --dry-run

# Execute for real (API Key)
./consolidate-creates.sh

# With JWT
./consolidate-creates.sh --auth jwt

# Against local dev server
GCDR_API_URL=http://localhost:3015 ./consolidate-creates.sh

# Custom output filename
./consolidate-creates.sh --out creates-2026-03-10.txt
```

**Output:** `consolidated-creates-<timestamp>.txt`

```
gcdrDeviceId|gcdrAssetId|central_id|slave_id|name|display_name|tb_id
<gcdr-assigned-id>|<assetId>|<centralId>|191|Device Name|Short Label|<tbId>
```

- `gcdrDeviceId` is the real ID returned by GCDR after the POST
- When `gcdrAssetId` is empty in the device-map, `DEFAULT_GCDR_ASSET_ID` from `config.env` is used as fallback
- Failed POSTs are logged as `# FAILED ...` and the script exits with code `2`

---

## Step 7 — apply-updates.sh

Reads all `action-plan-*.json` and applies `UPDATE` and `UPDATE_IDENTIFIER` actions via `PATCH /api/v1/devices/:id`. Only patches TB-owned fields extracted from the `divergences` array.

**Field ownership:**

| Field | Owner | Patched by this script |
|---|---|---|
| `identifier` | ThingsBoard | ✅ |
| `deviceProfile` | ThingsBoard | ✅ |
| `label` / `displayName` | ThingsBoard | ✅ |
| `slaveId` | ThingsBoard | ✅ |
| `externalId` | ThingsBoard | ✅ |
| `centralId` | GCDR | ❌ never overwritten |
| `customerId` | GCDR | ❌ never overwritten (use `relocate-devices.sh`) |
| `assetId` | GCDR | ❌ never overwritten (use `relocate-devices.sh`) |

```bash
# Dry-run: shows what would be patched, no actual requests
./apply-updates.sh --dry-run

# Apply all (UPDATE + UPDATE_IDENTIFIER)
./apply-updates.sh

# Only UPDATE_IDENTIFIER (identifier normalization)
./apply-updates.sh --action update_identifier

# Only UPDATE (real field divergences)
./apply-updates.sh --action update

# With JWT
./apply-updates.sh --auth jwt

# Against local dev server
GCDR_API_URL=http://localhost:3015 ./apply-updates.sh
```

**Output:** `apply-updates-<timestamp>.log` — pipe-delimited log per device:

```
timestamp|action|gcdrDeviceId|deviceName|status|fields_patched|error
2026-03-10T08:00:00Z|UPDATE_IDENTIFIER|abc123|HIDR. 106AB108AH|OK|identifier|
2026-03-10T08:00:01Z|UPDATE|def456|3F SCMAL0L1Q108|OK|label,slaveId,externalId|
2026-03-10T08:00:02Z|UPDATE|ghi789|TEMP. Temp1|FAIL||Validation failed
```

**Exit codes:** `0` = all applied · `2` = one or more failures · `1` = fatal error

---

## Auth

All scripts support the same auth modes:

| Mode | Header | Default |
|---|---|---|
| `apikey` (default) | `X-API-Key: <value from config.env>` | — |
| `jwt` | `Authorization: Bearer <token>` | `admin@gcdr.io` / `Test123!` |

Override via env vars: `GCDR_API_URL`, `GCDR_API_KEY`, `GCDR_EMAIL`, `GCDR_PASSWORD`, `GCDR_AUTH_MODE`.

---

## Generated file naming

| Type | Pattern |
|---|---|
| Conformity report | `inconformidades-report-device-map-<domain>-<date>-<scope>-<timestamp>.json` |
| Action plan | `action-plan-device-map-<domain>-<date>-<scope>-<timestamp>.json` |
| Relocation plan | `relocation-plan-<timestamp>.json` |
| Consolidated creates | `consolidated-creates-<timestamp>.txt` |
| Updates log | `apply-updates-<timestamp>.log` |
