# Quality Gate — SonarCloud + GitHub Actions

- **Status:** Active on every PR to `main` and `desenv`
- **Goal:** Catch code smells, bugs, security hotspots, and enforce 50%
  coverage on **new code** before merge.
- **Companion files:**
  - [`.github/workflows/pr-quality.yml`](../.github/workflows/pr-quality.yml) — CI workflow
  - [`sonar-project.properties`](../sonar-project.properties) — Sonar config

---

## TL;DR

- Open a PR → GitHub Actions runs `typecheck`, `test:ci` (with coverage),
  uploads HTML coverage as a workflow artifact, then runs **SonarCloud**.
- If the **quality gate** fails (coverage < 50% on new code, or any blocker
  smell/bug/security issue introduced), the PR is blocked from merging.
- Old code is not retroactively held to 50% — only **lines added by the
  PR** are measured. The repo can grow into 50% global over time.

---

## Local commands

### Run the full quality bundle locally before pushing

```bash
npm run typecheck         # tsc --noEmit
npm run lint              # eslint src/ tests/ --ext .ts        (TODO: needs config — see below)
npm run test:coverage     # jest --coverage  → coverage/
```

### Open the HTML coverage report

```bash
# After `npm run test:coverage`, open the index file in your browser:

# macOS
open coverage/lcov-report/index.html

# Linux
xdg-open coverage/lcov-report/index.html

# Windows (PowerShell)
start coverage/lcov-report/index.html

# Windows (Git Bash)
start coverage/lcov-report/index.html
```

The report is per-file with line-level highlighting for covered/uncovered
lines, branch coverage, and a sortable summary table at the top.

### Run a single file's tests with coverage

```bash
# Re-run only one suite (faster feedback loop):
npx jest tests/unit/services/qrc/InstallationService.test.ts --coverage

# Or filter by name:
npm run test:unit -- --testPathPattern=qrc
```

### Run SonarCloud scanner locally (optional)

You don't need this in the normal workflow — CI runs it on every PR — but
if you want to see the scan results before pushing:

```bash
# Set your token once (get one from https://sonarcloud.io/account/security):
export SONAR_TOKEN=<your-token>

# Run jest first to produce coverage/lcov.info:
npm run test:coverage

# Then run the sonar-scanner CLI:
npx sonar-scanner \
  -Dsonar.host.url=https://sonarcloud.io \
  -Dsonar.token=$SONAR_TOKEN
```

The first time, run:
```bash
npm i -D sonar-scanner
```

Output appears at `https://sonarcloud.io/project/overview?id=gh-myio_gcdr`.

---

## What the quality gate checks

Configured in SonarCloud's UI under **Project Settings → Quality Gate →
Sonar way (with our overrides)**. The gate is the *Sonar way* default
plus our coverage tightening:

| Metric                                  | Threshold                                 |
| --------------------------------------- | ----------------------------------------- |
| **Coverage on new code**                | **≥ 50%**                                 |
| Duplicated lines on new code            | ≤ 3%                                      |
| Maintainability rating on new code      | A (no major code smells introduced)       |
| Reliability rating on new code          | A (no bugs introduced)                    |
| Security rating on new code             | A (no vulnerabilities introduced)         |
| Security hotspots on new code reviewed  | 100%                                      |

> **Why "new code" only?** Current global coverage is ~5%. Forcing 50% on
> the whole codebase would block every PR with a "fix this 30k-line
> backlog first" message. The new-code gate is the standard SonarCloud
> pattern: every PR pulls coverage upward without halting development.

When the global average crosses 50%, raise the bar:

```
New code coverage:    50% → 70% → 80%
Overall coverage:     5%  → 30% → 50% → 70%
```

A future RFC can flip overall to a hard 50% gate once the baseline is high
enough that the cost of writing tests for a touched file is reasonable.

---

## CI workflow — what runs on every PR

`.github/workflows/pr-quality.yml`

```
┌────────────────────────────────────────────────────────────────┐
│ Trigger:  PR open/sync to main or desenv                       │
│           push to main or desenv                                │
└────────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
   ┌─────────────────┐             ┌─────────────────┐
   │ typecheck-and-  │             │   sonarcloud    │
   │     test        │  ────►      │   (depends on   │
   │                 │             │   typecheck job)│
   │ • npm ci        │             │ • npm ci        │
   │ • typecheck     │             │ • test:ci       │
   │ • test:ci       │             │ • sonar-scanner │
   │ • upload html   │             │                 │
   │   coverage      │             │ Quality gate    │
   │   artifact      │             │ pass/fail posts │
   └─────────────────┘             │ as PR check     │
                                   └─────────────────┘
```

### Coverage artifact

After every PR run, the **`coverage-html`** artifact is downloadable from
the workflow page (Actions tab → click run → Artifacts section). Unzip
and open `lcov-report/index.html` to inspect coverage exactly like
locally.

### Junit report

`junit.xml` is also uploaded for IDE integrations / external dashboards
that consume Jest output in JUnit format.

---

## SonarCloud setup (one-time, repo admin)

These are the steps to wire SonarCloud to this repo. Already done if
the badge in the README is green.

1. **Create a SonarCloud organization** matching the GitHub org
   (`gh-myio`). Use "Import from GitHub" so org membership stays in
   sync. Free for public repos; paid plan for private.
2. **Add the project** by importing `gcdr.git`. SonarCloud generates the
   `projectKey` (`gh-myio_gcdr`); confirm it matches
   `sonar-project.properties`.
3. **Set the analysis method** to "GitHub Actions" (not the legacy
   automatic analysis, which doesn't read `sonar-project.properties`
   correctly for TypeScript).
4. **Generate a token** at *Account → Security → Generate Token* and
   add it to the GitHub repo:
   - GitHub → Settings → Secrets and variables → Actions → New repository
     secret
   - Name: `SONAR_TOKEN`
   - Value: the token from step 4
5. **Configure the quality gate** under *Project → Quality Gate*:
   - Start from "Sonar way" template
   - Edit the "Coverage on new code" condition to ≥ 50%
   - Save
6. **Set the new-code definition** under *Project → New Code* to
   "Previous version" or "Number of days = 30" — whichever matches
   the team's release cadence.

---

## Failure modes and recovery

| Failure                                                                     | What to do                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------- |
| **`coverage < 50% on new code`**                                            | Add tests for the lines you added. The HTML report shows red lines — those are the priority. |
| **`Maintainability A` not met (code smell introduced)**                      | Click the SonarCloud PR comment → fix the smell or mark "won't fix" with rationale (smell stays but doesn't block). |
| **`Reliability A` not met (bug introduced)**                                | Real bug — fix it. Sonar's null-check, exception, and contract bugs are usually accurate. |
| **`Security A` not met (vulnerability)**                                    | Critical — fix before merge. Don't override. |
| **`Security hotspots reviewed < 100%`**                                     | Click each hotspot, mark "Safe" or "Fix" with rationale. Hotspots ≠ vulnerabilities; they're pattern-matched code that *might* be one. |
| **Sonar didn't run**                                                        | Forks can't access `SONAR_TOKEN`. Ask a maintainer to push the branch from a non-fork to trigger the scan. |
| **`token=*** is not authorized` in workflow log**                           | The token expired or was revoked. Generate a new one and update the GitHub secret. |

---

## How to bring up coverage on existing code

The roadmap (rough): each touched service file gets a `*.test.ts` next to
it before non-trivial changes. Reference the QR Checker tests for the
mock-everything pattern:

- `tests/unit/services/qrc/QrcPinService.test.ts` — pure helpers
- `tests/unit/services/qrc/InstallationService.test.ts` — service with
  multiple repo dependencies, audit-emission assertions

Priority files to test next (high traffic, currently ~0% covered):

- `src/services/AuthService.ts` — auth flow + token signing
- `src/services/AlarmBundleService.ts` — bundle versioning + cache
- `src/services/RegistrationService.ts` — registration + lockout
- `src/services/CustomerService.ts` — only `setDefaultCustomer` is covered today

---

## Pending — ESLint config

`npm run lint` currently fails because no ESLint config exists at the
repo root. The script is referenced by `npm run quality` but commented
out of the CI workflow until the config lands.

To unblock:
1. Add `.eslintrc.json` at repo root pointing at
   `@typescript-eslint/recommended`.
2. Add `eslint-plugin-jest` for the tests folder.
3. Reintroduce `npm run lint` to the CI workflow's `typecheck-and-test`
   job.

This is a separate task — not blocking on Sonar.
