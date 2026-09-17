# Gateway (Central) — consumer API guide

> Audience: teams integrating with GCDR (dashboards, Node-RED, the alarm
> orchestrator, provisioning/field tooling) that need to **read a customer's
> gateways** — their status, firmware, connected-device counts, and especially
> their **network identity**: MAC address, **Yggdrasil IPv6**, and the physical
> **hardware UUID**.
>
> In GCDR a **gateway is a "central"** — the domain, table and endpoints are all
> `central(s)`. The formal spec lives in `docs/openapi.yaml` and the Swagger —
> local `http://localhost:3015/docs`, prod `https://gcdr-api.a.myio-bas.com/docs/`.
> See also `reference_central_api_flat_contract` and `API-KEYS-CONSUMERS.md`.

---

## 1. Conceptual model

A **central** is one physical gateway. Its identity spans four fields, each with
a distinct role:

| Field | What it is | Source |
|---|---|---|
| `id` | The central's **GCDR UUID** (primary key). | `centrals.id` |
| `serialNumber` | **Logical ID**, immutable (RFC-0005). Unique per tenant. | `centrals.serial_number` |
| `hardwareId` | **UUID of the physical hardware.** Builds the tunnel/probe host `{hardwareId}.y.myio.com.br` (RFC-0062). `null` ⇒ the monitor falls back to `id`. | `centrals.hardware_id` |
| `macAddress` | Ethernet **MAC** (`AA:BB:CC:DD:EE:FF`). | `centrals.config.macAddress` |
| `ipv6Yggdrasil` | **Yggdrasil mesh IPv6** — intrinsic network identity (RFC-0035). | `centrals.config.ipv6Yggdrasil` |

Other useful fields: `type` (`NODEHUB` \| `GATEWAY` \| `EDGE_CONTROLLER` \|
`VIRTUAL`), `status`, `connectionStatus`, `firmwareVersion`, `softwareVersion`,
`frequency`, and `stats.connectedDevices` / `stats.lastHeartbeatAt`.

> **Network identity (ED-1247, additive).** `macAddress` and `ipv6Yggdrasil` are
> stored inside the `config` JSONB and are now **also surfaced top-level** on the
> list and by-id responses — so a single read gives you `hardwareId`,
> `macAddress` and `ipv6Yggdrasil` without digging into `config`. They are
> **optional/nullable** (a central may not have them set), and `config` keeps
> carrying them too — nothing was removed.

## 2. Authentication

Base path: `/api/v1`. Hybrid auth (per method):

- **Read** endpoints require scope **`centrals:read`**.
- **Write** endpoints require **`centrals:write`**.
- Accepts a **JWT Bearer** token or a **Customer API Key**
  (`X-API-Key: gcdr_cust_…`, reach per `hierarchyAccess` — see
  `API-KEYS-CONSUMERS.md`).

## 3. Read endpoints

### Get every gateway of a customer — the main one
```
GET /api/v1/customers/{customerId}/centrals
```
Returns **all** centrals of a customer (no pagination), each enriched with the
connected/total device counts and the network identity fields.

**Response** `200`:
```json
{
  "data": {
    "items": [
      {
        "id": "84638207-ac49-4adf-a033-4731dbb920c2",
        "customerId": "9a180922-f5cc-450b-b639-8b929f6ea6b9",
        "assetId": "…",
        "name": "Central Loja Q303A",
        "displayName": "Loja Q303A",
        "serialNumber": "MOX_CENTRAL_01",
        "hardwareId": null,
        "macAddress": null,
        "ipv6Yggdrasil": "200:9738:d165:f821:68d3:2852:d822:a748",
        "type": "GATEWAY",
        "status": "ACTIVE",
        "connectionStatus": "ONLINE",
        "firmwareVersion": "1.4.2",
        "config": { "ipv6Yggdrasil": "200:9738:…", "macAddress": null, "…": "…" },
        "stats": { "connectedDevices": 12, "lastHeartbeatAt": "2026-09-17T10:42:00Z" }
      }
    ]
  }
}
```
> This endpoint returns the **full central entity** (includes `config`, `stats`,
> `metadata`). The top-level `macAddress`/`ipv6Yggdrasil` mirror `config`.

### Other read endpoints

| Operation | Endpoint | Notes |
|---|---|---|
| Gateways of an **asset** | `GET /assets/{assetId}/centrals` | `{ items: [...] }`, same shape. |
| **Paginated** list / filter | `GET /centrals?customerId=&assetId=&type=&status=&connectionStatus=&limit=&cursor=` | Returns a **summary** DTO (`items` + cursor). Summary carries `id`, `serialNumber`, `hardwareId`, `macAddress`, `ipv6Yggdrasil`, `type`, `status`, `connectionStatus`, `firmwareVersion`, `frequency`, `connectedDevices`, `lastHeartbeatAt`. |
| **By id** | `GET /centrals/{id}` | Full detail DTO — top-level `hardwareId`/`macAddress`/`ipv6Yggdrasil` **plus** the nested `config`, `stats`, `location`, `metadata`, and RFC-0062 probe evidence (`monitoringEnabled`, `lastGatewayCheckAt`, `probeResult`, …). |
| **By serial** | `GET /centrals/serial/{serialNumber}` | Same detail shape, looked up by the logical ID. |
| **Statistics** | `GET /centrals/{id}/statistics` | Device/telemetry stats for the central. |
| **Latency history** | `GET /centrals/{id}/latency-history?days=7` | Probe latency samples over a window. |

## 4. Which endpoint for MAC / IPv6 / hardware UUID?

- **All three at once, per central** → `GET /centrals/{id}` (or `…/serial/{serialNumber}`): top-level `hardwareId`, `macAddress`, `ipv6Yggdrasil`.
- **For a whole customer** → `GET /customers/{customerId}/centrals`: iterate `items[]`, each with the same three fields.
- `hardwareId` may be `null` (probe then falls back to `id`); `macAddress` is `null` when the central never reported one; `ipv6Yggdrasil` is present for centrals provisioned on the Yggdrasil mesh (RFC-0035).

## 5. Write / lifecycle endpoints (overview)

Require `centrals:write`. Full request schemas in the Swagger.

| Operation | Endpoint |
|---|---|
| Create | `POST /centrals` |
| Update | `PUT /centrals/{id}` |
| Set status | `PATCH /centrals/{id}/status` |
| Set connection status | `PATCH /centrals/{id}/connection` |
| Heartbeat | `POST /centrals/{id}/heartbeat` |
| Re-check (probe now) | `POST /centrals/{id}/recheck` |
| Enroll token | `POST /centrals/{id}/enroll-token` |
| Field-swap replace | `POST /centrals/{oldUuid}/replace` |
| Reset provisioning | `POST /centrals/{id}/reset-provisioning` |
| MQTT passwords (set / delete / reveal) | `PUT · DELETE · POST /centrals/{id}/mqtt-passwords/{integrationId}[/reveal]` |

On create/update, `macAddress` (`AA:BB:CC:DD:EE:FF`) and `ipv6Yggdrasil` are set
**inside `config`**; `hardwareId` is a top-level field. `serialNumber` is
immutable (RFC-0005).

## 6. Notes

- **`config` stays authoritative.** The top-level `macAddress`/`ipv6Yggdrasil`
  are a read convenience mirrored from `config`; writes go through `config`.
- Arrays are `[]` when empty (never omitted); optional identity fields are
  `null`/absent when unset — never a fabricated value.
- The `{hardwareId || id}.y.myio.com.br` host is how RFC-0062 reaches the gateway
  for probing/backup — see the orchestrator-devices docs.
