/**
 * RFC-0061 M6 — expedition-order state machine (DEC-4, service with mocked
 * repositories — no DB).
 *
 * Covers the whole EXPEDITION_ORDER_TRANSITIONS map through the generic
 * /status service call plus the dedicated flows' transition guards:
 * legal transitions, INV_ALREADY_IN_STATE, INV_ILLEGAL_TRANSITION (body with
 * current + allowedTransitions), the mandatory-payload redirects (EM_TRANSITO
 * → ship, PERDIDO → lost, from-PERDIDO → found) and allowedTransitions on
 * reads (S3).
 */

import {
  EXPEDITION_ORDER_TRANSITIONS,
  InvExpeditionStatus,
} from '../../../src/domain/entities/Inventory';
import { InventoryError } from '../../../src/shared/errors/InventoryError';
import { ValidationError } from '../../../src/shared/errors/AppError';
import { CTX, ORDER_ID, makeOrder, makeExpeditionRepo, makeService } from './m6-helpers';

describe('M6 — EXPEDITION_ORDER_TRANSITIONS map (documented)', () => {
  it('matches the RFC §M6 diagram', () => {
    expect(EXPEDITION_ORDER_TRANSITIONS).toEqual({
      PENDENTE: ['PRODUZINDO'],
      PRODUZINDO: ['PRONTO_ENTREGA'],
      PRONTO_ENTREGA: ['EM_TRANSITO'],
      EM_TRANSITO: ['ENTREGUE_CLIENTE', 'PERDIDO'],
      ENTREGUE_CLIENTE: [],
      PERDIDO: ['PRODUZINDO', 'PRONTO_ENTREGA', 'EM_TRANSITO'],
    });
  });
});

describe('M6 — changeStatus (generic manual transitions)', () => {
  it('PENDENTE → PRODUZINDO succeeds and persists the new status', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PENDENTE' })),
    });
    const { service } = makeService({ repo });
    const result = await service.changeStatus(CTX, ORDER_ID, { status: 'PRODUZINDO' });
    expect(repo.updateOrder).toHaveBeenCalledWith(
      CTX.tenantId,
      ORDER_ID,
      expect.objectContaining({ status: 'PRODUZINDO' }),
      expect.anything(),
    );
    expect(result.order.status).toBe('PRODUZINDO');
    expect(result.order.allowedTransitions).toEqual(['PRONTO_ENTREGA']);
  });

  it('PRODUZINDO → PRONTO_ENTREGA succeeds', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PRODUZINDO' })),
    });
    const { service } = makeService({ repo });
    const result = await service.changeStatus(CTX, ORDER_ID, { status: 'PRONTO_ENTREGA' });
    expect(result.order.status).toBe('PRONTO_ENTREGA');
  });

  it('transition to the CURRENT state → INV_ALREADY_IN_STATE 409 (A1)', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PRODUZINDO' })),
    });
    const { service } = makeService({ repo });
    const err = await service.changeStatus(CTX, ORDER_ID, { status: 'PRODUZINDO' }).catch((e) => e);
    expect(err).toBeInstanceOf(InventoryError);
    expect(err.code).toBe('INV_ALREADY_IN_STATE');
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ current: 'PRODUZINDO' });
    expect(repo.updateOrder).not.toHaveBeenCalled();
  });

  it('illegal transition → INV_ILLEGAL_TRANSITION 409 with allowedTransitions', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PENDENTE' })),
    });
    const { service } = makeService({ repo });
    const err = await service.changeStatus(CTX, ORDER_ID, { status: 'ENTREGUE_CLIENTE' }).catch((e) => e);
    expect(err.code).toBe('INV_ILLEGAL_TRANSITION');
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ current: 'PENDENTE', allowedTransitions: ['PRODUZINDO'] });
  });

  it('ENTREGUE_CLIENTE is terminal — any transition out is illegal', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'ENTREGUE_CLIENTE' })),
    });
    const { service } = makeService({ repo });
    const err = await service.changeStatus(CTX, ORDER_ID, { status: 'PRODUZINDO' }).catch((e) => e);
    expect(err.code).toBe('INV_ILLEGAL_TRANSITION');
    expect(err.details.allowedTransitions).toEqual([]);
  });

  it('target EM_TRANSITO is redirected to /ship (mandatory payload)', async () => {
    const { service, repo } = makeService();
    const err = await service.changeStatus(CTX, ORDER_ID, { status: 'EM_TRANSITO' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('/ship');
    expect(repo.lockById).not.toHaveBeenCalled();
  });

  it('target PERDIDO is redirected to /lost (motivo obrigatório)', async () => {
    const { service } = makeService();
    const err = await service.changeStatus(CTX, ORDER_ID, { status: 'PERDIDO' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('/lost');
  });

  it('current PERDIDO is redirected to /found (sector mapping)', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'PERDIDO' })),
    });
    const { service } = makeService({ repo });
    const err = await service.changeStatus(CTX, ORDER_ID, { status: 'PRODUZINDO' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('/found');
  });

  it('EM_TRANSITO → ENTREGUE_CLIENTE creates the unit products (idempotent path tested in m6-unit-products)', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
    });
    const { service } = makeService({ repo });
    const result = await service.changeStatus(CTX, ORDER_ID, { status: 'ENTREGUE_CLIENTE' });
    expect(result.order.status).toBe('ENTREGUE_CLIENTE');
    expect(result.unitProducts).toBeDefined();
    expect(repo.insertUnitProducts).toHaveBeenCalled();
  });

  it('404 when the order does not exist', async () => {
    const repo = makeExpeditionRepo({ lockById: jest.fn(async () => null) });
    const { service } = makeService({ repo });
    const err = await service.changeStatus(CTX, ORDER_ID, { status: 'PRODUZINDO' }).catch((e) => e);
    expect(err.statusCode).toBe(404);
  });
});

describe('M6 — allowedTransitions on reads (S3)', () => {
  const cases: Array<[InvExpeditionStatus, InvExpeditionStatus[]]> = [
    ['PENDENTE', ['PRODUZINDO']],
    ['PRODUZINDO', ['PRONTO_ENTREGA']],
    ['PRONTO_ENTREGA', ['EM_TRANSITO']],
    ['EM_TRANSITO', ['ENTREGUE_CLIENTE', 'PERDIDO']],
    ['ENTREGUE_CLIENTE', []],
    ['PERDIDO', ['PRODUZINDO', 'PRONTO_ENTREGA', 'EM_TRANSITO']],
  ];

  it.each(cases)('getById exposes allowedTransitions for %s', async (status, allowed) => {
    const repo = makeExpeditionRepo({ getById: jest.fn(async () => makeOrder({ status })) });
    const { service } = makeService({ repo });
    const detail = await service.getById(CTX, ORDER_ID);
    expect(detail.allowedTransitions).toEqual(allowed);
  });
});
