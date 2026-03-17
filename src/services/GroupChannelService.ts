import { GroupChannelRepository, groupChannelRepository } from '../repositories/GroupChannelRepository';
import { GroupRepository } from '../repositories/GroupRepository';
import { GroupChannel } from '../domain/entities/GroupChannel';
import { NotFoundError } from '../shared/errors/AppError';
import { PutGroupChannelsDTO, PatchGroupChannelDTO } from '../dto/request/GroupChannelDTO';

const groupRepo = new GroupRepository();

export class GroupChannelService {
  private repo: GroupChannelRepository;

  constructor(repo?: GroupChannelRepository) {
    this.repo = repo ?? groupChannelRepository;
  }

  async list(tenantId: string, groupId: string): Promise<GroupChannel[]> {
    await this.assertGroupExists(tenantId, groupId);
    return this.repo.findByGroup(tenantId, groupId);
  }

  async put(tenantId: string, groupId: string, data: PutGroupChannelsDTO): Promise<GroupChannel[]> {
    await this.assertGroupExists(tenantId, groupId);
    await this.repo.deleteByGroup(tenantId, groupId);
    return this.repo.upsertMany(tenantId, groupId, data.channels.map(c => ({
      channel: c.channel,
      active:  c.active,
      target:  c.target,
      config:  c.config,
    })));
  }

  async patchChannel(tenantId: string, groupId: string, channel: string, data: PatchGroupChannelDTO): Promise<GroupChannel> {
    await this.assertGroupExists(tenantId, groupId);
    const result = await this.repo.patch(tenantId, groupId, channel, {
      active: data.active,
      target: data.target,
      config: data.config,
    });
    if (!result) throw new NotFoundError(`Channel "${channel}" not configured for group "${groupId}"`);
    return result;
  }

  async deleteChannel(tenantId: string, groupId: string, channel: string): Promise<void> {
    await this.assertGroupExists(tenantId, groupId);
    const existing = await this.repo.findByGroupAndChannel(tenantId, groupId, channel);
    if (!existing) throw new NotFoundError(`Channel "${channel}" not configured for group "${groupId}"`);
    await this.repo.deleteByChannel(tenantId, groupId, channel);
  }

  private async assertGroupExists(tenantId: string, groupId: string): Promise<void> {
    const group = await groupRepo.getById(tenantId, groupId);
    if (!group) throw new NotFoundError(`Group "${groupId}" not found`);
  }
}

export const groupChannelService = new GroupChannelService();
