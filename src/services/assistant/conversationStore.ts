// RFC-0043 — persistence for the GCDR Copiloto chat history.
// A conversation is private to its owner unless `shared` = true, when other
// users in the tenant can read it (read-only). Owner-only edit/delete.
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { NotFoundError } from '../../shared/errors/AppError';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
}

export interface ConversationInput {
  title?: string;
  messages: ConversationTurn[];
  shared?: boolean;
}

export type ConversationScope = 'mine' | 'shared' | 'all';

const { assistantConversations: T, users } = schema;

interface ProfileName {
  displayName?: string;
  firstName?: string;
  lastName?: string;
}
function ownerName(profile: unknown, email: string | null): string {
  const p = (profile ?? {}) as ProfileName;
  return (
    p.displayName ||
    [p.firstName, p.lastName].filter(Boolean).join(' ').trim() ||
    email ||
    'Usuário'
  );
}

function brief(row: typeof T.$inferSelect, myUserId: string) {
  const msgs = Array.isArray(row.messages) ? (row.messages as ConversationTurn[]) : [];
  return {
    id: row.id,
    title: row.title,
    shared: row.shared,
    isOwner: row.userId === myUserId,
    ownerId: row.userId,
    messageCount: msgs.length,
    updatedAt: row.updatedAt,
  };
}

/** List own conversations and/or those shared by other users in the tenant. */
export async function listConversations(
  tenantId: string,
  userId: string,
  scope: ConversationScope = 'all',
) {
  const mine = and(eq(T.tenantId, tenantId), eq(T.userId, userId));
  const sharedByOthers = and(
    eq(T.tenantId, tenantId),
    eq(T.shared, true),
    ne(T.userId, userId),
  );
  const where =
    scope === 'mine' ? mine : scope === 'shared' ? sharedByOthers : or(mine, sharedByOthers);

  const rows = await db.select().from(T).where(where).orderBy(desc(T.updatedAt)).limit(100);

  // Resolve owner names for conversations not owned by the caller.
  const otherOwnerIds = [...new Set(rows.filter((r) => r.userId !== userId).map((r) => r.userId))];
  const nameById = new Map<string, string>();
  if (otherOwnerIds.length) {
    const us = await db
      .select({ id: users.id, email: users.email, profile: users.profile })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.id, otherOwnerIds)));
    for (const u of us) nameById.set(u.id, ownerName(u.profile, u.email));
  }

  return rows.map((r) => ({
    ...brief(r, userId),
    ownerName: r.userId === userId ? null : nameById.get(r.userId) ?? 'Usuário',
  }));
}

/** Get one conversation if owned by the caller or shared. Throws if not. */
export async function getConversation(tenantId: string, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.id, id)))
    .limit(1);
  if (!row || (row.userId !== userId && !row.shared)) {
    throw new NotFoundError('Conversation not found');
  }
  return {
    ...brief(row, userId),
    messages: (Array.isArray(row.messages) ? row.messages : []) as ConversationTurn[],
  };
}

export async function createConversation(
  tenantId: string,
  userId: string,
  input: ConversationInput,
) {
  const [row] = await db
    .insert(T)
    .values({
      tenantId,
      userId,
      title: input.title?.slice(0, 200) || 'Conversa',
      messages: input.messages,
      shared: input.shared ?? false,
    })
    .returning();
  return getConversation(tenantId, userId, row.id);
}

/** Update title/messages/shared. Owner only. */
export async function updateConversation(
  tenantId: string,
  userId: string,
  id: string,
  patch: Partial<ConversationInput>,
) {
  const [owned] = await db
    .select({ id: T.id })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.id, id), eq(T.userId, userId)))
    .limit(1);
  if (!owned) throw new NotFoundError('Conversation not found');

  await db
    .update(T)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.slice(0, 200) || 'Conversa' } : {}),
      ...(patch.messages !== undefined ? { messages: patch.messages } : {}),
      ...(patch.shared !== undefined ? { shared: patch.shared } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(T.tenantId, tenantId), eq(T.id, id)));
  return getConversation(tenantId, userId, id);
}

/** Delete a conversation. Owner only. */
export async function deleteConversation(tenantId: string, userId: string, id: string) {
  const res = await db
    .delete(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.id, id), eq(T.userId, userId)))
    .returning({ id: T.id });
  if (!res.length) throw new NotFoundError('Conversation not found');
}
