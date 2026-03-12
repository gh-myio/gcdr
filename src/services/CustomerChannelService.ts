import { customerChannelRepository, CustomerChannel, ChannelType } from '../repositories/CustomerChannelRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { NotFoundError, ConflictError } from '../shared/errors/AppError';
import { CreateCustomerChannelDTO, UpdateCustomerChannelDTO } from '../dto/request/CustomerChannelDTO';

const customerRepo = new CustomerRepository();

export class CustomerChannelService {
  async list(tenantId: string, customerId: string): Promise<CustomerChannel[]> {
    await this.assertCustomerExists(tenantId, customerId);
    return customerChannelRepository.findByCustomer(tenantId, customerId);
  }

  async create(tenantId: string, customerId: string, data: CreateCustomerChannelDTO, userId?: string): Promise<CustomerChannel> {
    await this.assertCustomerExists(tenantId, customerId);

    const existing = await customerChannelRepository.findByCustomerAndChannel(tenantId, customerId, data.channel as ChannelType);
    if (existing) {
      throw new ConflictError(`Channel "${data.channel}" already exists for this customer`);
    }

    return customerChannelRepository.create({
      tenantId,
      customerId,
      channel:   data.channel as ChannelType,
      active:    data.active,
      config:    data.config as Record<string, unknown>,
      createdBy: userId,
    });
  }

  async update(tenantId: string, customerId: string, channelId: string, data: UpdateCustomerChannelDTO): Promise<CustomerChannel> {
    await this.assertCustomerExists(tenantId, customerId);

    const channel = await customerChannelRepository.findById(tenantId, channelId);
    if (!channel || channel.customerId !== customerId) {
      throw new NotFoundError('Customer channel not found');
    }

    const updated = await customerChannelRepository.update(tenantId, channelId, {
      active: data.active,
      config: data.config as Record<string, unknown> | undefined,
    });

    return updated!;
  }

  async delete(tenantId: string, customerId: string, channelId: string): Promise<void> {
    await this.assertCustomerExists(tenantId, customerId);

    const channel = await customerChannelRepository.findById(tenantId, channelId);
    if (!channel || channel.customerId !== customerId) {
      throw new NotFoundError('Customer channel not found');
    }

    await customerChannelRepository.delete(tenantId, channelId);
  }

  private async assertCustomerExists(tenantId: string, customerId: string): Promise<void> {
    const customer = await customerRepo.getById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundError(`Customer "${customerId}" not found`);
    }
  }
}

export const customerChannelService = new CustomerChannelService();
