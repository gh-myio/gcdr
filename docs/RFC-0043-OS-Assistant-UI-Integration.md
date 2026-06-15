# RFC-0043 — OS Assistant (bringing the WO MCP into the GCDR UI)

- **Status:** Draft
- **Date:** 2026-06-15
- **Domain:** Work Orders (`wo` / OS)
- **Depends on:** [RFC-0042 — Work Orders MCP Server](./RFC-0042-Work-Orders-MCP-Server.md), [RFC-0041 — Rules Engine](./RFC-0041-Work-Order-Rules-Engine.md)

## 1. Summary

Expose the Work Orders MCP capabilities **inside the GCDR web UI** as a natural-
language **assistant ("Copiloto OS")**. This RFC records the integration options,
their trade-offs, the recommended path, and the decisions to make.

## 2. The constraint

The MCP server (RFC-0042) speaks **stdio** and is meant for an **LLM host**
(Claude Desktop, Claude Code, …). Two consequences:

- The **browser cannot talk to it directly** (no stdio in the browser).
- The MCP alone answers nothing — **an LLM** is what calls the tools and turns
  results into language.

So "integrating into the UI" means adding an **assistant surface** (a chat) whose
backend runs an LLM wired to the WO tools. The MCP itself stays as the
desktop/agent entry point.

## 3. Options

### Option A — Assistant chat in the UI + backend endpoint (recommended)

```
[Chat panel in the GCDR UI]
        │  POST /wo/assistant   (JWT/tenant from the request)
        ▼
[GCDR backend] → LLM (Claude) + the WO tools → natural-language answer (stream)
```

- The backend runs the LLM with the **same tool functions** the MCP exposes
  (`get_progress`, `find_customer`, `list_work_orders`, …) and returns the
  answer to the UI.
- Tenant/customer scope comes from the **logged-in user's JWT** (not env), so the
  assistant respects the caller's permissions automatically.
- Requires extracting the tools into a **transport-agnostic** service (see §4) so
  stdio-MCP and the HTTP assistant share one implementation.
- **Pros:** real new value (NL over OS), reuses existing auth, one tool codebase.
- **Cons:** needs an LLM credential on the server + cost controls; streaming.

### Option B — MCP over HTTP/SSE + a web MCP client

- The MCP SDK supports an HTTP/SSE transport; expose the MCP over HTTP and have a
  web client connect.
- **Pros:** lets external MCP clients (not just desktop) connect; standards-based.
- **Cons:** still needs an LLM to be conversational; more moving parts; the
  browser-side MCP client is heavier. Better suited to *external integrators*
  than to an in-app assistant.

### Option C — REST "insights" widgets (no chat)

- Reuse the tool functions as plain REST endpoints (e.g. `GET /wo/insights/progress`)
  and render cards/summaries in the UI.
- **Pros:** simplest; no LLM.
- **Cons:** this largely duplicates what the **Desempenho** tab already shows; the
  unique value of the MCP (natural language) is lost. Only worth it for specific
  embedded summaries.

## 4. Shared tool layer (enabler for A & B)

Extract the WO query logic into a transport-agnostic module, e.g.
`src/services/work-orders/insights/` (pure functions returning
`{ data, summary }`), consumed by:

- the **stdio MCP** (`src/mcp/tools/*` become thin wrappers), and
- the **HTTP assistant** endpoint (Option A), and
- optionally the **REST insights** endpoints (Option C).

One implementation, three surfaces — no logic drift, numbers always match the UI.

## 5. Architecture for Option A

- **Frontend:** a chat panel. Placement (decision in §7): a **tab "Assistente"**
  inside `/os`, or a **global "Copiloto"** entry in the GCDR sidebar.
- **Backend:** `POST /api/v1/wo/assistant` — body `{ message, conversationId? }`,
  streams the LLM answer (SSE). The handler:
  1. builds tenant/customer scope from `req.context` (the user's JWT);
  2. runs the LLM with the WO tools bound (read-only);
  3. streams tokens + a final structured `summary`.
- **LLM:** Claude via the Anthropic API; server-held key; per-tenant rate/cost caps.

## 6. Security

- **Read-only** — the assistant exposes only the read tools; no WO writes.
- **Scope from the caller** — tenant (and customer, for customer-scoped users)
  derived from the JWT, never from a tool argument; the assistant can't read
  outside the user's scope.
- **No secrets** in answers; **cost/rate limits** per tenant; prompt-injection
  hardening (tools are typed/validated, not free SQL).

## 7. Decisions to make

1. **Menu placement:** "Assistente" tab in `/os` (focused on OS) **vs** a global
   "Copiloto" in the GCDR sidebar (spans the whole product, OS first).
2. **LLM provider/credential & budget:** Anthropic key on the server; per-tenant
   spend caps; which model.
3. **Streaming UX:** SSE token streaming vs single response.
4. **History:** ephemeral per session vs persisted conversations.

## 8. Recommendation

- **Now (no UI work):** the MCP already serves internal staff via Claude
  Desktop/Code — ship the `.mcp.json` and use it immediately.
- **In-app:** go with **Option A**, starting by extracting the shared
  `wo-insights` layer (§4), then a `POST /wo/assistant` endpoint, then a chat
  panel in an **"Assistente"** tab under `/os`. Promote to a global "Copiloto"
  later if it proves out.
- Keep **Option B** for *external* MCP integrators; use **Option C** only for
  specific embedded summaries.

## 9. Out of scope

- Write actions from the assistant (creating WOs / appending events) — read-only
  for now; a future RFC could add guarded, confirmed, audited writes.
- A full multi-domain copilot (this RFC is OS-first).
