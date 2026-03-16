import { db } from '../infrastructure/database/drizzle/db';
import { userContacts } from '../infrastructure/database/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export interface UserContact {
  id:        string;
  tenantId:  string;
  userId:    string;
  channel:   string;
  value:     string;
  label:     string | null;
  verified:  boolean;
  active:    boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserContactData {
  tenantId: string;
  userId:   string;
  channel:  string;
  value:    string;
  label?:   string;
  active?:  boolean;
}

export interface UpdateUserContactData {
  value?:    string;
  label?:    string;
  active?:   boolean;
  verified?: boolean;
}

export class UserContactRepository {
  async create(data: CreateUserContactData): Promise<UserContact> {
    const [row] = await db.insert(userContacts).values({
      tenantId: data.tenantId,
      userId:   data.userId,
      channel:  data.channel,
      value:    data.value,
      label:    data.label ?? null,
      active:   data.active ?? true,
    }).returning();

    return this.mapRow(row);
  }

  async findById(tenantId: string, id: string): Promise<UserContact | null> {
    const [row] = await db
      .select()
      .from(userContacts)
      .where(and(eq(userContacts.tenantId, tenantId), eq(userContacts.id, id)))
      .limit(1);

    return row ? this.mapRow(row) : null;
  }

  async findByUser(tenantId: string, userId: string): Promise<UserContact[]> {
    const rows = await db
      .select()
      .from(userContacts)
      .where(and(eq(userContacts.tenantId, tenantId), eq(userContacts.userId, userId)));

    return rows.map(this.mapRow);
  }

  async findByUserAndChannel(tenantId: string, userId: string, channel: string): Promise<UserContact[]> {
    const rows = await db
      .select()
      .from(userContacts)
      .where(and(
        eq(userContacts.tenantId, tenantId),
        eq(userContacts.userId, userId),
        eq(userContacts.channel, channel),
      ));

    return rows.map(this.mapRow);
  }

  async update(tenantId: string, id: string, data: UpdateUserContactData): Promise<UserContact | null> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.value    !== undefined) updateData.value    = data.value;
    if (data.label    !== undefined) updateData.label    = data.label;
    if (data.active   !== undefined) updateData.active   = data.active;
    if (data.verified !== undefined) updateData.verified = data.verified;

    const [row] = await db
      .update(userContacts)
      .set(updateData)
      .where(and(eq(userContacts.tenantId, tenantId), eq(userContacts.id, id)))
      .returning();

    return row ? this.mapRow(row) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(userContacts)
      .where(and(eq(userContacts.tenantId, tenantId), eq(userContacts.id, id)))
      .returning({ id: userContacts.id });

    return result.length > 0;
  }

  private mapRow(row: typeof userContacts.$inferSelect): UserContact {
    return {
      id:        row.id,
      tenantId:  row.tenantId,
      userId:    row.userId,
      channel:   row.channel,
      value:     row.value,
      label:     row.label ?? null,
      verified:  row.verified,
      active:    row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const userContactRepository = new UserContactRepository();
