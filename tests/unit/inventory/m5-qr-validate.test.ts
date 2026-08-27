/**
 * RFC-0061 M5 — POST /qr/validate service logic (S2, mocked repo, no DB):
 * per-code verdicts (ok / INV_QR_NOT_IN_REGISTRY / INV_QR_ALREADY_USED /
 * INV_QR_WRONG_ITEM), box expansion, context resolution from orderItemId,
 * and the guarantee that a batch NEVER fails as a whole.
 */

import { InventoryQrService } from '../../../src/services/inventory/InventoryQrService';
import {
  TENANT,
  ITEM_ID,
  OTHER_ITEM_ID,
  BOX_ID,
  BASE,
  makeHomologation,
  makeUnit,
  makeRegistryRow,
  makeMovementEvent,
  makeDeliveryEvent,
  makeQrRepoMock,
  QrRepoMock,
  nextId,
} from './m5-helpers';

let repo: QrRepoMock;
let service: InventoryQrService;

beforeEach(() => {
  jest.clearAllMocks();
  repo = makeQrRepoMock();
  service = new InventoryQrService(repo);
});

function homologatedUnit(qrValue: string, overrides: Record<string, unknown> = {}) {
  const homologation = makeHomologation({ id: nextId(), boxSize: 1, ...overrides });
  return { unit: makeUnit({ id: nextId(), homologationId: homologation.id, qrValue }), homologation };
}

describe('validate — unit verdicts', () => {
  it('homologated, never exited → ok with itemId', async () => {
    repo.findUnitsByQrValues.mockResolvedValue([homologatedUnit('123_456')]);
    repo.movementEventsByQrs.mockResolvedValue([makeMovementEvent({ qrValue: '123_456', type: 'ENTRADA' })]);

    const { results } = await service.validate(TENANT, { codes: ['123_456'] });
    expect(results).toEqual([{ code: '123_456', ok: true, itemId: ITEM_ID }]);
  });

  it('unknown code → INV_QR_NOT_IN_REGISTRY (batch still 1 verdict per code)', async () => {
    const { results } = await service.validate(TENANT, { codes: ['999_999'] });
    expect(results).toEqual([{ code: '999_999', ok: false, reason: 'INV_QR_NOT_IN_REGISTRY' }]);
  });

  it('latest ledger event is an exit → INV_QR_ALREADY_USED', async () => {
    repo.findUnitsByQrValues.mockResolvedValue([homologatedUnit('123_456')]);
    repo.movementEventsByQrs.mockResolvedValue([
      makeMovementEvent({ qrValue: '123_456', type: 'ENTRADA', createdAt: new Date('2026-02-01T00:00:00Z') }),
      makeMovementEvent({ qrValue: '123_456', type: 'SAIDA', createdAt: new Date('2026-02-02T00:00:00Z') }),
    ]);

    const { results } = await service.validate(TENANT, { codes: ['123_456'] });
    expect(results[0]).toEqual(expect.objectContaining({ ok: false, reason: 'INV_QR_ALREADY_USED' }));
  });

  it('re-entered after an exit (latest = ENTRADA) → ok again', async () => {
    repo.findUnitsByQrValues.mockResolvedValue([homologatedUnit('123_456')]);
    repo.movementEventsByQrs.mockResolvedValue([
      makeMovementEvent({ qrValue: '123_456', type: 'SAIDA', createdAt: new Date('2026-02-02T00:00:00Z') }),
      makeMovementEvent({ qrValue: '123_456', type: 'ENTRADA', createdAt: new Date('2026-02-03T00:00:00Z') }),
    ]);

    const { results } = await service.validate(TENANT, { codes: ['123_456'] });
    expect(results[0].ok).toBe(true);
  });

  it('expedition baixa (inv_delivery_qrs row) → INV_QR_ALREADY_USED', async () => {
    repo.findUnitsByQrValues.mockResolvedValue([homologatedUnit('123_456')]);
    repo.deliveryEventsByQrs.mockResolvedValue([makeDeliveryEvent({ qrValue: '123_456' })]);

    const { results } = await service.validate(TENANT, { codes: ['123_456'] });
    expect(results[0]).toEqual(expect.objectContaining({ ok: false, reason: 'INV_QR_ALREADY_USED' }));
  });

  it('expectedItemId mismatch → INV_QR_WRONG_ITEM', async () => {
    repo.findUnitsByQrValues.mockResolvedValue([homologatedUnit('123_456')]);

    const { results } = await service.validate(TENANT, {
      codes: ['123_456'],
      expectedItemId: OTHER_ITEM_ID,
    });
    expect(results[0]).toEqual(
      expect.objectContaining({ ok: false, reason: 'INV_QR_WRONG_ITEM', itemId: ITEM_ID }),
    );
  });

  it('resolves the expected item from orderItemId when expectedItemId is absent', async () => {
    const orderItemId = nextId();
    repo.getExpeditionOrderItem.mockResolvedValue({ id: orderItemId, itemId: OTHER_ITEM_ID, orderId: nextId() });
    repo.findUnitsByQrValues.mockResolvedValue([homologatedUnit('123_456')]);

    const { results } = await service.validate(TENANT, { codes: ['123_456'], orderItemId });
    expect(repo.getExpeditionOrderItem).toHaveBeenCalledWith(TENANT, orderItemId);
    expect(results[0].reason).toBe('INV_QR_WRONG_ITEM');
  });

  it('accepts the full URL spelling (camera scan) for a stored bare code', async () => {
    repo.findUnitsByQrValues.mockResolvedValue([homologatedUnit('123_456')]);
    const { results } = await service.validate(TENANT, { codes: [`${BASE}123_456`] });
    expect(results[0]).toEqual(expect.objectContaining({ code: `${BASE}123_456`, ok: true }));
  });

  it('registry-only QR (not yet homologated locally) still validates by item', async () => {
    repo.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: '77_77' })]);
    const { results } = await service.validate(TENANT, { codes: ['77_77'] });
    expect(results[0]).toEqual({ code: '77_77', ok: true, itemId: ITEM_ID });
  });
});

describe('validate — box expansion', () => {
  const BOX_QR = `${BASE}caixa-10/1`;

  function setupBox() {
    const box = makeHomologation({ id: BOX_ID, boxSize: 10, boxQr: BOX_QR });
    repo.findBoxesByQrValues.mockResolvedValue([box]);
    repo.unitsByHomologationIds.mockResolvedValue([
      makeUnit({ id: nextId(), homologationId: BOX_ID, qrValue: '1_1' }),
      makeUnit({ id: nextId(), homologationId: BOX_ID, qrValue: '1_2' }),
    ]);
    return box;
  }

  it('box QR expands its units, all active → ok with isBox + units', async () => {
    setupBox();
    const { results } = await service.validate(TENANT, { codes: [BOX_QR] });
    expect(results[0]).toEqual(
      expect.objectContaining({
        code: BOX_QR,
        ok: true,
        isBox: true,
        itemId: ITEM_ID,
        units: [
          { qrValue: '1_1', ok: true },
          { qrValue: '1_2', ok: true },
        ],
      }),
    );
  });

  it('box with a spent unit → ok=false, per-unit verdicts kept', async () => {
    setupBox();
    repo.movementEventsByQrs.mockResolvedValue([
      makeMovementEvent({ qrValue: '1_2', type: 'SAIDA', createdAt: new Date('2026-02-05T00:00:00Z') }),
    ]);
    const { results } = await service.validate(TENANT, { codes: [BOX_QR] });
    expect(results[0].ok).toBe(false);
    expect(results[0].units).toEqual([
      { qrValue: '1_1', ok: true },
      { qrValue: '1_2', ok: false, reason: 'INV_QR_ALREADY_USED' },
    ]);
  });

  it('box of another material → INV_QR_WRONG_ITEM (units still listed)', async () => {
    setupBox();
    const { results } = await service.validate(TENANT, { codes: [BOX_QR], expectedItemId: OTHER_ITEM_ID });
    expect(results[0]).toEqual(
      expect.objectContaining({ ok: false, reason: 'INV_QR_WRONG_ITEM', isBox: true }),
    );
    expect(results[0].units).toHaveLength(2);
  });
});

describe('validate — batch semantics (S2)', () => {
  it('mixed batch returns one verdict per code and never throws', async () => {
    repo.findUnitsByQrValues.mockResolvedValue([homologatedUnit('1_1')]);
    repo.movementEventsByQrs.mockResolvedValue([
      makeMovementEvent({ qrValue: '1_1', type: 'SAIDA', createdAt: new Date('2026-02-02T00:00:00Z') }),
    ]);

    const { results } = await service.validate(TENANT, { codes: ['1_1', 'nope', `${BASE}2_2`] });
    expect(results).toHaveLength(3);
    expect(results[0].reason).toBe('INV_QR_ALREADY_USED');
    expect(results[1].reason).toBe('INV_QR_NOT_IN_REGISTRY');
    expect(results[2].reason).toBe('INV_QR_NOT_IN_REGISTRY');
  });
});
