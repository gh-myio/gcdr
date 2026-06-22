# RFC-0042 — Work Orders MCP Server

- **Status:** Draft
- **Date:** 2026-06-15
- **Domain:** Work Orders (`wo` / OS)
- **Depends on:** [RFC-0037 — Work Orders Event Model](./RFC-0037-Work-Orders-Event-Model.md), [RFC-0041 — Work Order Rules Engine](./RFC-0041-Work-Order-Rules-Engine.md)
- **Companion:** [WO-OS-MAP.md](./WO-OS-MAP.md), [WO-OS-API-GUIDE.md](./WO-OS-API-GUIDE.md)
- **Prior art:** `qrcode-check.git` `src/mcp/` (the read-only `qr-checker` MCP server we are porting)

## 1. Summary

Add a **read-only MCP server** to GCDR that lets chatbots / LLMs query the Work
Orders (OS) domain in natural language — progress, devices, maintenance,
technician performance, activity and daily summaries. It ports the proven
`qr-checker` MCP from `qrcode-check.git`, with two structural changes for GCDR:

1. **`malls` → `customers`.** The fixed "mall" concept becomes the GCDR
   **customer** (OS-enabled customers). Every tool that took a `mall` now takes a
   `customer` (name / code / id, fuzzy-matched).
2. **Server-side data via GCDR repositories**, not a local file DB. Tools read
   through the existing services/repositories (Drizzle/PostgreSQL), inheriting
   tenant scoping and the RFC-0041 status projection — never recomputing state.

## 2. Motivation

- The `qrcode-check.git` MCP is a real, modular, SDK-based server that already
  proved this UX (10 tools, `{success, message, data, summary}` responses,
  fuzzy matching). GCDR now owns the WO domain (post RFC-0032 migration), so the
  MCP belongs here, querying the live multi-tenant data.
- LLM/agent access (e.g. an operations copilot) needs a typed, safe, read-only
  surface over OS — not raw SQL or the REST API.

## 3. Architecture

| | |
|---|---|
| **Location** | `src/mcp/` inside `gcdr.git` |
| **Transport** | stdio (standard MCP CLI transport) |
| **Entry point** | `src/mcp/server.ts` — standalone, run via `npx tsx` |
| **SDK** | `@modelcontextprotocol/sdk` + `zod` (zod is already a dependency) |
| **Data access** | the existing WO services/repositories, **read-only** (no writes) |
| **State** | status comes from RFC-0041 projection; the MCP never computes it |

### 3.1 Tenant & customer scoping (the key GCDR difference)

`qr-checker` was single-tenant against a local `DATA_DIR`. GCDR is multi-tenant
and customer-scoped, so a server instance is **pinned to one tenant** via env,
and customer scope is resolved per tool call:

```jsonc
// .mcp.json
{ "mcpServers": { "gcdr-wo": {
    "command": "npx", "args": ["tsx", "src/mcp/server.ts"],
    "env": {
      "DATABASE_URL": "postgresql://…",          // read replica recommended
      "GCDR_TENANT_ID": "11111111-…",            // pins the tenant
      "GCDR_MCP_API_KEY": "gcdr_pk_…"            // optional: scope to a partner/customer
    }
} } }
```

- `GCDR_TENANT_ID` is mandatory — all queries are filtered by it.
- An optional API key (`gcdr_pk_*` / `gcdr_cust_*`) further restricts the visible
  customers (re-using the existing key→scope resolution), so a customer-scoped
  key only sees its own OS data.
- The server connects **read-only** (recommended: a read-replica / a role with
  SELECT-only grants). No tool performs writes.

### 3.2 File structure

```
src/mcp/
├── server.ts                 # entry point: registers tools, stdio transport
├── context.ts                # tenant/customer scope + read-only repo handles
├── tools/
│   ├── customers.ts          # list_customers, find_customer
│   ├── workOrders.ts         # list_work_orders, get_work_order, get_transitions
│   ├── devices.ts            # get_devices, get_device_details
│   ├── maintenance.ts        # get_maintenance
│   └── analytics.ts          # get_progress, get_average_time,
│                             # get_technician_performance, get_activity_log,
│                             # get_daily_summary
└── utils/
    └── fuzzyMatch.ts         # fuzzy customer name/code matching (ported)
```

## 4. Tools

All tools return `{ success: boolean, message: string, data: <typed>, summary: string }`
(the `summary` is a natural-language sentence the LLM can speak verbatim).

Ported from `qr-checker` with `mall → customer`, plus WO-native additions:

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_customers` | OS-enabled customers + WO progress stats | none |
| `find_customer` | Resolve a customer by fuzzy name/code | `name: string` |
| `list_work_orders` | WOs of a customer, filterable | `customer: string, status?, type?, limit?` |
| `get_work_order` | One WO: status, scope, full timeline | `code: string` (or `id`) |
| `get_transitions` | RFC-0041 allowed/blocked next events + reasons | `code: string` |
| `get_devices` | Devices in a customer's WO scope | `customer: string, filter?: "all"\|"installed"\|"pending"` |
| `get_device_details` | A device + its WO + install/maintenance events | `customer: string, device: string` |
| `get_maintenance` | MANUTENCAO WOs / open maintenance | `customer?: string, status?` |
| `get_progress` | Installation progress % | `customer?: string` |
| `get_average_time` | Average installation time (gap model) | `customer?: string` |
| `get_technician_performance` | Technician ranking by installs | `customer?: string` |
| `get_activity_log` | Recent WO events (timeline feed) | `customer?: string, limit?: number` |
| `get_daily_summary` | Today's installs + open backlog | `customer?: string` |

### 4.1 Mapping to GCDR data

- **Progress / installed**: distinct devices with a `PRODUTO_INSTALADO` event over
  the WO device scope (same definition as the Desempenho tab).
- **Average / technician performance**: derived from `PRODUTO_INSTALADO` event
  actors and timestamps (gap-based time, ≤4h gaps counted) — mirrors the
  Performance tab so numbers match the UI.
- **Activity log**: `work_orders_events` newest-first, joined to actor snapshots.
- **Status / transitions**: from the WO projection and the Rules Engine
  (`getTransitions`) — the MCP exposes *why* an event is blocked.
- **Maintenance**: `MANUTENCAO`-type WOs and their lifecycle/structural events.

### 4.2 Fuzzy customer matching

`find_customer` resolves, in order: exact id → exact code → exact name →
fuzzy (typo-tolerant, threshold ~0.5) on name and code (port of
`utils/fuzzy-match.ts`). On no match it returns the available customer names in
the `summary` to help the LLM retry.

## 5. Response format

```jsonc
{
  "success": true,
  "message": "Found 12 work order(s) for Dimension",
  "data": { "workOrders": [ { "code": "OS-ABC1D2", "status": "EM_ANDAMENTO", … } ] },
  "summary": "Dimension has 12 work orders: 3 in progress, 8 finished, 1 planned. Installation progress is 91% (283/311 devices)."
}
```

## 6. Security

- **Read-only**: tools only issue SELECTs; the server uses a SELECT-only DB role
  or a read replica. No tool maps to a write/append.
- **Tenant isolation**: every query is filtered by `GCDR_TENANT_ID`; an optional
  API key narrows the customer scope. A server instance can never read another
  tenant.
- **No secrets in responses**: tools never return credentials, viewer passwords
  or API keys.
- **PII**: actor names/emails appear only where the UI already shows them
  (timeline, technician ranking).

## 7. Dependencies

```jsonc
// package.json
{ "dependencies": { "@modelcontextprotocol/sdk": "^1.0.0", "zod": "^3.x" } }
```

`zod` is already present. Add the MCP SDK. Run target: `tsx src/mcp/server.ts`.

## 8. Rollout

1. **Phase 1 — DONE.** `context.ts` (tenant scope + read-only repos), the
   `customers` + `work_orders` tools (`list_customers`, `find_customer`,
   `list_work_orders`, `get_work_order`, `get_transitions`), stdio server and
   `.mcp.json`.
2. **Phase 2 — DONE.** `devices`, `maintenance` and `analytics` tools
   (`get_devices`, `get_device_details`, `get_maintenance`, `get_progress`,
   `get_average_time`, `get_technician_performance`, `get_activity_log`,
   `get_daily_summary`). Analytics query the WO tables directly and reuse the
   Desempenho gap-based time model so numbers equal the UI.
3. **Phase 3 — production hardening (not new tools).** Three things, only needed
   to expose this in production / to third parties:
   1. **DB-level read-only.** Run the server with a SELECT-only Postgres role
      (and/or a read replica). The tools are already read-only in code; this is
      the safety net at the database level.
   2. **Auto-scope by API key.** Today a server is pinned to a *tenant* and sees
      *all* its customers. Phase 3 resolves an optional `gcdr_cust_*` key to its
      customer and restricts every tool to it — so a customer can be given an
      MCP without seeing other customers' OS. (This is the only code part:
      resolve the key → `allowedCustomerIds` in `context.ts` and filter in the
      tools.)
   3. **Ops/docs.** Running the server inside the network that reaches the prod
      Postgres (the prod host is internal), `.mcp.json` config and a consumer
      guide for the tools.

   For **local/internal** use with a trusted single tenant, Phase 3 is **not**
   required — Phases 1–2 are fully functional.

## 9. Migrations, seeds & environment

- **No migrations and no seeds are required by the MCP itself** — it only
  *reads* existing tables (`work_orders*`, `work_orders_events`,
  `work_orders_devices`, `work_orders_lifecycle_rules`, `customers`, `users`,
  `devices`). The RFC-0041 migrations (`0040`, `0041`) and the demo seeds
  (`27`/`28`/`29`) are independent; they just provide data to query.
- **Environment** (set in `.mcp.json` → `env`, never committed):
  - `DATABASE_URL` — points at the GCDR database. **Prod: use a read-only role
    / read replica**, on a host the server can reach (the prod DB host is
    internal, so run the MCP from inside that network).
  - `GCDR_TENANT_ID` — pins the tenant (required).
  - `GCDR_MCP_API_KEY` *(Phase 3)* — optional customer-scoping key.
- No changes to the API's own `.env` are needed; the MCP is a separate process.

## 10. How to test

Run a JSON-RPC handshake over stdio and call a tool (no LLM client needed):

```bash
# from gcdr.git, with the local DB up (docker container gcdr-db-local on :5544)
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_progress","arguments":{}}}'
  sleep 5
} | DATABASE_URL="postgresql://postgres:postgres@localhost:5544/db_gcdr" \
    GCDR_TENANT_ID="11111111-1111-1111-1111-111111111111" \
    npx tsx src/mcp/server.ts
```

A real MCP client (Claude Desktop / Claude Code) just needs the `.mcp.json`
above; it spawns `npx tsx src/mcp/server.ts` and lists the 13 tools.
Prerequisite: `npm install` (pulls `@modelcontextprotocol/sdk`).

## 11. Out of scope

- **Write tools** (creating WOs / appending events) — this server is read-only.
  A future RFC could add a guarded, audited write surface.
- HTTP/SSE transport (stdio only for now).
- Cross-tenant analytics.
```
