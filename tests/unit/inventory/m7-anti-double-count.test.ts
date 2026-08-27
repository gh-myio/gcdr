/**
 * RFC-0061 M7 — the ANTI-DOUBLE-COUNT rule (§M7), destination by destination.
 *
 * Field moves are tracking-only: they must NOT touch the stock ledger — with
 * exactly one exception, destination ALMOXARIFADO, which writes an ENTRADA and
 * re-links the QR on the new movement (inv_movement_qrs) so the M8 sync's
 * latest-event-per-QR reconciliation keeps the return instead of undoing it.
 */

import {
  InventoryFieldService,
  REASON_CLIENT_RETURN,
  reasonTechnicianReturn,
  reasonDamaged,
  RETURN_LOCATION,
} from '../../../src/services/inventory/InventoryFieldService';
import {
  CTX,
  TENANT,
  ITEM_ID,
  UNIT_ID,
  DISPATCH_ID,
  QR,
  TECHNICIAN,
  makeFieldRepo,
  makeStockRepo,
  makeQrRepo,
  makeUnit,
  makeDispatchMovement,
} from './m7-helpers';

function build(overrides: {
  field?: Record<string, jest.Mock>;
  stock?: Record<string, jest.Mock>;
  qr?: Record<string, jest.Mock>;
} = {}) {
  const fieldRepo = makeFieldRepo(overrides.field);
  const stockRepo = makeStockRepo(overrides.stock);
  const qrRepo = makeQrRepo(overrides.qr);
  const service = new InventoryFieldService(fieldRepo, stockRepo, qrRepo);
  return { service, fieldRepo, stockRepo, qrRepo };
}

describe('M7 unit-product move × ledger (anti-double-count)', () => {
  it.each([
    ['TECNICO', { destination: 'TECNICO' as const, technician: TECHNICIAN }],
    ['PERDIDO', { destination: 'PERDIDO' as const }],
  ])('destination %s is tracking-only — NO stock movement', async (_dest, dto) => {
    const { service, fieldRepo, stockRepo } = build();
    const result = await service.moveUnitProduct(CTX, UNIT_ID, dto, `k-${_dest}`);

    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
    expect(stockRepo.insertMovementQrs).not.toHaveBeenCalled();
    expect(fieldRepo.insertDamagedItem).not.toHaveBeenCalled();
    expect(result.stockMovementId).toBeNull();
    expect(result.damagedItemId).toBeNull();
    expect(fieldRepo.markUnitMoved).toHaveBeenCalledWith(
      TENANT,
      UNIT_ID,
      expect.objectContaining({ movedTo: dto.destination }),
      expect.anything(),
    );
  });

  it('destination TECNICO stamps moved_technician', async () => {
    const { service, fieldRepo } = build();
    await service.moveUnitProduct(CTX, UNIT_ID, { destination: 'TECNICO', technician: TECHNICIAN }, 'k-tec');
    expect(fieldRepo.markUnitMoved).toHaveBeenCalledWith(
      TENANT,
      UNIT_ID,
      expect.objectContaining({ movedTo: 'TECNICO', movedTechnician: TECHNICIAN }),
      expect.anything(),
    );
  });

  it('destination ALMOXARIFADO writes ENTRADA "Devolução do cliente" + re-links the QR', async () => {
    const { service, stockRepo } = build();
    const result = await service.moveUnitProduct(CTX, UNIT_ID, { destination: 'ALMOXARIFADO' }, 'k-alm');

    expect(stockRepo.insertMovement).toHaveBeenCalledTimes(1);
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        itemId: ITEM_ID,
        type: 'ENTRADA',
        location: RETURN_LOCATION,
        quantity: '1',
        reason: REASON_CLIENT_RETURN,
      }),
      expect.anything(),
    );
    expect(result.stockMovementId).not.toBeNull();
    // QR re-link so the M8 sync does not revert the return (§M7).
    expect(stockRepo.insertMovementQrs).toHaveBeenCalledWith(
      TENANT,
      result.stockMovementId,
      [{ qrValue: QR }],
      expect.anything(),
    );
  });

  it('destination ALMOXARIFADO without a QR-shaped label skips the re-link (still ENTRADA)', async () => {
    const { service, stockRepo } = build({
      field: { getUnitProductForUpdate: jest.fn(async () => makeUnit({ label: null })) },
    });
    const result = await service.moveUnitProduct(CTX, UNIT_ID, { destination: 'ALMOXARIFADO' }, 'k-alm2');
    expect(stockRepo.insertMovement).toHaveBeenCalledTimes(1);
    expect(stockRepo.insertMovementQrs).not.toHaveBeenCalled();
    expect(result.stockMovementId).not.toBeNull();
  });

  it('destination AVARIADO creates the damage report (source Cliente) and NO stock movement', async () => {
    const { service, fieldRepo, stockRepo } = build();
    const result = await service.moveUnitProduct(
      CTX,
      UNIT_ID,
      { destination: 'AVARIADO', notes: 'display quebrado' },
      'k-ava',
    );

    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
    expect(fieldRepo.insertDamagedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        itemId: ITEM_ID,
        quantity: 1,
        source: 'Cliente',
        sourceDetail: expect.stringContaining(QR), // projeto/label — keeps the QR recoverable
        reason: 'display quebrado',
      }),
      expect.anything(),
    );
    expect(result.damagedItemId).not.toBeNull();
  });

  it('a unit already moved cannot move again → 409 INV_ALREADY_IN_STATE', async () => {
    const { service, stockRepo } = build({
      field: { getUnitProductForUpdate: jest.fn(async () => makeUnit({ movedTo: 'TECNICO' })) },
    });
    await expect(
      service.moveUnitProduct(CTX, UNIT_ID, { destination: 'ALMOXARIFADO' }, 'k-dup'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'INV_ALREADY_IN_STATE' });
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
  });

  it('return to stock without a linked item → 400 (no orphan ENTRADA)', async () => {
    const { service, stockRepo } = build({
      field: { getUnitProductForUpdate: jest.fn(async () => makeUnit({ itemId: null })) },
    });
    await expect(
      service.moveUnitProduct(CTX, UNIT_ID, { destination: 'ALMOXARIFADO' }, 'k-noitem'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
  });
});

describe('M7 technician move × ledger (anti-double-count)', () => {
  it.each([
    ['UNIDADE', { movementId: DISPATCH_ID, destination: 'UNIDADE' as const, quantity: 2, projectId: '11111111-2222-4333-8444-555555555555' }],
    ['PERDIDO', { movementId: DISPATCH_ID, destination: 'PERDIDO' as const, quantity: 2 }],
  ])('destination %s is tracking-only — NO stock movement', async (_dest, dto) => {
    const { service, stockRepo } = build();
    const result = await service.createTechnicianMove(CTX, dto, `t-${_dest}`);
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
    expect(result.stockMovementId).toBeNull();
  });

  it('destination UNIDADE creates quantity inv_unit_products WITHOUT label in the project', async () => {
    const { service, fieldRepo } = build();
    const result = await service.createTechnicianMove(
      CTX,
      { movementId: DISPATCH_ID, destination: 'UNIDADE', quantity: 3, projectId: '11111111-2222-4333-8444-555555555555' },
      't-uni',
    );
    expect(fieldRepo.insertUnitProducts).toHaveBeenCalledTimes(1);
    const inputs = fieldRepo.insertUnitProducts.mock.calls[0][0];
    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(input.label).toBeNull();
      expect(input.itemId).toBe(ITEM_ID);
      expect(input.clientNameSnapshot).toBe('Projeto Moxuara'); // Projeto = Cliente
    }
    expect(result.createdUnitProductIds).toHaveLength(3);
  });

  it('destination ALMOXARIFADO writes ENTRADA "Devolução do técnico <nome>" + re-links QRs', async () => {
    const { service, fieldRepo, stockRepo } = build({
      field: {
        listMovementQrs: jest.fn(async () => [
          { id: 'q1', tenantId: TENANT, movementId: DISPATCH_ID, qrValue: '1_1', boxQr: null, homologationUnitId: null },
          { id: 'q2', tenantId: TENANT, movementId: DISPATCH_ID, qrValue: '1_2', boxQr: null, homologationUnitId: null },
        ]),
      },
    });
    const result = await service.createTechnicianMove(
      CTX,
      { movementId: DISPATCH_ID, destination: 'ALMOXARIFADO', quantity: 2, qrValues: ['1_1', '1_2'] },
      't-alm',
    );

    expect(stockRepo.insertMovement).toHaveBeenCalledTimes(1);
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ENTRADA',
        location: RETURN_LOCATION,
        quantity: '2',
        reason: reasonTechnicianReturn(TECHNICIAN),
      }),
      expect.anything(),
    );
    expect(stockRepo.insertMovementQrs).toHaveBeenCalledWith(
      TENANT,
      result.stockMovementId,
      [{ qrValue: '1_1' }, { qrValue: '1_2' }],
      expect.anything(),
    );
    expect(fieldRepo.insertTechnicianMove).toHaveBeenCalledWith(
      expect.objectContaining({ movementId: DISPATCH_ID, destination: 'ALMOXARIFADO', quantity: 2 }),
      expect.anything(),
    );
  });

  it('destination AVARIADO creates the damage report (source Técnico) and NO stock movement', async () => {
    const { service, fieldRepo, stockRepo } = build();
    const result = await service.createTechnicianMove(
      CTX,
      { movementId: DISPATCH_ID, destination: 'AVARIADO', quantity: 2, notes: 'queimou na instalação' },
      't-ava',
    );
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
    expect(fieldRepo.insertDamagedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: ITEM_ID,
        quantity: 2,
        source: 'Técnico',
        sourceDetail: TECHNICIAN,
        reason: 'queimou na instalação',
      }),
      expect.anything(),
    );
    expect(result.damagedItemId).not.toBeNull();
  });

  it('a non-dispatch movement (no responsible) is rejected', async () => {
    const { service } = build({
      field: { lockDispatch: jest.fn(async () => makeDispatchMovement({ responsible: null }) as never) },
    });
    await expect(
      service.createTechnicianMove(CTX, { movementId: DISPATCH_ID, destination: 'PERDIDO', quantity: 1 }, 't-bad'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('M7 damaged report from stock × ledger', () => {
  it('POST damage from stock writes a balance-guarded SAIDA "Item avariado — <motivo>"', async () => {
    const { service, fieldRepo, stockRepo } = build();
    const result = await service.createDamagedItem(
      CTX,
      { itemId: ITEM_ID, quantity: 2, location: 'ALMOXARIFADO', reason: 'oxidação' },
      'd-1',
    );
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SAIDA',
        location: 'ALMOXARIFADO',
        quantity: '2',
        reason: reasonDamaged('oxidação'),
      }),
      expect.anything(),
    );
    expect(fieldRepo.insertDamagedItem).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'Estoque', quantity: 2, reason: 'oxidação' }),
      expect.anything(),
    );
    expect(result.stockMovementId).toBeDefined();
  });

  it('quantity above the location balance → 409 INV_INSUFFICIENT_STOCK (no writes)', async () => {
    const { service, fieldRepo, stockRepo } = build({
      stock: {
        getBalance: jest.fn(async () => ({ balance: '1', totalIn: '1', totalOut: '0', lastMovementAt: null })),
      },
    });
    await expect(
      service.createDamagedItem(CTX, { itemId: ITEM_ID, quantity: 2, location: 'FABRICA', reason: 'x' }, 'd-2'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'INV_INSUFFICIENT_STOCK' });
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
    expect(fieldRepo.insertDamagedItem).not.toHaveBeenCalled();
  });
});
