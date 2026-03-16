import { userContactRepository, UserContact } from '../repositories/UserContactRepository';
import { UserRepository } from '../repositories/UserRepository';
import { NotFoundError, ConflictError } from '../shared/errors/AppError';
import { CreateUserContactDTO, UpdateUserContactDTO } from '../dto/request/UserContactDTO';

const userRepo = new UserRepository();

export class UserContactService {
  async list(tenantId: string, userId: string): Promise<UserContact[]> {
    await this.assertUserExists(tenantId, userId);
    return userContactRepository.findByUser(tenantId, userId);
  }

  async create(tenantId: string, userId: string, data: CreateUserContactDTO): Promise<UserContact> {
    await this.assertUserExists(tenantId, userId);

    // Check for duplicate (same channel + value)
    const existing = await userContactRepository.findByUserAndChannel(tenantId, userId, data.channel);
    const duplicate = existing.find(c => c.value === data.value);
    if (duplicate) {
      throw new ConflictError(`Contact "${data.value}" already exists for channel "${data.channel}"`);
    }

    return userContactRepository.create({ tenantId, userId, ...data });
  }

  async update(tenantId: string, userId: string, contactId: string, data: UpdateUserContactDTO): Promise<UserContact> {
    await this.assertUserExists(tenantId, userId);

    const contact = await userContactRepository.findById(tenantId, contactId);
    if (!contact || contact.userId !== userId) {
      throw new NotFoundError('User contact not found');
    }

    const updated = await userContactRepository.update(tenantId, contactId, data);
    return updated!;
  }

  async delete(tenantId: string, userId: string, contactId: string): Promise<void> {
    await this.assertUserExists(tenantId, userId);

    const contact = await userContactRepository.findById(tenantId, contactId);
    if (!contact || contact.userId !== userId) {
      throw new NotFoundError('User contact not found');
    }

    await userContactRepository.delete(tenantId, contactId);
  }

  private async assertUserExists(tenantId: string, userId: string): Promise<void> {
    const user = await userRepo.getById(tenantId, userId);
    if (!user) throw new NotFoundError(`User "${userId}" not found`);
  }
}

export const userContactService = new UserContactService();
