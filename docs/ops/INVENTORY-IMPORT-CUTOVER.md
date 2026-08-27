# Inventory Import & Cutover Runbook (RFC-0061 M10)

Operational guide for importing the legacy **"Myio Compras"** system
(Lovable/Supabase, `comprasmyio.lovable.app`) into the GCDR inventory domain
(`inv_*`), and for the **two-wave cutover** defined in RFC-0061
(§Migration & import, J1/J2/W5/A5).

- Import script: `scripts/inventory/import-comprasmyio.ts`
- RBAC seeds: `scripts/db/seeds/v1.0.0/17-inventory-rbac.sql`
- Unit tests of the transformations: `tests/unit/inventory/m10-import.test.ts`

---

## 1. The import script

```
tsx scripts/inventory/import-comprasmyio.ts \
  --backup ./comprasmyio-backup.json \
  [--supabase-url https://<project>.supabase.co --supabase-key <service-key>] \
  [--tenant 11111111-1111-1111-1111-111111111111] \
  [--files-dir ./buckets] \
  [--report ./m10-parity-report.json] \
  [--dry-run] \
  [--wipe-first --yes] \
  [--allow-diff] \
  [--actor <gcdr-user-uuid>] \
  [--curated-third-party "Nome A,Nome B"]
```

| Flag | Meaning |
|---|---|
| `--backup <path.json>` | **Required.** The source's `exportDatabaseBackup` JSON (map table → rows[]). |
| `--supabase-url` / `--supabase-key` | Fetch via PostgREST the tables the backup misses (`tool_assets`, `tool_movements` — Appendix C defect #5) **and** the 3 balance views for the parity snapshot. Also read from env `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`. Never hardcode credentials; put them in env or paste flags from a secret manager. |
| `--tenant <uuid>` | Target tenant (default `11111111-1111-1111-1111-111111111111`). |
| `--dry-run` | Full planning + report, **zero writes**. Parity is computed from the planned movements. Works without `DATABASE_URL` (then user/customer matching is skipped, with a warning). |
| `--files-dir <path>` | Directory with the storage buckets downloaded as `<dir>/<bucket>/<path>` (buckets: `order-attachments`, `assembly-photos`, `product-images`). Files found become `file_assets` rows with `storageProvider=LOCAL`. Without it, nullable photo columns stay NULL; **NOT NULL** photo/proof columns (`inv_assembly_releases.photo_file_id`, `inv_item_deliveries.photo_file_id`, `inv_shipments.proof_file_id`) get a single shared LOCAL **placeholder** asset (`metadata.placeholder=true`) — every use is counted in the report's `missingFiles` section. |
| `--report <path.json>` | Where to write the parity/import report (defaults to `./m10-import-report-<ts>.json`). |
| `--wipe-first --yes` | Delete ALL `inv_*` rows of the tenant (plus the import's own `file_assets`, matched by `metadata.import = "comprasmyio"`) before importing. `--yes` is the required confirmation. Recommended for weekly rehearsals. |
| `--allow-diff` | Do not fail (exit 2) on parity divergence. Use only with a curated, named exception list. |
| `--actor <uuid>` | GCDR user recorded as uploader of created `file_assets` (defaults to the nil UUID). |
| `--curated-third-party "A,B"` | Appendix B curated list: `materials` names that map to domain `THIRD_PARTY` instead of `COMPONENT`. |

`DATABASE_URL` must be set (same convention as `db:mig:*`) except for a
standalone `--dry-run`.

### What it does (operational contract, RFC A5)

1. **Topological order** — items (merging duplicate names per domain across
   locations, DEC-3) → BOMs → customers/projects (clients matched to existing
   GCDR customers by normalized name, created as flat `COMPANY` customers when
   absent) → purchase orders + events (legacy statuses
   `comprado`/`aguardando`/`a_caminho` → `COMPRADO_AGUARDANDO`; doubled
   `order_logs` de-duplicated) → assembly releases → homologations + units
   (+ `inv_qr_registry` UNIT/BOX rows) → stock movements + movement QRs
   (location = the material row's location at import time) → expedition
   (orders → items → deliveries → delivery QRs → shipments; free-text product
   names resolved to item FKs, unmatched names create `PRODUCT` items flagged
   for curation) → production/purchase demands → field (unit products,
   technician moves — destination `AVARIADO` is now valid —, damaged items) →
   external states/sync state.
   *The physical insert order is FK-safe (e.g. homologation units are inserted
   before the movement-QR rows that reference them); it preserves the RFC's
   data-dependency order.*
2. **Raw-ledger mode** — historical movements are written directly via Drizzle
   with `imported = true`; the M2 service guards (QR/photo exit requirements,
   negative-stock lock) intentionally do NOT run for legacy rows.
3. **Users** — source `profiles` matched to GCDR users by email
   (case-insensitive). Unmatched actors import with `created_by NULL`; their
   names survive in free-text fields where the schema has one
   (`responsible`, `technician`, `[Solicitante legado: …]` note) and the full
   unmatched list is in the report.
4. **Parity report** — step 0 snapshots the source's three balance views
   (`material_stock`, `terceiros_material_stock`, `tool_asset_stock`); after
   import, the ledger (`inv_stock_movements` aggregated exactly like
   `InventoryStockRepository`: in = ENTRADA+AJUSTE+TRANSFERENCIA_IN) is diffed
   per `(item, location)`. **Zero-diff or a nominal list**; exit code 2 on any
   diff without `--allow-diff`. Also in the report: per-table source vs
   imported vs skipped counts, merged items, curation-flagged items, status
   remaps, missing files, unmatched users, de-duplicated log count.
5. **Idempotency** — source UUIDs are reused as target ids and every insert is
   `ON CONFLICT DO NOTHING`, so an accidental re-run inserts nothing new.
   For clean reruns use `--wipe-first --yes` (the documented strategy for the
   weekly rehearsals).

### Location assumptions (documented, surfaced by parity)

- `materials` movements: the material row's own `location`
  (`fabrica` → `FABRICA`, `almoxarifado` → `ALMOXARIFADO`,
  `almoxarifado_geral` → `ALMOXARIFADO_GERAL`).
- `terceiros_movements`: `ALMOXARIFADO` (constant `THIRD_PARTY_LOCATION`).
- `tool_movements`: `ALMOXARIFADO_GERAL` (constant `TOOL_LOCATION`).

If either constant is wrong for the real operation the parity diff will name
every affected pair — adjust the constant in
`scripts/inventory/lib/transform.ts` and re-run the rehearsal.

---

## 2. Weekly rehearsal (J2 — from P1 until cutover)

Run every week against a **fresh backup**; the parity report is the project's
health metric. By cutover day it must have been green for weeks.

```powershell
# 1. Export a fresh backup in the legacy app (Admin → Backup) → backup.json
# 2. Rehearse against the local/staging DB:
$env:DATABASE_URL = "<staging-url>"
npx tsx scripts/inventory/import-comprasmyio.ts `
  --backup .\backup.json `
  --supabase-url $env:SUPABASE_URL --supabase-key $env:SUPABASE_SERVICE_KEY `
  --wipe-first --yes `
  --report .\rehearsals\m10-$(Get-Date -Format yyyy-MM-dd).json
# 3. Review: parity ZERO_DIFF? curationItems empty or shrinking?
#    unmatched users expected? missingFiles accounted for?
```

Keep the reports in the ops drive — the trend (curation list shrinking,
parity staying green) is the Wave-2 go/no-go evidence.

---

## 3. RBAC seeds

```powershell
# Applies scripts/db/seeds/v1.0.0/17-inventory-rbac.sql (with the others):
npm run db:seed
# Or execute just this file:
npm run db:ops -- scripts/db/seeds/v1.0.0/17-inventory-rbac.sql
```

| Source role | GCDR role | Policies |
|---|---|---|
| `solicitante` | `role:inventory-requester` | `policy:inventory-requester` |
| `comprador` | `role:inventory-buyer` | requester + `policy:inventory-buyer` |
| `fabrica` | `role:inventory-factory` | `policy:inventory-factory` (expedition read-only, explicit denies on destructive verbs) |
| `admin` | `role:inventory-admin` | `policy:inventory-admin` (`inventory.*.*`) |
| — (M2M) | customer API key `gcdr_cust_*` | scopes; `policy:inventory-external-sync` exists for JWT service users |

Assign roles to the matched users after the first production import (source
`user_roles` tells you who was what; users are matched by email in the import
report). Assignment is intentionally manual — review each admin.

---

## 4. Cutover — two waves (J1)

### Wave 1 (after P1) — Compras only

Solicitantes + comprador move to GCDR. The purchase flow touches no QR/sync.

1. Seed RBAC (`17-inventory-rbac.sql`) and assign
   `role:inventory-requester`/`role:inventory-buyer`.
2. Run a fresh import (`--wipe-first --yes`) so open purchase orders exist in
   GCDR; verify counts for `purchase_orders`/`order_logs` in the report.
3. Point requesters/buyer at the GCDR "Estoque → Compras" screens.
4. **Interim rule (OI-1, lean (a))**: while the warehouse still lives in
   Lovable, `RECEBIDO_OK` confirmations in GCDR create ledger entries that the
   legacy views don't see — keep these orders in the parity exception list
   until Wave 2, or mirror the entry manually in Lovable (decide before
   Wave 1; track under OI-1).

### Wave 2 (after P4) — warehouse / factory / expedition

**Execute in this exact order (W5).** The old sync must die BEFORE the freeze:

1. **Disable the legacy sync** — remove/disable the Lovable webhook
   (`/api/public/hooks/sync-product-status`) and any `pg_cron` schedule in the
   Supabase project. Confirm no run occurs for 10+ minutes
   (`external_sync_state.last_run_at` stops moving).
2. **Freeze the app** (read-only): announce the stop, revoke write roles or
   put the app in maintenance. From this moment the legacy DB is a photograph.
3. **Snapshot** — export the final backup JSON **and** download the 3 storage
   buckets to `--files-dir`; the script reads the balance views via
   `--supabase-url` in the same window.
4. **Final import** — on prod GCDR:
   ```powershell
   $env:DATABASE_URL = "<prod-url>"
   npx tsx scripts/inventory/import-comprasmyio.ts `
     --backup .\final-backup.json `
     --supabase-url ... --supabase-key ... `
     --files-dir .\buckets `
     --wipe-first --yes `
     --report .\m10-final-parity.json
   ```
5. **Validate parity** — exit code 0 and `parity.status = ZERO_DIFF` (or every
   diff in the pre-approved named exception list). Also spot-check: one QR
   trace end-to-end, one purchase order timeline, per-location balances of the
   top-10 items against the legacy screens.
6. **Enable GCDR workers** — turn on the M8 sync cron (live writes — after the
   shadow-mode sign-off, J4) and the push-outbox worker.
7. **Point operators at "Estoque"** — assign the remaining roles
   (`factory`/`admin`), factory pilot users first (J3 gate already passed).

The legacy app stays a frozen photograph — **its sync must never run again** —
retained read-only for 30 days, then archived.

### Rollback (Wave 2)

Before step 6 nothing irreversible happened: re-freeze GCDR "Estoque",
re-enable the Lovable app (NOT its sync until re-cutover), and
`--wipe-first --yes` cleans the imported tenant data for the next attempt.
After step 6 (workers live, external platform being written) rollback requires
re-importing the external states into the legacy DB — avoid by holding the
go/no-go at step 5.

---

## 5. Checklist

Wave 2, day of:

- [ ] Legacy webhook + pg_cron disabled; `last_run_at` frozen for 10+ min
- [ ] App frozen read-only, users notified
- [ ] Final backup JSON exported; buckets downloaded; views reachable via REST
- [ ] `DATABASE_URL` → prod; `--wipe-first --yes` intentional and announced
- [ ] Import exit code 0; report archived
- [ ] Parity ZERO_DIFF (or only pre-approved named exceptions)
- [ ] Curation list reviewed (`curationItems`), owners assigned
- [ ] Unmatched users list reviewed; role assignments done
- [ ] `missingFiles` count matches the expectation from the bucket download
- [ ] M8 sync cron enabled (live) + outbox worker running
- [ ] Operators redirected; legacy app read-only, sync permanently disabled
