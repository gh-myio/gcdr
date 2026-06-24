# RFC-0048 — Dokploy Log Cockpit & Agentic On-call Terminal

- **Status:** Draft — proposal, 2026-06-24
- **Created:** 2026-06-24
- **Author:** MYIO Engineering
- **Domain:** Platform / Observability / Ops (cross-cutting)
- **Deploys to:** Dokploy (self-hosted, Docker-based PaaS)
- **Related:** RFC-0009 (audit logs) · the `/loop` on-call agent pattern (Claude Code) · `docs/specs/CI-PIPELINE.md` (the deploy path the agent proposes into).

---

## Summary

Stand up a single self-contained service — **`oncall-cockpit`** — deployed as one
Dokploy application that does two things at once:

1. **Real-time log cockpit.** It tails the logs of the *other* containers running on
   the same Dokploy host (via the Docker Engine API) and streams them, merged and
   tagged, into a browser dashboard — one pane of glass for the whole fleet.
2. **Agentic on-call terminal.** The same dashboard embeds a real browser terminal
   (a PTY bridged over WebSocket). In it we install **Claude Code** and run it with
   **`/loop`** against an on-call prompt (Appendix A). The agent reads the very same
   aggregated logs, triages issues, writes findings to `tasks/`, and proposes fixes —
   under hard guardrails (read-only by default; ask before any write/deploy).

The result is a "cockpit": humans and an always-on agent watching the same live log
stream, in the same place, with the agent able to act safely under approval.

---

## Motivation

Today, looking at what a Dokploy fleet is doing means opening the Dokploy UI per
service, scrolling one container's logs at a time, with no merged view, no
cross-container search, and no memory. There is no always-on triage: a 2am error
spike is found at 9am. We already use the Claude Code **`/loop`** on-call pattern
elsewhere; we want it *next to the logs it needs*, watching them in real time, with a
human able to glance at the same screen and approve actions.

We want one box that:

- gives a **single real-time, merged, searchable** view of every container's logs;
- hosts an **interactive terminal** so Claude Code (and a human) can investigate and
  act from inside the network, with the right toolchain pre-installed;
- runs an **agent on a loop** that turns "logs nobody is watching" into "triaged
  tasks and small, approved fixes";
- is **cheap to operate** (one container) and **safe by construction** (least-privilege
  Docker access, an explicit guardrail prompt, an auth wall in front of the terminal).

Non-goals: replacing a real metrics/observability stack (Prometheus/Grafana/Loki at
scale), multi-node cluster aggregation in v1, or letting the agent deploy unattended.

---

## Guide-level explanation

You deploy one Dokploy app, `oncall-cockpit`, on the same host as the services you
want to watch. You open its URL (behind auth), and you see two panes:

```
┌───────────────────────────────── oncall-cockpit ──────────────────────────────────┐
│  filters: [container ▾] [level ▾] [regex____] [⏸ pause] [⤓ follow]   ● 7 up / 1 down │
├──────────────────────────────────────────────┬─────────────────────────────────────┤
│  LIVE LOGS (merged, tagged, colored)          │  TERMINAL (PTY, tmux-backed)        │
│  12:01:03 gcdr-api      INFO  request 200 …   │  $ claude                            │
│  12:01:03 gcdr-db       LOG   checkpoint …    │  > /loop You are the on-call …       │
│  12:01:04 alarm-bundle  ERROR upstream 502 …  │  wake 1 · reading logs …             │
│  12:01:04 traefik       WARN  retry backend … │  → tasks/502-alarm-upstream.md       │
│  …(virtualized, follows tail)…                │  …                                  │
└──────────────────────────────────────────────┴─────────────────────────────────────┘
```

- **Left pane** is the merged log stream from every sibling container, tagged with the
  container/service name, the stream (stdout/stderr), a parsed level, and a timestamp.
  You can filter by container, by level, by regex, pause, and tail-follow.
- **Right pane** is a terminal *inside* the cockpit container. There you run
  `claude`, then `/loop <prompt>`. Claude Code now lives on the host network with a
  read-only view of Docker, a read-only DB path (via bastion), git, and a `tasks/`
  scratchpad. It watches the same logs you do and works the loop (Appendix A).

The agent's job each "wake": pick the single most useful thing in the logs, document
it in `tasks/`, and either propose a fix or — if it is small, obvious, and tested —
ask you "ship as v0.0.X?" and, on approval, commit + push (CI deploys). It never
deploys or writes on its own.

The four moving parts:

| Part | What it does |
|---|---|
| **Log Aggregator** | Streams every sibling container's logs from the Docker API, demuxes + tags them, fans out to clients over WebSocket, keeps a bounded ring buffer (+ optional SQLite). |
| **Cockpit UI** | Virtualized merged log table + filters + metrics strip; the embedded terminal. |
| **Terminal Bridge** | A PTY (node-pty / ttyd) over WebSocket, backed by `tmux` so the `/loop` session survives reconnects. |
| **Agent Runner** | Claude Code installed in the image, launched in the tmux session, running `/loop` with the on-call prompt + guardrails. |

---

## Reference-level explanation

### Topology

One container, `oncall-cockpit`, on the Dokploy host, attached to the same Docker
network as the watched services, with **read-only** access to the Docker daemon —
**not** by mounting `/var/run/docker.sock` directly into the app, but through a
**socket proxy** that exposes only the `containers` + `logs` endpoints (see Security).

```
        ┌───────────────────────────── Dokploy host (Docker) ─────────────────────────────┐
        │                                                                                  │
        │   gcdr-api   gcdr-db   alarm-bundle   traefik   …   (the watched containers)      │
        │      │          │           │            │                                       │
        │      └──────────┴───────────┴────────────┘   logs (read-only)                    │
        │                     ▲                                                            │
        │            docker-socket-proxy  (allows: containers, logs · denies: exec, create)│
        │                     ▲                                                            │
        │             ┌───────┴────────┐        Traefik (TLS + auth middleware)            │
        │             │ oncall-cockpit │◀──────────────  https://cockpit.<domain>          │
        │             │  aggregator    │                                                   │
        │             │  cockpit UI    │                                                   │
        │             │  PTY + tmux    │                                                   │
        │             │  Claude Code   │                                                   │
        │             └────────────────┘                                                   │
        └──────────────────────────────────────────────────────────────────────────────────┘
```

### Log Aggregator

- **Discovery:** `GET /containers/json` (via the proxy) to enumerate containers; filter
  by a label allowlist (e.g. `oncall.watch=true`) or an explicit name list from env.
  Reconcile on a timer + Docker events so Dokploy redeploys (new container ids, same
  service) are picked up automatically — **key on the service/name, not the id**.
- **Streaming:** per container, `GET /containers/{id}/logs?follow=1&stdout=1&stderr=1&timestamps=1&tail=<n>`.
  Demux the Docker multiplexed stream framing (8-byte header: stream type + length)
  unless the container is TTY-attached. Each line becomes a record:
  `{ ts, container, service, stream: stdout|stderr, level, message }` where `level`
  is parsed heuristically (`ERROR|WARN|INFO|DEBUG`, JSON `level` field, or stderr→warn).
- **Buffering & fan-out:** a bounded in-memory **ring buffer** (e.g. last N=50k lines or
  M minutes) for instant backfill on connect; optional durable sink (SQLite WAL, or ship
  to Loki) gated by an env flag. WebSocket fan-out with per-client server-side filters
  (container, level, regex, since) so the browser only receives what it subscribes to.
- **Backpressure:** drop-oldest on the ring; coalesce + rate-limit per-client sends;
  never block the Docker read loop on a slow client.

### Realtime transport & Cockpit UI

- **Transport:** WebSocket (bidirectional: client sends filter/subscribe; server streams
  log frames). SSE is an acceptable fallback for the log pane.
- **UI:** a virtualized (windowed) log table — only render visible rows — with severity
  coloring, container chips, full-text + regex search, pause/resume, jump-to-tail, and a
  small metrics strip (per-container up/down, error-rate sparkline derived from the level
  tags). Built as a tiny SPA (any stack; the team default is fine) served by the same
  service.

### Terminal Bridge

- A **PTY** (`node-pty`, or embed **ttyd**/**gotty**) exposed over a *separate*,
  auth-gated WebSocket, rendered with **xterm.js** in the right pane.
- The shell starts (or attaches to) a **`tmux`** session named `oncall`, so the
  `/loop` run keeps going across browser disconnects and the human can detach/reattach.
- The container image ships the agent's toolchain: `node`, `git`, the **Docker CLI**
  (pointed at the read-only proxy), a `psql` client (for the bastion path), `jq`, and
  **Claude Code** (`@anthropic-ai/claude-code`).

### Agent Runner (Claude Code on `/loop`)

- Installed in the image; authenticated via `ANTHROPIC_API_KEY` (Dokploy env/secret) —
  or interactive OAuth on first run if preferred.
- Launched inside the `oncall` tmux session: `claude` → `/loop <prompt>` (Appendix A).
- **Tools the agent is allowed:** read-only Docker (containers + logs via the proxy),
  read-only DB via the bastion, read-only git, writing under `tasks/`, reading source.
- **Guardrails** are enforced three ways, defense-in-depth: (1) the **prompt** (Appendix
  A) states the non-negotiables; (2) Claude Code **permission mode** / allowlist; (3) the
  socket proxy and DB credentials are **physically read-only** (the agent *cannot*
  `docker exec`, restart, or write the DB even if it tried).

### Security (this is the load-bearing section)

A web panel with a terminal is **remote code execution by design**, and Docker socket
access is **host-root-equivalent**. Therefore, non-negotiable:

1. **Never expose `/var/run/docker.sock` directly.** Put
   [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
   in front and allow only `CONTAINERS=1`, `LOGS=1` (where supported), `EVENTS=1`; deny
   `EXEC`, `POST`, `CONTAINERS_CREATE`, `IMAGES`, `NETWORKS`, `VOLUMES`, etc.
2. **Auth wall in front of everything.** Use a Dokploy/Traefik middleware —
   basic-auth at minimum, ideally **forward-auth/SSO** — plus TLS, plus an IP allowlist
   for the terminal route. No anonymous access, ever.
3. **Secrets via Dokploy env/secrets**, never baked into the image or printed to logs
   (the aggregator must redact obvious secret patterns before fan-out).
4. **Least-privilege DB:** the agent's DB path is a **read-only** role over a bastion;
   writes require a human to run them.
5. **Token budget cap** on the agent to bound spend (and a wake interval that backs off
   when idle — see the prompt's "when to stop").
6. **Audit:** persist the agent's actions (it already writes `tasks/` + git history);
   optionally tee the terminal session log to the durable sink.

### Configuration (env)

| Var | Purpose |
|---|---|
| `DOCKER_HOST` | URL of the socket proxy (e.g. `tcp://docker-socket-proxy:2375`). |
| `WATCH_LABEL` / `WATCH_CONTAINERS` | Label selector or explicit list of containers to tail. |
| `LOG_RING_SIZE` / `LOG_RETENTION` | Ring-buffer bound; durable-sink retention. |
| `LOG_SINK` | `memory` (default) \| `sqlite` \| `loki`. |
| `ANTHROPIC_API_KEY` | Claude Code auth. |
| `AGENT_TOKEN_BUDGET` | Cap for the `/loop` run. |
| `BASIC_AUTH_USERS` / SSO config | Panel auth (or configured at the Traefik layer). |

### Deployment on Dokploy

A Dokploy **Application** (or a small Compose stack) with:

- the `oncall-cockpit` service (this image),
- a `docker-socket-proxy` sidecar service,
- a **persistent volume** for `tasks/` and the optional SQLite sink,
- a Traefik route `cockpit.<domain>` with TLS + an auth middleware,
- env/secrets as above.

Sketch (`docker-compose.yml`, the shape Dokploy consumes):

```yaml
services:
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    environment: { CONTAINERS: 1, LOGS: 1, EVENTS: 1, EXEC: 0, POST: 0 }
    volumes: [ "/var/run/docker.sock:/var/run/docker.sock:ro" ]

  oncall-cockpit:
    image: registry.<domain>/oncall-cockpit:latest
    depends_on: [ docker-socket-proxy ]
    environment:
      DOCKER_HOST: "tcp://docker-socket-proxy:2375"
      WATCH_LABEL: "oncall.watch=true"
      LOG_SINK: "sqlite"
      ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
      AGENT_TOKEN_BUDGET: "2000000"
    volumes: [ "oncall-data:/work" ]   # tasks/ + sqlite live here
    labels:
      - traefik.enable=true
      - traefik.http.routers.cockpit.rule=Host(`cockpit.<domain>`)
      - traefik.http.routers.cockpit.middlewares=cockpit-auth@file
volumes: { oncall-data: {} }
```

`Dockerfile` sketch:

```dockerfile
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git tmux docker.io postgresql-client jq ca-certificates && \
    npm i -g @anthropic-ai/claude-code && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY . /app
# /app = the aggregator + cockpit UI + PTY bridge (built separately)
EXPOSE 8080
CMD ["node", "/app/server.js"]   # serves UI + WS log stream + WS PTY; agent runs in tmux
```

---

## Drawbacks

- **Big blast radius.** A terminal panel = RCE; Docker access = host-root-equivalent.
  The whole value depends on the auth wall and the socket proxy holding. Get those wrong
  and you have handed out the host.
- **Always-on agent cost.** Tokens add up; needs a budget cap and idle back-off.
- **In-memory logs are volatile** — a cockpit restart loses the ring buffer unless the
  durable sink is on.
- **Not a real observability stack.** No long-term metrics, tracing, or cross-host
  aggregation in v1. It complements Loki/Grafana; it does not replace them.
- **Single-host scope.** A multi-node Dokploy/Swarm needs one cockpit per node (or a
  fan-in) — deferred.
- **Agent trust.** Even read-only, an agent that proposes wrong fixes wastes human time;
  the guardrails reduce but do not eliminate this.

---

## Rationale and alternatives

- **Docker socket (proxied) vs a log-shipping pipeline (Vector/Promtail → Loki).** The
  socket approach is zero-per-service-config and instantly real-time, which is exactly
  what the cockpit + agent want. A Loki pipeline is more robust and queryable long-term
  but is more moving parts and has no agent/terminal. We choose the socket (proxied) for
  v1 and leave a Loki sink as an option (`LOG_SINK=loki`).
- **Embedded interactive terminal vs a headless agent (cron/`CronCreate`).** Interactive
  keeps a human in the loop for approvals and lets us watch the same screen. A headless
  daemon is cheaper to operate but loses the "cockpit" property and the approval UX. We
  start interactive; a headless mode is a future possibility.
- **Build vs buy the log view.** [**Dozzle**](https://dozzle.dev) already renders
  real-time Docker logs in the browser over the socket — we could **embed/fork Dozzle**
  for the log pane and add the terminal + agent, instead of rebuilding the aggregator.
  Strong candidate; see Prior art.
- **One cockpit container vs a sidecar per service.** One container is cheaper and gives
  the merged view for free; sidecars would multiply cost and fragment the view.

---

## Prior art

- **Dozzle** — real-time Docker logs in the browser, socket-based, lightweight (the log
  pane, almost off-the-shelf).
- **ttyd / gotty** — expose a terminal over the web via WebSocket (the terminal pane).
- **xterm.js / node-pty** — browser terminal + PTY bridge.
- **tecnativa/docker-socket-proxy** — least-privilege Docker socket exposure.
- **lazydocker / Portainer** — Docker TUIs/UIs (interaction patterns).
- **Grafana Loki + Promtail / Vector** — the "proper" log pipeline (the durable-sink
  alternative).
- **Claude Code `/loop`** — the agentic on-call pattern this RFC operationalizes; the
  source on-call prompt this is modeled on is in `logs/027-DraftRfc0048.md` (Appendix A
  is its English, Dokploy-adapted form).

---

## Unresolved questions

1. **Durable sink:** ship v1 with the in-memory ring only, or default to SQLite? (Lean:
   SQLite on a volume, so restarts and the agent's backfill survive.)
2. **Auth mechanism:** Traefik basic-auth for v1 vs forward-auth/SSO from day one for the
   terminal route?
3. **Action scope:** which containers/services may the agent reference, and how do we
   express "you may read these logs but only propose fixes in repo X"? (Labels + an
   allowlist in the prompt.)
4. **Agent auth in a headless container:** API key vs OAuth; how to rotate; how to cap
   spend per day.
5. **Multi-node Dokploy:** one cockpit per node + a fan-in UI, or a single node scope for
   v1?
6. **Redaction:** how aggressive should secret-pattern redaction be before fan-out (false
   positives vs leaks)?

---

## Future possibilities

- **Metrics alongside logs** (cAdvisor / node-exporter) → a true cockpit with CPU/mem and
  error-rate, the data the on-call prompt already wants.
- **Alerting & push** — the agent (or the aggregator) pushes to Slack/notifications on
  threshold breach, closing the "2am spike found at 9am" gap.
- **The agent opens PRs** (not just `tasks/`) with proposed fixes, gated by CI + human
  review — extending the existing `/loop` "ask to ship" step.
- **GCDR audit integration** — tee agent actions into RFC-0009 audit logs.
- **Session replay** of the merged log stream around an incident.
- **Headless mode** (`CronCreate`-driven) for hosts where no human will watch the panel.
- **Multi-node fan-in** for a fleet-wide cockpit.

---

## Appendix A — the `/loop` on-call prompt (English, Dokploy-adapted)

> Source: `logs/027-DraftRfc0048.md` (PT-BR draft). This is its English form, retargeted
> from AWS/DocDB to a Dokploy host watched through the cockpit. Paste it after `/loop`.

```
/loop You are the on-call for this Dokploy host. On each wake (default every 30 min),
pick the single most useful thing to investigate and act on. Find it by looking at:
the real-time merged container logs in the cockpit, the metrics strip, the database
(read-only via bastion), the source, and the open work in tasks/.

## Mission
Keep the fleet healthy, cheap, and quiet. "Healthy" = no customer-facing failures.
"Cheap" = no wasted spend. "Quiet" = error logs reflect real problems, not
business flows that are already handled.

## How to spend each wake
Open-ended. Examples of what "the single most useful thing" might be on any given wake:
- Error rate climbed in a container → find the root cause; file a task or propose a fix.
- One client/merchant generating repeated failures → check whether existing guards catch
  it; if not, find the bypass.
- Errors are low but one pattern dominates → ask whether it can be reclassified as
  handled (warn) instead of error.
- A container's CPU/memory creeping up → diagnose what changed.
- A new exception appeared that isn't in tasks/ → triage it.
- Cost accumulating on some line item → propose where to cut.
- Nothing actionable → say so and increase the wake interval.
Fit the work to what is actually happening this wake. Do not run a fixed checklist —
look at the system and decide.

## How to act
For each finding:
1. Document it in tasks/<slug>.md: symptom, evidence (timestamps + counts from the
   logs), hypothesis, proposed fix, effort, risk.
2. If the fix is small + obvious + covered by tests at the change site → ask the user
   "ship as v0.0.X?"; with approval: fix + commit + push (CI deploys after tests pass).
3. If the fix is larger or risky → propose it in the task and stop.

## Guardrails — non-negotiable
Allowed without asking: read-only Docker (containers + logs via the socket proxy),
read-only DB queries via the bastion, read-only git commands, writing files under
tasks/, reading source.
ASK FIRST: any git push, any deploy/redeploy in Dokploy, any `docker exec`/restart/stop,
any write to the database.
NEVER, even if asked: --force push to a protected branch, commits with --no-verify,
deleting volumes/backups/snapshots, modifying credentials.

## State
Treat tasks/*.md as persistent memory across wakes — read the existing ones before
creating new ones (do not duplicate). Treat git log as your action history. The user is
your colleague; tell them what you found in a short paragraph at the end of each wake.

## When to stop
Stop looping when the user says so, OR when 5 consecutive wakes find nothing worth
doing (then send a final summary and exit gracefully).
```

---

## Appendix B — minimal build checklist

- [ ] `oncall-cockpit` service: aggregator (Docker API client + demux + ring) · WS log
      fan-out · static cockpit UI · WS PTY bridge (tmux-backed).
- [ ] `docker-socket-proxy` sidecar, `CONTAINERS/LOGS/EVENTS` only.
- [ ] Image ships: node, git, docker CLI, psql, jq, tmux, `@anthropic-ai/claude-code`.
- [ ] Dokploy app + persistent volume (`/work` → tasks/ + sqlite) + Traefik route with
      TLS + auth middleware + IP allowlist on the terminal route.
- [ ] Env/secrets: `DOCKER_HOST`, `WATCH_LABEL`, `LOG_SINK`, `ANTHROPIC_API_KEY`,
      `AGENT_TOKEN_BUDGET`, auth creds.
- [ ] Label the watched services `oncall.watch=true`.
- [ ] First run: open the panel (auth) → terminal → `claude` → `/loop <Appendix A>`.

---

## Round Table — review & open questions (2026-06-24)

> BMAD party-mode review (independent subagents — Winston · Amelia · John · Sally).
> Each voice read this RFC and gave feedback from their domain. Their contributions are
> reproduced **verbatim** (PT-BR) below; the cross-cutting decisions they converged on
> (and disagreed on) are consolidated at the end as **Open decisions**.

### 🏗️ Winston — System Architect

A espinha dorsal é sólida — socket-proxy + Traefik-auth + single-container é a topologia certa para v1 — mas o doc está vendendo o caminho mais arriscado (terminal + agente com push) como se fosse o mesmo risco do caminho barato (log cockpit read-only), e isso precisa ser desacoplado na arquitetura.

**Ajustes concretos ao doc**

- **Reference-level › Topology:** separar o `oncall-cockpit` em **dois processos/portas Traefik distintos** — pane de logs (read-only, baixo risco) e terminal/agente (RCE, alto risco) — com middlewares de auth independentes. Hoje o doc mistura os dois atrás de uma única rota `cockpit.<domain>`; um forward-auth fraco no log pane não deveria abrir o PTY. Permite shippar v1 só com o log cockpit e o terminal atrás de feature-flag.
- **Reference-level › Log Aggregator › Discovery:** o doc diz "key on the service/name, not the id" mas não trata o **gap de reconciliação** em redeploy Dokploy (container velho morre, novo nasce com id novo). Especificar: ao receber evento `die`/`start`, re-anexar o stream com `since=<ts do último frame visto>` para não perder linhas na janela de troca, e deduplicar por `(container_id, ts)`.
- **Reference-level › Security:** o `docker-socket-proxy` da Tecnativa **não tem um flag `LOGS`** — logs são servidos sob o endpoint `CONTAINERS` (o `EXEC` é o que dá shell). Corrigir o item 1 e o Compose (`environment: { CONTAINERS: 1, EVENTS: 1, EXEC: 0, POST: 0, ... }`) e explicitar que `EVENTS=1` já habilita o stream de eventos que a reconciliação precisa. O `LOGS: 1` do sketch é enganoso.
- **Reference-level › Security › item 3 (redação):** mover redação de "antes do fan-out" para **antes de qualquer persistência também**. Do jeito que está, `LOG_SINK=sqlite` grava o log cru no volume sem passar pelo redactor — o secret vaza no disco mesmo com a UI limpa.
- **Rationale and alternatives › Build vs buy:** assumir Dozzle como baseline do log pane em vez de "strong candidate". Reescrever a aggregator do zero é exatamente o "build-your-own" que o nosso princípio de boring-tech desaconselha. O valor diferenciado do RFC é o **terminal+agente colado nos logs**, não o renderizador de logs. Recomendar: embed Dozzle (ou seu modo de fan-out) para o pane esquerdo, e gastar o esforço de engenharia no bridge PTY e nos guardrails.
- **Drawbacks / Topology:** declarar explicitamente que o terminal `tmux` é **single-session compartilhada** — dois operadores conectados veem e digitam no mesmo PTY (`oncall`). Isso é um risco de segurança e de UX que o doc não nomeia.
- **Configuration (env):** `AGENT_TOKEN_BUDGET` é um teto de gasto, mas não há mecanismo descrito de *enforcement*. Ou citar como será aplicado (hook do Claude Code? wrapper?) ou rebaixar para "best-effort, monitorado" — caso contrário é segurança teatral.

**Pontos em aberto**

1. **Vale o terminal embutido?** O agente `/loop` é o valor de negócio real (turning "logs nobody watches" into triaged tasks). O *terminal no browser* é o que carrega o blast-radius de RCE. Dá pra extrair 80% do valor com o agente rodando **headless** (já listado em Future possibilities) + log cockpit read-only, e deixar o PTY interativo como v2 opt-in? Isso muda a equação risco/valor inteira.
2. **Trust boundary do agente vs. proxy read-only:** o RFC promete que o agente "physically cannot `docker exec`" — mas ele tem **Docker CLI + git push + ANTHROPIC_API_KEY** no mesmo container. O guardrail é o proxy, não o agente. Se o agente roda `git push` sob aprovação, qual credencial ele usa, e essa credencial consegue tocar branch protegida? O "NEVER --force a protected branch" é prompt, não controle — precisa ser branch protection no servidor git.
3. **Backpressure sob incidente:** o pior momento (storm de erros às 2am) é exatamente quando o ring buffer satura e o drop-oldest descarta as linhas que o agente mais precisa. A política "drop-oldest" otimiza para o cliente lento, mas penaliza o caso de uso central. Vale um sink durável *sempre-ligado* (não opcional) para que o backfill do agente sobreviva à própria tempestade?
4. **Multi-node:** o doc difere para v2, o que é defensável — mas precisamos confirmar agora se o host Dokploy de prod é single-node. Se já for Swarm, "one cockpit per node" muda o design de auth e de fan-in e não pode ser um afterthought.

### 💻 Amelia — Senior Software Engineer

**Verdict:** Buildável, mas o doc descreve dois produtos (aggregator + agentic terminal) como um; o risco real não está na UI — está em (a) demux/reconnect do log stream sob churn de redeploy, (b) PTY+tmux survivability, e (c) redaction como gate de segurança hand-wavy. A seção Reference esconde os três pontos onde se gasta 80% do esforço.

**Ajustes concretos ao doc:**

- **§Log Aggregator → Streaming.** O header não é "8-byte: stream type + length" genérico — é `[STREAM_TYPE(1)][000][SIZE(4 big-endian)]` (8 bytes, byte 0 = 0/1/2, bytes 4–7 = uint32 BE). O doc precisa cravar: parser stateful (frame pode chegar partido entre chunks TCP → buffer de continuação), e detectar TTY via `GET /containers/{id}/json` campo `Config.Tty` **antes** de decidir demux vs raw. Sem isso o parser corrompe na primeira mensagem >64KB.
- **§Log Aggregator → Discovery.** "key on the service/name not the id" está certo mas incompleto: especificar que cada stream tem que carregar `?since=<lastTs>` no reconnect pós-redeploy, senão perde linhas no gap OU duplica o `tail`. Documentar a regra de dedup (ts+container+hash da linha) — hoje é hand-waving.
- **§Realtime transport → Backpressure.** "coalesce + rate-limit per-client" não é spec. Crave o mecanismo: high-water mark no `ws.bufferedAmount`; ao exceder, dropar com counter `dropped_n` enviado ao cliente (UI mostra "N linhas omitidas"). Sem número observável não há teste.
- **§Terminal Bridge.** Decisão build-vs-reuse está empurrada com a barriga. **ttyd já É servidor PTY+WS+xterm com `--writable` e flag de auth** — embutir ttyd backed por `tmux new-session -A -s oncall` elimina node-pty e o protocolo WS custom. node-pty só se a UI precisa do mesmo WS do log pane multiplexado. O doc deve escolher **ttyd como default**, node-pty como fallback, não listar ambos como equivalentes.
- **§Rationale → "embed/fork Dozzle".** Dozzle já faz discovery+demux+ring+fan-out+UI virtualizada. Se Dozzle entra, o "Log Aggregator" inteiro vira `iframe`/reverse-proxy + Dozzle, e o RFC só constrói o terminal+agent. O doc tem que **decidir**, não deixar como "strong candidate" — isso muda ~60% do escopo de build e do checklist do Appendix B.
- **§Security #3 / §Unresolved #6.** Redaction "antes do fan-out" está listada como segurança mas é best-effort por regex — não pode ser a defesa. Reclassificar: redaction = mitigação cosmética; a defesa real é a DB read-only role + nunca logar secret. Adicionar nota: redaction roda no path de fan-out E no sink durável (senão SQLite vira o leak).
- **§compose sketch.** Quebras concretas: (a) `docker-socket-proxy` precisa de `HEALTHCHECK`/`depends_on: condition: service_healthy`, senão o aggregator sobe antes do proxy e morre no connect; (b) faltam labels `oncall.watch=true` nos exemplos — o WATCH_LABEL não casa com nada; (c) a env do proxy precisa `POST=0` explícito já está, mas falta `EXEC=0` literal (citado no texto §Security #1, ausente no YAML — inconsistência); (d) sem `restart: unless-stopped` o cockpit não sobrevive a reboot do host.
- **§Dockerfile sketch.** `docker.io` (apt) traz o daemon inteiro — para CLI-only use `docker-ce-cli` do repo Docker, ou só o binário `docker` estático. Imagem encolhe e remove um daemon que nunca roda. Faltam `WORKDIR /work` como volume e a ausência de `USER` não-root — rodar Claude Code + git como root é evitável.
- **§Reference.** Falta a seção de **lifecycle do agente no boot**: como `/loop` re-arma após restart do container? tmux session morre com o PID 1. Precisa de `CMD` que faça `tmux new-session -d -s oncall 'claude'` + supervisor, ou o agente não "survives reconnects" como o doc promete (§Terminal Bridge afirma survivability; o sketch não entrega).

**Pontos em aberto:**

- **Testabilidade do demux:** dá pra cravar um teste unitário com fixtures de frames Docker partidos (chunk boundary no meio do header de 8 bytes, payload >64KB, mix stdout/stderr interleaved)? Sem corpus de fixtures gravado de um container real, o parser não tem red/green.
- **Reconnect sob redeploy:** qual o comportamento testável esperado quando Dokploy recria o container durante um write parcial de frame — o doc não define se a expectativa é "0 linhas perdidas" ou "best-effort com gap visível". Não dá pra escrever a AC sem essa decisão.
- **Backpressure como número:** sob um container cuspindo 50k linhas/s com cliente lento, qual a invariante medível — `bufferedAmount` nunca passa de X, read loop nunca bloqueia (mensurável como latência de outro container <Y ms)? Hoje não há nada falsificável.
- **Auth no WS do PTY:** Traefik forward-auth protege o HTTP upgrade, mas o doc não diz se o WS do terminal valida o token **a cada frame** ou só no handshake — e como se testa que um upgrade sem cookie é recusado (é o teste de segurança que importa mais que a UI inteira).

### 📋 John — Product Manager

**Job-to-be-Done (minha leitura):** "Quando algo quebra num container do meu fleet Dokploy às 2h da manhã, me ajude a perceber e triar *antes* das 9h — sem eu ter que abrir a UI do Dokploy serviço por serviço."

Esse é o job. Notem o que *não* está no job: "rodar um agente Claude". O agente é uma *solução* candidata, não o job.

**Ajustes concretos ao doc**

- **Summary — separe o escopo em duas frases de valor distintas.** Hoje o Summary funde "log cockpit" e "agente on-call" como se fossem um produto. São dois jobs: (a) *humano vê logs merged em tempo real*; (b) *agente tria sozinho de madrugada*. O cockpit entrega valor sem o agente. O agente **não** entrega valor sem o cockpit. Isso não é simetria — é uma dependência. Diga isso explicitamente: "v1 = cockpit; o agente é uma camada *opcional, flag-gated* (`AGENT_ENABLED=false` por padrão)."
- **Adicione uma seção `## Success Metrics` (não existe — é a lacuna mais grave do doc).** Um RFC que justifica todo o blast radius com "achado às 9h" e não mede MTTD está pedindo para ser construído por fé. Proponho: *Cockpit (v1):* tempo mediano até um humano ver um ERROR cross-container cai de X para < 30s (mede-se com um incidente sintético). *Agente (v2):* % de incidentes reais em que o `tasks/<slug>.md` do agente *precedeu* o report humano; e a taxa de sinal — quantas tasks o humano marcou como "útil" vs "ruído". Sem esse segundo número, o agente é indistinguível de um gerador de lixo caro.
- **Motivation — nomeie o usuário.** "Looking at what a fleet is doing" — *quem* olha? Quantas pessoas? Têm rotação de on-call hoje, ou é o Rodrigo às 9h percebendo sozinho? Se o fleet tem 8 containers e 1 pessoa, o cockpit é claramente justificável e o agente é teórico. Escreva a persona e a frequência real de incidentes/semana.
- **Mova "Build vs buy / Dozzle" de Alternatives para o coração do v1.** A própria seção admite que o Dozzle já faz o log pane "almost off-the-shelf". Então o v1 honesto é: *Dozzle atrás do auth wall + socket-proxy*. Pare de propor reconstruir o aggregator, demux de 8 bytes, ring buffer, fan-out WebSocket.
- **Unresolved questions — promova "qual o sinal do agente?" para questão #1.** As 6 perguntas atuais são todas de *implementação*. Nenhuma pergunta *se o agente vale a pena*. Adicione: "Em uma semana de logs reais, o agente teria produzido alguma task que mudou uma decisão? Se não conseguimos responder, não construímos o Agent Runner."
- **Drawbacks — o item "Agent trust" está subdimensionado.** O risco real: um agente que propõe fixes plausíveis-mas-errados *erode a confiança no cockpit inteiro*, e aí ninguém olha mais o pane que de fato funciona. O agente ruim pode matar o produto bom que ele vem junto.

**Pontos em aberto** (e quero respostas, não acenos)

1. **O agente resolve dor real, ou é "agente porque podemos"?** Nos últimos 90 dias, quantos incidentes "achados às 9h" *de fato* aconteceram? Se for "um ou dois", você está propondo um terminal-RCE-host-root-equivalent para economizar 7 horas, duas vezes por trimestre. Justifique o blast radius com a contagem real, ou corte o agente do v1.
2. **Quem *age* sobre o que o agente acha?** O loop pergunta "ship as v0.0.X?". Para *quem* às 2h17? Se ninguém aprova até as 9h, o agente só moveu "achado às 9h" para "task escrita às 2h, lida às 9h" — mesmo MTTR, mais tokens. Onde está o ganho que não seja só um push pro Slack (que a seção Future já lista como mais barato)?
3. **Por que xterm.js + PTY + tmux se o output do agente é texto em `tasks/` e git?** O terminal embutido é a peça de maior risco do RFC. Se o agente roda headless e escreve em `tasks/` + abre PR, o humano lê isso no GitHub — *sem terminal no browser*. O que o pane de terminal entrega que um PR + um tail de log não entregam, e esse delta justifica ser host-root-equivalent?
4. **Por que UM RFC e não dois?** O cockpit é shippável, mensurável e seguro sozinho. Amarrar os dois significa que a discussão de segurança do agente *bloqueia* o envio do cockpit. Separe: RFC-0048 = cockpit (ship). RFC-0048b = agente on-call (provar valor primeiro, num spike, com a métrica #2).

Resumo de uma linha: **construa o cockpit, plugue o Dozzle, ponha o auth wall — e faça o agente *ganhar* seu lugar com uma métrica de sinal antes de lhe dar a chave de host-root.**

### 🎨 Sally — UX Designer

**Uma cena — 2h17 da manhã.** O celular vibrou — `alarm-bundle` está cuspindo 502. A pessoa de plantão abre `cockpit.<domain>`: à esquerda, uma cachoeira de log rolando rápido demais para ler; à direita, um terminal onde o Claude já está na metade de um "wake". A pessoa precisa fazer **três coisas ao mesmo tempo**: achar a linha vermelha no meio da enxurrada, ler o que o agente pensa, e decidir se confia. O log não para — ela aperta `⏸ pause` e perde o "follow". O agente terminou e perguntou `ship as v0.0.7?` numa linha que já subiu para fora da tela. Ela não viu o pedido. O agente espera. Ninguém age. **É essa a cena que o RFC ainda não resolve:** o documento descreve *dois softwares lado a lado*, não *uma experiência* — dois panes competindo pela atenção humana exatamente quando ela é mais escassa.

**Ajustes concretos ao doc**

- **Adicionar uma seção nova `## UX / Interaction` (entre "Guide-level" e "Reference-level").** Hoje a UX está diluída num sub-bullet de "Cockpit UI". Um painel cujo valor inteiro é *atenção humana sob estresse* precisa de seção própria. A experiência do operador é o produto, não detalhe de implementação.
- **Guide-level mockup: adicionar uma "faixa de incidente" no topo, acima dos dois panes.** Uma linha de destaque única: *"⚠ alarm-bundle: 23 ERROR nos últimos 5 min — pico iniciou 12:01:04"*. É a resposta ao "como um humano vê o ÚNICO erro que importa": promover o sinal para fora da cachoeira. O log mergulhado é a evidência; a faixa é o diagnóstico.
- **Guide-level mockup + Terminal Bridge: explicitar como a AÇÃO e a APROVAÇÃO do agente aparecem.** Hoje `ship as v0.0.X?` vive como texto no xterm.js — que rola, que se perde. Propor uma **"Agent Action Bar"**: um card fixo *fora* do fluxo do terminal com o título da task, o diff/risco resumido, e botões `[Aprovar e shippar] [Ver task] [Recusar]`. O momento da aprovação é o momento mais importante de confiança do produto — não pode depender de a pessoa estar olhando a linha certa no segundo certo.
- **Reference-level → Cockpit UI: trocar "severity coloring" por severidade acessível.** Cor sozinha falha para ~8% dos homens (daltonismo) e no escuro às 2h. Especificar **ícone + cor + peso de fonte** por nível (ERROR = ◆ vermelho negrito, WARN = ▲ âmbar, INFO = · neutro) com contraste WCAG AA no tema escuro.
- **Reference-level → Cockpit UI: resolver o conflito pause vs. follow.** Ao rolar para cima, o follow desliga sozinho e aparece *"↓ N novas linhas — voltar ao vivo"* (padrão de chat/console). Pausar não deve significar perder o lugar.
- **Guide-level: adicionar "First run / Onboarding".** A primeira experiência hoje é colar um prompt gigante num terminal vazio. Especificar um estado inicial: terminal já abre com `/loop` pré-carregado (ou botão `▶ Iniciar plantão`), e o pane de logs mostra *"Observando 7 containers · aguardando primeiro evento"* em vez de tela preta.
- **Reference-level → Cockpit UI: nomear o "Thinnest Lovable UI".** A coisa mínima adorável **não é** os dois panes. É: pane de log mergulhado + filtro + faixa de incidente + severidade acessível, com o agente rodando *headless* e empurrando seu pedido de aprovação para um único banner. O terminal xterm.js completo pode ser **v1.1**.
- **Drawbacks "Agent trust": ligar a uma decisão de UX.** A mitigação é de UX, não de prompt: todo pedido de aprovação precisa mostrar **evidência (timestamps + counts)** e **o diff proposto** *antes* dos botões. Confiança se constrói tornando o raciocínio inspecionável no momento da decisão.

**Pontos em aberto (UX)**

1. **Divisão de atenção:** dois panes ativos competindo é caro no pior momento. O humano deve *dirigir* (olhar logs, mandar o agente) ou *supervisionar* (agente dirige, humano aprova)? O layout muda completamente conforme a resposta — e o RFC assume os dois sem escolher.
2. **UX da aprovação:** onde vive o `ship as v0.0.X?` para ser *impossível* de perder, mas sem virar pop-up fechado no automático? Banner persistente, badge na aba, notificação de SO/Slack? E o estado "agente bloqueado esperando humano" precisa ser visível à distância.
3. **Sinal vs. ruído:** quem decide "a linha que importa" — o humano caçando, ou o agente promovendo? Se a faixa de incidente é heurística (error-rate spike), como evitar flapping? O produto morre se a faixa mentir duas vezes.
4. **Confiança no primeiro contato:** na primeira semana, qual a UX que mostra "o que o agente *teria* feito" sem ele agir — um modo *shadow/dry-run* para o humano calibrar a confiança antes de soltar os botões de aprovação?

### Open decisions (consolidated — for Rodrigo)

The table converged hard on a few things and split on others. Decisions needed before build:

1. **Split scope / flag-gate the agent.** (John ⬆, Winston, Amelia, Sally) — `v1 = read-only log cockpit` (ships alone, measurable, low risk); the agent becomes an **opt-in, flag-gated** layer (`AGENT_ENABLED=false` default), possibly its own RFC-0048b. **Decide:** one RFC with a flag, or split into two?
2. **Adopt Dozzle for the log pane** instead of hand-building the aggregator. (Winston, Amelia, John) — would cut ~60% of build; the RFC's *differentiated* value is the terminal+agent, not the log renderer. **Decide:** embed/reverse-proxy Dozzle vs build the aggregator.
3. **Embedded terminal (RCE) vs headless agent.** (Winston #1, John #3, Sally) — does the browser PTY earn its host-root blast radius, or does a headless agent writing `tasks/` + opening a PR get ~80% of the value at a fraction of the risk? (Terminal → v1.1/v2.)
4. **Security corrections (must-fix, factual).** (Winston, Amelia) — `docker-socket-proxy` has **no `LOGS` flag** (logs are served under `CONTAINERS`; `EXEC` is the shell gate) → fix §Security + the compose env; add `EXEC=0` literal to the YAML; run **redaction before persistence**, not just before fan-out (else `LOG_SINK=sqlite` leaks to disk); reclassify redaction as cosmetic — the real defense is the DB read-only role.
5. **Approval UX — "Agent Action Bar".** (Sally, Winston) — `ship as v0.0.X?` gets lost in terminal scroll / a **shared single tmux session**; surface approvals out-of-band (persistent banner with task title + evidence + diff + approve/reject), plus a **shadow/dry-run** mode for trust calibration.
6. **Add a `## Success Metrics` section.** (John) — cockpit MTTD < 30s (synthetic incident); agent **signal ratio** (useful tasks vs noise) + "did the agent's task precede the human report?". Without the agent-signal metric, don't build the Agent Runner.
7. **Who acts on findings at 2am?** (John #2) — if no one approves until 9am, the agent only moved "found at 9am" → "task written at 2am, read at 9am" (same MTTR, more tokens). Justify vs a cheap Slack push.
8. **Agent git-push credential & branch protection.** (Winston #2) — "NEVER --force a protected branch" is prompt, not control; enforce server-side branch protection; pin which credential the agent pushes with and what it can reach.
9. **Backpressure under storm.** (Winston #3, Amelia) — drop-oldest discards exactly the lines the agent needs during a 2am storm; consider an **always-on durable sink** so backfill survives; define a falsifiable backpressure invariant (`ws.bufferedAmount` cap + `dropped_n` counter shown in UI).
10. **Single-node vs multi-node Dokploy.** (Winston #4) — confirm the prod host is single-node now; Swarm changes auth + fan-in and can't be an afterthought.
11. **Implementation specifics to harden.** (Amelia) — Docker frame demux `[type(1)][000][size(4 BE)]` stateful parser + TTY detection (`Config.Tty`); reconnect with `?since=<lastTs>` + dedup rule; **ttyd as the default terminal** (not node-pty); compose `HEALTHCHECK`/`depends_on: service_healthy`, `restart: unless-stopped`, the `oncall.watch=true` labels; Dockerfile `docker-ce-cli` (not `docker.io`) + non-root `USER`; agent boot lifecycle (tmux session must survive PID 1).

> **Status after round table:** Draft → **needs revision.** The strongest cross-cutting signal: *ship the cockpit (Dozzle + auth wall + socket-proxy) as v1, and make the agent earn its place behind a flag with a signal metric.* Decisions 1–3 are the forks that reshape the rest.
