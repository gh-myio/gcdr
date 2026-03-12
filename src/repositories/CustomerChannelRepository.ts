import { db } from '../infrastructure/database/drizzle/db';
import { customerChannels } from '../infrastructure/database/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export type ChannelType = 'EMAIL_RELAY' | 'TELEGRAM' | 'WHATSAPP' | 'WEBHOOK' | 'SMS' | 'SLACK' | 'TEAMS' | 'CUSTOM';

export interface CustomerChannel {
  id: string;
  tenantId: string;
  customerId: string;
  channel: ChannelType;
  active: boolean;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface CreateCustomerChannelData {
  tenantId: string;
  customerId: string;
  channel: ChannelType;
  active?: boolean;
  config?: Record<string, unknown>;
  createdBy?: string;
}

export interface UpdateCustomerChannelData {
  active?: boolean;
  config?: Record<string, unknown>;
}

export class CustomerChannelRepository {
  async create(data: CreateCustomerChannelData): Promise<CustomerChannel> {
    const [row] = await db.insert(customerChannels).values({
      tenantId:   data.tenantId,
      customerId: data.customerId,
      channel:    data.channel,
      active:     data.active ?? true,
      config:     (data.config ?? {}) as never,
      createdBy:  data.createdBy ?? null,
    }).returning();

    return this.mapRow(row);
  }

  async findById(tenantId: string, id: string): Promise<CustomerChannel | null> {
    const [row] = await db
      .select()
      .from(customerChannels)
      .where(and(eq(customerChannels.tenantId, tenantId), eq(customerChannels.id, id)))
      .limit(1);

    return row ? this.mapRow(row) : null;
  }

  async findByCustomer(tenantId: string, customerId: string): Promise<CustomerChannel[]> {
    const rows = await db
      .select()
      .from(customerChannels)
      .where(and(eq(customerChannels.tenantId, tenantId), eq(customerChannels.customerId, customerId)));

    return rows.map(this.mapRow);
  }

  async findByCustomerAndChannel(tenantId: string, customerId: string, channel: ChannelType): Promise<CustomerChannel | null> {
    const [row] = await db
      .select()
      .from(customerChannels)
      .where(and(
        eq(customerChannels.tenantId, tenantId),
        eq(customerChannels.customerId, customerId),
        eq(customerChannels.channel, channel),
      ))
      .limit(1);

    return row ? this.mapRow(row) : null;
  }

  async update(tenantId: string, id: string, data: UpdateCustomerChannelData): Promise<CustomerChannel | null> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.active  !== undefined) updateData.active = data.active;
    if (data.config  !== undefined) updateData.config = data.config;

    const [row] = await db
      .update(customerChannels)
      .set(updateData)
      .where(and(eq(customerChannels.tenantId, tenantId), eq(customerChannels.id, id)))
      .returning();

    return row ? this.mapRow(row) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(customerChannels)
      .where(and(eq(customerChannels.tenantId, tenantId), eq(customerChannels.id, id)))
      .returning({ id: customerChannels.id });

    return result.length > 0;
  }

  private mapRow(row: typeof customerChannels.$inferSelect): CustomerChannel {
    return {
      id:         row.id,
      tenantId:   row.tenantId,
      customerId: row.customerId,
      channel:    row.channel as ChannelType,
      active:     row.active,
      config:     (row.config as Record<string, unknown>) ?? {},
      createdAt:  row.createdAt,
      updatedAt:  row.updatedAt,
      createdBy:  row.createdBy ?? null,
    };
  }
}

export const customerChannelRepository = new CustomerChannelRepository();
