/**
 * RFC-0061 M5 — box operations (mocked repo, no DB): add-unit into an
 * incomplete box of the same material (INV_BOX_FULL / INV_QR_WRONG_ITEM) and
 * remove-from-box (unit becomes a box_size=1 homologation; an emptied box is
 * deleted and its box-QR identity released from the registry).
 */

import { InventoryHomologationService } from '../../../src/services/inventory/InventoryHomologationService';
import { AppError, NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';
import {
  CTX,
  TENANT,
  ITEM_ID,
  OTHER_ITEM_ID,
  BOX_ID,
  UNIT_ID,
  BASE,
  makeHomologation,
  makeUnit,
  makeHomologRepoMock,
  makeStockServiceMock,
  HomologRepoMock,
  nextId,
} from './m5-helpers';

let repo: HomologRepoMock;
let service: InventoryHomologationService;

const SOLO_ID = nextId();
const BOX_QR = `${BASE}caixa-10/1`;

beforeEach(() => {
  jest.clearAllMocks();
  repo = makeHomologRepoMock();
  service = new InventoryHomologationService(repo, makeStockServiceMock());
});

async function expectAppError(promise: Promise<unknown>, code: string, status: number): Promise<AppError> {
  const err = (await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e) => e,
  )) as AppError;
  expect(err).toBeInstanceOf(AppError);
  expect(err.code).toBe(code);
  expect(err.statusCode).toBe(status);
  return err;
}

function box(overrides = {}) {
  return makeHomologation({ id: BOX_ID, boxSize: 10, boxQr: BOX_QR, ...overrides });
}
function soloHomologation(overrides = {}) {
  return makeHomologation({ id: SOLO_ID, boxSize: 1, boxQr: null, ...overrides });
}

describe('addUnitToBox', () => {
  it('moves the unit into the box and deletes the emptied unitary source', async () => {
    const target = box();
    const source = soloHomologation();
    const unit = makeUnit({ id: UNIT_ID, homologationId: SOLO_ID });
    repo.getHomologationById.mockImplementation(async (_t: string, id: string) =>
      id === BOX_ID ? target : id === SOLO_ID ? source : null,
    );
    repo.getUnitById.mockResolvedValue(unit);
    // First countUnits call = box fill check (3/10); second = emptied-source check (0).
    repo.countUnits.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    repo.unitsByHomologationIds.mockResolvedValue([
      makeUnit({ id: nextId(), homologationId: BOX_ID, qrValue: '9_1' }),
      makeUnit({ id: nextId(), homologationId: BOX_ID, qrValue: '9_2' }),
      makeUnit({ id: nextId(), homologationId: BOX_ID, qrValue: '9_3' }),
      makeUnit({ id: UNIT_ID, homologationId: BOX_ID }),
    ]);

    const res = await service.addUnitToBox(CTX, BOX_ID, { unitId: UNIT_ID });

    expect(repo.moveUnit).toHaveBeenCalledWith(TENANT, UNIT_ID, BOX_ID, 4, expect.anything());
    expect(repo.deleteHomologation).toHaveBeenCalledWith(TENANT, SOLO_ID, expect.anything());
    // Unitary source has no box QR — nothing to release from the registry.
    expect(repo.deleteRegistryByValues).not.toHaveBeenCalled();
    expect(res.unitCount).toBe(4);
    expect(res.isFull).toBe(false);
  });

  it('keeps a source box that still has units (and releases nothing)', async () => {
    const target = box();
    const otherBoxId = nextId();
    const source = makeHomologation({ id: otherBoxId, boxSize: 10, boxQr: `${BASE}caixa-10/2` });
    repo.getHomologationById.mockImplementation(async (_t: string, id: string) =>
      id === BOX_ID ? target : id === otherBoxId ? source : null,
    );
    repo.getUnitById.mockResolvedValue(makeUnit({ id: UNIT_ID, homologationId: otherBoxId }));
    repo.countUnits.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    repo.unitsByHomologationIds.mockResolvedValue([makeUnit({ id: UNIT_ID, homologationId: BOX_ID })]);

    await service.addUnitToBox(CTX, BOX_ID, { unitId: UNIT_ID });

    expect(repo.deleteHomologation).not.toHaveBeenCalled();
    expect(repo.deleteRegistryByValues).not.toHaveBeenCalled();
  });

  it('deletes an emptied source BOX and releases its box QR from the registry', async () => {
    const target = box();
    const otherBoxId = nextId();
    const sourceQr = `${BASE}caixa-10/2`;
    const source = makeHomologation({ id: otherBoxId, boxSize: 10, boxQr: sourceQr });
    repo.getHomologationById.mockImplementation(async (_t: string, id: string) =>
      id === BOX_ID ? target : id === otherBoxId ? source : null,
    );
    repo.getUnitById.mockResolvedValue(makeUnit({ id: UNIT_ID, homologationId: otherBoxId }));
    repo.countUnits.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    repo.unitsByHomologationIds.mockResolvedValue([makeUnit({ id: UNIT_ID, homologationId: BOX_ID })]);

    await service.addUnitToBox(CTX, BOX_ID, { unitId: UNIT_ID });

    expect(repo.deleteHomologation).toHaveBeenCalledWith(TENANT, otherBoxId, expect.anything());
    expect(repo.deleteRegistryByValues).toHaveBeenCalledWith(TENANT, [sourceQr], expect.anything());
  });

  it('full box → 422 INV_BOX_FULL', async () => {
    repo.getHomologationById.mockImplementation(async (_t: string, id: string) =>
      id === BOX_ID ? box() : soloHomologation(),
    );
    repo.getUnitById.mockResolvedValue(makeUnit({ id: UNIT_ID, homologationId: SOLO_ID }));
    repo.countUnits.mockResolvedValue(10);
    await expectAppError(service.addUnitToBox(CTX, BOX_ID, { unitId: UNIT_ID }), 'INV_BOX_FULL', 422);
    expect(repo.moveUnit).not.toHaveBeenCalled();
  });

  it('unit of another material → 422 INV_QR_WRONG_ITEM', async () => {
    repo.getHomologationById.mockImplementation(async (_t: string, id: string) =>
      id === BOX_ID ? box() : soloHomologation({ itemId: OTHER_ITEM_ID }),
    );
    repo.getUnitById.mockResolvedValue(makeUnit({ id: UNIT_ID, homologationId: SOLO_ID }));
    const err = await expectAppError(service.addUnitToBox(CTX, BOX_ID, { unitId: UNIT_ID }), 'INV_QR_WRONG_ITEM', 422);
    expect((err as AppError & { details?: Record<string, unknown> }).details).toEqual(
      expect.objectContaining({ expectedItemId: ITEM_ID }),
    );
  });

  it('box not found → 404; unit not found → 404', async () => {
    repo.getHomologationById.mockResolvedValue(null);
    await expect(service.addUnitToBox(CTX, BOX_ID, { unitId: UNIT_ID })).rejects.toBeInstanceOf(NotFoundError);

    repo.getHomologationById.mockResolvedValue(box());
    repo.getUnitById.mockResolvedValue(null);
    await expect(service.addUnitToBox(CTX, BOX_ID, { unitId: UNIT_ID })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('target that is not a box → 400; unit already in the box → 400', async () => {
    repo.getHomologationById.mockResolvedValue(soloHomologation());
    await expect(service.addUnitToBox(CTX, SOLO_ID, { unitId: UNIT_ID })).rejects.toBeInstanceOf(ValidationError);

    repo.getHomologationById.mockResolvedValue(box());
    repo.getUnitById.mockResolvedValue(makeUnit({ id: UNIT_ID, homologationId: BOX_ID }));
    await expect(service.addUnitToBox(CTX, BOX_ID, { unitId: UNIT_ID })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('removeFromBox', () => {
  it('turns the unit into a box_size=1 homologation; box with units left survives', async () => {
    const theBox = box();
    const unit = makeUnit({ id: UNIT_ID, homologationId: BOX_ID });
    repo.getUnitById.mockResolvedValue(unit);
    repo.getHomologationById.mockResolvedValue(theBox);
    repo.insertHomologation.mockResolvedValue(soloHomologation());
    repo.moveUnit.mockResolvedValue(makeUnit({ id: UNIT_ID, homologationId: SOLO_ID }));
    repo.countUnits.mockResolvedValue(9);

    const res = await service.removeFromBox(CTX, UNIT_ID);

    expect(repo.insertHomologation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, itemId: ITEM_ID, boxSize: 1, boxQr: null }),
      expect.anything(),
    );
    expect(repo.moveUnit).toHaveBeenCalledWith(TENANT, UNIT_ID, SOLO_ID, 1, expect.anything());
    expect(res.boxDeleted).toBe(false);
    expect(res.homologation.boxSize).toBe(1);
    expect(repo.deleteHomologation).not.toHaveBeenCalled();
  });

  it('deletes the emptied box and releases its box QR', async () => {
    repo.getUnitById.mockResolvedValue(makeUnit({ id: UNIT_ID, homologationId: BOX_ID }));
    repo.getHomologationById.mockResolvedValue(box());
    repo.insertHomologation.mockResolvedValue(soloHomologation());
    repo.moveUnit.mockResolvedValue(makeUnit({ id: UNIT_ID, homologationId: SOLO_ID }));
    repo.countUnits.mockResolvedValue(0);

    const res = await service.removeFromBox(CTX, UNIT_ID);

    expect(res.boxDeleted).toBe(true);
    expect(repo.deleteHomologation).toHaveBeenCalledWith(TENANT, BOX_ID, expect.anything());
    expect(repo.deleteRegistryByValues).toHaveBeenCalledWith(TENANT, [BOX_QR], expect.anything());
  });

  it('unit not inside a box → 422 INV_BOX_EMPTY', async () => {
    repo.getUnitById.mockResolvedValue(makeUnit({ id: UNIT_ID, homologationId: SOLO_ID }));
    repo.getHomologationById.mockResolvedValue(soloHomologation());
    await expectAppError(service.removeFromBox(CTX, UNIT_ID), 'INV_BOX_EMPTY', 422);
    expect(repo.insertHomologation).not.toHaveBeenCalled();
  });

  it('unknown unit → 404', async () => {
    repo.getUnitById.mockResolvedValue(null);
    await expect(service.removeFromBox(CTX, UNIT_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});
