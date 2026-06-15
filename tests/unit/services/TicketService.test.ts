// Unit tests for the RFC-0044 TicketService. Mocks the module-singleton
// collaborators (workOrderService + ticketRepository) so the branchy chamado
// logic is exercised without a database.
jest.mock('../../../src/services/work-orders/WorkOrderService', () => ({
  workOrderService: {
    create: jest.fn(),
    getById: jest.fn(),
    appendEvent: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    list: jest.fn().mockResolvedValue({ items: [], pagination: { total: 0 } }),
  },
}));
jest.mock('../../../src/repositories/work-orders/TicketRepository', () => ({
  ticketRepository: {
    createMeta: jest.fn().mockResolvedValue(undefined),
    addWatcher: jest.fn().mockResolvedValue(undefined),
    findUserIdByEmail: jest.fn().mockResolvedValue(null),
    getMeta: jest.fn().mockResolvedValue({ subject: 'S', priority: 'MEDIA', requesterEmail: 'a@b.com' }),
    listWatchers: jest.fn().mockResolvedValue([]),
    listDerived: jest.fn().mockResolvedValue([]),
    setTicketId: jest.fn().mockResolvedValue(undefined),
    getTicketIdOf: jest.fn().mockResolvedValue(null),
    listEventsForWorkOrders: jest.fn().mockResolvedValue([]),
    listTickets: jest.fn().mockResolvedValue([]),
    countByStatus: jest.fn().mockResolvedValue({ ABERTO: 2, PENDENTE: 1 }),
    getViewer: jest.fn().mockResolvedValue({ id: 'u1', email: 'me@x.com', customerId: 'c1', profile: {} }),
    ticketTeam: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Me', email: 'me@x.com' }]),
  },
}));

import { ticketService } from '../../../src/services/work-orders/TicketService';
import { workOrderService } from '../../../src/services/work-orders/WorkOrderService';
import { ticketRepository } from '../../../src/repositories/work-orders/TicketRepository';
import { ConflictError, NotFoundError } from '../../../src/shared/errors/AppError';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ctx = { userId: 'u1', actorType: 'USER' as const, actor: { id: 'u1' } };
const chamado = (over: Record<string, unknown> = {}) => ({
  id: 'wo1', type: 'CHAMADO', code: 'OS-CH1', status: 'ABERTO', customerId: 'c1',
  assignedTo: null, createdAt: 'now', updatedAt: 'now', ...over,
});

const mocked = {
  create: workOrderService.create as jest.Mock,
  getById: workOrderService.getById as jest.Mock,
  appendEvent: workOrderService.appendEvent as jest.Mock,
  listDerived: ticketRepository.listDerived as jest.Mock,
};

beforeEach(() => jest.clearAllMocks());

describe('TicketService', () => {
  it('open() creates a CHAMADO work order, meta, and emits CHAMADO_ABERTO', async () => {
    mocked.create.mockResolvedValue(chamado());
    mocked.getById.mockResolvedValue(chamado());

    await ticketService.open(
      TENANT,
      { customerId: 'c1', subject: 'Help', requesterEmail: 'user@empresa.com', cc: ['cc@empresa.com'] },
      ctx,
    );

    expect(mocked.create).toHaveBeenCalledWith(
      TENANT, expect.objectContaining({ type: 'CHAMADO', customerId: 'c1' }), ctx,
    );
    expect(ticketRepository.createMeta).toHaveBeenCalled();
    expect(ticketRepository.addWatcher).toHaveBeenCalled();
    expect(mocked.appendEvent).toHaveBeenCalledWith(
      TENANT, 'wo1', expect.objectContaining({ eventType: 'CHAMADO_ABERTO' }), ctx,
    );
  });

  it('get() rejects a non-CHAMADO work order', async () => {
    mocked.getById.mockResolvedValue(chamado({ type: 'INSTALACAO' }));
    await expect(ticketService.get(TENANT, 'wo1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('derive() creates the child OS, links it and recomputes', async () => {
    mocked.getById.mockResolvedValue(chamado());
    mocked.create.mockResolvedValue({ id: 'os9', code: 'OS-9', type: 'INSTALACAO' });
    mocked.listDerived.mockResolvedValue([{ id: 'os9', code: 'OS-9', type: 'INSTALACAO', status: 'PLANEJADA' }]);

    await ticketService.derive(TENANT, 'wo1', { type: 'INSTALACAO' }, ctx);

    expect(ticketRepository.setTicketId).toHaveBeenCalledWith(TENANT, 'os9', 'wo1');
    expect(mocked.appendEvent).toHaveBeenCalledWith(
      TENANT, 'wo1', expect.objectContaining({ eventType: 'CHAMADO_OS_VINCULADA' }), ctx,
    );
  });

  it('transition(resolve) is blocked while a derived OS is active', async () => {
    mocked.getById.mockResolvedValue(chamado());
    mocked.listDerived.mockResolvedValue([{ id: 'os9', code: 'OS-9', type: 'INSTALACAO', status: 'EM_ANDAMENTO' }]);
    await expect(ticketService.transition(TENANT, 'wo1', 'resolve', ctx)).rejects.toBeInstanceOf(ConflictError);
  });

  it('transition(cancel) appends CHAMADO_CANCELADO', async () => {
    mocked.getById.mockResolvedValue(chamado());
    mocked.listDerived.mockResolvedValue([]);
    await ticketService.transition(TENANT, 'wo1', 'cancel', ctx);
    expect(mocked.appendEvent).toHaveBeenCalledWith(
      TENANT, 'wo1', expect.objectContaining({ eventType: 'CHAMADO_CANCELADO' }), ctx,
    );
  });

  it('recomputeAggregate auto-cancels when every derived OS is cancelled', async () => {
    mocked.getById.mockResolvedValue(chamado({ status: 'ABERTO' }));
    mocked.listDerived.mockResolvedValue([{ id: 'os9', code: 'OS-9', type: 'INSTALACAO', status: 'CANCELADA' }]);
    await ticketService.recomputeAggregate(TENANT, 'wo1', ctx);
    expect(mocked.appendEvent).toHaveBeenCalledWith(
      TENANT, 'wo1', expect.objectContaining({ eventType: 'CHAMADO_CANCELADO' }), ctx,
    );
  });

  it('recomputeAggregate is a no-op while any derived OS is active', async () => {
    mocked.getById.mockResolvedValue(chamado({ status: 'ABERTO' }));
    mocked.listDerived.mockResolvedValue([{ id: 'os9', code: 'OS-9', type: 'INSTALACAO', status: 'PLANEJADA' }]);
    await ticketService.recomputeAggregate(TENANT, 'wo1', ctx);
    expect(mocked.appendEvent).not.toHaveBeenCalled();
  });

  it('recomputeAggregate is a no-op when the chamado is already terminal', async () => {
    mocked.getById.mockResolvedValue(chamado({ status: 'CANCELADO' }));
    mocked.listDerived.mockResolvedValue([{ id: 'os9', code: 'OS-9', type: 'INSTALACAO', status: 'CANCELADA' }]);
    await ticketService.recomputeAggregate(TENANT, 'wo1', ctx);
    expect(mocked.appendEvent).not.toHaveBeenCalled();
  });

  it('list() returns a status board (view ALL → no scope lookup)', async () => {
    const res = await ticketService.list(TENANT, { view: 'ALL', viewerUserId: 'u1' });
    expect(res.board.ABERTO).toBe(2);
    expect(res.board.total).toBe(3);
    expect(ticketRepository.getViewer).not.toHaveBeenCalled();
  });

  it('list() with the TECNICO view resolves the viewer scope', async () => {
    await ticketService.list(TENANT, { view: 'TECNICO', viewerUserId: 'u1' });
    expect(ticketRepository.getViewer).toHaveBeenCalledWith(TENANT, 'u1');
  });

  it('list() with the HOLDING view resolves the viewer scope', async () => {
    await ticketService.list(TENANT, { view: 'HOLDING', viewerUserId: 'u1' });
    expect(ticketRepository.getViewer).toHaveBeenCalled();
  });

  it('timeline() flags the chamado events vs the derived OS events', async () => {
    mocked.getById.mockResolvedValue(chamado());
    mocked.listDerived.mockResolvedValue([{ id: 'os9', code: 'OS-9', type: 'INSTALACAO', status: 'PLANEJADA' }]);
    (ticketRepository.listEventsForWorkOrders as jest.Mock).mockResolvedValue([
      { workOrderId: 'wo1', code: 'OS-CH1', type: 'CHAMADO', eventType: 'CHAMADO_ABERTO', actor: { name: 'Me' }, payload: {}, createdAt: 'now' },
      { workOrderId: 'os9', code: 'OS-9', type: 'INSTALACAO', eventType: 'WO_CRIADA', actor: null, payload: {}, createdAt: 'now' },
    ]);
    const events = await ticketService.timeline(TENANT, 'wo1');
    expect(events).toHaveLength(2);
    expect(events[0].isTicket).toBe(true);
    expect(events[1].isTicket).toBe(false);
  });

  it('team() returns the deduped chamados team', async () => {
    const team = await ticketService.team(TENANT);
    expect(team).toEqual([{ id: 'u1', name: 'Me', email: 'me@x.com' }]);
  });
});
