/**
 * RFC-0061 M5 — GET /qr/trace/:code service logic (S5, mocked repo, no DB):
 * input normalization (bare code vs full URL), 404 for unknown QRs, box
 * expansion (flagged, units listed), and the normalized timeline
 * {ts, type, actor, location, refs} merging homologation + ledger + baixas.
 */

import { InventoryQrService, normalizeQrInput } from '../../../src/services/inventory/InventoryQrService';
import { NotFoundError } from '../../../src/shared/errors/AppError';
import {
  TENANT,
  ITEM_ID,
  BOX_ID,
  BASE,
  USER,
  makeHomologation,
  makeUnit,
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

describe('normalizeQrInput (S5 input contract)', () => {
  it('keeps a bare code and adds the URL spelling as a candidate', () => {
    const n = normalizeQrInput('123_456_789');
    expect(n.code).toBe('123_456_789');
    expect(n.candidates).toEqual(expect.arrayContaining(['123_456_789', `${BASE}123_456_789`]));
  });

  it('strips the https URL prefix (camera scan)', () => {
    const n = normalizeQrInput(`${BASE}123_456`);
    expect(n.code).toBe('123_456');
    expect(n.candidates).toEqual(expect.arrayContaining([`${BASE}123_456`, '123_456']));
  });

  it('strips an http:// spelling and trims whitespace', () => {
    expect(normalizeQrInput(` http://produto.myio.com.br/9_9 `).code).toBe('9_9');
  });
});

describe('trace — unit QR', () => {
  function setupUnit() {
    const homologation = makeHomologation({
      id: nextId(),
      boxSize: 10,
      boxQr: `${BASE}caixa-10/1`,
      responsibleId: USER,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });
    const unit = makeUnit({
      id: nextId(),
      homologationId: homologation.id,
      qrValue: '123_456',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });
    repo.findUnitsByQrValues.mockResolvedValue([{ unit, homologation }]);
    return { unit, homologation };
  }

  it('unknown QR → 404', async () => {
    await expect(service.trace(TENANT, 'does-not-exist')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('accepts the full URL and answers with the normalized bare code', async () => {
    setupUnit();
    const res = await service.trace(TENANT, `${BASE}123_456`);
    expect(res.code).toBe('123_456');
    expect(res.isBox).toBe(false);
  });

  it('timeline merges homologation + ledger + baixa, sorted by ts, with normalized events', async () => {
    const { homologation } = setupUnit();
    repo.movementEventsByQrs.mockResolvedValue([
      makeMovementEvent({
        qrValue: '123_456',
        type: 'ENTRADA',
        location: 'ALMOXARIFADO',
        createdAt: new Date('2026-02-01T01:00:00Z'),
      }),
      makeMovementEvent({
        qrValue: '123_456',
        type: 'SAIDA',
        location: 'ALMOXARIFADO',
        reason: 'Saída p/ técnico',
        createdAt: new Date('2026-02-10T00:00:00Z'),
      }),
    ]);
    repo.deliveryEventsByQrs.mockResolvedValue([
      makeDeliveryEvent({ qrValue: '123_456', createdAt: new Date('2026-03-01T00:00:00Z') }),
    ]);

    const res = await service.trace(TENANT, '123_456');

    expect(res.timeline.map((e) => e.type)).toEqual([
      'HOMOLOGACAO',
      'ENTRADA_ESTOQUE',
      'SAIDA_ESTOQUE',
      'EXPEDICAO_BAIXA',
    ]);
    // Every event carries the normalized envelope.
    for (const event of res.timeline) {
      expect(event).toEqual(
        expect.objectContaining({
          ts: expect.any(String),
          type: expect.any(String),
          refs: expect.any(Object),
        }),
      );
    }
    expect(res.timeline[0].refs).toEqual(
      expect.objectContaining({ homologationId: homologation.id, itemId: ITEM_ID, boxQr: `${BASE}caixa-10/1` }),
    );
    // Latest fact is the expedition baixa → current reflects it.
    expect(res.current).toEqual({ location: 'EXPEDICAO', status: 'EM_TRANSITO', client: 'Pedido Cliente X' });
  });

  it('current = EM_ESTOQUE at the last entry location when never exited', async () => {
    setupUnit();
    repo.movementEventsByQrs.mockResolvedValue([
      makeMovementEvent({ qrValue: '123_456', type: 'ENTRADA', location: 'ALMOXARIFADO' }),
    ]);
    const res = await service.trace(TENANT, '123_456');
    expect(res.current).toEqual({ location: 'ALMOXARIFADO', status: 'EM_ESTOQUE', client: null });
  });

  it('current = BAIXADO when the latest ledger event is an exit', async () => {
    setupUnit();
    repo.movementEventsByQrs.mockResolvedValue([
      makeMovementEvent({ qrValue: '123_456', type: 'ENTRADA', createdAt: new Date('2026-02-01T01:00:00Z') }),
      makeMovementEvent({ qrValue: '123_456', type: 'SAIDA', createdAt: new Date('2026-02-02T00:00:00Z') }),
    ]);
    const res = await service.trace(TENANT, '123_456');
    expect(res.current).toEqual({ location: null, status: 'BAIXADO', client: null });
  });

  it('flags ledger events that reached the unit through its box QR', async () => {
    setupUnit();
    repo.movementEventsByQrs.mockResolvedValue([
      makeMovementEvent({ qrValue: null, boxQr: `${BASE}caixa-10/1`, type: 'ENTRADA' }),
    ]);
    const res = await service.trace(TENANT, '123_456');
    const entry = res.timeline.find((e) => e.type === 'ENTRADA_ESTOQUE');
    expect(entry?.refs).toEqual(expect.objectContaining({ viaBoxQr: `${BASE}caixa-10/1` }));
  });

  it('no ledger events yet → HOMOLOGADO in ALMOXARIFADO', async () => {
    setupUnit();
    const res = await service.trace(TENANT, '123_456');
    expect(res.current).toEqual({ location: 'ALMOXARIFADO', status: 'HOMOLOGADO', client: null });
  });
});

describe('trace — box QR', () => {
  const BOX_QR = `${BASE}caixa-50/3`;

  it('expands the units and flags the response as box', async () => {
    const box = makeHomologation({ id: BOX_ID, boxSize: 50, boxQr: BOX_QR, createdAt: new Date('2026-02-01T00:00:00Z') });
    repo.findBoxesByQrValues.mockResolvedValue([box]);
    repo.unitsByHomologationIds.mockResolvedValue([
      makeUnit({ id: nextId(), homologationId: BOX_ID, qrValue: '1_1' }),
      makeUnit({ id: nextId(), homologationId: BOX_ID, qrValue: '1_2' }),
    ]);
    repo.movementEventsByQrs.mockResolvedValue([
      makeMovementEvent({ qrValue: null, boxQr: BOX_QR, type: 'ENTRADA', createdAt: new Date('2026-02-01T01:00:00Z') }),
    ]);

    const res = await service.trace(TENANT, `caixa-50/3`);

    expect(res.isBox).toBe(true);
    expect(res.units).toEqual(['1_1', '1_2']);
    expect(res.timeline.map((e) => e.type)).toEqual(['HOMOLOGACAO', 'ENTRADA_ESTOQUE']);
    expect(res.timeline[0].refs).toEqual(expect.objectContaining({ boxSize: 50, unitCount: 2 }));
    expect(res.current).toEqual({ location: 'ALMOXARIFADO', status: 'EM_ESTOQUE', client: null });
  });
});
