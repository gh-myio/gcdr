/**
 * RFC-0061 M10 — parity/import report assembly (A5).
 *
 * Pure data shaping: the CLI feeds counts and diffs in, gets the JSON report
 * out. The parity contract: zero-diff between the frozen source balance
 * snapshot and the imported ledger, or a NAMED list of exceptions — and a
 * non-zero exit unless --allow-diff.
 */

import {
  BalanceEntry,
  ItemMergeResult,
  ParityDiff,
  SourceRow,
  StockLocation,
  THIRD_PARTY_LOCATION,
  TOOL_LOCATION,
  asNumber,
  asString,
  mapLocation,
  pick,
} from './transform';

export interface TableCount {
  source: number;
  imported: number;
  skipped: number;
}

export interface ImportReport {
  generatedAt: string;
  mode: 'dry-run' | 'import';
  tenantId: string;
  backupFile: string;
  counts: Record<string, TableCount>;
  users: {
    matched: number;
    unmatched: Array<{ id: string; email?: string; name?: string }>;
  };
  mergedItems: Array<{ name: string; domain: string; sourceIds: string[] }>;
  curationItems: Array<{ id: string; name: string; reason: string }>;
  missingFiles: { total: number; byTable: Record<string, number> };
  orderLogsDeduplicated: number;
  statusRemaps: Record<string, number>;
  parity: {
    status: 'ZERO_DIFF' | 'DIFF' | 'SKIPPED';
    checkedPairs: number;
    diffs: ParityDiff[];
    note?: string;
  };
  warnings: string[];
}

export class ReportBuilder {
  private counts: Record<string, TableCount> = {};
  readonly warnings: string[] = [];
  readonly curationItems: ImportReport['curationItems'] = [];
  readonly statusRemaps: Record<string, number> = {};
  readonly missingByTable: Record<string, number> = {};
  orderLogsDeduplicated = 0;

  private slot(table: string): TableCount {
    if (!this.counts[table]) this.counts[table] = { source: 0, imported: 0, skipped: 0 };
    return this.counts[table];
  }

  addSource(table: string, n: number): void { this.slot(table).source += n; }
  addImported(table: string, n: number): void { this.slot(table).imported += n; }
  addSkipped(table: string, n: number, reason?: string): void {
    this.slot(table).skipped += n;
    if (reason && n > 0) this.warn(`${table}: ${n} row(s) skipped — ${reason}`);
  }

  warn(msg: string): void { this.warnings.push(msg); }

  remap(status: string): void {
    this.statusRemaps[status] = (this.statusRemaps[status] ?? 0) + 1;
  }

  missingFile(table: string): void {
    this.missingByTable[table] = (this.missingByTable[table] ?? 0) + 1;
  }

  build(
    base: Pick<ImportReport, 'mode' | 'tenantId' | 'backupFile' | 'users' | 'mergedItems' | 'parity'>,
  ): ImportReport {
    const missingTotal = Object.values(this.missingByTable).reduce((a, b) => a + b, 0);
    return {
      generatedAt: new Date().toISOString(),
      ...base,
      counts: this.counts,
      curationItems: this.curationItems,
      missingFiles: { total: missingTotal, byTable: this.missingByTable },
      orderLogsDeduplicated: this.orderLogsDeduplicated,
      statusRemaps: this.statusRemaps,
      warnings: this.warnings,
    };
  }
}

/**
 * Build the frozen source snapshot as target-keyed balance entries.
 * The three views expose balance = in + adjust − out per source item row;
 * source item ids are mapped through the merge result onto target item ids,
 * and the location comes from the source row's location at snapshot time
 * (DEC-3): merged duplicate rows CONTRIBUTE to different locations, so the
 * snapshot sums per (target item, location) — exactly what the ledger derives.
 */
export function buildSourceSnapshot(
  views: {
    materialStock: SourceRow[];
    terceirosMaterialStock: SourceRow[];
    toolAssetStock: SourceRow[];
  },
  merge: ItemMergeResult,
): { snapshot: BalanceEntry[]; unmappedRows: number } {
  const acc = new Map<string, BalanceEntry>();
  let unmappedRows = 0;

  const push = (sourceItemId: string | undefined, fallbackLocation: StockLocation, row: SourceRow): void => {
    const plan = sourceItemId ? merge.bySourceId.get(sourceItemId) : undefined;
    if (!plan) { unmappedRows++; return; }
    const balance =
      asNumber(pick(row, ['balance', 'current_stock', 'saldo'])) ??
      (asNumber(pick(row, ['total_in', 'entradas'])) ?? 0) - (asNumber(pick(row, ['total_out', 'saidas'])) ?? 0);
    const location = sourceItemId
      ? merge.locationBySourceId.get(sourceItemId) ?? fallbackLocation
      : fallbackLocation;
    const key = `${plan.targetId} ${location}`;
    const entry = acc.get(key) ?? { itemId: plan.targetId, location, balance: 0 };
    entry.balance += balance;
    acc.set(key, entry);
  };

  for (const row of views.materialStock) {
    push(
      asString(pick(row, ['material_id', 'id'])),
      mapLocation(asString(pick(row, ['location']))),
      row,
    );
  }
  for (const row of views.terceirosMaterialStock) {
    push(asString(pick(row, ['material_id', 'terceiros_material_id', 'id'])), THIRD_PARTY_LOCATION, row);
  }
  for (const row of views.toolAssetStock) {
    push(asString(pick(row, ['tool_asset_id', 'asset_id', 'id'])), TOOL_LOCATION, row);
  }

  return { snapshot: [...acc.values()], unmappedRows };
}
