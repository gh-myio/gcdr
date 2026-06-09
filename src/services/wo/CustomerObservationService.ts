import { CustomerObservation } from '../../domain/entities/wo/CustomerObservation';
import { ICustomerObservationRepository } from '../../repositories/interfaces/wo/ICustomerObservationRepository';
import { customerObservationRepository } from '../../repositories/wo/CustomerObservationRepository';
import { NotFoundError } from '../../shared/errors/AppError';

export class CustomerObservationService {
  constructor(
    private readonly repo: ICustomerObservationRepository = customerObservationRepository,
  ) {}

  async create(
    tenantId: string,
    customerId: string,
    observation: string,
    fileAssetId: string | null,
    createdBy: string,
  ): Promise<CustomerObservation> {
    return this.repo.create(tenantId, customerId, { observation, fileAssetId, createdBy });
  }

  async list(tenantId: string, customerId: string): Promise<CustomerObservation[]> {
    return this.repo.listByCustomer(tenantId, customerId);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.repo.getById(tenantId, id);
    if (!existing) throw new NotFoundError(`Observation ${id} not found`);
    return this.repo.delete(tenantId, id);
  }
}

export const customerObservationService = new CustomerObservationService();
