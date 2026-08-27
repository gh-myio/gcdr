/**
 * RFC-0061 M6 — inv_unit_products creation on ENTREGUE_CLIENTE (service with
 * mocked repositories — no DB).
 *
 * One row per delivered unit, labels matched from the delivery QRs, "Projeto =
 * Cliente" (client_name_snapshot = project name; customer from the project
 * when set), status PARADO, idempotent (existing labels are never recreated).
 * Also covers the transit-progress read ("X de Y em transporte").
 */

import { ValidationError } from '../../../src/shared/errors/AppError';
import {
  CTX,
  ORDER_ID,
  ORDER_ITEM_ID,
  ORDER_ITEM_ID_2,
  ITEM_MANUFACTURED,
  ITEM_PURCHASABLE,
  PROJECT_ID,
  CUSTOMER_ID,
  makeOrder,
  makeProject,
  makeDeliveredQr,
  makeExpeditionRepo,
  makeService,
} from './m6-helpers';

function deliveredThree() {
  return [
    makeDeliveredQr({ qrValue: '100_1' }),
    makeDeliveredQr({ qrValue: '100_2', boxQr: 'caixa-10/1' }),
    makeDeliveredQr({ qrValue: '100_3', orderItemId: ORDER_ITEM_ID_2, itemId: ITEM_PURCHASABLE }),
  ];
}

describe('M6 — unit products on ENTREGUE_CLIENTE', () => {
  it('creates one PARADO row per delivered unit with the Projeto = Cliente rule', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
      deliveredQrsByOrder: jest.fn(async () => deliveredThree()),
    });
    const { service } = makeService({ repo });
    const result = await service.changeStatus(CTX, ORDER_ID, { status: 'ENTREGUE_CLIENTE' });

    expect(repo.getProject).toHaveBeenCalledWith(CTX.tenantId, PROJECT_ID, expect.anything());
    const rows = repo.insertUnitProducts.mock.calls[0][0];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      tenantId: CTX.tenantId,
      itemId: ITEM_MANUFACTURED,
      label: '100_1',
      projectId: PROJECT_ID,
      customerId: CUSTOMER_ID, // from the project
      clientNameSnapshot: 'Projeto Moxuara', // Projeto = Cliente
      expeditionOrderId: ORDER_ID,
    });
    expect(rows[2]).toMatchObject({ label: '100_3', itemId: ITEM_PURCHASABLE });
    expect(result.unitProducts).toMatchObject({ created: 3, skipped: 0 });
    expect(repo.enqueuePush).toHaveBeenCalledWith(
      CTX.tenantId,
      { qrCodes: ['100_1', '100_2', '100_3'], location: 'cliente', clientName: 'Projeto Moxuara' },
      expect.anything(),
    );
  });

  it('is idempotent — labels already registered are skipped, never recreated', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
      deliveredQrsByOrder: jest.fn(async () => deliveredThree()),
      existingUnitProductLabels: jest.fn(async () => new Set(['100_1', '100_2'])),
    });
    const { service } = makeService({ repo });
    const result = await service.changeStatus(CTX, ORDER_ID, { status: 'ENTREGUE_CLIENTE' });

    const rows = repo.insertUnitProducts.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: '100_3' });
    expect(result.unitProducts).toMatchObject({ created: 1, skipped: 2 });
  });

  it('fully replayed order creates nothing (created 0, skipped all)', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
      deliveredQrsByOrder: jest.fn(async () => deliveredThree()),
      existingUnitProductLabels: jest.fn(async () => new Set(['100_1', '100_2', '100_3'])),
    });
    const { service } = makeService({ repo });
    const result = await service.changeStatus(CTX, ORDER_ID, { status: 'ENTREGUE_CLIENTE' });
    expect(repo.insertUnitProducts.mock.calls[0][0]).toHaveLength(0);
    expect(result.unitProducts).toMatchObject({ created: 0, skipped: 3 });
  });

  it('duplicate delivered labels collapse to one unit product', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
      deliveredQrsByOrder: jest.fn(async () => [
        makeDeliveredQr({ qrValue: '100_1' }),
        makeDeliveredQr({ qrValue: '100_1' }),
      ]),
    });
    const { service } = makeService({ repo });
    const result = await service.changeStatus(CTX, ORDER_ID, { status: 'ENTREGUE_CLIENTE' });
    expect(repo.insertUnitProducts.mock.calls[0][0]).toHaveLength(1);
    expect(result.unitProducts).toMatchObject({ created: 1, skipped: 0 });
  });

  it('customer falls back to the order when the project has none', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () =>
        makeOrder({ status: 'EM_TRANSITO', customerId: '99999999-9999-4999-8999-999999999999' }),
      ),
      getProject: jest.fn(async () => makeProject({ customerId: null })),
      deliveredQrsByOrder: jest.fn(async () => [makeDeliveredQr()]),
    });
    const { service } = makeService({ repo });
    await service.changeStatus(CTX, ORDER_ID, { status: 'ENTREGUE_CLIENTE' });
    expect(repo.insertUnitProducts.mock.calls[0][0][0]).toMatchObject({
      customerId: '99999999-9999-4999-8999-999999999999',
    });
  });

  it('order without a project → ValidationError (regra Projeto = Cliente)', async () => {
    const repo = makeExpeditionRepo({
      lockById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO', projectId: null })),
    });
    const { service } = makeService({ repo });
    const err = await service.changeStatus(CTX, ORDER_ID, { status: 'ENTREGUE_CLIENTE' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
  });
});

describe('M6 — transit progress ("X de Y em transporte")', () => {
  it('no external-state rows → every QR counts as in transit (default)', async () => {
    const repo = makeExpeditionRepo({
      getById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
      deliveredQrsByOrder: jest.fn(async () => [
        makeDeliveredQr({ qrValue: '100_1' }),
        makeDeliveredQr({ qrValue: '100_2' }),
      ]),
      externalStatesByCodes: jest.fn(async () => []),
    });
    const { service } = makeService({ repo });
    const result = await service.transitProgress(CTX, ORDER_ID, 1, 20);
    expect(result.summary).toBe('2 de 2 em transporte');
    expect(result.totalUnits).toBe(2);
    expect(result.unitsInTransit).toBe(2);
    expect(result.items[0].units.every((u) => u.inTransit)).toBe(true);
  });

  it('a QR mirrored elsewhere (e.g. cliente) leaves the in-transit count', async () => {
    const repo = makeExpeditionRepo({
      getById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
      deliveredQrsByOrder: jest.fn(async () => [
        makeDeliveredQr({ qrValue: '100_1' }),
        makeDeliveredQr({ qrValue: '100_2' }),
        makeDeliveredQr({ qrValue: '100_3' }),
      ]),
      externalStatesByCodes: jest.fn(async () => [
        { code: '100_2', qrValue: null, location: 'cliente', status: 'instalado' },
        { code: '100_3', qrValue: null, location: 'transporte', status: null },
      ]),
    });
    const { service } = makeService({ repo });
    const result = await service.transitProgress(CTX, ORDER_ID, 1, 20);
    expect(result.summary).toBe('2 de 3 em transporte');
    const units = result.items[0].units;
    expect(units.find((u) => u.qrValue === '100_2')).toMatchObject({
      inTransit: false,
      externalLocation: 'cliente',
    });
    expect(units.find((u) => u.qrValue === '100_3')).toMatchObject({ inTransit: true });
  });

  it('groups per order item and paginates the item breakdown', async () => {
    const repo = makeExpeditionRepo({
      getById: jest.fn(async () => makeOrder({ status: 'EM_TRANSITO' })),
      listItemsByOrders: jest.fn(async () => [
        { id: ORDER_ITEM_ID, orderId: ORDER_ID, itemId: ITEM_MANUFACTURED, itemName: 'Produto A', isManufactured: true, domain: 'PRODUCT', quantity: 1 },
        { id: ORDER_ITEM_ID_2, orderId: ORDER_ID, itemId: ITEM_PURCHASABLE, itemName: 'Produto B', isManufactured: true, domain: 'PRODUCT', quantity: 1 },
      ]),
      deliveredQrsByOrder: jest.fn(async () => [
        makeDeliveredQr({ qrValue: '100_1', orderItemId: ORDER_ITEM_ID }),
        makeDeliveredQr({ qrValue: '100_2', orderItemId: ORDER_ITEM_ID_2 }),
      ]),
    });
    const { service } = makeService({ repo });
    const page1 = await service.transitProgress(CTX, ORDER_ID, 1, 1);
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.totalPages).toBe(2);
    expect(page1.summary).toBe('2 de 2 em transporte');
    const page2 = await service.transitProgress(CTX, ORDER_ID, 2, 1);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].orderItemId).toBe(ORDER_ITEM_ID_2);
  });

  it('404 for an unknown order', async () => {
    const repo = makeExpeditionRepo({ getById: jest.fn(async () => null) });
    const { service } = makeService({ repo });
    const err = await service.transitProgress(CTX, ORDER_ID, 1, 20).catch((e) => e);
    expect(err.statusCode).toBe(404);
  });
});
