import {
  IntegrationPackage,
  PackageSubscription,
  PackageCapability,
  PackageEndpoint,
  PackageEvent,
  PackagePricing,
  PackageVersion,
} from '../../domain/entities/IntegrationPackage';

// Package Summary (for list views)
export interface PackageSummaryDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  type: string;
  status: string;
  currentVersion: string;
  iconUrl?: string;
  publisherName: string;
  verified: boolean;
  pricing: {
    model: string;
    price?: number;
    currency?: string;
  };
  subscriberCount: number;
  tags: string[];
  publishedAt?: string;
  updatedAt: string;
}

// Full Package Details
export interface PackageDetailDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  longDescription?: string;
  category: string;
  type: string;
  status: string;
  tags: string[];
  iconUrl?: string;
  documentationUrl?: string;

  // Version info
  currentVersion: string;
  versions: PackageVersion[];

  // Publisher
  publisherId: string;
  publisherName: string;
  verified: boolean;

  // Technical
  scopes: string[];
  capabilities: PackageCapability[];
  endpoints: PackageEndpoint[];
  events: PackageEvent[];
  auth: {
    type: string;
  };
  rateLimits: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
    monthlyQuota?: number;
  };

  // Subscription
  pricing: PackagePricing;
  subscriberCount: number;

  // Timestamps
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Subscription Response
export interface SubscriptionDTO {
  id: string;
  packageId: string;
  packageName: string;
  packageVersion: string;
  subscriberType: string;
  status: string;
  subscribedAt: string;
  expiresAt?: string;
  config?: Record<string, unknown>;
  usageStats: {
    requestCount: number;
    lastRequestAt?: string;
    monthlyUsage: number;
  };
}

// Transform functions
export function toPackageSummaryDTO(pkg: IntegrationPackage): PackageSummaryDTO {
  return {
    id: pkg.id,
    name: pkg.name,
    slug: pkg.slug,
    description: pkg.description,
    category: pkg.category,
    type: pkg.type,
    status: pkg.status,
    currentVersion: pkg.currentVersion,
    iconUrl: pkg.iconUrl,
    publisherName: pkg.publisherName,
    verified: pkg.verified,
    pricing: {
      model: pkg.pricing.model,
      price: pkg.pricing.price,
      currency: pkg.pricing.currency,
    },
    subscriberCount: pkg.subscriberCount,
    tags: pkg.tags,
    publishedAt: pkg.publishedAt,
    updatedAt: pkg.updatedAt,
  };
}

export function toPackageDetailDTO(pkg: IntegrationPackage): PackageDetailDTO {
  return {
    id: pkg.id,
    name: pkg.name,
    slug: pkg.slug,
    description: pkg.description,
    longDescription: pkg.longDescription,
    category: pkg.category,
    type: pkg.type,
    status: pkg.status,
    tags: pkg.tags,
    iconUrl: pkg.iconUrl,
    documentationUrl: pkg.documentationUrl,
    currentVersion: pkg.currentVersion,
    versions: pkg.versions,
    publisherId: pkg.publisherId,
    publisherName: pkg.publisherName,
    verified: pkg.verified,
    scopes: pkg.scopes,
    capabilities: pkg.capabilities,
    endpoints: pkg.endpoints,
    events: pkg.events,
    auth: {
      type: pkg.auth.type,
    },
    rateLimits: pkg.rateLimits,
    pricing: pkg.pricing,
    subscriberCount: pkg.subscriberCount,
    publishedAt: pkg.publishedAt,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

export function toSubscriptionDTO(
  sub: PackageSubscription,
  packageName: string
): SubscriptionDTO {
  return {
    id: sub.id,
    packageId: sub.packageId,
    packageName,
    packageVersion: sub.packageVersion,
    subscriberType: sub.subscriberType,
    status: sub.status,
    subscribedAt: sub.subscribedAt,
    expiresAt: sub.expiresAt,
    config: sub.config,
    usageStats: sub.usageStats,
  };
}
