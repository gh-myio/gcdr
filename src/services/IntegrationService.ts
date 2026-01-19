import { IntegrationPackage, PackageSubscription, PackageStatus } from '../domain/entities/IntegrationPackage';
import {
  CreatePackageDTO,
  UpdatePackageDTO,
  PublishVersionDTO,
  SearchPackagesDTO,
  ReviewPackageDTO,
} from '../dto/request/IntegrationDTO';
import {
  IntegrationPackageRepository,
  SubscriptionRepository,
} from '../repositories/IntegrationRepository';
import { IIntegrationPackageRepository, ISubscriptionRepository } from '../repositories/interfaces/IIntegrationRepository';
import { PartnerRepository } from '../repositories/PartnerRepository';
import { IPartnerRepository } from '../repositories/interfaces/IPartnerRepository';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../shared/errors/AppError';

export class IntegrationService {
  private packageRepo: IIntegrationPackageRepository;
  private subscriptionRepo: ISubscriptionRepository;
  private partnerRepo: IPartnerRepository;

  constructor(
    packageRepo?: IIntegrationPackageRepository,
    subscriptionRepo?: ISubscriptionRepository,
    partnerRepo?: IPartnerRepository
  ) {
    this.packageRepo = packageRepo || new IntegrationPackageRepository();
    this.subscriptionRepo = subscriptionRepo || new SubscriptionRepository();
    this.partnerRepo = partnerRepo || new PartnerRepository();
  }

  // ==================== Package Management ====================

  async createPackage(
    tenantId: string,
    data: CreatePackageDTO,
    publisherId: string
  ): Promise<IntegrationPackage> {
    // Get publisher info
    const partner = await this.partnerRepo.getById(tenantId, publisherId);
    if (!partner) {
      throw new NotFoundError(`Partner ${publisherId} not found`);
    }

    if (partner.status !== 'ACTIVE') {
      throw new ValidationError('Only active partners can create integration packages');
    }

    // Check for slug uniqueness
    const existing = await this.packageRepo.getBySlug(tenantId, data.slug);
    if (existing) {
      throw new ConflictError(`Package with slug "${data.slug}" already exists`);
    }

    const pkg = await this.packageRepo.create(tenantId, data, publisherId, partner.companyName);

    return pkg;
  }

  async getPackageById(tenantId: string, id: string): Promise<IntegrationPackage> {
    const pkg = await this.packageRepo.getById(tenantId, id);
    if (!pkg) {
      throw new NotFoundError(`Integration package ${id} not found`);
    }
    return pkg;
  }

  async getPackageBySlug(tenantId: string, slug: string): Promise<IntegrationPackage> {
    const pkg = await this.packageRepo.getBySlug(tenantId, slug);
    if (!pkg) {
      throw new NotFoundError(`Integration package with slug "${slug}" not found`);
    }
    return pkg;
  }

  async updatePackage(
    tenantId: string,
    id: string,
    data: UpdatePackageDTO,
    updatedBy: string
  ): Promise<IntegrationPackage> {
    const existing = await this.getPackageById(tenantId, id);

    // Only publisher can update their package
    if (existing.publisherId !== updatedBy) {
      throw new ForbiddenError('Only the package publisher can update it');
    }

    // Can't update published packages (only minor fields)
    if (existing.status === 'PUBLISHED') {
      const allowedFields = ['description', 'longDescription', 'tags', 'iconUrl', 'documentationUrl'];
      const attemptedFields = Object.keys(data);
      const disallowedFields = attemptedFields.filter((f) => !allowedFields.includes(f));
      if (disallowedFields.length > 0) {
        throw new ValidationError(
          `Cannot update ${disallowedFields.join(', ')} on a published package. Create a new version instead.`
        );
      }
    }

    return this.packageRepo.update(tenantId, id, data, updatedBy);
  }

  async deletePackage(tenantId: string, id: string, deletedBy: string): Promise<void> {
    const existing = await this.getPackageById(tenantId, id);

    // Only publisher can delete
    if (existing.publisherId !== deletedBy) {
      throw new ForbiddenError('Only the package publisher can delete it');
    }

    // Can't delete packages with active subscribers
    if (existing.subscriberCount > 0) {
      throw new ValidationError(
        'Cannot delete a package with active subscribers. Deprecate it instead.'
      );
    }

    await this.packageRepo.delete(tenantId, id);
  }

  async searchPackages(
    tenantId: string,
    params: SearchPackagesDTO
  ): Promise<PaginatedResult<IntegrationPackage>> {
    return this.packageRepo.search(tenantId, params);
  }

  async listPublisherPackages(tenantId: string, publisherId: string): Promise<IntegrationPackage[]> {
    return this.packageRepo.listByPublisher(tenantId, publisherId);
  }

  async listByCategory(tenantId: string, category: string): Promise<IntegrationPackage[]> {
    return this.packageRepo.listByCategory(tenantId, category);
  }

  // ==================== Version Management ====================

  async publishVersion(
    tenantId: string,
    id: string,
    data: PublishVersionDTO,
    publishedBy: string
  ): Promise<IntegrationPackage> {
    const existing = await this.getPackageById(tenantId, id);

    // Only publisher can publish versions
    if (existing.publisherId !== publishedBy) {
      throw new ForbiddenError('Only the package publisher can publish versions');
    }

    // Check version is greater than current
    if (existing.currentVersion !== '0.0.0') {
      const [curMajor, curMinor, curPatch] = existing.currentVersion.split('.').map(Number);
      const [newMajor, newMinor, newPatch] = data.version.split('.').map(Number);

      const isGreater =
        newMajor > curMajor ||
        (newMajor === curMajor && newMinor > curMinor) ||
        (newMajor === curMajor && newMinor === curMinor && newPatch > curPatch);

      if (!isGreater) {
        throw new ValidationError(
          `Version ${data.version} must be greater than current version ${existing.currentVersion}`
        );
      }
    }

    // If status is DRAFT, it needs to go through review first
    if (existing.status === 'DRAFT') {
      throw new ValidationError('Package must be submitted for review before publishing');
    }

    return this.packageRepo.publish(tenantId, id, data.version, data.releaseNotes, data.breaking);
  }

  async submitForReview(tenantId: string, id: string, submittedBy: string): Promise<IntegrationPackage> {
    const existing = await this.getPackageById(tenantId, id);

    if (existing.publisherId !== submittedBy) {
      throw new ForbiddenError('Only the package publisher can submit for review');
    }

    if (existing.status !== 'DRAFT') {
      throw new ValidationError(`Cannot submit package with status ${existing.status} for review`);
    }

    // Validate package has minimum required fields
    if (existing.scopes.length === 0) {
      throw new ValidationError('Package must define at least one scope');
    }

    return this.packageRepo.updateStatus(tenantId, id, 'PENDING_REVIEW', submittedBy);
  }

  async reviewPackage(
    tenantId: string,
    id: string,
    data: ReviewPackageDTO,
    reviewedBy: string
  ): Promise<IntegrationPackage> {
    const existing = await this.getPackageById(tenantId, id);

    if (existing.status !== 'PENDING_REVIEW') {
      throw new ValidationError(`Cannot review package with status ${existing.status}`);
    }

    if (data.approved) {
      return this.packageRepo.updateStatus(tenantId, id, 'PUBLISHED', reviewedBy);
    } else {
      if (!data.reason) {
        throw new ValidationError('Rejection reason is required');
      }
      // For rejection, we update status back to DRAFT with rejection reason
      const pkg = await this.packageRepo.updateStatus(tenantId, id, 'DRAFT', reviewedBy);
      // Store rejection reason (would need additional field in entity)
      return pkg;
    }
  }

  async deprecatePackage(
    tenantId: string,
    id: string,
    reason: string,
    deprecatedBy: string
  ): Promise<IntegrationPackage> {
    const existing = await this.getPackageById(tenantId, id);

    if (existing.publisherId !== deprecatedBy) {
      throw new ForbiddenError('Only the package publisher can deprecate it');
    }

    return this.packageRepo.deprecate(tenantId, id, reason);
  }

  // ==================== Subscription Management ====================

  async subscribe(
    tenantId: string,
    packageId: string,
    subscriberId: string,
    subscriberType: 'partner' | 'customer',
    version?: string,
    config?: Record<string, unknown>
  ): Promise<PackageSubscription> {
    const pkg = await this.getPackageById(tenantId, packageId);

    if (pkg.status !== 'PUBLISHED') {
      throw new ValidationError('Cannot subscribe to a package that is not published');
    }

    // Check if already subscribed
    const existing = await this.subscriptionRepo.getByPackageAndSubscriber(
      tenantId,
      packageId,
      subscriberId
    );
    if (existing && existing.status === 'ACTIVE') {
      throw new ConflictError('Already subscribed to this package');
    }

    const subscriptionVersion = version || pkg.currentVersion;

    const subscription = await this.subscriptionRepo.create(
      tenantId,
      packageId,
      subscriptionVersion,
      subscriberId,
      subscriberType,
      config
    );

    // Increment subscriber count
    await this.packageRepo.incrementSubscriberCount(tenantId, packageId);

    // Update partner's subscribed packages
    if (subscriberType === 'partner') {
      const partner = await this.partnerRepo.getById(tenantId, subscriberId);
      if (partner && !partner.subscribedPackages.includes(packageId)) {
        await this.partnerRepo.update(
          tenantId,
          subscriberId,
          { subscribedPackages: [...partner.subscribedPackages, packageId] },
          subscriberId
        );
      }
    }

    return subscription;
  }

  async unsubscribe(
    tenantId: string,
    subscriptionId: string,
    unsubscribedBy: string
  ): Promise<void> {
    const subscription = await this.subscriptionRepo.getById(tenantId, subscriptionId);
    if (!subscription) {
      throw new NotFoundError(`Subscription ${subscriptionId} not found`);
    }

    if (subscription.subscriberId !== unsubscribedBy) {
      throw new ForbiddenError('Only the subscriber can cancel the subscription');
    }

    await this.subscriptionRepo.update(tenantId, subscriptionId, { status: 'CANCELLED' });
    await this.packageRepo.decrementSubscriberCount(tenantId, subscription.packageId);
  }

  async getSubscription(tenantId: string, id: string): Promise<PackageSubscription> {
    const subscription = await this.subscriptionRepo.getById(tenantId, id);
    if (!subscription) {
      throw new NotFoundError(`Subscription ${id} not found`);
    }
    return subscription;
  }

  async listSubscriberSubscriptions(
    tenantId: string,
    subscriberId: string
  ): Promise<PackageSubscription[]> {
    return this.subscriptionRepo.listBySubscriber(tenantId, subscriberId);
  }

  async listPackageSubscribers(
    tenantId: string,
    packageId: string,
    requesterId: string
  ): Promise<PackageSubscription[]> {
    const pkg = await this.getPackageById(tenantId, packageId);

    // Only publisher can see subscribers
    if (pkg.publisherId !== requesterId) {
      throw new ForbiddenError('Only the package publisher can view subscribers');
    }

    return this.subscriptionRepo.listByPackage(tenantId, packageId);
  }

  async updateSubscription(
    tenantId: string,
    subscriptionId: string,
    data: { version?: string; config?: Record<string, unknown> },
    updatedBy: string
  ): Promise<PackageSubscription> {
    const subscription = await this.getSubscription(tenantId, subscriptionId);

    if (subscription.subscriberId !== updatedBy) {
      throw new ForbiddenError('Only the subscriber can update the subscription');
    }

    return this.subscriptionRepo.update(tenantId, subscriptionId, data);
  }
}

export const integrationService = new IntegrationService();
