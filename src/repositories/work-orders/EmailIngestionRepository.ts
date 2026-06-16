// RFC-0045 — persistence for inbound email ingestion: the idempotency/thread log
// and the lookups EmailToTicketService needs to decide new-vs-append.
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';

const { emailIngestionLog, workOrders } = schema;

export type IngestionStatus = 'created' | 'appended' | 'skipped' | 'error';

export interface IngestionLogInput {
  tenantId: string;
  messageId: string;
  workOrderId?: string | null;
  direction?: 'inbound' | 'outbound';
  fromAddress?: string | null;
  toAddress?: string | null;
  subject?: string | null;
  inReplyTo?: string | null;
  status: IngestionStatus;
  error?: string | null;
}

export class EmailIngestionRepository {
  /** Idempotency check — has this Message-ID already been processed? */
  async findByMessageId(tenantId: string, messageId: string) {
    const [row] = await db
      .select()
      .from(emailIngestionLog)
      .where(and(eq(emailIngestionLog.tenantId, tenantId), eq(emailIngestionLog.messageId, messageId)))
      .limit(1);
    return row ?? null;
  }

  /** Append-only log. Unique (tenant, message_id) makes a racing duplicate a no-op. */
  async insert(input: IngestionLogInput) {
    const [row] = await db
      .insert(emailIngestionLog)
      .values({
        tenantId: input.tenantId,
        messageId: input.messageId,
        workOrderId: input.workOrderId ?? null,
        direction: input.direction ?? 'inbound',
        fromAddress: input.fromAddress ?? null,
        toAddress: input.toAddress ?? null,
        subject: input.subject ?? null,
        inReplyTo: input.inReplyTo ?? null,
        status: input.status,
        error: input.error ?? null,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  /** Resolve a chamado id by its work-order code (CHAMADO only) — subject token match. */
  async findTicketIdByCode(tenantId: string, code: string): Promise<string | null> {
    const [row] = await db
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.code, code), eq(workOrders.type, 'CHAMADO')))
      .limit(1);
    return row?.id ?? null;
  }

  /** Find the chamado a prior email belonged to — In-Reply-To / References match. */
  async findTicketIdByAnchors(tenantId: string, messageIds: string[]): Promise<string | null> {
    for (const mid of messageIds) {
      if (!mid) continue;
      const [row] = await db
        .select({ wo: emailIngestionLog.workOrderId })
        .from(emailIngestionLog)
        .where(and(eq(emailIngestionLog.tenantId, tenantId), eq(emailIngestionLog.messageId, mid)))
        .limit(1);
      if (row?.wo) return row.wo;
    }
    return null;
  }

  /** Resolve a customer by an exact sender-domain match against existing tickets. */
  async findCustomerIdByRequesterDomain(tenantId: string, domain: string): Promise<string | null> {
    const { workOrdersTicketMeta } = schema;
    const [row] = await db
      .select({ customerId: workOrders.customerId })
      .from(workOrdersTicketMeta)
      .innerJoin(workOrders, eq(workOrders.id, workOrdersTicketMeta.workOrderId))
      .where(and(eq(workOrdersTicketMeta.tenantId, tenantId), eq(workOrdersTicketMeta.requesterDomain, domain)))
      .orderBy(desc(workOrders.createdAt))
      .limit(1);
    return row?.customerId ?? null;
  }

  /** Recent ingestion rows for the admin view. */
  async listRecent(tenantId: string, limit = 50) {
    return db
      .select()
      .from(emailIngestionLog)
      .where(eq(emailIngestionLog.tenantId, tenantId))
      .orderBy(desc(emailIngestionLog.processedAt))
      .limit(limit);
  }
}

export const emailIngestionRepository = new EmailIngestionRepository();
