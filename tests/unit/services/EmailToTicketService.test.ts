// Unit tests for the RFC-0045 EmailToTicketService. Mocks the singleton
// collaborators (ticketService, workOrderService, emailIngestionRepository) so
// the new-vs-append / skip / reopen branches run without a database or IMAP.
jest.mock('../../../src/services/work-orders/TicketService', () => ({
  ticketService: {
    open: jest.fn(),
    transition: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../src/services/work-orders/WorkOrderService', () => ({
  workOrderService: {
    getById: jest.fn(),
    appendEvent: jest.fn().mockResolvedValue({ id: 'evt-1' }),
  },
}));
jest.mock('../../../src/repositories/work-orders/EmailIngestionRepository', () => ({
  emailIngestionRepository: {
    findByMessageId: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue({ id: 'log-1' }),
    findTicketIdByCode: jest.fn().mockResolvedValue(null),
    findTicketIdByAnchors: jest.fn().mockResolvedValue(null),
    findCustomerIdByRequesterDomain: jest.fn().mockResolvedValue(null),
  },
}));

import { emailToTicketService, ParsedEmail } from '../../../src/services/work-orders/EmailToTicketService';
import { ticketService } from '../../../src/services/work-orders/TicketService';
import { workOrderService } from '../../../src/services/work-orders/WorkOrderService';
import { emailIngestionRepository } from '../../../src/repositories/work-orders/EmailIngestionRepository';

const m = {
  open: ticketService.open as jest.Mock,
  transition: ticketService.transition as jest.Mock,
  getById: workOrderService.getById as jest.Mock,
  appendEvent: workOrderService.appendEvent as jest.Mock,
  findByMessageId: emailIngestionRepository.findByMessageId as jest.Mock,
  insert: emailIngestionRepository.insert as jest.Mock,
  findByCode: emailIngestionRepository.findTicketIdByCode as jest.Mock,
  findByAnchors: emailIngestionRepository.findTicketIdByAnchors as jest.Mock,
  findCustomerByDomain: emailIngestionRepository.findCustomerIdByRequesterDomain as jest.Mock,
};

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const SYSUSER = 'bbbb5555-5555-5555-5555-555555555555';

function email(over: Partial<ParsedEmail> & { from: ParsedEmail['from'] }): ParsedEmail {
  return { to: ['atendimento@myio.com.br'], subject: 'Teste', text: 'corpo', ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUPPORT_TENANT_ID = TENANT;
  process.env.SUPPORT_DEFAULT_CUSTOMER_ID = CUSTOMER;
  process.env.SUPPORT_SYSTEM_USER_ID = SYSUSER;
  delete process.env.SUPPORT_DOMAIN_ALLOWLIST;
  m.findByMessageId.mockResolvedValue(null);
  m.findByCode.mockResolvedValue(null);
  m.findByAnchors.mockResolvedValue(null);
  m.findCustomerByDomain.mockResolvedValue(null);
});

describe('EmailToTicketService.ingest', () => {
  it('opens a new chamado for a fresh email (source=EMAIL, default customer)', async () => {
    m.open.mockResolvedValue({ id: 'wo1', code: 'OS-AAA' });
    const r = await emailToTicketService.ingest(
      email({ messageId: '<n1@x>', from: { address: 'joao@cliente.com', name: 'Joao' }, cc: ['g@cliente.com'] }),
    );
    expect(r.status).toBe('created');
    expect(r.code).toBe('OS-AAA');
    const openArg = m.open.mock.calls[0][1];
    expect(openArg.source).toBe('EMAIL');
    expect(openArg.customerId).toBe(CUSTOMER);
    expect(openArg.requesterEmail).toBe('joao@cliente.com');
    // first email is dropped on the timeline + a 'created' log row written
    expect(m.appendEvent).toHaveBeenCalledWith(TENANT, 'wo1', expect.objectContaining({ eventType: 'CHAMADO_EMAIL_RECEBIDO' }), expect.anything());
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'created', workOrderId: 'wo1' }));
  });

  it('strips Re:/Fwd: and the [OS-…] token from the subject when opening', async () => {
    m.open.mockResolvedValue({ id: 'wo1', code: 'OS-AAA' });
    m.findByCode.mockResolvedValue(null); // token present but no match -> new
    await emailToTicketService.ingest(
      email({ messageId: '<n2@x>', from: { address: 'a@b.com' }, subject: 'Re: Fwd: [OS-ZZZ] Falha real' }),
    );
    expect(m.open.mock.calls[0][1].subject).toBe('Falha real');
  });

  it('resolves the customer by sender domain when a prior ticket exists', async () => {
    m.findCustomerByDomain.mockResolvedValue('cust-by-domain');
    m.open.mockResolvedValue({ id: 'wo1', code: 'OS-AAA' });
    await emailToTicketService.ingest(email({ messageId: '<n3@x>', from: { address: 'a@known.com' } }));
    expect(m.open.mock.calls[0][1].customerId).toBe('cust-by-domain');
  });

  it('appends to the existing chamado when the subject token matches', async () => {
    m.findByCode.mockResolvedValue('wo-existing');
    m.getById.mockResolvedValue({ id: 'wo-existing', code: 'OS-BBB', status: 'ABERTO' });
    const r = await emailToTicketService.ingest(
      email({ messageId: '<n4@x>', from: { address: 'a@b.com' }, subject: 'Re: [OS-BBB] oi' }),
    );
    expect(r.status).toBe('appended');
    expect(r.ticketId).toBe('wo-existing');
    expect(m.open).not.toHaveBeenCalled();
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'appended' }));
  });

  it('appends via In-Reply-To/References when there is no subject token', async () => {
    m.findByAnchors.mockResolvedValue('wo-thread');
    m.getById.mockResolvedValue({ id: 'wo-thread', code: 'OS-CCC', status: 'PENDENTE' });
    const r = await emailToTicketService.ingest(
      email({ messageId: '<n5@x>', from: { address: 'a@b.com' }, subject: 'sem token', references: ['<n1@x>'] }),
    );
    expect(r.status).toBe('appended');
    expect(m.findByAnchors).toHaveBeenCalled();
  });

  it('reopens a terminal chamado on a client reply', async () => {
    m.findByCode.mockResolvedValue('wo-closed');
    m.getById.mockResolvedValue({ id: 'wo-closed', code: 'OS-DDD', status: 'FECHADO' });
    await emailToTicketService.ingest(email({ messageId: '<n6@x>', from: { address: 'a@b.com' }, subject: '[OS-DDD] de novo' }));
    expect(m.transition).toHaveBeenCalledWith(TENANT, 'wo-closed', 'reopen', expect.anything(), expect.any(String));
  });

  it('skips auto-replies (loop guard) without opening anything', async () => {
    const r = await emailToTicketService.ingest(
      email({ messageId: '<n7@x>', from: { address: 'a@b.com' }, headers: { 'auto-submitted': 'auto-replied' } }),
    );
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('auto-submitted');
    expect(m.open).not.toHaveBeenCalled();
  });

  it('skips senders outside the allowlist when one is configured', async () => {
    process.env.SUPPORT_DOMAIN_ALLOWLIST = 'allowed.com';
    const r = await emailToTicketService.ingest(email({ messageId: '<n8@x>', from: { address: 'x@blocked.com' } }));
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('domain_not_allowlisted');
  });

  it('skips a duplicate Message-ID (idempotency)', async () => {
    m.findByMessageId.mockResolvedValue({ id: 'log-old', workOrderId: 'wo-old' });
    const r = await emailToTicketService.ingest(email({ messageId: '<dup@x>', from: { address: 'a@b.com' } }));
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('duplicate');
    expect(r.ticketId).toBe('wo-old');
  });

  it('records an error row and returns error when opening throws (no throw to caller)', async () => {
    m.open.mockRejectedValue(new Error('Customer X not found'));
    const r = await emailToTicketService.ingest(email({ messageId: '<n9@x>', from: { address: 'a@b.com' } }));
    expect(r.status).toBe('error');
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('throws a readable config error when routing env is missing', async () => {
    delete process.env.SUPPORT_TENANT_ID;
    // Misconfiguration is a startup error, surfaced to the transport (not swallowed).
    await expect(
      emailToTicketService.ingest(email({ messageId: '<n10@x>', from: { address: 'a@b.com' } })),
    ).rejects.toThrow('SUPPORT_TENANT_ID');
  });

  it('falls back to stripped HTML when there is no text part', async () => {
    m.open.mockResolvedValue({ id: 'wo1', code: 'OS-AAA' });
    await emailToTicketService.ingest(
      email({ messageId: '<n11@x>', from: { address: 'a@b.com' }, text: null, html: '<p>Olá<br>mundo</p>' }),
    );
    expect(m.open.mock.calls[0][1].reason).toContain('Olá');
  });
});
