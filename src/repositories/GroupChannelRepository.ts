import { db } from '../infrastructure/database/drizzle/db';
import { groupChannels } from '../infrastructure/database/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { GroupChannel } from '../domain/entities/GroupChannel';
import {
  IGroupChannelRepository,
  UpsertGroupChannelData,
  PatchGroupChannelData,
} from './interfaces/IGroupChannelRepository';

export class GroupChannelRepository implements IGroupChannelRepository {
  async findByGroup(tenantId: string, groupId: string): Promise<GroupChannel[]> {
    const rows = await db
      .select()
      .from(groupChannels)
      .where(and(eq(groupChannels.tenantId, tenantId), eq(groupChannels.groupId, groupId)));
    return rows.map(this.mapRow);
  }

  async findByGroupAndChannel(tenantId: string, groupId: string, channel: string): Promise<GroupChannel | null> {
    const [row] = await db
      .select()
      .from(groupChannels)
      .where(and(
        eq(groupChannels.tenantId, tenantId),
        eq(groupChannels.groupId, groupId),
        eq(groupChannels.channel, channel),
      ))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async upsert(tenantId: string, groupId: string, data: UpsertGroupChannelData): Promise<GroupChannel> {
    const [row] = await db
      .insert(groupChannels)
      .values({ tenantId, groupId, channel: data.channel, active: data.active, target: data.target, config: data.config })
      .onConflictDoUpdate({
        target: [groupChannels.tenantId, groupChannels.groupId, groupChannels.channel],
        set: { active: data.active, target: data.target, config: data.config, updatedAt: new Date() },
      })
      .returning();
    return this.mapRow(row);
  }

  async upsertMany(tenantId: string, groupId: string, data: UpsertGroupChannelData[]): Promise<GroupChannel[]> {
    if (data.length === 0) return [];
    const rows = await db
      .insert(groupChannels)
      .values(data.map(d => ({ tenantId, groupId, channel: d.channel, active: d.active, target: d.target, config: d.config })))
      .onConflictDoUpdate({
        target: [groupChannels.tenantId, groupChannels.groupId, groupChannels.channel],
        set: { active: groupChannels.active, target: groupChannels.target, config: groupChannels.config, updatedAt: new Date() },
      })
      .returning();
    return rows.map(this.mapRow);
  }

  async patch(tenantId: string, groupId: string, channel: string, data: PatchGroupChannelData): Promise<GroupChannel | null> {
    const updateData: Partial<typeof groupChannels.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
    if (data.active  !== undefined) updateData.active = data.active;
    if (data.target  !== undefined) updateData.target = data.target;
    if (data.config  !== undefined) updateData.config = data.config;

    const [row] = await db
      .update(groupChannels)
      .set(updateData)
      .where(and(
        eq(groupChannels.tenantId, tenantId),
        eq(groupChannels.groupId, groupId),
        eq(groupChannels.channel, channel),
      ))
      .returning();
    return row ? this.mapRow(row) : null;
  }

  async deleteByChannel(tenantId: string, groupId: string, channel: string): Promise<void> {
    await db
      .delete(groupChannels)
      .where(and(
        eq(groupChannels.tenantId, tenantId),
        eq(groupChannels.groupId, groupId),
        eq(groupChannels.channel, channel),
      ));
  }

  async deleteByGroup(tenantId: string, groupId: string): Promise<void> {
    await db
      .delete(groupChannels)
      .where(and(eq(groupChannels.tenantId, tenantId), eq(groupChannels.groupId, groupId)));
  }

  private mapRow(row: typeof groupChannels.$inferSelect): GroupChannel {
    return {
      id:        row.id,
      tenantId:  row.tenantId,
      groupId:   row.groupId,
      channel:   row.channel,
      active:    row.active,
      target:    row.target,
      config:    (row.config as Record<string, unknown>) ?? {},
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const groupChannelRepository = new GroupChannelRepository();
