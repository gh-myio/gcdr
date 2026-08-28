/**
 * RFC-0061 M5 — InventoryHomologationService.createHomologation (mocked repo,
 * no DB): box-size/box-QR shape rules, auto box-QR generation, GLOBAL
 * duplicate detection (payload, registry pre-check and the 23505/err.cause
 * backstop), remaining-to-homologate accounting, and the finishing ENTRADA
 * into ALMOXARIFADO via the M2 stock service.
 */

import {
  InventoryHomologationService,
  CreateHomologationSchema,
  boxQrPrefix,
} from '../../../src/services/inventory/InventoryHomologationService';
import { AppError, NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';
import {
  CTX,
  TENANT,
  ITEM_ID,
  RELEASE_ID,
  makeItem,
  makeRegistryRow,
  makeHomologRepoMock,
  makeStockServiceMock,
  HomologRepoMock,
  StockServiceMock,
  BASE,
} from './m5-helpers';

let repo: HomologRepoMock;
let stock: StockServiceMock;
let service: InventoryHomologationService;

beforeEach(() => {
  jest.clearAllMocks();
  repo = makeHomologRepoMock();
  stock = makeStockServiceMock();
  service = new InventoryHomologationService(repo, stock);
});

function unitDto(overrides: Record<string, unknown> = {}) {
  return {
    itemId: ITEM_ID,
    boxSize: 1 as const,
    units: [{ qrValue: '123_456' }],
    ...overrides,
  };
}

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

describe('createHomologation — shape rules', () => {
  it('schema rejects a boxSize outside {1,10,50,100,224}', () => {
    const parsed = CreateHomologationSchema.safeParse(unitDto({ boxSize: 5 }));
    expect(parsed.success).toBe(false);
  });

  it('schema accepts every legal box size', () => {
    for (const size of [1, 10, 50, 100, 224]) {
      const parsed = CreateHomologationSchema.safeParse(unitDto({ boxSize: size }));
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects a boxQr on a unitary homologation (400)', async () => {
    await expect(
      service.createHomologation(CTX, unitDto({ boxQr: `${BASE}caixa-1/1` }) as never, 'k1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a unitary homologation with more than one unit (400)', async () => {
    await expect(
      service.createHomologation(
        CTX,
        unitDto({ units: [{ qrValue: '1_2' }, { qrValue: '3_4' }] }) as never,
        'k2',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects more units than the box holds → 422 INV_BOX_TOO_BIG', async () => {
    const dto = unitDto({
      boxSize: 10,
      units: Array.from({ length: 11 }, (_, i) => ({ qrValue: `1_${i}` })),
    });
    const err = await expectAppError(service.createHomologation(CTX, dto as never, 'k3'), 'INV_BOX_TOO_BIG', 422);
    expect((err as AppError & { details?: Record<string, unknown> }).details).toEqual({ boxSize: 10, units: 11 });
  });

  it('404 when the item does not exist', async () => {
    repo.getItem.mockResolvedValue(null);
    await expect(service.createHomologation(CTX, unitDto() as never, 'k4')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('400 when the item is not a PRODUCT', async () => {
    repo.getItem.mockResolvedValue(makeItem({ domain: 'COMPONENT', isManufactured: false }));
    await expect(service.createHomologation(CTX, unitDto() as never, 'k5')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('createHomologation — GLOBAL QR duplicate detection (AC-3)', () => {
  it('duplicate inside the payload → 409 INV_QR_DUPLICATE before any insert', async () => {
    const dto = unitDto({ boxSize: 10, units: [{ qrValue: '1_2' }, { qrValue: '1_2' }] });
    await expectAppError(service.createHomologation(CTX, dto as never, 'k6'), 'INV_QR_DUPLICATE', 409);
    expect(repo.insertHomologation).not.toHaveBeenCalled();
  });

  it('box QR equal to a unit QR in the payload → 409 (cross box×unit)', async () => {
    const dto = unitDto({ boxSize: 10, boxQr: '1_2', units: [{ qrValue: '1_2' }] });
    const err = await expectAppError(service.createHomologation(CTX, dto as never, 'k7'), 'INV_QR_DUPLICATE', 409);
    expect((err as AppError & { details?: Record<string, unknown> }).details).toEqual({ qrValue: '1_2' });
  });

  it('value already in inv_qr_registry (any kind) → 409 via the transactional pre-check', async () => {
    repo.findRegistryByValues.mockResolvedValue([makeRegistryRow({ qrValue: '123_456', kind: 'BOX' })]);
    const err = await expectAppError(service.createHomologation(CTX, unitDto() as never, 'k8'), 'INV_QR_DUPLICATE', 409);
    expect((err as AppError & { details?: Record<string, unknown> }).details).toEqual({ qrValue: '123_456' });
    expect(repo.insertHomologation).not.toHaveBeenCalled();
  });

  it('concurrent duplicate past the pre-check → 23505 on err.cause mapped to 409', async () => {
    // Drizzle wraps the driver error: SQLSTATE lives on cause.code (gotcha).
    const wrapped = Object.assign(new Error('Failed query: insert into "inv_qr_registry" …'), {
      cause: Object.assign(new Error('duplicate key value violates unique constraint "inv_qr_registry_uq"'), {
        code: '23505',
        detail: `Key (tenant_id, qr_value)=(${TENANT}, 123_456) already exists.`,
      }),
    });
    repo.insertRegistryRows.mockRejectedValue(wrapped);
    const err = await expectAppError(service.createHomologation(CTX, unitDto() as never, 'k9'), 'INV_QR_DUPLICATE', 409);
    expect((err as AppError & { details?: Record<string, unknown> }).details).toEqual({ qrValue: '123_456' });
  });
});

describe('createHomologation — remaining per release item (§M5)', () => {
  it('404 when the release has no row for the item', async () => {
    repo.releasedQuantity.mockResolvedValue(null);
    await expect(
      service.createHomologation(CTX, unitDto({ releaseId: RELEASE_ID }) as never, 'k10'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('homologating above the remainder → 422 with released/homologated/remaining params', async () => {
    repo.releasedQuantity.mockResolvedValue(10);
    repo.homologatedCount.mockResolvedValue(8);
    const dto = unitDto({ boxSize: 10, releaseId: RELEASE_ID, units: [{ qrValue: '1_1' }, { qrValue: '1_2' }, { qrValue: '1_3' }] });
    const err = await expectAppError(
      service.createHomologation(CTX, dto as never, 'k11'),
      'INV_HOMOLOGATION_OVER_REMAINING',
      422,
    );
    expect((err as AppError & { details?: Record<string, unknown> }).details).toEqual({
      released: 10,
      homologated: 8,
      remaining: 2,
      requested: 3,
    });
    expect(repo.insertHomologation).not.toHaveBeenCalled();
  });

  it('homologating exactly the remainder passes', async () => {
    repo.releasedQuantity.mockResolvedValue(10);
    repo.homologatedCount.mockResolvedValue(9);
    const res = await service.createHomologation(CTX, unitDto({ releaseId: RELEASE_ID }) as never, 'k12');
    expect(res.releaseId).toBe(RELEASE_ID);
  });
});

describe('createHomologation — box QR auto-generation & stock entry', () => {
  it('unitary: no box QR, registry gets one UNIT row, entrada "Homologação — unitário"', async () => {
    const res = await service.createHomologation(CTX, unitDto() as never, 'k13');

    expect(res.boxQr).toBeNull();
    expect(res.units).toHaveLength(1);
    expect(repo.insertRegistryRows).toHaveBeenCalledWith(
      TENANT,
      [expect.objectContaining({ qrValue: '123_456', kind: 'UNIT', itemId: ITEM_ID })],
      expect.anything(),
    );
    expect(stock.createMovement).toHaveBeenCalledWith(
      { tenantId: CTX.tenantId, userId: CTX.userId },
      expect.objectContaining({
        itemId: ITEM_ID,
        location: 'ALMOXARIFADO',
        quantity: 1,
        type: 'ENTRADA',
        reason: 'Homologação — unitário',
        qrs: [expect.objectContaining({ qrValue: '123_456', homologationUnitId: expect.any(String) })],
      }),
      'homologation-entry:k13',
    );
    expect(res.movementId).toBe('aaaaaaaa-0000-0000-0000-000000000001');
  });

  it('box without boxQr: auto-generates <base>caixa-<N>/<seq> sequential per prefix', async () => {
    repo.maxBoxSeq.mockResolvedValue(4);
    const dto = unitDto({ boxSize: 10, units: [{ qrValue: '1_1' }, { qrValue: '1_2' }] });
    const res = await service.createHomologation(CTX, dto as never, 'k14');

    expect(repo.maxBoxSeq).toHaveBeenCalledWith(TENANT, boxQrPrefix(10), expect.anything());
    expect(res.boxQr).toBe(`${BASE}caixa-10/5`);
    // Registry gets the 2 UNIT rows + 1 BOX row (cross box×unit uniqueness).
    const registryRows = repo.insertRegistryRows.mock.calls[0][1];
    expect(registryRows).toHaveLength(3);
    expect(registryRows[2]).toEqual(expect.objectContaining({ qrValue: `${BASE}caixa-10/5`, kind: 'BOX' }));
    expect(stock.createMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        quantity: 2,
        reason: 'Homologação — caixa de 10',
        qrs: [
          expect.objectContaining({ qrValue: '1_1', boxQr: `${BASE}caixa-10/5` }),
          expect.objectContaining({ qrValue: '1_2', boxQr: `${BASE}caixa-10/5` }),
        ],
      }),
      expect.any(String),
    );
  });

  it('box with an explicit boxQr keeps it (no auto-generation)', async () => {
    const dto = unitDto({ boxSize: 10, boxQr: `${BASE}caixa-10/99`, units: [{ qrValue: '1_1' }] });
    const res = await service.createHomologation(CTX, dto as never, 'k15');
    expect(repo.maxBoxSeq).not.toHaveBeenCalled();
    expect(res.boxQr).toBe(`${BASE}caixa-10/99`);
  });

  it('replays the original result for the same Idempotency-Key (S1)', async () => {
    const first = await service.createHomologation(CTX, unitDto() as never, 'same-key');
    const second = await service.createHomologation(CTX, unitDto() as never, 'same-key');
    expect(second).toBe(first);
    expect(repo.insertHomologation).toHaveBeenCalledTimes(1);
    expect(stock.createMovement).toHaveBeenCalledTimes(1);
  });
});
