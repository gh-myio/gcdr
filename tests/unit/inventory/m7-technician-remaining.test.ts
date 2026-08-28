/**
 * RFC-0061 M7 — technician custody: per-dispatch remaining.
 *
 * A dispatch = SAIDA with a responsible; remaining = quantity − Σ
 * inv_technician_moves.quantity. GET groups by technician, omits zeroed
 * dispatches and attaches the dispatch QRs; POST validates 1..remaining under
 * the dispatch row lock.
 */

import { InventoryFieldService } from '../../../src/services/inventory/InventoryFieldService';
import {
  CTX,
  TENANT,
  DISPATCH_ID,
  TECHNICIAN,
  makeFieldRepo,
  makeStockRepo,
  makeQrRepo,
  makeDispatchRow,
} from './m7-helpers';

function build(overrides: { field?: Record<string, jest.Mock> } = {}) {
  const fieldRepo = makeFieldRepo(overrides.field);
  const service = new InventoryFieldService(fieldRepo, makeStockRepo(), makeQrRepo());
  return { service, fieldRepo };
}

describe('M7 GET technician-items — remaining & grouping', () => {
  it('computes remaining = quantity − Σ moves and groups by technician', async () => {
    const { service } = build({
      field: {
        listDispatches: jest.fn(async () => [
          makeDispatchRow({ movementId: 'a1a1a1a1-0000-4000-8000-000000000001', quantity: '5', movedQuantity: 2 }),
          makeDispatchRow({
            movementId: 'a1a1a1a1-0000-4000-8000-000000000002',
            technician: 'Maria',
            quantity: '3',
            movedQuantity: 0,
          }),
        ]),
      },
    });

    const result = await service.listTechnicianItems(TENANT, { page: 1, pageSize: 20 });
    expect(result.total).toBe(2);
    const joao = result.items.find((g) => g.technician === TECHNICIAN);
    const maria = result.items.find((g) => g.technician === 'Maria');
    expect(joao?.totalRemaining).toBe(3);
    expect(joao?.dispatches[0]).toMatchObject({ quantity: 5, movedQuantity: 2, remaining: 3 });
    expect(maria?.totalRemaining).toBe(3);
  });

  it('omits fully-consumed dispatches (and technicians left with none)', async () => {
    const { service } = build({
      field: {
        listDispatches: jest.fn(async () => [
          makeDispatchRow({ movementId: 'a1a1a1a1-0000-4000-8000-000000000003', quantity: '5', movedQuantity: 5 }),
          makeDispatchRow({
            movementId: 'a1a1a1a1-0000-4000-8000-000000000004',
            technician: 'Maria',
            quantity: '2',
            movedQuantity: 1,
          }),
        ]),
      },
    });

    const result = await service.listTechnicianItems(TENANT, { page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].technician).toBe('Maria');
    expect(result.items[0].dispatches[0].remaining).toBe(1);
  });

  it('attaches the dispatch QRs to each open dispatch', async () => {
    const { service, fieldRepo } = build({
      field: {
        listDispatches: jest.fn(async () => [makeDispatchRow({ quantity: '2', movedQuantity: 0 })]),
        listMovementQrs: jest.fn(async () => [
          { id: 'q1', tenantId: TENANT, movementId: DISPATCH_ID, qrValue: '1_1', boxQr: null, homologationUnitId: null },
        ]),
      },
    });

    const result = await service.listTechnicianItems(TENANT, { page: 1, pageSize: 20 });
    expect(fieldRepo.listMovementQrs).toHaveBeenCalledWith(TENANT, [DISPATCH_ID]);
    expect(result.items[0].dispatches[0].qrs).toEqual([{ qrValue: '1_1', boxQr: null }]);
  });
});

describe('M7 POST technician-moves — remaining guard', () => {
  it('accepts quantity exactly equal to the remaining', async () => {
    const { service, fieldRepo } = build({
      field: { sumTechnicianMoves: jest.fn(async () => 3) }, // dispatch qty 5 → remaining 2
    });
    await service.createTechnicianMove(CTX, { movementId: DISPATCH_ID, destination: 'PERDIDO', quantity: 2 }, 'r-1');
    expect(fieldRepo.insertTechnicianMove).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 2, technician: TECHNICIAN }),
      expect.anything(),
    );
  });

  it('rejects quantity above the remaining → 400 (no writes)', async () => {
    const { service, fieldRepo } = build({
      field: { sumTechnicianMoves: jest.fn(async () => 4) }, // remaining 1
    });
    await expect(
      service.createTechnicianMove(CTX, { movementId: DISPATCH_ID, destination: 'PERDIDO', quantity: 2 }, 'r-2'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fieldRepo.insertTechnicianMove).not.toHaveBeenCalled();
  });

  it('locks the dispatch row before summing (remaining check is race-free)', async () => {
    const order: string[] = [];
    const { service } = build({
      field: {
        lockDispatch: jest.fn(async () => {
          order.push('lock');
          return (await import('./m7-helpers')).makeDispatchMovement() as never;
        }),
        sumTechnicianMoves: jest.fn(async () => {
          order.push('sum');
          return 0;
        }),
      },
    });
    await service.createTechnicianMove(CTX, { movementId: DISPATCH_ID, destination: 'PERDIDO', quantity: 1 }, 'r-3');
    expect(order).toEqual(['lock', 'sum']);
  });

  it('unknown dispatch → 404', async () => {
    const { service } = build({ field: { lockDispatch: jest.fn(async () => null) } });
    await expect(
      service.createTechnicianMove(CTX, { movementId: DISPATCH_ID, destination: 'PERDIDO', quantity: 1 }, 'r-4'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('qrValues must match quantity and belong to the dispatch', async () => {
    const { service } = build({
      field: {
        listMovementQrs: jest.fn(async () => [
          { id: 'q1', tenantId: TENANT, movementId: DISPATCH_ID, qrValue: '1_1', boxQr: null, homologationUnitId: null },
        ]),
      },
    });
    // count mismatch (2 QRs would be required for quantity 2)
    await expect(
      service.createTechnicianMove(
        CTX,
        { movementId: DISPATCH_ID, destination: 'ALMOXARIFADO', quantity: 2, qrValues: ['1_1'] },
        'r-5',
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    // foreign QR
    await expect(
      service.createTechnicianMove(
        CTX,
        { movementId: DISPATCH_ID, destination: 'ALMOXARIFADO', quantity: 1, qrValues: ['9_9'] },
        'r-6',
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
