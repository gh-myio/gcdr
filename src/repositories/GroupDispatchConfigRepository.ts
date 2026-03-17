import { db } from '../infrastructure/database/drizzle/db';
import { groupDispatchConfigs } from '../infrastructure/database/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export type AlarmAction = 'OPEN' | 'ACK' | 'ESCALATE' | 'SNOOZE' | 'CLOSE' | 'STATE_HISTORY';

export interface GroupDispatchConfig {
  id:                string;
  tenantId:          string;
  groupId:           string;
  channel:           string;
  action:            AlarmAction;
  active:            boolean;
  escalationDelayMs: number;
  createdAt:         Date;
  updatedAt:         Date;
}

export interface UpsertGroupDispatchConfigData {
  tenantId:          string;
  groupId:           string;
  channel:           string;
  action:            AlarmAction;
  active:            boolean;
  escalationDelayMs: number;
}

export interface PatchGroupDispatchConfigData {
  channel:           string;
  action:            AlarmAction;
  active:            boolean;
  escalationDelayMs: number;
}

export class GroupDispatchConfigRepository {
  async findByGroup(tenantId: string, groupId: string): Promise<GroupDispatchConfig[]> {
    const rows = await db
      .select()
      .from(groupDispatchConfigs)
      .where(and(eq(groupDispatchConfigs.tenantId, tenantId), eq(groupDispatchConfigs.groupId, groupId)));
    return rows.map(this.mapRow);
  }

  async upsertMany(tenantId: string, groupId: string, entries: UpsertGroupDispatchConfigData[]): Promise<GroupDispatchConfig[]> {
    if (entries.length === 0) return [];
    const rows = await db
      .insert(groupDispatchConfigs)
      .values(entries.map(e => ({
        tenantId:          e.tenantId,
        groupId:           e.groupId,
        channel:           e.channel,
        action:            e.action,
        active:            e.active,
        escalationDelayMs: e.escalationDelayMs,
      })))
      .onConflictDoUpdate({
        target: [groupDispatchConfigs.tenantId, groupDispatchConfigs.groupId, groupDispatchConfigs.channel, groupDispatchConfigs.action],
        set: {
          active:            groupDispatchConfigs.active,
          escalationDelayMs: groupDispatchConfigs.escalationDelayMs,
          updatedAt:         new Date(),
        },
      })
      .returning();
    return rows.map(this.mapRow);
  }

  async patch(tenantId: string, groupId: string, entries: PatchGroupDispatchConfigData[]): Promise<GroupDispatchConfig[]> {
    if (entries.length === 0) return this.findByGroup(tenantId, groupId);
    const results: GroupDispatchConfig[] = [];
    for (const entry of entries) {
      const [row] = await db
        .update(groupDispatchConfigs)
        .set({ active: entry.active, escalationDelayMs: entry.escalationDelayMs, updatedAt: new Date() })
        .where(and(
          eq(groupDispatchConfigs.tenantId, tenantId),
          eq(groupDispatchConfigs.groupId, groupId),
          eq(groupDispatchConfigs.channel, entry.channel),
          eq(groupDispatchConfigs.action, entry.action),
        ))
        .returning();
      if (row) results.push(this.mapRow(row));
    }
    return results;
  }

  async deleteByGroup(tenantId: string, groupId: string): Promise<void> {
    await db
      .delete(groupDispatchConfigs)
      .where(and(eq(groupDispatchConfigs.tenantId, tenantId), eq(groupDispatchConfigs.groupId, groupId)));
  }

  private mapRow(row: typeof groupDispatchConfigs.$inferSelect): GroupDispatchConfig {
    return {
      id:                row.id,
      tenantId:          row.tenantId,
      groupId:           row.groupId,
      channel:           row.channel,
      action:            row.action as AlarmAction,
      active:            row.active,
      escalationDelayMs: row.escalationDelayMs,
      createdAt:         row.createdAt,
      updatedAt:         row.updatedAt,
    };
  }
}

export const groupDispatchConfigRepository = new GroupDispatchConfigRepository();
