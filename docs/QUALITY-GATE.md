# Quality Gate — GitHub-native CI

- **Status:** Active on every PR to `main` and `desenv`
- **Goal:** Catch code smells, security issues, and enforce coverage on
  PRs without paying for SonarCloud.
- **Stack:** ESLint (with `eslint-plugin-sonarjs`) + Jest coverage +
  CodeQL — all native to GitHub Actions, free for any repo.
- **Companion files:**
  - [`.github/workflows/pr-quality.yml`](../.github/workflows/pr-quality.yml) — lint + tests + coverage
  - [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml) — security scan
  - [`.eslintrc.json`](../.eslintrc.json) — lint rules incl. SonarJS smells
  - [`tsconfig.eslint.json`](../tsconfig.eslint.json) — TS project pointing at src/ + tests/

---

## TL;DR

Every PR triggers four checks:

| Check                            | Tool                                       | Blocks merge if…                        |
| -------------------------------- | ------------------------------------------ | --------------------------------------- |
| **Typecheck**                    | `tsc --noEmit`                             | TS errors                               |
| **Tests + coverage**             | Jest + `coverageThreshold`                 | global coverage < 10% (raised gradually) |
| **Lint (changed files only)**    | ESLint + `eslint-plugin-sonarjs`           | any `error` rule fires on PR-touched .ts |
| **Security scan**                | CodeQL `security-extended` queries         | high/critical security finding           |

Plus a **PR comment** with the coverage table for visibility (no hard
gate — informational).

---

## Why GitHub-native instead of SonarCloud

SonarCloud is **paid for private repos** (~$11/dev/month). For a private
repo like `gcdr.git`, the free alternative needs to cover:

| Sonar feature                  | GitHub-native equivalent                                  |
| ------------------------------ | --------------------------------------------------------- |
| Code smells (250+ JS/TS rules) | `eslint-plugin-sonarjs` — same rules, runs locally + CI   |
| Security hotspots / vulns      | **CodeQL** (better — same engine GitHub uses internally)  |
| Bug detection                  | TypeScript strict + ESLint `no-floating-promises` etc.    |
| Coverage threshold             | Jest `coverageThreshold` in `jest.config.js`              |
| Coverage report HTML           | Jest `lcov` reporter → `coverage/lcov-report/index.html`  |
| Coverage on new code (diff)    | jest-coverage-comment posts table on PR (no hard gate v1) |
| PR check / status              | Native — every job is a check                             |

What we lose:
- "Maintainability rating A/B/C/D" — SonarCloud's letter grades. No equivalent; ESLint warnings/errors are more actionable per-rule.
- "Technical debt in hours" — estimation feature. No equivalent.

What we gain:
- Zero cost
- Zero infra to maintain
- ESLint runs in the IDE locally (instant feedback, no CI roundtrip)
- CodeQL is GitHub's own scanner — best-in-class for security on JS/TS

---

## Local commands

### Lint locally

```bash
npm run lint                              # full repo (errors + warnings)
npm run lint:fix                          # auto-fix what's auto-fixable
npx eslint src/services/qrc/ --quiet      # single folder, errors only
```

The ESLint config (`.eslintrc.json`) extends:
- `eslint:recommended` — language-level rules
- `@typescript-eslint/recommended` — TS-specific rules
- `plugin:sonarjs/recommended` — code-smell rules from SonarJS

Test files get a more relaxed override (no `no-explicit-any`, no
`no-duplicate-string`, no `cognitive-complexity` cap — tests legitimately
have repetition and complex setup).

### Tests + coverage

```bash
npm test                                       # all tests, no coverage
npm run test:coverage                          # all tests + coverage to coverage/
npm run test:unit                              # unit tests only
npx jest path/to/file.test.ts --coverage       # single file
npm run test:unit -- --testPathPattern=qrc     # by name pattern
```

### Open the HTML coverage report

```bash
# After `npm run test:coverage`:

# macOS
open coverage/lcov-report/index.html

# Linux
xdg-open coverage/lcov-report/index.html

# Windows (PowerShell or Git Bash)
start coverage/lcov-report/index.html
```

The report is per-file with line-level highlighting, branch coverage,
and a sortable summary table.

### Run the full CI bundle locally

```bash
npm run typecheck && npm run test:coverage && npm run lint
```

If any step fails, CI will fail too — same commands.

---

## CI workflow walkthrough

### `.github/workflows/pr-quality.yml`

```
┌─────────────────────────────────────────────────────────────┐
│ Trigger:  PR open/sync to main or desenv                    │
│           push to main or desenv                             │
└─────────────────────────────────────────────────────────────┘
                  │
   ┌──────────────┴──────────────┐
   ▼                             ▼
┌────────────────┐         ┌─────────────────┐
│ typecheck-and- │         │  lint-changed-  │
│     test       │         │     files       │
│                │         │                 │
│ • npm ci       │         │ • npm ci        │
│ • typecheck    │         │ • tj-actions/   │
│ • test:ci      │         │   changed-files │
│ • upload html  │         │ • eslint        │
│   coverage     │         │   --max-warn 0  │
│ • upload junit │         │   <changed>     │
│ • PR comment   │         │                 │
└────────────────┘         └─────────────────┘
```

**Key design decisions:**

- **Lint only changed files** — pre-existing 10 errors in unrelated files
  don't block new PRs. Standard "new code" pattern.
- **Threshold currently low (10%)** — current global coverage is ~5%.
  Setting 50% globally would block every PR. Raise gradually:

  ```
  jest.config.js → coverageThreshold:
    branches:   10% → 30% → 50% → 70%
    functions:  15% → 30% → 50% → 70%
    lines:      10% → 30% → 50% → 70%
    statements: 10% → 30% → 50% → 70%
  ```

  The QRC service layer is already at 70-100% coverage; the average
  is dragged down by big untested files (AuthService, AlarmBundleService,
  CustomerService, etc.). Test-as-you-touch policy plus a few targeted
  test sprints is the path to 50%.

### `.github/workflows/codeql.yml`

Standalone — runs on the same triggers plus a weekly cron. Uses the
`security-extended` query suite. Findings appear as:

- **PR review comments** inline on the diff
- **Code Scanning alerts** at repo Settings → Security → Code scanning

Queries available:
- `security-and-quality` (broadest; high noise from quality issues)
- `security-extended` ← **what we use** (security only, expanded set)
- `security` (default; smallest set)

---

## Artifacts produced on every run

After each PR run, two artifacts are downloadable from the workflow page
(GitHub Actions tab → click run → Artifacts section):

- **`coverage-html`** — unzip and open `lcov-report/index.html`
- **`jest-junit`** — XML for IDE / external dashboards

PR comments produced:
- **Coverage summary** (jest-coverage-comment) — table of overall %
- **CodeQL findings** (when issues are found) — inline review comments

---

## Failure modes and recovery

| Failure                                                          | Fix                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `coverage threshold for X (10%) not met: Y%`                     | Add tests for new code; or lower threshold temporarily if a refactor moves code around without changing logic. |
| ESLint error on PR-touched file                                  | Click the failed step → fix the rule violation, or add a per-line `// eslint-disable-next-line <rule>` with rationale. |
| `Parsing error: ESLint was configured to run on … <tsconfig>`    | The file isn't in `tsconfig.eslint.json`. Add it to `include` there.      |
| CodeQL flagged a finding                                         | Click the alert → "Show in PR" → fix in code, or dismiss as false-positive with reason. |
| `tj-actions/changed-files` shows zero files but expected matches | Make sure base branch is fetched (workflow already does `fetch-depth: 0`).|

---

## How to raise coverage on existing code

The roadmap (rough): each touched service file gets a `*.test.ts` next to
it before non-trivial changes. Reference the QR Checker tests for the
mock-everything pattern:

- `tests/unit/services/qrc/QrcPinService.test.ts` — pure helpers (100%)
- `tests/unit/services/qrc/InstallationService.test.ts` — service with
  multiple repo dependencies, audit-emission assertions

Priority files to test next (high traffic, currently ~0% covered):

- `src/services/AuthService.ts` — auth flow + token signing
- `src/services/AlarmBundleService.ts` — bundle versioning + cache
- `src/services/RegistrationService.ts` — registration + lockout
- `src/services/CustomerService.ts` — only `setDefaultCustomer` is covered

After three or four such PRs, raise the global threshold in
`jest.config.js` by 10pp.

---

## Pre-existing lint issues (not blocking new PRs)

Running `npm run lint` shows ~10 errors and ~240 warnings in the codebase
today. Examples:

- `src/services/DeviceSyncJobService.ts:183` — `!=` vs `!==`
- `tests/unit/repositories/WikiPageRepository.sql.test.ts` — `require()` instead of `import`
- 3 files using `Function` as a type (`@typescript-eslint/ban-types`)

Because the CI lint step runs **only on changed files**, these don't
block PRs. They get fixed as those files are touched in regular work
(or in a one-off cleanup PR).

---

## Optional: enable Code Scanning + Dependabot

Two more zero-cost gates worth turning on:

1. **Code Scanning** — GitHub auto-discovers our CodeQL workflow and
   surfaces alerts at *repo Settings → Code security → Code scanning*.
   Requires Code Scanning enabled in the org plan.
2. **Dependabot security updates** — auto-PRs for vulnerable dep
   versions. Enable at *repo Settings → Code security → Dependabot
   alerts / security updates*.

Both are free for private repos with GitHub Advanced Security (included
in many GitHub plans, free for public repos).

---

## Pending / future work

- **Coverage diff gate (≥ 50% on new lines)** — currently informational
  via the PR comment. To make it a hard gate without paying for
  SonarCloud, the cleanest options are:
  - [Codecov](https://about.codecov.io/) free plan — has diff coverage
    threshold, posts PR comment, includes a single-line GitHub Action.
    Free tier includes private repos with limits.
  - [Coveralls](https://coveralls.io/) — same shape, also free.
  - Self-rolled bash + lcov-parse — possible but maintenance cost.
- **Raise `coverageThreshold` in `jest.config.js`** as global average
  climbs.
- **Fix the 10 pre-existing lint errors** in a one-off PR so we can
  switch from "lint changed files" to "lint all".
