import { groupDispatchConfigRepository, GroupDispatchConfig, AlarmAction, UpsertGroupDispatchConfigData } from '../repositories/GroupDispatchConfigRepository';
import { GroupRepository } from '../repositories/GroupRepository';
import { NotFoundError } from '../shared/errors/AppError';
import { PutGroupDispatchDTO, PatchGroupDispatchDTO } from '../dto/request/GroupDispatchDTO';

const groupRepo = new GroupRepository();

export class GroupDispatchConfigService {
  async list(tenantId: string, groupId: string): Promise<GroupDispatchConfig[]> {
    await this.assertGroupExists(tenantId, groupId);
    return groupDispatchConfigRepository.findByGroup(tenantId, groupId);
  }

  async put(tenantId: string, groupId: string, data: PutGroupDispatchDTO): Promise<GroupDispatchConfig[]> {
    await this.assertGroupExists(tenantId, groupId);
    await groupDispatchConfigRepository.deleteByGroup(tenantId, groupId);
    const entries: UpsertGroupDispatchConfigData[] = data.entries.map(e => ({
      tenantId,
      groupId,
      channel:           e.channel,
      action:            e.action as AlarmAction,
      active:            e.active,
      escalationDelayMs: e.escalationDelayMs,
    }));
    return groupDispatchConfigRepository.upsertMany(tenantId, groupId, entries);
  }

  async patch(tenantId: string, groupId: string, data: PatchGroupDispatchDTO): Promise<GroupDispatchConfig[]> {
    await this.assertGroupExists(tenantId, groupId);
    return groupDispatchConfigRepository.patch(tenantId, groupId, data.entries.map(e => ({
      channel:           e.channel,
      action:            e.action as AlarmAction,
      active:            e.active,
      escalationDelayMs: e.escalationDelayMs,
    })));
  }

  private async assertGroupExists(tenantId: string, groupId: string): Promise<void> {
    const group = await groupRepo.getById(tenantId, groupId);
    if (!group) throw new NotFoundError(`Group "${groupId}" not found`);
  }
}

export const groupDispatchConfigService = new GroupDispatchConfigService();
