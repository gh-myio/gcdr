import { CustomerObservation } from '../../../domain/entities/wo/CustomerObservation';

export interface ICustomerObservationRepository {
  create(
    tenantId: string,
    customerId: string,
    data: { observation: string; fileAssetId: string | null; createdBy: string },
  ): Promise<CustomerObservation>;

  getById(tenantId: string, id: string): Promise<CustomerObservation | null>;

  listByCustomer(tenantId: string, customerId: string): Promise<CustomerObservation[]>;

  delete(tenantId: string, id: string): Promise<void>;
}
