# RFC-0022 — ThingsBoard ↔ GCDR Device Conformity Check & Sync Strategy

- **Feature Name:** `thingsboard-gcdr-device-conformity`
- **Start Date:** 2026-03-10
- **RFC PR:** *(pending)*
- **GCDR Issue:** *(pending)*
- **Status:** Draft

---

## Summary

Establish a process and tooling to detect, report, and resolve registration non-conformities between **ThingsBoard** (source of truth for physical device inventory) and **GCDR** (source of truth for master data, rules, and asset hierarchy).

A non-conformity occurs when a device exists in ThingsBoard with GCDR-specific server-scope attributes (`gcdrDeviceId`, `gcdrCustomerId`, `gcdrAssetId`, etc.) that do not match the corresponding record in GCDR — or when no GCDR record can be located at all.

---

## Motivation

ThingsBoard holds the physical device registry and stores GCDR identifiers in `server_scope` attributes. GCDR holds the master data (asset hierarchy, alarm rules, device profiles, Modbus configuration). When the two systems diverge — due to manual edits, failed sync operations, or data migration — alarm bundles are generated with incorrect or missing devices, leading to silent operational failures.

We need:

1. A way to **inspect** the current state of divergence without modifying data.
2. A structured **report format** that can be consumed by both humans and automation.
3. A clear **definition** of which system wins for each field (field ownership).
4. A path toward an **automated reconciliation** strategy.

---

## Guide-Level Explanation

### The conformity check script

The script `scripts/api/check-inconformidades/check-inconformidades.sh` reads a pipe-delimited `target.txt` file in the same directory and compares each device against GCDR.

**`target.txt` format** (one row per device, first row is the header):

```
tbId|deviceName|label|deviceType|deviceProfile|slaveId|centralId|gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt
```

| Column | Source | Description |
|---|---|---|
| `tbId` | ThingsBoard | Device UUID in ThingsBoard |
| `deviceName` | ThingsBoard | Name as registered in ThingsBoard |
| `label` | TB `server_scope` | Short label |
| `deviceType` | TB `server_scope` | Device type string |
| `deviceProfile` | TB `server_scope` | Device profile slug |
| `slaveId` | TB `server_scope` | Modbus slave ID |
| `centralId` | TB `server_scope` | UUID of the GCDR central |
| `gcdrCustomerId` | TB `server_scope` | Expected GCDR customer UUID |
| `gcdrAssetId` | TB `server_scope` | Expected GCDR asset UUID |
| `gcdrDeviceId` | TB `server_scope` | Known GCDR device UUID (if synced) |
| `gcdrSyncAt` | TB `server_scope` | ISO timestamp of last known sync |

**Running the check:**

```bash
# Using API Key (default)
./check-inconformidades.sh

# Using admin JWT
./check-inconformidades.sh --auth jwt

# Against local dev server
GCDR_API_URL=http://localhost:3015 ./check-inconformidades.sh
```

**Status codes per device:**

| Status | Meaning |
|---|---|
| `CONFORMANT` | All compared fields match between TB and GCDR |
| `DIVERGENT` | Device found in GCDR but one or more fields differ |
| `MISSING_IN_GCDR` | `gcdrDeviceId` provided but not found in GCDR |
| `NOT_LINKED` | No `gcdrDeviceId`; search by `externalId`/`identifier` returned no results |

**Report output:**

A timestamped JSON file is written to the same directory:

```
inconformidades-report-20260310-153000.json
```

---

## Reference-Level Explanation

### Device resolution strategy

The script follows this resolution order when looking up a device in GCDR:

1. If `gcdrDeviceId` is present → `GET /api/v1/devices/:gcdrDeviceId`
2. Else → `GET /api/v1/devices?externalId=<tbId>`
3. Else → `GET /api/v1/devices?identifier=<tbId>`
4. If nothing found → status `NOT_LINKED`

### Field ownership (who wins on conflict)

| Field | Owner | Rationale |
|---|---|---|
| `label` | ThingsBoard | Operational label set by field technicians |
| `deviceProfile` | ThingsBoard | Assigned during device provisioning in TB |
| `deviceType` | ThingsBoard | Physical classification |
| `slaveId` | ThingsBoard | Hardware configuration |
| `centralId` | GCDR | GCDR is the authority for gateway topology |
| `customerId` | GCDR | Hierarchy managed exclusively in GCDR |
| `assetId` | GCDR | Asset hierarchy managed in GCDR |
| `externalId` | GCDR (points to TB) | GCDR stores TB's UUID as `externalId` |
| `name` / `displayName` | GCDR | Display names curated in GCDR |

### Report JSON schema

```json
{
  "meta": {
    "generatedAt": "2026-03-10T15:30:00Z",
    "apiUrl": "https://gcdr-api.a.myio-bas.com",
    "authMode": "apikey",
    "totals": {
      "devices": 120,
      "conformant": 105,
      "divergent": 12,
      "missing": 3,
      "errors": 0
    }
  },
  "results": [
    {
      "tbId": "20b93da0-9011-11f0-a06d-e9509531b1d5",
      "deviceName": "3F ELEV. SCMAL2ACEL2",
      "tb": {
        "label": "elevador-3f",
        "deviceType": "ELEVATOR_CONTROLLER",
        "deviceProfile": "elevator",
        "slaveId": "85",
        "centralId": "e982edf9-edb1-4aa6-8a14-4782465ae5a3",
        "gcdrCustomerId": "e04046d4-baa4-44e9-a378-4dfebe4140f1",
        "gcdrAssetId": "aaa00001-0001-0001-0001-000000000003",
        "gcdrDeviceId": "9048c4da-9c6e-429e-a214-2fc0bf6fde06",
        "gcdrSyncAt": "2026-02-15T10:00:00Z"
      },
      "gcdr": { "...full device object..." },
      "status": "DIVERGENT",
      "divergences": [
        "label: TB='elevador-3f' GCDR='elev-3f-old'",
        "slaveId: TB='85' GCDR='84'"
      ]
    }
  ]
}
```

### Authentication

The script supports two modes:

**API Key** (default):
```
X-API-Key: gcdr_myio_tenant_bundle_key_2026
```
Requires `hierarchyAccess: TENANT` to read devices across all customers.

**JWT** (email/password):
```
POST /api/v1/auth/login
{ "email": "admin@gcdr.io", "password": "Test123!" }
→ Bearer <accessToken>
```

---

## Drawbacks

- The script is read-only and produces no fixes — remediation must be done separately (manually or via a future sync command).
- ThingsBoard is treated as source of truth for device identity fields; this assumption must be validated per-customer before any automated write-back to GCDR.
- The script does not currently handle pagination when searching by `externalId` or `identifier` (assumes ≤1 result, which is enforced by GCDR unique constraints).

---

## Rationale and Alternatives

**Why pipe-delimited `target.txt`?**
Simple to generate from a ThingsBoard CSV export or a custom API call. No JSON parsing required outside of the script itself.

**Why not query ThingsBoard directly?**
The script is intentionally ThingsBoard-agnostic. The caller is responsible for exporting TB data to `target.txt`. This keeps the script portable and avoids ThingsBoard API credentials in the GCDR toolchain.

**Alternative: a dedicated GCDR endpoint `GET /conformity/devices`**
This would move the comparison server-side, enabling scheduled conformity checks. See *Future Possibilities*.

---

## Prior Art

- `scripts/db/ops/fix-moxuara-malformed-uuid.sql` — precedent for ops scripts targeting specific divergence fixes.
- `docs/rfcs/RFC-0016-ThingsBoard-Entity-Mapping.md` — defines `externalId` as the TB↔GCDR link for devices and customers.
- `docs/thingsboard/GUIDE-THINGSBOARD-Get-Device-By-ExternalId.md` — documents the enriched lookup endpoint used internally by this script.

---

## Unresolved Questions

- **Who triggers the check?** Manual (ops team) for now. Should it run on a schedule (cron) and post results to a Slack channel or audit log?
- **Remediation flow:** After identifying divergences, what is the correction authority? Does GCDR pull from TB, or does TB pull from GCDR?
- **Partial sync:** Should a future endpoint accept the report JSON and apply only `CONFORMANT`-safe corrections (e.g. updating `externalId` in GCDR to point to TB)?
- **Scope:** This RFC covers devices only. Assets, customers, and centrals may also diverge between TB and GCDR.

---

## Future Possibilities

- **`POST /api/v1/conformity/devices/reconcile`** — accepts the report JSON, applies field-ownership rules, and writes corrections to GCDR.
- **`GET /api/v1/conformity/devices`** — server-side conformity endpoint that accepts a list of `tbId` values and returns the same report format without a shell script.
- **Scheduled conformity job** — a background cron inside GCDR that periodically fetches ThingsBoard device attributes via webhook or polling and flags divergences to the audit log.
- **`gcdrSyncAt` write-back** — after a successful sync, GCDR writes the timestamp back to the TB `server_scope` attribute via ThingsBoard REST API, creating a bidirectional sync trail.
