/**
 * RFC-0061 M10 — minimal Supabase PostgREST reader.
 *
 * Used ONLY for the tables the source backup misses (Appendix C defect #5:
 * `tool_assets`, `tool_movements`) and for the three balance views that feed
 * the freeze parity snapshot (A5): `material_stock`,
 * `terceiros_material_stock`, `tool_asset_stock`.
 *
 * No credentials are hardcoded — url/key come from CLI flags or env
 * (SUPABASE_URL / SUPABASE_SERVICE_KEY). Never called from unit tests.
 */

import type { SourceRow } from './transform';

export interface SupabaseConfig {
  url: string;   // e.g. https://<project>.supabase.co
  key: string;   // service-role or anon key with read access
}

const PAGE_SIZE = 1000;

/** Fetch every row of a table/view, paginating with Range headers. */
export async function fetchAllRows(
  cfg: SupabaseConfig,
  table: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const res = await fetchImpl(`${cfg.url.replace(/\/$/, '')}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        'Range-Unit': 'items',
        Prefer: 'count=exact',
      },
    });
    if (!res.ok) {
      throw new Error(`Supabase REST ${table} failed: HTTP ${res.status} ${await res.text()}`);
    }
    const page = (await res.json()) as SourceRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export interface SupabaseExtras {
  toolAssets: SourceRow[];
  toolMovements: SourceRow[];
  materialStock: SourceRow[];
  terceirosMaterialStock: SourceRow[];
  toolAssetStock: SourceRow[];
}

/** One round-trip for everything the backup can't provide. */
export async function fetchExtras(
  cfg: SupabaseConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SupabaseExtras> {
  const [toolAssets, toolMovements, materialStock, terceirosMaterialStock, toolAssetStock] =
    await Promise.all([
      fetchAllRows(cfg, 'tool_assets', fetchImpl),
      fetchAllRows(cfg, 'tool_movements', fetchImpl),
      fetchAllRows(cfg, 'material_stock', fetchImpl),
      fetchAllRows(cfg, 'terceiros_material_stock', fetchImpl),
      fetchAllRows(cfg, 'tool_asset_stock', fetchImpl),
    ]);
  return { toolAssets, toolMovements, materialStock, terceirosMaterialStock, toolAssetStock };
}
