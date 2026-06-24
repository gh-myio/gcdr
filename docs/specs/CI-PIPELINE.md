# Backend CI Pipeline — Quality Gates & Security Scan

**Repo:** `gh-myio/gcdr` (backend) · **Scope:** what runs on every pull request and push, what blocks a merge, and how to reproduce it locally.

> Source of truth: `.github/workflows/pr-quality.yml` and `.github/workflows/codeql.yml`. If this doc and a workflow disagree, the workflow wins — open a PR to reconcile.

---

## 1. Overview

Two workflow files drive CI. Together they surface **four checks** on a pull request:

| Check (as shown on the PR) | Workflow · job | Blocks merge on |
| --- | --- | --- |
| **PR Quality Gate / Typecheck + tests + coverage** | `pr-quality.yml` · `typecheck-and-test` | `tsc --noEmit` error · Jest test failure · coverage below threshold |
| **PR Quality Gate / Lint (changed files)** | `pr-quality.yml` · `lint-changed-files` | any ESLint error/warning in a **changed** `.ts` file |
| **CodeQL Security Scan / Analyze (javascript-typescript)** | `codeql.yml` · `analyze` | the analysis itself failing to run |
| **Code scanning results / CodeQL** | GitHub-native gate (fed by `codeql.yml`) | new **high-severity** CodeQL alerts on the diff |

**Triggers (both workflows):** `pull_request` and `push` to `main` and `desenv`. `codeql.yml` also runs a weekly full-repo scan (`cron: '0 6 * * 1'`, Mon 06:00 UTC).

**Concurrency:** `pr-quality.yml` cancels in-progress runs for the same PR when new commits arrive (`cancel-in-progress: true`).

**Runtime:** `ubuntu-latest`, Node.js `20` (`actions/setup-node@v4`, npm cache), `npm ci`.

---

## 2. `pr-quality.yml` — PR Quality Gate

### Job: `typecheck-and-test` ("Typecheck + tests + coverage")
Steps:
1. `npm run typecheck` → `tsc --noEmit`.
2. `npm run test:ci` → `jest --ci --coverage --reporters=default --reporters=jest-junit`.
   - **Env:** `DATABASE_URL=postgres://test:test@localhost:5432/test`, `WO_PIN_PEPPER=<ci pepper>` (see workflow). These are CI placeholders, not real secrets.
   - Coverage **threshold is enforced by `jest.config.js` `coverageThreshold`** (the test run fails if coverage drops below it).
3. Upload artifacts (always): `coverage/` HTML report + `junit.xml`.
4. On PRs, post a coverage table comment via `MishaKav/jest-coverage-comment` (needs `pull-requests: write`).

### Job: `lint-changed-files` ("Lint (changed files)")
Runs only on `pull_request`. A **new-code** gate — it does **not** lint the whole repo.
1. `actions/checkout` with `fetch-depth: 0` (needs full history for the diff).
2. `tj-actions/changed-files@v45` lists changed files matching `src/**/*.ts`, `tests/**/*.ts`, `scripts/**/*.ts`.
3. If any changed: `npx eslint --max-warnings 0 <changed files>` — **zero warnings allowed** on touched files.
4. If none changed: no-op (lint skipped).

> **Why changed-files only:** the repo carries legacy lint debt; a whole-repo lint would red-wall every PR. This gate keeps *new/touched* code clean while old files are fixed opportunistically when edited.

---

## 3. `codeql.yml` — CodeQL Security Scan

GitHub-native static analysis (free). Catches injection (SQL/command/NoSQL), hard-coded secrets, unsafe regex/ReDoS, path traversal, prototype pollution, unsafe deserialization, crypto misuse, and **missing rate limiting on authenticated routes**.

- Language: `javascript-typescript`. Query pack: **`security-extended`** (higher-severity rules; more analysis time than the default).
- Steps: `codeql-action/init` → `codeql-action/autobuild` → `codeql-action/analyze` (`category: /language:javascript-typescript`).
- Permissions: `security-events: write` (to post findings to Code Scanning).
- Findings appear **inline on the diff** as review comments, and the **Code scanning results / CodeQL** check blocks the merge when there are new high-severity alerts.

---

## 4. Coverage policy

Enforced via `jest.config.js` `coverageThreshold`:
- A **low global floor** (currently ~3% lines/functions/statements, ~1% branches) so the gate doesn't block legacy code.
- **Higher thresholds scoped to well-tested paths** (e.g. ~20–28%) to ratchet quality where it already exists.
- **Raise gradually** as old code gets tested — never lower the floor to make a red build pass.

---

## 5. Run it locally (before pushing)

```bash
npm ci
npm run typecheck                       # = tsc --noEmit
npm run lint                            # eslint src/ tests/ --ext .ts   (whole repo; CI only lints changed files)
npx eslint --max-warnings 0 <your-changed-files>   # mirror the CI new-code gate exactly
npm run test:ci                         # jest --ci --coverage  (DATABASE_URL/WO_PIN_PEPPER may be needed)
npm run quality                         # lint + test:coverage (convenience)
```

---

## 6. Known quirks & gotchas

- **CodeQL only recognizes `express-rate-limit`** for the `js/missing-rate-limiting` rule — the repo's custom `rateLimit` middleware is **not** recognized, so a route guarded by it can still be flagged. The fix pattern is to route through `express-rate-limit` (precedent: the RFC-0046 goals commit *"use express-rate-limit on the goals route (CodeQL recognition)"*). See PR #10 for a live example (centrals enroll/poll routes).
- **`js/user-controlled-bypass`** flags conditions guarded by a request-controlled value even when a later cryptographic check is the real gate (e.g. `centralAuth` selecting a secret by the `uuid` header). A code comment does **not** silence CodeQL — these need a **dismissal with justification** in the Code Scanning UI, or a refactor.
- **Node 20 deprecation:** GitHub is phasing out Node-20 actions; the lint job logs a deprecation warning (non-blocking). Bump to Node 22 when convenient.
- **`test:ci` needs DB env:** some tests expect `DATABASE_URL`/`WO_PIN_PEPPER`; the workflow injects CI placeholders. Integration tests requiring a live Postgres are **not** run in this gate.

---

_Documents the CI as configured in `.github/workflows/`. Update alongside any workflow change._
