import { BaseEntity } from '../../shared/types';

export type IntegrationType = 'INBOUND' | 'OUTBOUND' | 'BIDIRECTIONAL';
export type PackageStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'DEPRECATED' | 'SUSPENDED';
export type PricingModel = 'FREE' | 'PER_REQUEST' | 'MONTHLY' | 'ANNUAL' | 'CUSTOM';

export interface AuthConfig {
  type: 'none' | 'api_key' | 'oauth2' | 'basic' | 'custom';
  config?: Record<string, unknown>;
}

export interface RateLimitConfig {
  requestsPerMinute?: number;
  requestsPerDay?: number;
  monthlyQuota?: number;
}

export interface PackageCapability {
  id: string;
  name: string;
  description: string;
  requiredScopes: string[];
}

export interface PackageEndpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  requiredScopes: string[];
  rateLimit?: RateLimitConfig;
}

export interface PackageEvent {
  eventType: string;
  description: string;
  payloadSchema?: Record<string, unknown>;
}

export interface PackagePricing {
  model: PricingModel;
  price?: number;
  currency?: string;
  includedRequests?: number;
  overagePrice?: number;
}

export interface PackageVersion {
  version: string;
  releaseNotes: string;
  publishedAt: string;
  deprecatedAt?: string;
  breaking: boolean;
}

export interface IntegrationPackage extends BaseEntity {
  // Basic Info
  name: string;
  slug: string;
  description: string;
  longDescription?: string;
  category: string;
  tags: string[];
  iconUrl?: string;
  documentationUrl?: string;

  // Type and Status
  type: IntegrationType;
  status: PackageStatus;
  currentVersion: string;
  versions: PackageVersion[];

  // Publisher
  publisherId: string;
  publisherName: string;
  verified: boolean;

  // Technical Config
  scopes: string[];
  capabilities: PackageCapability[];
  endpoints: PackageEndpoint[];
  events: PackageEvent[];
  auth: AuthConfig;
  rateLimits: RateLimitConfig;

  // Subscription
  pricing: PackagePricing;
  subscriberCount: number;

  // Review
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;

  // Timestamps
  publishedAt?: string;
  deprecatedAt?: string;
}

export interface PackageSubscription {
  id: string;
  packageId: string;
  packageVersion: string;
  subscriberId: string;
  subscriberType: 'partner' | 'customer';
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  subscribedAt: string;
  expiresAt?: string;
  config?: Record<string, unknown>;
  usageStats: {
    requestCount: number;
    lastRequestAt?: string;
    monthlyUsage: number;
  };
}

export const PACKAGE_CATEGORIES = [
  'analytics',
  'automation',
  'communication',
  'crm',
  'data-sync',
  'erp',
  'iot',
  'monitoring',
  'notification',
  'security',
  'workflow',
  'other',
] as const;

export type PackageCategory = (typeof PACKAGE_CATEGORIES)[number];
