// Pure unit tests of the status-projection flow. appendEvent also touches
// module-singleton repos (lifecycle rules + the RFC-0044 chamado roll-up) that
// aren't constructor-injected; mock them so the suite never hits a database and
// exercises the built-in default flow (no tenant rules).
jest.mock('../../../src/repositories/work-orders/WorkOrderLifecycleRepository', () => ({
  workOrderLifecycleRepository: {
    listByTenant: jest.fn().mockResolvedValue([]),
    listAllByTenant: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../../../src/repositories/work-orders/TicketRepository', () => ({
  ticketRepository: { getTicketIdOf: jest.fn().mockResolvedValue(null) },
}));

import { WorkOrderService } from '../../../src/services/work-orders/WorkOrderService';
import { ConflictError, ValidationError } from '../../../src/shared/errors/AppError';
import type { IWorkOrderRepository } from '../../../src/repositories/interfaces/work-orders/IWorkOrderRepository';
import type { ICustomerRepository } from '../../../src/repositories/interfaces/ICustomerRepository';
import type { IDeviceRepository } from '../../../src/repositories/interfaces/IDeviceRepository';
import type { IAssetRepository } from '../../../src/repositories/interfaces/IAssetRepository';

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const woId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const ctx = { userId, actorType: 'USER' as const, actor: { id: userId } };

/**
 * Build a WorkOrderService with a mock repo. `wo` is the work order returned by
 * getById; `eventType` is the catalog row returned by getEventType.
 */
function makeService(wo: Record<string, unknown>, eventType: Record<string, unknown> | null) {
  const repo = {
    getById: jest.fn().mockResolvedValue(wo),
    getEventType: jest.fn().mockResolvedValue(eventType),
    appendEvent: jest.fn().mockImplementation((_t, _id, data) =>
      Promise.resolve({ id: 'evt-1', ...data })),
    updateStatus: jest.fn().mockResolvedValue({ ...wo }),
  };
  const customerRepo = {} as ICustomerRepository;
  const deviceRepo = { getById: jest.fn().mockResolvedValue({ id: 'dev-1' }) };
  const assetRepo = { getById: jest.fn().mockResolvedValue({ id: 'asset-1' }) };
  const service = new WorkOrderService(
    repo as unknown as IWorkOrderRepository,
    customerRepo,
    deviceRepo as unknown as IDeviceRepository,
    assetRepo as unknown as IAssetRepository,
  );
  return { service, repo };
}

const visitaType = (code: string, terminal = false) => ({
  code, category: 'VISITA_TECNICA', label: code, isTerminal: terminal, active: true, sortOrder: 0,
});

describe('WorkOrderService — status projection on appendEvent', () => {
  it('moves PLANEJADA → EM_ANDAMENTO on VISITA_TECNICA_INICIADA', async () => {
    const wo = { id: woId, type: 'VISITA_TECNICA', status: 'PLANEJADA' };
    const { service, repo } = makeService(wo, visitaType('VISITA_TECNICA_INICIADA'));

    await service.appendEvent(tenantId, woId, { eventType: 'VISITA_TECNICA_INICIADA' } as never, ctx);

    expect(repo.updateStatus).toHaveBeenCalledWith(tenantId, woId, 'EM_ANDAMENTO');
  });

  it('maps AGUARDANDO_AGENDA_CLIENTE → AGUARDANDO', async () => {
    const wo = { id: woId, type: 'VISITA_TECNICA', status: 'EM_ANDAMENTO' };
    const { service, repo } = makeService(wo, visitaType('VISITA_TECNICA_AGUARDANDO_AGENDA_CLIENTE'));

    await service.appendEvent(tenantId, woId, { eventType: 'VISITA_TECNICA_AGUARDANDO_AGENDA_CLIENTE' } as never, ctx);

    expect(repo.updateStatus).toHaveBeenCalledWith(tenantId, woId, 'AGUARDANDO');
  });

  it('does NOT move status for a non-lifecycle (ESTRUTURA) event', async () => {
    const wo = { id: woId, type: 'VISITA_TECNICA', status: 'PLANEJADA' };
    const { service, repo } = makeService(wo, {
      code: 'WO_REAJUSTADA', category: 'ESTRUTURA', label: 'x', isTerminal: false, active: true, sortOrder: 0,
    });

    await service.appendEvent(tenantId, woId, { eventType: 'WO_REAJUSTADA' } as never, ctx);

    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('locks a terminal WO against further lifecycle events', async () => {
    const wo = { id: woId, type: 'VISITA_TECNICA', status: 'FINALIZADA' };
    const { service } = makeService(wo, visitaType('VISITA_TECNICA_INICIADA'));

    await expect(
      service.appendEvent(tenantId, woId, { eventType: 'VISITA_TECNICA_INICIADA' } as never, ctx),
    ).rejects.toThrow(ConflictError);
  });

  it('rejects a lifecycle event whose category != the WO type', async () => {
    const wo = { id: woId, type: 'VISITA_TECNICA', status: 'PLANEJADA' };
    const { service } = makeService(wo, {
      code: 'INSTALACAO_INICIADA', category: 'INSTALACAO', label: 'x', isTerminal: false, active: true, sortOrder: 0,
    });

    await expect(
      service.appendEvent(tenantId, woId, { eventType: 'INSTALACAO_INICIADA' } as never, ctx),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an unknown/inactive event_type', async () => {
    const wo = { id: woId, type: 'VISITA_TECNICA', status: 'PLANEJADA' };
    const { service } = makeService(wo, null);

    await expect(
      service.appendEvent(tenantId, woId, { eventType: 'NOPE' } as never, ctx),
    ).rejects.toThrow(ValidationError);
  });
});
