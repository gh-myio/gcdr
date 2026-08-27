/**
 * RFC-0061 M7 — damaged-item recovery (3 destinations + QR re-link).
 *
 * Every recovery writes an ENTRADA "Recuperação de item avariado"; TECNICO and
 * UNIDADE add a paired SAIDA in the same transaction (custody leaves stock
 * again); UNIDADE also creates the unit products, the FIRST inheriting the QR
 * as label. When source_detail carries a QR code (`\d+(_\d+)+`) it is
 * re-linked on the new movements — without it the M8 sync would revert the
 * recovery on its next run.
 */

import {
  InventoryFieldService,
  REASON_DAMAGED_RECOVERY,
  extractQrFromSourceDetail,
} from '../../../src/services/inventory/InventoryFieldService';
import {
  CTX,
  TENANT,
  ITEM_ID,
  DAMAGED_ID,
  QR,
  TECHNICIAN,
  PROJECT_ID,
  makeFieldRepo,
  makeStockRepo,
  makeQrRepo,
  makeDamaged,
  makeUnit,
} from './m7-helpers';

function build(overrides: {
  field?: Record<string, jest.Mock>;
  stock?: Record<string, jest.Mock>;
} = {}) {
  const fieldRepo = makeFieldRepo(overrides.field);
  const stockRepo = makeStockRepo(overrides.stock);
  const service = new InventoryFieldService(fieldRepo, stockRepo, makeQrRepo());
  return { service, fieldRepo, stockRepo };
}

describe('extractQrFromSourceDetail', () => {
  it.each([
    [`Projeto Moxuara / ${QR}`, QR],
    [QR, QR],
    ['sem código aqui', null],
    ['técnico João', null],
    [null, null],
    [undefined, null],
    ['1234', null], // a bare number is not a QR code (needs at least one _)
    ['prefixo 12_34_56 sufixo', '12_34_56'],
  ])('%p → %p', (input, expected) => {
    expect(extractQrFromSourceDetail(input)).toBe(expected);
  });
});

describe('M7 recover — destination ESTOQUE', () => {
  it('writes ONE ENTRADA with the recovery reason and re-links the QR from source_detail', async () => {
    const { service, fieldRepo, stockRepo } = build();
    const result = await service.recoverDamagedItem(CTX, DAMAGED_ID, { destination: 'ESTOQUE', location: 'ALMOXARIFADO' }, 'rc-1');

    expect(stockRepo.insertMovement).toHaveBeenCalledTimes(1);
    expect(stockRepo.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ENTRADA',
        location: 'ALMOXARIFADO',
        quantity: '1',
        itemId: ITEM_ID,
        reason: REASON_DAMAGED_RECOVERY,
      }),
      expect.anything(),
    );
    // Re-link — the sync's latest-event-per-QR must see this ENTRADA.
    expect(stockRepo.insertMovementQrs).toHaveBeenCalledWith(
      TENANT,
      result.entryMovementId,
      [{ qrValue: QR }],
      expect.anything(),
    );
    expect(result.exitMovementId).toBeNull();
    expect(result.createdUnitProductIds).toEqual([]);
    expect(result.relinkedQr).toBe(QR);
    expect(fieldRepo.markDamagedRecovered).toHaveBeenCalledWith(
      TENANT,
      DAMAGED_ID,
      expect.objectContaining({ recoveredTo: 'ESTOQUE', recoveredBy: CTX.userId }),
      expect.anything(),
    );
    expect(result.damaged.status).toBe('RECUPERADO');
  });

  it('no QR in source_detail → no re-link, recovery still lands', async () => {
    const { service, stockRepo } = build({
      field: { getDamagedItemForUpdate: jest.fn(async () => makeDamaged({ sourceDetail: 'avaria interna' })) },
    });
    const result = await service.recoverDamagedItem(CTX, DAMAGED_ID, { destination: 'ESTOQUE', location: 'FABRICA' }, 'rc-2');
    expect(stockRepo.insertMovementQrs).not.toHaveBeenCalled();
    expect(result.relinkedQr).toBeNull();
  });
});

describe('M7 recover — destination TECNICO', () => {
  it('writes ENTRADA + SAIDA with responsible, both QR-linked', async () => {
    const { service, stockRepo } = build();
    const result = await service.recoverDamagedItem(
      CTX,
      DAMAGED_ID,
      { destination: 'TECNICO', location: 'ALMOXARIFADO', technician: TECHNICIAN },
      'rc-3',
    );

    expect(stockRepo.insertMovement).toHaveBeenCalledTimes(2);
    expect(stockRepo.insertMovement).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'ENTRADA', reason: REASON_DAMAGED_RECOVERY }),
      expect.anything(),
    );
    expect(stockRepo.insertMovement).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'SAIDA', responsible: TECHNICIAN, quantity: '1' }),
      expect.anything(),
    );
    expect(result.exitMovementId).not.toBeNull();
    // Both legs carry the QR — the latest event reflects the technician custody.
    expect(stockRepo.insertMovementQrs).toHaveBeenCalledTimes(2);
    expect(stockRepo.insertMovementQrs).toHaveBeenLastCalledWith(
      TENANT,
      result.exitMovementId,
      [{ qrValue: QR }],
      expect.anything(),
    );
  });
});

describe('M7 recover — destination UNIDADE', () => {
  it('writes ENTRADA + SAIDA and creates the unit products; the FIRST inherits the QR', async () => {
    const { service, fieldRepo, stockRepo } = build({
      field: { getDamagedItemForUpdate: jest.fn(async () => makeDamaged({ quantity: 3 })) },
    });
    const result = await service.recoverDamagedItem(
      CTX,
      DAMAGED_ID,
      { destination: 'UNIDADE', location: 'ALMOXARIFADO', projectId: PROJECT_ID },
      'rc-4',
    );

    expect(stockRepo.insertMovement).toHaveBeenCalledTimes(2);
    const inputs = fieldRepo.insertUnitProducts.mock.calls[0][0];
    expect(inputs).toHaveLength(3);
    expect(inputs[0].label).toBe(QR);
    expect(inputs[1].label).toBeNull();
    expect(inputs[2].label).toBeNull();
    expect(inputs[0].projectId).toBe(PROJECT_ID);
    expect(inputs[0].clientNameSnapshot).toBe('Projeto Moxuara');
    expect(result.createdUnitProductIds).toHaveLength(3);
  });

  it('does NOT inherit the QR when another unit row already holds that label', async () => {
    const { service, fieldRepo } = build({
      field: { findUnitByLabel: jest.fn(async () => makeUnit({ label: QR, movedTo: 'ALMOXARIFADO' })) },
    });
    await service.recoverDamagedItem(
      CTX,
      DAMAGED_ID,
      { destination: 'UNIDADE', location: 'ALMOXARIFADO', projectId: PROJECT_ID },
      'rc-5',
    );
    const inputs = fieldRepo.insertUnitProducts.mock.calls[0][0];
    expect(inputs[0].label).toBeNull();
  });

  it('unknown project → 404 (nothing persisted after the guard)', async () => {
    const { service, fieldRepo } = build({ field: { getProject: jest.fn(async () => null) } });
    await expect(
      service.recoverDamagedItem(
        CTX,
        DAMAGED_ID,
        { destination: 'UNIDADE', location: 'ALMOXARIFADO', projectId: PROJECT_ID },
        'rc-6',
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(fieldRepo.insertUnitProducts).not.toHaveBeenCalled();
    expect(fieldRepo.markDamagedRecovered).not.toHaveBeenCalled();
  });
});

describe('M7 recover — guards', () => {
  it('already RECUPERADO → 409 INV_ALREADY_IN_STATE (no movements)', async () => {
    const { service, stockRepo } = build({
      field: { getDamagedItemForUpdate: jest.fn(async () => makeDamaged({ status: 'RECUPERADO' })) },
    });
    await expect(
      service.recoverDamagedItem(CTX, DAMAGED_ID, { destination: 'ESTOQUE', location: 'ALMOXARIFADO' }, 'rc-7'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'INV_ALREADY_IN_STATE' });
    expect(stockRepo.insertMovement).not.toHaveBeenCalled();
  });

  it('unknown damaged item → 404', async () => {
    const { service } = build({ field: { getDamagedItemForUpdate: jest.fn(async () => null) } });
    await expect(
      service.recoverDamagedItem(CTX, DAMAGED_ID, { destination: 'ESTOQUE', location: 'ALMOXARIFADO' }, 'rc-8'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('damaged row without item → 400 (cannot write ledger movements)', async () => {
    const { service } = build({
      field: { getDamagedItemForUpdate: jest.fn(async () => makeDamaged({ itemId: null })) },
    });
    await expect(
      service.recoverDamagedItem(CTX, DAMAGED_ID, { destination: 'ESTOQUE', location: 'ALMOXARIFADO' }, 'rc-9'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
