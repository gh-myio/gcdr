/**
 * RFC-0061 M8 — box-is-master (2 passes, §M8).
 *
 * Pass 1: a state reported for a BOX QR propagates to every unit in the box
 * (the box overwrites unit-level state). Pass 2: a unit reported at the
 * client (location `cliente` or status `instalado`) "leaves the box" — a solo
 * box_size=1 homologation via the M5 repos; an emptied box is deleted and its
 * box-QR identity released. Pass 2 is shadow-gated (J4).
 */

import {
  TENANT,
  ITEM_ID,
  CODE,
  CODE_2,
  BOX_QR,
  BOX_CODE,
  BOX_HOMOLOGATION_ID,
  makeProduct,
  makeRegistryRow,
  makeHomologation,
  makeHomologationUnit,
  makeSyncHarness,
  withLiveEnv,
  clearLiveEnv,
} from './m8-helpers';

beforeEach(() => {
  jest.clearAllMocks();
  clearLiveEnv();
});

afterAll(() => clearLiveEnv());

function boxSetup() {
  const box = makeHomologation({ id: BOX_HOMOLOGATION_ID, boxSize: 10, boxQr: BOX_QR });
  const unit1 = makeHomologationUnit({ id: 'ffffffff-7777-4777-8777-777777777771', homologationId: box.id, qrValue: CODE });
  const unit2 = makeHomologationUnit({ id: 'ffffffff-7777-4777-8777-777777777772', homologationId: box.id, qrValue: CODE_2, position: 2 });
  return { box, unit1, unit2 };
}

describe('M8 box-is-master — pass 1 (box state propagates to units)', () => {
  it('propagates the box location/status/technician to every unit in the box', async () => {
    const { box, unit1, unit2 } = boxSetup();
    const h = makeSyncHarness([
      makeProduct({ code: BOX_QR, location: 'transporte', technician: 'Transportadora' }),
      // Platform ALSO lists unit1 individually with a stale location:
      makeProduct({ code: CODE, location: 'estoque' }),
    ]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([
      makeRegistryRow({ qrValue: BOX_QR, kind: 'BOX' }),
      makeRegistryRow({ qrValue: CODE }),
    ]);
    h.homologRepository.findUnitsByQrValues.mockResolvedValue([{ unit: unit1, homologation: box }]);
    h.homologRepository.findBoxesByQrValues.mockResolvedValue([box]);
    h.homologRepository.unitsByHomologationIds.mockResolvedValue([unit1, unit2]);

    await h.service.runPull(TENANT);

    // Both units mirrored with the BOX's state — the box is master.
    expect(h.repository.upsertState).toHaveBeenCalledWith(
      expect.objectContaining({ code: CODE, location: 'transporte', technician: 'Transportadora' }),
    );
    expect(h.repository.upsertState).toHaveBeenCalledWith(
      expect.objectContaining({ code: CODE_2, location: 'transporte' }),
    );
    // The box's own mirror row is kept too (keyed by the normalized code).
    expect(h.repository.upsertState).toHaveBeenCalledWith(
      expect.objectContaining({ code: BOX_CODE, location: 'transporte' }),
    );
  });

  it('adds units the platform did not list individually (synthetic states)', async () => {
    const { box, unit1, unit2 } = boxSetup();
    const h = makeSyncHarness([makeProduct({ code: BOX_QR, location: 'expedicao' })]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: BOX_QR, kind: 'BOX' })]);
    h.homologRepository.findBoxesByQrValues.mockResolvedValue([box]);
    h.homologRepository.unitsByHomologationIds.mockResolvedValue([unit1, unit2]);

    await h.service.runPull(TENANT);

    // 1 box row + 2 propagated unit rows.
    expect(h.repository.upsertState).toHaveBeenCalledTimes(3);
    expect(h.repository.upsertState).toHaveBeenCalledWith(
      expect.objectContaining({ code: CODE_2, location: 'expedicao', homologationUnitId: unit2.id }),
    );
  });
});

describe('M8 box-is-master — pass 2 (unit at the client leaves the box)', () => {
  function clientUnitInBox() {
    const { box, unit1 } = boxSetup();
    const h = makeSyncHarness([
      makeProduct({ code: CODE, location: 'cliente', status: 'instalado', clientName: 'Moxuara' }),
    ]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);
    h.homologRepository.findUnitsByQrValues.mockResolvedValue([{ unit: unit1, homologation: box }]);
    return { h, box, unit1 };
  }

  it('SHADOW: records the box exit as an unapplied correction', async () => {
    const { h } = clientUnitInBox();

    const report = await h.service.runPull(TENANT);

    const exit = report.corrections.find((c) => c.kind === 'BOX_UNIT_LEFT_BOX');
    expect(exit).toBeDefined();
    expect(exit?.applied).toBe(false);
    expect(h.homologRepository.insertHomologation).not.toHaveBeenCalled();
    expect(h.homologRepository.moveUnit).not.toHaveBeenCalled();
  });

  it('LIVE: creates the solo box_size=1 homologation and moves the unit', async () => {
    withLiveEnv();
    const { h, box, unit1 } = clientUnitInBox();
    h.homologRepository.countUnits.mockResolvedValue(4); // box not emptied

    const report = await h.service.runPull(TENANT);

    const exit = report.corrections.find((c) => c.kind === 'BOX_UNIT_LEFT_BOX');
    expect(exit?.applied).toBe(true);
    expect(h.homologRepository.insertHomologation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, itemId: ITEM_ID, boxSize: 1, boxQr: null }),
      expect.anything(),
    );
    expect(h.homologRepository.moveUnit).toHaveBeenCalledWith(
      TENANT,
      unit1.id,
      expect.any(String),
      1,
      expect.anything(),
    );
    // Box still holds units — NOT deleted.
    expect(h.homologRepository.deleteHomologation).not.toHaveBeenCalled();
    expect(box.boxQr).toBe(BOX_QR);
  });

  it('LIVE: an emptied box is deleted and its box-QR identity released', async () => {
    withLiveEnv();
    const { h, box } = clientUnitInBox();
    h.homologRepository.countUnits.mockResolvedValue(0); // last unit left

    await h.service.runPull(TENANT);

    expect(h.homologRepository.deleteHomologation).toHaveBeenCalledWith(TENANT, box.id, expect.anything());
    expect(h.homologRepository.deleteRegistryByValues).toHaveBeenCalledWith(TENANT, [BOX_QR], expect.anything());
  });

  it('does NOT leave the box for a unit still in transit', async () => {
    const { box, unit1 } = boxSetup();
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'transporte' })]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);
    h.homologRepository.findUnitsByQrValues.mockResolvedValue([{ unit: unit1, homologation: box }]);

    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'BOX_UNIT_LEFT_BOX')).toBeUndefined();
  });

  it('does NOT leave the box for a solo (box_size=1) homologation', async () => {
    const solo = makeHomologation({ boxSize: 1 });
    const unit = makeHomologationUnit({ homologationId: solo.id });
    const h = makeSyncHarness([makeProduct({ code: CODE, location: 'cliente' })]);
    h.homologRepository.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: CODE })]);
    h.homologRepository.findUnitsByQrValues.mockResolvedValue([{ unit, homologation: solo }]);

    const report = await h.service.runPull(TENANT);

    expect(report.corrections.find((c) => c.kind === 'BOX_UNIT_LEFT_BOX')).toBeUndefined();
  });
});
