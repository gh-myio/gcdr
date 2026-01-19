import { IntegrationPackage, PackageSubscription, PackageStatus } from '../../domain/entities/IntegrationPackage';
import { CreatePackageDTO, UpdatePackageDTO, SearchPackagesDTO } from '../../dto/request/IntegrationDTO';
import { PaginatedResult } from '../../shared/types';

export interface IIntegrationPackageRepository {
  // Package CRUD
  create(tenantId: string, data: CreatePackageDTO, publisherId: string, publisherName: string): Promise<IntegrationPackage>;
  getById(tenantId: string, id: string): Promise<IntegrationPackage | null>;
  getBySlug(tenantId: string, slug: string): Promise<IntegrationPackage | null>;
  update(tenantId: string, id: string, data: UpdatePackageDTO, updatedBy: string): Promise<IntegrationPackage>;
  delete(tenantId: string, id: string): Promise<void>;

  // Search and List
  search(tenantId: string, params: SearchPackagesDTO): Promise<PaginatedResult<IntegrationPackage>>;
  listByPublisher(tenantId: string, publisherId: string): Promise<IntegrationPackage[]>;
  listByStatus(tenantId: string, status: PackageStatus): Promise<IntegrationPackage[]>;
  listByCategory(tenantId: string, category: string): Promise<IntegrationPackage[]>;

  // Status updates
  updateStatus(tenantId: string, id: string, status: PackageStatus, updatedBy: string): Promise<IntegrationPackage>;
  publish(tenantId: string, id: string, version: string, releaseNotes: string, breaking: boolean): Promise<IntegrationPackage>;
  deprecate(tenantId: string, id: string, reason: string): Promise<IntegrationPackage>;

  // Subscriber count
  incrementSubscriberCount(tenantId: string, id: string): Promise<void>;
  decrementSubscriberCount(tenantId: string, id: string): Promise<void>;
}

export interface ISubscriptionRepository {
  // Subscription CRUD
  create(
    tenantId: string,
    packageId: string,
    packageVersion: string,
    subscriberId: string,
    subscriberType: 'partner' | 'customer',
    config?: Record<string, unknown>
  ): Promise<PackageSubscription>;
  getById(tenantId: string, id: string): Promise<PackageSubscription | null>;
  getByPackageAndSubscriber(
    tenantId: string,
    packageId: string,
    subscriberId: string
  ): Promise<PackageSubscription | null>;
  update(
    tenantId: string,
    id: string,
    data: { version?: string; config?: Record<string, unknown>; status?: string }
  ): Promise<PackageSubscription>;
  delete(tenantId: string, id: string): Promise<void>;

  // List subscriptions
  listBySubscriber(tenantId: string, subscriberId: string): Promise<PackageSubscription[]>;
  listByPackage(tenantId: string, packageId: string): Promise<PackageSubscription[]>;

  // Usage tracking
  updateUsageStats(tenantId: string, id: string, requestCount: number): Promise<void>;
}
