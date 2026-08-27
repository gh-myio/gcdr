/**
 * RFC-0061 M8 — ledger reconciliation, client upsert, damaged auto-report and
 * order auto-transition — each rule asserted in SHADOW (computed + logged,
 * never applied) and LIVE (INV_SYNC_LIVE=true — applied) modes (J4).
 */

import { SYNC_STOCK_LOCATION } from '../../../src/services/inventory/InventoryExternalSyncService';
import {
  TENANT,
  ITEM_ID,
  PROJECT_ID,
  CUSTOMER_ID,
  ORDER_ID,
  CODE,
  CODE_2,
  makeProduct,
  makeRegistryRow,
  makeUnitWithHomologation,
  makeSyncHarness,
  makeDispatchByQr,
  withLiveEnv,
  clearLiveEnv,
} from './m8-helpers';
import type { SyncHarness } from './m8-helpers';

beforeEach(() => {
  jest.clearAllMocks();
  clearLiveEnv();
});

afterAll(() => clearLiveEnv());

function eligible(h: SyncHarness): void {
  h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);
  h.homologRepository.findUnitsByQrValues.mockResolvedValue([makeUnitWithHomologation()]);
}

// -----------------------------------------------------------------------------
// Rule 1 — in the field per the platform, in stock per the ledger ⇒ SAIDA
// -----------------------------------------------------------------------------

describe('M8 reconciliation — field vs stock ⇒ SAIDA', () => {
  function fieldButInStock(location = 'cliente') {
    const h = makeSyncHarness([makeProduct({ code: CODE, location, technician: location === 'tecnico' ? 'Zé' : null })]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'ENTRADA']]));
    return h;
  }

  it('SHADOW: logs the SAIDA correction without writing the ledger', async () => {
    const h = fieldButInStock();
    const report = await h.service.runPull(TENANT);

    const saida = report.corrections.find((c) => c.kind === 'LEDGER_SAIDA');
    expect(saida).toBeDefined();
    expect(saida?.applied).toBe(false);
    expect(h.stockRepository.insertMovement).not.toHaveBeenCalled();
  });

  it('LIVE: writes SAIDA 1un with the QR linked to the new movement', async () => {
    withLiveEnv();
    const h = fieldButInStock();
    const report = await h.service.runPull(TENANT);

    const saida = report.corrections.find((c) => c.kind === 'LEDGER_SAIDA');
    expect(saida?.applied).toBe(true);
    expect(h.stockRepository.lockItem).toHaveBeenCalledWith(TENANT, ITEM_ID, expect.anything());
    expect(h.stockRepository.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SAIDA', quantity: '1', itemId: ITEM_ID, location: SYNC_STOCK_LOCATION }),
      expect.anything(),
    );
    expect(h.stockRepository.insertMovementQrs).toHaveBeenCalledWith(
      TENANT,
      expect.any(String),
      [expect.objectContaining({ qrValue: CODE })],
      expect.anything(),
    );
  });

  it('LIVE: sets responsible = technician when the platform says tecnico (conserta responsible)', async () => {
    withLiveEnv();
    const h = fieldButInStock('tecnico');
    await h.service.runPull(TENANT);

    expect(h.stockRepository.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SAIDA', responsible: 'Zé' }),
      expect.anything(),
    );
  });

  it('LIVE: negative guard — balance < 1 skips the write and records a problem', async () => {
    withLiveEnv();
    const h = fieldButInStock();
    h.stockRepository.getBalance.mockResolvedValue({ balance: '0', totalIn: '1', totalOut: '1', lastMovementAt: null });

    const report = await h.service.runPull(TENANT);

    expect(h.stockRepository.insertMovement).not.toHaveBeenCalled();
    expect(report.problems.some((p) => p.includes('saldo insuficiente'))).toBe(true);
    const saida = report.corrections.find((c) => c.kind === 'LEDGER_SAIDA');
    expect(saida?.applied).toBe(false);
  });

  it('no correction when the ledger already agrees (QR exited)', async () => {
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'cliente' })]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'SAIDA']]));

    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'LEDGER_SAIDA')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Rule 2 — back to estoque per the platform, exited per the ledger ⇒ ENTRADA
// -----------------------------------------------------------------------------

describe('M8 reconciliation — estoque vs exited ⇒ ENTRADA estorno', () => {
  function backInStock() {
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'estoque' })]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'SAIDA']]));
    return h;
  }

  it('SHADOW: logs the ENTRADA without writing', async () => {
    const h = backInStock();
    const report = await h.service.runPull(TENANT);

    const entrada = report.corrections.find((c) => c.kind === 'LEDGER_ENTRADA');
    expect(entrada).toBeDefined();
    expect(entrada?.applied).toBe(false);
    expect(h.stockRepository.insertMovement).not.toHaveBeenCalled();
  });

  it('LIVE: writes the compensating ENTRADA and RE-LINKS the QR (anti-loop)', async () => {
    withLiveEnv();
    const h = backInStock();
    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'LEDGER_ENTRADA')?.applied).toBe(true);
    expect(h.stockRepository.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ENTRADA', quantity: '1', location: SYNC_STOCK_LOCATION }),
      expect.anything(),
    );
    // Without this re-link the next run would see the old SAIDA and undo it.
    expect(h.stockRepository.insertMovementQrs).toHaveBeenCalledWith(
      TENANT,
      expect.any(String),
      [expect.objectContaining({ qrValue: CODE })],
      expect.anything(),
    );
  });

  it('no correction when the QR never touched the ledger', async () => {
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'estoque' })]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map());

    const report = await h.service.runPull(TENANT);

    expect(report.corrections).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Rule 3 — QR left the technician ⇒ consume the dispatch (zera a lista)
// -----------------------------------------------------------------------------

describe('M8 reconciliation — technician custody zeroing', () => {
  function leftTechnician(location = 'cliente') {
    const h = makeSyncHarness([makeProduct({ code: CODE, location, clientName: 'Moxuara' })]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'SAIDA']]));
    h.repository.dispatchesByQrValues.mockResolvedValue([
      makeDispatchByQr({ movementId: 'dddddddd-0000-4000-8000-000000000001', quantity: '1', movedQuantity: 0 }),
    ]);
    return h;
  }

  it('SHADOW: logs the technician move without writing', async () => {
    const h = leftTechnician();
    const report = await h.service.runPull(TENANT);

    const move = report.corrections.find((c) => c.kind === 'TECHNICIAN_MOVE');
    expect(move).toBeDefined();
    expect(move?.applied).toBe(false);
    expect(h.fieldRepository.insertTechnicianMove).not.toHaveBeenCalled();
  });

  it('LIVE: consumes the open dispatch with the mapped destination (cliente → UNIDADE)', async () => {
    withLiveEnv();
    const h = leftTechnician('cliente');
    await h.service.runPull(TENANT);

    expect(h.fieldRepository.insertTechnicianMove).toHaveBeenCalledWith(
      expect.objectContaining({
        movementId: 'dddddddd-0000-4000-8000-000000000001',
        destination: 'UNIDADE',
        quantity: 1,
        technician: 'João da Silva',
      }),
    );
  });

  it('LIVE: estoque maps to ALMOXARIFADO', async () => {
    withLiveEnv();
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'estoque' })]);
    eligible(h);
    // Ledger already back in stock (no ENTRADA correction) — dispatch open.
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'ENTRADA']]));
    h.repository.dispatchesByQrValues.mockResolvedValue([makeDispatchByQr()]);

    await h.service.runPull(TENANT);

    expect(h.fieldRepository.insertTechnicianMove).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'ALMOXARIFADO' }),
    );
  });

  it('does nothing while the platform still says tecnico', async () => {
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'tecnico', technician: 'Zé' })]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'SAIDA']]));
    h.repository.dispatchesByQrValues.mockResolvedValue([makeDispatchByQr()]);

    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'TECHNICIAN_MOVE')).toBeUndefined();
  });

  it('does nothing when the dispatch has no remaining quantity', async () => {
    const h = leftTechnician();
    h.repository.dispatchesByQrValues.mockResolvedValue([makeDispatchByQr({ quantity: '1', movedQuantity: 1 })]);

    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'TECHNICIAN_MOVE')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Rule 4 — cliente ⇒ unit products (upsert, status, moved-out) + projeto match
// -----------------------------------------------------------------------------

describe('M8 reconciliation — client unit products', () => {
  function atClient(status = 'instalado') {
    const h = makeSyncHarness([
      makeProduct({ code: CODE, location: 'cliente', status, clientName: 'MOXUARA' }),
    ]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'SAIDA']]));
    return h;
  }

  it('SHADOW: logs the unit creation without writing', async () => {
    const h = atClient();
    const report = await h.service.runPull(TENANT);

    const created = report.corrections.find((c) => c.kind === 'UNIT_CREATED');
    expect(created).toBeDefined();
    expect(created?.applied).toBe(false);
    expect(h.fieldRepository.insertUnitProducts).not.toHaveBeenCalled();
  });

  it('LIVE: creates the unit product matching projeto→cliente case-insensitively', async () => {
    withLiveEnv();
    const h = atClient('instalado');
    h.repository.projectsByNamesInsensitive.mockResolvedValue([
      {
        id: PROJECT_ID,
        tenantId: TENANT,
        name: 'Moxuara', // platform said "MOXUARA" — matched case-insensitively
        customerId: CUSTOMER_ID,
      } as never,
    ]);

    const report = await h.service.runPull(TENANT);

    expect(h.repository.projectsByNamesInsensitive).toHaveBeenCalledWith(TENANT, ['moxuara']);
    expect(h.fieldRepository.insertUnitProducts).toHaveBeenCalledWith([
      expect.objectContaining({
        label: CODE,
        status: 'INSTALADO',
        projectId: PROJECT_ID,
        customerId: CUSTOMER_ID,
        clientNameSnapshot: 'MOXUARA',
      }),
    ]);
    expect(report.problems).toHaveLength(0);
  });

  it('LIVE: unmatched client name still creates the unit and records a problem', async () => {
    withLiveEnv();
    const h = atClient();
    h.repository.projectsByNamesInsensitive.mockResolvedValue([]);

    const report = await h.service.runPull(TENANT);

    expect(h.fieldRepository.insertUnitProducts).toHaveBeenCalledWith([
      expect.objectContaining({ projectId: null, customerId: null, clientNameSnapshot: 'MOXUARA' }),
    ]);
    expect(report.problems.some((p) => p.includes('Projeto não encontrado'))).toBe(true);
  });

  it('LIVE: fixes the install status of an existing active unit', async () => {
    withLiveEnv();
    const h = atClient('instalado');
    h.repository.unitProductsByLabels.mockResolvedValue([
      { id: 'ab000000-0000-4000-8000-000000000001', label: CODE, status: 'PARADO', movedTo: null } as never,
    ]);

    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'UNIT_STATUS')?.applied).toBe(true);
    expect(h.fieldRepository.updateUnitStatus).toHaveBeenCalledWith(
      TENANT,
      'ab000000-0000-4000-8000-000000000001',
      'INSTALADO',
      expect.any(Date),
    );
    expect(h.fieldRepository.insertUnitProducts).not.toHaveBeenCalled();
  });

  it('LIVE: a unit that left the client is marked moved_to (tecnico → TECNICO)', async () => {
    withLiveEnv();
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'tecnico', technician: 'Zé' })]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'SAIDA']]));
    h.repository.unitProductsByLabels.mockResolvedValue([
      { id: 'ab000000-0000-4000-8000-000000000002', label: CODE, status: 'INSTALADO', movedTo: null } as never,
    ]);

    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'UNIT_MOVED_OUT')?.applied).toBe(true);
    expect(h.fieldRepository.markUnitMoved).toHaveBeenCalledWith(
      TENANT,
      'ab000000-0000-4000-8000-000000000002',
      expect.objectContaining({ movedTo: 'TECNICO', movedTechnician: 'Zé' }),
    );
  });

  it('transporte does NOT move a unit out (in-flight logistics)', async () => {
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'transporte' })]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'SAIDA']]));
    h.repository.unitProductsByLabels.mockResolvedValue([
      { id: 'ab000000-0000-4000-8000-000000000003', label: CODE, status: 'PARADO', movedTo: null } as never,
    ]);

    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'UNIT_MOVED_OUT')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Rule 5 — avariado ⇒ inv_damaged_items (one open report per code)
// -----------------------------------------------------------------------------

describe('M8 reconciliation — damaged auto-report', () => {
  function damaged() {
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'avariado', productType: 'SmartLight v3' })]);
    eligible(h);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(new Map([[CODE, 'SAIDA']]));
    return h;
  }

  it('SHADOW: logs the damage report without writing', async () => {
    const h = damaged();
    const report = await h.service.runPull(TENANT);

    const dmg = report.corrections.find((c) => c.kind === 'DAMAGED_REPORT');
    expect(dmg).toBeDefined();
    expect(dmg?.applied).toBe(false);
    expect(h.fieldRepository.insertDamagedItem).not.toHaveBeenCalled();
  });

  it('LIVE: opens the damage report with the code in source_detail', async () => {
    withLiveEnv();
    const h = damaged();
    await h.service.runPull(TENANT);

    expect(h.fieldRepository.insertDamagedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: ITEM_ID,
        quantity: 1,
        source: 'SYNC_EXTERNO',
        sourceDetail: `QR ${CODE}`,
        productNameSnapshot: 'SmartLight v3',
      }),
    );
  });

  it('LIVE: never opens a second report while one is still AVARIADO for the code', async () => {
    withLiveEnv();
    const h = damaged();
    h.repository.listOpenDamaged.mockResolvedValue([
      { id: 'dc000000-0000-4000-8000-000000000001', sourceDetail: `Projeto X / ${CODE}`, status: 'AVARIADO' } as never,
    ]);

    const report = await h.service.runPull(TENANT);

    expect(h.fieldRepository.insertDamagedItem).not.toHaveBeenCalled();
    expect(report.corrections.find((c) => c.kind === 'DAMAGED_REPORT')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Rule 6 — EM_TRANSITO order fully at the client ⇒ ENTREGUE_CLIENTE + vínculo
// -----------------------------------------------------------------------------

describe('M8 reconciliation — order auto-transition', () => {
  function orderInTransit(locations: Record<string, string>) {
    const products = Object.entries(locations).map(([code, location]) => makeProduct({ code, location }));
    const h = makeSyncHarness(products);
    h.homologRepository.findRegistryByValues.mockResolvedValue([
      makeRegistryRow({ qrValue: CODE }),
      makeRegistryRow({ qrValue: CODE_2 }),
    ]);
    h.stockRepository.latestQrEventTypes.mockResolvedValue(
      new Map([
        [CODE, 'SAIDA'],
        [CODE_2, 'SAIDA'],
      ]),
    );
    h.repository.ordersInTransit.mockResolvedValue([
      { id: ORDER_ID, title: 'Pedido Moxuara', status: 'EM_TRANSITO', projectId: PROJECT_ID, customerId: null } as never,
    ]);
    h.expeditionRepository.deliveredQrsByOrder.mockResolvedValue([
      { orderItemId: 'x', itemId: ITEM_ID, qrValue: CODE, boxQr: null, homologationUnitId: null },
      { orderItemId: 'x', itemId: ITEM_ID, qrValue: CODE_2, boxQr: null, homologationUnitId: null },
    ] as never);
    return h;
  }

  it('SHADOW: logs ORDER_DELIVERED without touching the order', async () => {
    const h = orderInTransit({ [CODE]: 'cliente', [CODE_2]: 'cliente' });
    const report = await h.service.runPull(TENANT);

    const delivered = report.corrections.find((c) => c.kind === 'ORDER_DELIVERED');
    expect(delivered).toBeDefined();
    expect(delivered?.applied).toBe(false);
    expect(h.expeditionRepository.updateOrder).not.toHaveBeenCalled();
  });

  it('LIVE: transitions to ENTREGUE_CLIENTE and creates the unit-product vínculo', async () => {
    withLiveEnv();
    const h = orderInTransit({ [CODE]: 'cliente', [CODE_2]: 'cliente' });
    h.expeditionRepository.getProject.mockResolvedValue(
      { id: PROJECT_ID, name: 'Moxuara', customerId: CUSTOMER_ID } as never,
    );
    h.expeditionRepository.existingUnitProductLabels.mockResolvedValue(new Set([CODE])); // idempotent

    await h.service.runPull(TENANT);

    expect(h.expeditionRepository.updateOrder).toHaveBeenCalledWith(
      TENANT,
      ORDER_ID,
      { status: 'ENTREGUE_CLIENTE' },
      expect.anything(),
    );
    // Only the missing label is created, with the expedition vínculo.
    expect(h.expeditionRepository.insertUnitProducts).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          label: CODE_2,
          expeditionOrderId: ORDER_ID,
          projectId: PROJECT_ID,
          customerId: CUSTOMER_ID,
          clientNameSnapshot: 'Moxuara',
        }),
      ],
      expect.anything(),
    );
  });

  it('does nothing while ANY delivered QR is not yet at the client', async () => {
    const h = orderInTransit({ [CODE]: 'cliente', [CODE_2]: 'transporte' });
    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'ORDER_DELIVERED')).toBeUndefined();
  });
});
