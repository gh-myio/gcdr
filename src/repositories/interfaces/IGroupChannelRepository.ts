import { GroupChannel } from '../../domain/entities/GroupChannel';

export interface IGroupChannelRepository {
  findByGroup(tenantId: string, groupId: string): Promise<GroupChannel[]>;
  findByGroupAndChannel(tenantId: string, groupId: string, channel: string): Promise<GroupChannel | null>;
  upsert(tenantId: string, groupId: string, data: UpsertGroupChannelData): Promise<GroupChannel>;
  upsertMany(tenantId: string, groupId: string, data: UpsertGroupChannelData[]): Promise<GroupChannel[]>;
  patch(tenantId: string, groupId: string, channel: string, data: PatchGroupChannelData): Promise<GroupChannel | null>;
  deleteByChannel(tenantId: string, groupId: string, channel: string): Promise<void>;
  deleteByGroup(tenantId: string, groupId: string): Promise<void>;
}

export interface UpsertGroupChannelData {
  channel: string;
  active:  boolean;
  target:  string;
  config:  Record<string, unknown>;
}

export interface PatchGroupChannelData {
  active?: boolean;
  target?: string;
  config?: Record<string, unknown>;
}
