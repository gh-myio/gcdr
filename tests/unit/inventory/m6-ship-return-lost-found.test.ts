/**
 * RFC-0061 M6 — ship / return / lost / found flows (service with mocked
 * repositories — no DB).
 *
 * Ship: mandatory address/method/responsible/tracking/proof → inv_shipments +
 * EM_TRANSITO + push "transporte". Return (EM_TRANSITO → PRONTO_ENTREGA) and
 * lost (→ PERDIDO) demand a reason and stamp the notes with the timestamped
 * markers; found maps the chosen sector to the target status and stamps too.
 */

import {
  ShipExpeditionSchema,
  ReturnExpeditionSchema,
  LostExpeditionSchema,
  FoundExpeditionSchema,
  returnStamp,
  lostStamp,
  foundStamp,
} from '../../../src/services/inventory/InventoryExpeditionService';
import { ValidationError } from '../../../src/shared/errors/AppError';
import {
  CTX,
  ORDER_ID,
  PROOF_ID,
  makeOrder,
  makeDeliveredQr,
  makeExpeditionRepo,
  makeService,
} from './m6-helpers';

const SHIP_DTO = {
  address: 'Rua das Amoreiras, 100 — Vitória/ES',
  shippingMethod: 'AZUL_CARGO',
  responsible: 'João Transportes',
  trackingCode: 'AZ123456789BR',
  proofFileId: PROOF_ID,
};

describe('M6 ship — DTO shape (campos obrigatórios)', () => {
  it.each(['address', 'shippingMethod', 'responsible', 'trackingCode', 'proofFileId'])(
    'rejects a payload missing %s',
    (field) => {
      const dto: Record<string, unknown> = { ...SHIP_DTO };
      delete dto[field];
      expect(() => ShipExpeditionSchema.parse(dto)).toThrow();
    },
  );

  it('rejects an unknown shipping method (enum AZUL_CARGO/CORREIOS/CARRO_MYIO/UBER)', () => {
    expect(() => ShipExpeditionSchema.parse({ ...SHIP_DTO, shippingMethod: 'SEDEX' })).toThrow();
    for (const method of ['AZUL_CARGO', 'CORREIOS', 'CARRO_MYIO', 'UBER']) {
      expect(() => ShipExpeditionSchema.parse({ ...SHIP_DTO, shippingMethod: method })).not.toThrow();
    }
  });
});

describe('M6 ship — flow', () => {
  it('PRONTO_ENTREGA → EM_TRANSITO: creates the shipment and pushes "transporte"', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PRONTO_ENTREGA' })),
      deliveredQrsByOrder: jest.fn(async () => [
        makeDeliveredQr({ qrValue: '100_1' }),
        makeDeliveredQr({ qrValue: '100_2' }),
      ]),
    });
    const { service } = makeService({ repo });
    const result = await service.ship(CTX, ORDER_ID, SHIP_DTO);

    expect(repo.insertShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        address: SHIP_DTO.address,
        shippingMethod: 'AZUL_CARGO',
        responsible: SHIP_DTO.responsible,
        trackingCode: SHIP_DTO.trackingCode,
        proofFileId: PROOF_ID,
      }),
      expect.anything(),
    );
    expect(repo.updateOrder).toHaveBeenCalledWith(
      CTX.tenantId,
      ORDER_ID,
      expect.objectContaining({ status: 'EM_TRANSITO' }),
      expect.anything(),
    );
    expect(repo.enqueuePush).toHaveBeenCalledWith(
      CTX.tenantId,
      expect.objectContaining({ qrCodes: ['100_1', '100_2'], location: 'transporte' }),
      expect.anything(),
    );
    expect(result.order.status).toBe('EM_TRANSITO');
    expect(result.shipment.trackingCode).toBe(SHIP_DTO.trackingCode);
  });

  it('already EM_TRANSITO → INV_ALREADY_IN_STATE 409', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
    });
    const { service } = makeService({ repo });
    const err = await service.ship(CTX, ORDER_ID, SHIP_DTO).catch((e) => e);
    expect(err.code).toBe('INV_ALREADY_IN_STATE');
    expect(repo.insertShipment).not.toHaveBeenCalled();
  });

  it('ship from PENDENTE → INV_ILLEGAL_TRANSITION 409', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PENDENTE' })),
    });
    const { service } = makeService({ repo });
    const err = await service.ship(CTX, ORDER_ID, SHIP_DTO).catch((e) => e);
    expect(err.code).toBe('INV_ILLEGAL_TRANSITION');
    expect(err.details).toEqual({ current: 'PENDENTE', allowedTransitions: ['PRODUZINDO'] });
  });
});

describe('M6 return — EM_TRANSITO → PRONTO_ENTREGA with the note stamp', () => {
  it('reason is mandatory (DTO)', () => {
    expect(() => ReturnExpeditionSchema.parse({})).toThrow();
    expect(() => ReturnExpeditionSchema.parse({ reason: '' })).toThrow();
  });

  it('stamps "[Retornado para Expedição em <ISO>] motivo" and pushes "expedicao"', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO', notes: 'nota antiga' })),
      deliveredQrsByOrder: jest.fn(async () => [makeDeliveredQr({ qrValue: '100_1' })]),
    });
    const { service } = makeService({ repo });
    await service.returnToExpedition(CTX, ORDER_ID, { reason: 'cliente ausente' });

    const patch = repo.updateOrder.mock.calls[0][2] as { status: string; notes: string };
    expect(patch.status).toBe('PRONTO_ENTREGA');
    expect(patch.notes).toMatch(
      /^nota antiga\n\[Retornado para Expedição em \d{4}-\d{2}-\d{2}T[\d:.]+Z\] cliente ausente$/,
    );
    expect(repo.enqueuePush).toHaveBeenCalledWith(
      CTX.tenantId,
      expect.objectContaining({ location: 'expedicao', qrCodes: ['100_1'] }),
      expect.anything(),
    );
  });

  it('return outside EM_TRANSITO → INV_ILLEGAL_TRANSITION 409', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PRODUZINDO' })),
    });
    const { service } = makeService({ repo });
    const err = await service.returnToExpedition(CTX, ORDER_ID, { reason: 'x' }).catch((e) => e);
    expect(err.code).toBe('INV_ILLEGAL_TRANSITION');
  });

  it('already PRONTO_ENTREGA → INV_ALREADY_IN_STATE 409', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PRONTO_ENTREGA' })),
    });
    const { service } = makeService({ repo });
    const err = await service.returnToExpedition(CTX, ORDER_ID, { reason: 'x' }).catch((e) => e);
    expect(err.code).toBe('INV_ALREADY_IN_STATE');
  });
});

describe('M6 lost — EM_TRANSITO → PERDIDO with the note stamp', () => {
  it('reason is mandatory (DTO)', () => {
    expect(() => LostExpeditionSchema.parse({})).toThrow();
  });

  it('stamps "[Mercadoria perdida em <ISO>] motivo" and pushes "perdido"', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO', notes: null })),
      deliveredQrsByOrder: jest.fn(async () => [makeDeliveredQr({ qrValue: '100_1' })]),
    });
    const { service } = makeService({ repo });
    await service.markLost(CTX, ORDER_ID, { reason: 'extraviado pela transportadora' });

    const patch = repo.updateOrder.mock.calls[0][2] as { status: string; notes: string };
    expect(patch.status).toBe('PERDIDO');
    expect(patch.notes).toMatch(
      /^\[Mercadoria perdida em \d{4}-\d{2}-\d{2}T[\d:.]+Z\] extraviado pela transportadora$/,
    );
    expect(repo.enqueuePush).toHaveBeenCalledWith(
      CTX.tenantId,
      expect.objectContaining({ location: 'perdido' }),
      expect.anything(),
    );
  });

  it('lost outside EM_TRANSITO → INV_ILLEGAL_TRANSITION 409', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PRONTO_ENTREGA' })),
    });
    const { service } = makeService({ repo });
    const err = await service.markLost(CTX, ORDER_ID, { reason: 'x' }).catch((e) => e);
    expect(err.code).toBe('INV_ILLEGAL_TRANSITION');
  });

  it('already PERDIDO → INV_ALREADY_IN_STATE 409', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PERDIDO' })),
    });
    const { service } = makeService({ repo });
    const err = await service.markLost(CTX, ORDER_ID, { reason: 'x' }).catch((e) => e);
    expect(err.code).toBe('INV_ALREADY_IN_STATE');
  });
});

describe('M6 found — PERDIDO → sector-mapped status with the note stamp', () => {
  it('sector enum is enforced (DTO)', () => {
    expect(() => FoundExpeditionSchema.parse({ sector: 'FABRICA' })).toThrow();
    expect(() => FoundExpeditionSchema.parse({ sector: 'EXPEDICAO' })).not.toThrow();
  });

  const sectorCases: Array<[string, string, string]> = [
    ['EXPEDICAO', 'PRONTO_ENTREGA', 'expedicao'],
    ['TRANSPORTE', 'EM_TRANSITO', 'transporte'],
    ['ESTOQUE', 'PRODUZINDO', 'estoque'],
  ];

  it.each(sectorCases)('sector %s → status %s + push %s', async (sector, status, push) => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PERDIDO' })),
      deliveredQrsByOrder: jest.fn(async () => [makeDeliveredQr({ qrValue: '100_1' })]),
    });
    const { service } = makeService({ repo });
    await service.markFound(CTX, ORDER_ID, { sector: sector as never });

    const patch = repo.updateOrder.mock.calls[0][2] as { status: string; notes: string };
    expect(patch.status).toBe(status);
    expect(patch.notes).toMatch(/^\[Mercadoria encontrada em \d{4}-\d{2}-\d{2}T[\d:.]+Z\] Setor: /);
    expect(repo.enqueuePush).toHaveBeenCalledWith(
      CTX.tenantId,
      expect.objectContaining({ location: push }),
      expect.anything(),
    );
    expect(repo.insertUnitProducts).not.toHaveBeenCalled();
  });

  it('sector CLIENTE → ENTREGUE_CLIENTE + unit products + push "cliente"', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PERDIDO' })),
      deliveredQrsByOrder: jest.fn(async () => [makeDeliveredQr({ qrValue: '100_1' })]),
    });
    const { service } = makeService({ repo });
    const result = await service.markFound(CTX, ORDER_ID, { sector: 'CLIENTE', notes: 'achado no cliente' });

    const patch = repo.updateOrder.mock.calls[0][2] as { status: string; notes: string };
    expect(patch.status).toBe('ENTREGUE_CLIENTE');
    expect(patch.notes).toContain('Setor: Cliente — achado no cliente');
    expect(repo.insertUnitProducts).toHaveBeenCalled();
    expect(repo.enqueuePush).toHaveBeenCalledWith(
      CTX.tenantId,
      expect.objectContaining({ location: 'cliente', qrCodes: ['100_1'] }),
      expect.anything(),
    );
    expect(result.unitProducts).toMatchObject({ created: 1, skipped: 0 });
  });

  it('sector CLIENTE without a project → ValidationError (Projeto = Cliente)', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PERDIDO', projectId: null })),
    });
    const { service } = makeService({ repo });
    const err = await service.markFound(CTX, ORDER_ID, { sector: 'CLIENTE' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('projeto');
  });

  it('found outside PERDIDO → INV_ILLEGAL_TRANSITION 409', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
    });
    const { service } = makeService({ repo });
    const err = await service.markFound(CTX, ORDER_ID, { sector: 'EXPEDICAO' }).catch((e) => e);
    expect(err.code).toBe('INV_ILLEGAL_TRANSITION');
  });
});

describe('M6 — stamp formats (documented)', () => {
  it('keeps the exact source markers', () => {
    expect(returnStamp('2026-08-27T12:00:00.000Z', 'motivo x')).toBe(
      '[Retornado para Expedição em 2026-08-27T12:00:00.000Z] motivo x',
    );
    expect(lostStamp('2026-08-27T12:00:00.000Z', 'motivo y')).toBe(
      '[Mercadoria perdida em 2026-08-27T12:00:00.000Z] motivo y',
    );
    expect(foundStamp('2026-08-27T12:00:00.000Z', 'ESTOQUE')).toBe(
      '[Mercadoria encontrada em 2026-08-27T12:00:00.000Z] Setor: Estoque',
    );
  });
});
