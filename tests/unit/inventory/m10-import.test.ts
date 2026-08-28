/**
 * RFC-0061 M10 — unit tests for the pure import transformations
 * (scripts/inventory/lib). ZERO network, ZERO database: inline fixtures only.
 *
 * Covers the Appendix B contract: duplicate-item merge across locations
 * (DEC-3), legacy purchase-status collapse, order_logs de-dup (Appendix C
 * defect #1), text→FK resolution with curation fallback (DEC-5), technician
 * destination AVARIADO (defect #2 fixed), user email matching, and the parity
 * diff assembly (A5).
 */

import {
  aggregateBalances,
  buildParityDiff,
  dedupOrderLogs,
  domainNameKey,
  makeCurationProduct,
  mapLocation,
  mapMovementType,
  mapOrderLogToEvent,
  mapPurchaseStatus,
  mapExpeditionStatus,
  mapTechnicianDestination,
  matchUsersByEmail,
  mergeItems,
  normalizeName,
  parseStorageUrl,
  resolveItemByText,
  resolveMaterialDomain,
} from '../../../scripts/inventory/lib/transform';
import { ReportBuilder, buildSourceSnapshot } from '../../../scripts/inventory/lib/report';

describe('M10 import — item merge (DEC-1/DEC-3, Appendix B)', () => {
  const materials = [
    { id: 'm-1', name: 'Parafuso M3', location: 'fabrica' },
    // same normalized name, different location → merged into m-1
    { id: 'm-2', name: '  parafuso m3 ', location: 'almoxarifado_geral' },
    { id: 'm-3', name: 'Hidrômetro V2', location: 'almoxarifado', is_product: true },
    { id: 'm-4', name: 'Produto — Caixa de 50', location: 'almoxarifado' }, // synthetic box row
    { id: 'm-5', name: 'Etiqueta Terceiro', location: 'almoxarifado' },
  ];
  const terceiros = [{ id: 't-1', name: 'Sensor Revenda' }];
  const tools = [{ id: 'tool-1', name: 'Parafusadeira' }];

  it('merges duplicates by normalized name within the same domain, keeping per-source locations', () => {
    const result = mergeItems(materials, terceiros, tools);
    const parafuso = result.byDomainName.get(domainNameKey('COMPONENT', 'Parafuso M3'));
    expect(parafuso).toBeDefined();
    expect(parafuso!.sourceIds.sort()).toEqual(['m-1', 'm-2']);
    // Both source ids point at the SAME merged item...
    expect(result.bySourceId.get('m-1')).toBe(result.bySourceId.get('m-2'));
    // ...but each keeps its own historical location (movements need it).
    expect(result.locationBySourceId.get('m-1')).toBe('FABRICA');
    expect(result.locationBySourceId.get('m-2')).toBe('ALMOXARIFADO_GERAL');
    // Merge is reported nominally.
    expect(result.merged).toEqual([
      { name: 'Parafuso M3', domain: 'COMPONENT', sourceIds: ['m-1', 'm-2'] },
    ]);
  });

  it('does NOT merge across domains and skips synthetic "— Caixa de N" rows', () => {
    const result = mergeItems(materials, terceiros, tools);
    expect(result.byDomainName.get(domainNameKey('PRODUCT', 'Hidrômetro V2'))).toBeDefined();
    // The box row is not ported (boxes live in M5).
    const names = result.items.map((i) => i.name);
    expect(names).not.toContain('Produto — Caixa de 50');
    // Families map to their Appendix B domains.
    expect(result.bySourceId.get('t-1')!.domain).toBe('THIRD_PARTY');
    expect(result.bySourceId.get('tool-1')!.domain).toBe('TOOL');
    expect(result.locationBySourceId.get('t-1')).toBe('ALMOXARIFADO');
    expect(result.locationBySourceId.get('tool-1')).toBe('ALMOXARIFADO_GERAL');
  });

  it('routes curated names to THIRD_PARTY (Appendix B curated list)', () => {
    const result = mergeItems(materials, [], [], ['Etiqueta Terceiro']);
    expect(result.bySourceId.get('m-5')!.domain).toBe('THIRD_PARTY');
    expect(
      resolveMaterialDomain({ name: 'Etiqueta Terceiro' }, new Set(['etiqueta terceiro'])),
    ).toBe('THIRD_PARTY');
  });

  it('marks manufactured products but never non-PRODUCT domains (W4 invariant)', () => {
    const result = mergeItems(
      [{ id: 'p-1', name: 'Gateway', is_manufactured: true, location: 'almoxarifado' }],
      [],
      [{ id: 'tool-2', name: 'Alicate', is_manufactured: true }],
    );
    expect(result.bySourceId.get('p-1')!.domain).toBe('PRODUCT');
    expect(result.bySourceId.get('p-1')!.isManufactured).toBe(true);
    expect(result.bySourceId.get('tool-2')!.domain).toBe('TOOL');
    expect(result.bySourceId.get('tool-2')!.isManufactured).toBe(false);
  });
});

describe('M10 import — legacy status mapping (Appendix B)', () => {
  it('collapses the legacy buyer trio into COMPRADO_AGUARDANDO', () => {
    expect(mapPurchaseStatus('comprado')).toBe('COMPRADO_AGUARDANDO');
    expect(mapPurchaseStatus('aguardando')).toBe('COMPRADO_AGUARDANDO');
    expect(mapPurchaseStatus('a_caminho')).toBe('COMPRADO_AGUARDANDO');
    expect(mapPurchaseStatus('comprado_aguardando')).toBe('COMPRADO_AGUARDANDO');
  });

  it('maps the remaining statuses 1:1 and rejects unknowns', () => {
    expect(mapPurchaseStatus('pendente')).toBe('PENDENTE');
    expect(mapPurchaseStatus('entregue')).toBe('ENTREGUE');
    expect(mapPurchaseStatus('recebido_ok')).toBe('RECEBIDO_OK');
    expect(mapPurchaseStatus('recebido_problema')).toBe('RECEBIDO_PROBLEMA');
    expect(mapPurchaseStatus('cancelado')).toBe('CANCELADO');
    expect(mapPurchaseStatus('what_is_this')).toBeUndefined();
    expect(mapPurchaseStatus(null)).toBeUndefined();
  });

  it('maps expedition statuses case-insensitively', () => {
    expect(mapExpeditionStatus('em_transito')).toBe('EM_TRANSITO');
    expect(mapExpeditionStatus('ENTREGUE_CLIENTE')).toBe('ENTREGUE_CLIENTE');
    expect(mapExpeditionStatus('desconhecido')).toBeUndefined();
  });

  it('maps movement types and locations', () => {
    expect(mapMovementType('entrada')).toBe('ENTRADA');
    expect(mapMovementType('saida')).toBe('SAIDA');
    expect(mapMovementType('ajuste')).toBe('AJUSTE');
    expect(mapMovementType('transferencia')).toBeUndefined(); // not a source type
    expect(mapLocation('fabrica')).toBe('FABRICA');
    expect(mapLocation('almoxarifado_geral')).toBe('ALMOXARIFADO_GERAL');
    expect(mapLocation('almoxarifado')).toBe('ALMOXARIFADO');
  });

  it('accepts AVARIADO as a technician destination (Appendix C defect #2 fixed)', () => {
    expect(mapTechnicianDestination('avariado')).toBe('AVARIADO');
    expect(mapTechnicianDestination('unidade')).toBe('UNIDADE');
    expect(mapTechnicianDestination('perdido')).toBe('PERDIDO');
    expect(mapTechnicianDestination('almoxarifado')).toBe('ALMOXARIFADO');
    expect(mapTechnicianDestination('outro')).toBeUndefined();
  });
});

describe('M10 import — order_logs de-dup + event mapping (Appendix C defect #1, DEC-9)', () => {
  it('drops the doubled trigger rows by [order, action, details, ts]', () => {
    const logs = [
      { order_id: 'o-1', action: 'status_alterado', details: 'pendente → comprado', created_at: '2026-01-01T10:00:00Z' },
      { order_id: 'o-1', action: 'status_alterado', details: 'pendente → comprado', created_at: '2026-01-01T10:00:00Z' },
      // Same content at a DIFFERENT instant is a real second event.
      { order_id: 'o-1', action: 'status_alterado', details: 'pendente → comprado', created_at: '2026-01-02T10:00:00Z' },
      { order_id: 'o-2', action: 'criado', details: null, created_at: '2026-01-01T10:00:00Z' },
      { order_id: 'o-2', action: 'criado', details: null, created_at: '2026-01-01T10:00:00Z' },
    ];
    const { kept, dropped } = dedupOrderLogs(logs);
    expect(kept).toHaveLength(3);
    expect(dropped).toBe(2);
  });

  it('maps legacy actions onto the CHECK-constrained event types, extracting from→to', () => {
    const status = mapOrderLogToEvent({
      action: 'status_alterado',
      details: 'a_caminho → entregue',
    });
    expect(status.eventType).toBe('STATUS_ALTERADO');
    // Legacy statuses inside the details are remapped too.
    expect(status.details.from).toBe('COMPRADO_AGUARDANDO');
    expect(status.details.to).toBe('ENTREGUE');

    expect(mapOrderLogToEvent({ action: 'criado' }).eventType).toBe('CRIADO');
    // Unknown legacy actions degrade to OBSERVACAO_ATUALIZADA, keeping the raw action.
    const unknown = mapOrderLogToEvent({ action: 'anexo_adicionado', details: 'nota.pdf' });
    expect(unknown.eventType).toBe('OBSERVACAO_ATUALIZADA');
    expect(unknown.details.legacyAction).toBe('anexo_adicionado');
    expect(unknown.details.imported).toBe(true);
  });
});

describe('M10 import — text→FK resolution with curation fallback (DEC-5)', () => {
  const merge = mergeItems(
    [{ id: 'm-1', name: 'Hidrômetro V2', location: 'almoxarifado', is_product: true }],
    [],
    [],
  );

  it('resolves free-text names case/space-insensitively, preferring PRODUCT', () => {
    const hit = resolveItemByText('  hidrômetro v2 ', merge.byDomainName);
    expect(hit).toBeDefined();
    expect(hit!.targetId).toBe('m-1');
  });

  it('returns undefined for unmatched names — caller fabricates a curation PRODUCT', () => {
    expect(resolveItemByText('Produto Fantasma', merge.byDomainName)).toBeUndefined();
    const created = makeCurationProduct('  Produto Fantasma ');
    expect(created.name).toBe('Produto Fantasma');
    expect(created.domain).toBe('PRODUCT');
    expect(created.createdFromText).toBe(true);
    expect(created.flaggedForCuration).toBe(true);
    expect(created.isManufactured).toBe(false);
  });
});

describe('M10 import — user matching by email', () => {
  it('matches case-insensitively and lists the unmatched nominally', () => {
    const { bySourceUserId, unmatched } = matchUsersByEmail(
      [
        { id: 'p-1', email: 'Ana@Myio.com.br', full_name: 'Ana' },
        { id: 'p-2', email: 'ghost@nowhere.io', full_name: 'Ghost' },
        { id: 'p-3', full_name: 'Sem Email' },
      ],
      [{ id: 'u-1', email: 'ana@myio.com.br' }],
    );
    expect(bySourceUserId.get('p-1')).toBe('u-1');
    expect(bySourceUserId.has('p-2')).toBe(false);
    expect(unmatched).toEqual([
      { id: 'p-2', email: 'ghost@nowhere.io', name: 'Ghost' },
      { id: 'p-3', email: undefined, name: 'Sem Email' },
    ]);
  });
});

describe('M10 import — storage URL parsing (DEC-8)', () => {
  it('parses Supabase object URLs into bucket/path', () => {
    expect(
      parseStorageUrl('https://x.supabase.co/storage/v1/object/public/assembly-photos/2026/foto%20a.jpg'),
    ).toEqual({ bucket: 'assembly-photos', path: '2026/foto a.jpg' });
    expect(parseStorageUrl('order-attachments/pedidos/nf.pdf')).toEqual({
      bucket: 'order-attachments',
      path: 'pedidos/nf.pdf',
    });
    expect(parseStorageUrl('https://example.com/not-storage.png')).toBeUndefined();
    expect(parseStorageUrl(undefined)).toBeUndefined();
  });
});

describe('M10 import — parity diff (A5)', () => {
  it('aggregates like the ledger: in = ENTRADA + AJUSTE + TRANSFERENCIA_IN', () => {
    const balances = aggregateBalances([
      { itemId: 'i-1', location: 'FABRICA', type: 'ENTRADA', quantity: 10 },
      { itemId: 'i-1', location: 'FABRICA', type: 'AJUSTE', quantity: 2 },
      { itemId: 'i-1', location: 'FABRICA', type: 'SAIDA', quantity: 3 },
      { itemId: 'i-1', location: 'ALMOXARIFADO', type: 'TRANSFERENCIA_IN', quantity: 1 },
    ]);
    expect(balances).toEqual(
      expect.arrayContaining([
        { itemId: 'i-1', location: 'FABRICA', balance: 9 },
        { itemId: 'i-1', location: 'ALMOXARIFADO', balance: 1 },
      ]),
    );
  });

  it('reports zero-diff when snapshot and ledger agree', () => {
    const snapshot = [{ itemId: 'i-1', location: 'FABRICA' as const, balance: 9 }];
    const target = [{ itemId: 'i-1', location: 'FABRICA' as const, balance: 9 }];
    expect(buildParityDiff(snapshot, target)).toEqual([]);
  });

  it('names every divergent (item, location) pair, including one-sided rows', () => {
    const snapshot = [
      { itemId: 'i-1', location: 'FABRICA' as const, balance: 9 },
      { itemId: 'i-2', location: 'ALMOXARIFADO' as const, balance: 5 },
    ];
    const target = [
      { itemId: 'i-1', location: 'FABRICA' as const, balance: 7 },     // drifted
      { itemId: 'i-3', location: 'ALMOXARIFADO' as const, balance: 4 }, // only in target
    ];
    const diffs = buildParityDiff(snapshot, target);
    expect(diffs).toHaveLength(3);
    expect(diffs).toEqual(
      expect.arrayContaining([
        { itemId: 'i-1', location: 'FABRICA', sourceBalance: 9, targetBalance: 7, delta: -2 },
        { itemId: 'i-2', location: 'ALMOXARIFADO', sourceBalance: 5, targetBalance: null, delta: -5 },
        { itemId: 'i-3', location: 'ALMOXARIFADO', sourceBalance: null, targetBalance: 4, delta: 4 },
      ]),
    );
  });

  it('tolerates numeric noise below the epsilon', () => {
    const snapshot = [{ itemId: 'i-1', location: 'FABRICA' as const, balance: 1.0001 }];
    const target = [{ itemId: 'i-1', location: 'FABRICA' as const, balance: 1.0004 }];
    expect(buildParityDiff(snapshot, target)).toEqual([]);
  });

  it('builds the source snapshot through the merge map, summing per (target item, location)', () => {
    const merge = mergeItems(
      [
        { id: 'm-1', name: 'Parafuso', location: 'fabrica' },
        { id: 'm-2', name: 'Parafuso', location: 'almoxarifado' },
      ],
      [],
      [],
    );
    const { snapshot, unmappedRows } = buildSourceSnapshot(
      {
        materialStock: [
          { material_id: 'm-1', balance: 10 },
          { material_id: 'm-2', total_in: 8, total_out: 3 }, // derived: 5
          { material_id: 'ghost', balance: 99 },
        ],
        terceirosMaterialStock: [],
        toolAssetStock: [],
      },
      merge,
    );
    expect(unmappedRows).toBe(1);
    const target = merge.bySourceId.get('m-1')!.targetId;
    expect(snapshot).toEqual(
      expect.arrayContaining([
        { itemId: target, location: 'FABRICA', balance: 10 },
        { itemId: target, location: 'ALMOXARIFADO', balance: 5 },
      ]),
    );
  });
});

describe('M10 import — report builder', () => {
  it('accumulates per-table counts and nominal warnings', () => {
    const rb = new ReportBuilder();
    rb.addSource('materials', 10);
    rb.addImported('inv_items', 8);
    rb.addSkipped('inv_items', 2, 'test skip');
    rb.remap('purchase:comprado→COMPRADO_AGUARDANDO');
    rb.remap('purchase:comprado→COMPRADO_AGUARDANDO');
    rb.missingFile('inv_shipments');
    rb.orderLogsDeduplicated = 4;
    const report = rb.build({
      mode: 'dry-run',
      tenantId: 't',
      backupFile: 'b.json',
      users: { matched: 1, unmatched: [] },
      mergedItems: [],
      parity: { status: 'ZERO_DIFF', checkedPairs: 0, diffs: [] },
    });
    expect(report.counts['materials'].source).toBe(10);
    expect(report.counts['inv_items'].imported).toBe(8);
    expect(report.counts['inv_items'].skipped).toBe(2);
    expect(report.statusRemaps['purchase:comprado→COMPRADO_AGUARDANDO']).toBe(2);
    expect(report.missingFiles).toEqual({ total: 1, byTable: { inv_shipments: 1 } });
    expect(report.orderLogsDeduplicated).toBe(4);
    expect(report.warnings).toContain('inv_items: 2 row(s) skipped — test skip');
  });
});

describe('M10 import — normalizeName mirrors lower(btrim(name))', () => {
  it('trims edges and lowercases without touching inner whitespace', () => {
    expect(normalizeName('  Parafuso  M3  ')).toBe('parafuso  m3');
    expect(normalizeName('ÁGUA')).toBe('água');
  });
});
