// RFC-0045 smoke test — exercises EmailToTicketService end-to-end against the
// local DB (no IMAP, no HTTP). Run: tsx --env-file=.env scripts/dev/smoke-email-ingestion.ts
import { emailToTicketService, ParsedEmail } from '../../src/services/work-orders/EmailToTicketService';
import { emailIngestionRepository } from '../../src/repositories/work-orders/EmailIngestionRepository';

process.env.SUPPORT_TENANT_ID ??= '11111111-1111-1111-1111-111111111111';
process.env.SUPPORT_DEFAULT_CUSTOMER_ID ??= '33333333-3333-3333-3333-333333333333';
process.env.SUPPORT_SYSTEM_USER_ID ??= 'bbbb5555-5555-5555-5555-555555555555';

const tenantId = process.env.SUPPORT_TENANT_ID;

function email(over: Partial<ParsedEmail> & { from: ParsedEmail['from'] }): ParsedEmail {
  return { to: ['atendimento@myio.com.br'], subject: 'Teste', text: 'corpo', ...over };
}

async function main() {
  // 1) New email -> new chamado
  const r1 = await emailToTicketService.ingest(
    email({
      messageId: '<m-001@cliente.com>',
      from: { address: 'joao@cliente-x.com', name: 'João Cliente' },
      subject: 'Sensor offline na loja 12',
      text: 'Bom dia, o sensor da loja 12 parou de responder desde ontem.',
      cc: ['gerente@cliente-x.com'],
    }),
  );
  console.log('1) new       ->', r1);
  if (r1.status !== 'created' || !r1.code) throw new Error('expected created');

  // 2) Reply with subject token -> append to the SAME chamado (+ reopen if terminal)
  const r2 = await emailToTicketService.ingest(
    email({
      messageId: '<m-002@cliente.com>',
      from: { address: 'joao@cliente-x.com', name: 'João Cliente' },
      subject: `Re: [${r1.code}] Sensor offline na loja 12`,
      text: 'Continua offline, alguma previsão?',
      inReplyTo: '<m-001@cliente.com>',
    }),
  );
  console.log('2) reply tok ->', r2);
  if (r2.status !== 'appended' || r2.ticketId !== r1.ticketId) throw new Error('expected appended to same ticket');

  // 3) Reply matched only by In-Reply-To (no token) -> same chamado
  const r3 = await emailToTicketService.ingest(
    email({
      messageId: '<m-003@cliente.com>',
      from: { address: 'joao@cliente-x.com' },
      subject: 'sem token aqui',
      references: ['<m-001@cliente.com>'],
    }),
  );
  console.log('3) reply ref ->', r3);
  if (r3.status !== 'appended' || r3.ticketId !== r1.ticketId) throw new Error('expected appended via references');

  // 4) Auto-reply -> skipped (loop guard)
  const r4 = await emailToTicketService.ingest(
    email({
      messageId: '<m-004@cliente.com>',
      from: { address: 'noreply@cliente-x.com' },
      headers: { 'auto-submitted': 'auto-replied' },
    }),
  );
  console.log('4) autoreply ->', r4);
  if (r4.status !== 'skipped') throw new Error('expected skipped (auto-submitted)');

  // 5) Duplicate Message-ID -> skipped (idempotency)
  const r5 = await emailToTicketService.ingest(
    email({ messageId: '<m-001@cliente.com>', from: { address: 'joao@cliente-x.com' } }),
  );
  console.log('5) duplicate ->', r5);
  if (r5.status !== 'skipped' || r5.reason !== 'duplicate') throw new Error('expected duplicate skip');

  const log = await emailIngestionRepository.listRecent(tenantId, 10);
  console.log(`\nemail_ingestion_log (${log.length} rows):`);
  for (const l of log) console.log(`  ${l.status.padEnd(9)} ${l.messageId.padEnd(22)} ${l.subject ?? ''}`);
  console.log(`\nOK — chamado ${r1.code} (${r1.ticketId})`);
  process.exit(0);
}

main().catch((e) => { console.error('SMOKE FAILED:', e); process.exit(1); });
