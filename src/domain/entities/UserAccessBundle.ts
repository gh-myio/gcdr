import { PolicyConditions } from './Policy';

// =============================================================================
// User Access Profile Bundle (RFC-0013)
// =============================================================================

export type FeatureAccessType = 'guaranteed' | 'granted' | 'conditional' | 'denied' | 'not_granted';

export interface BundleProfile {
  userId: string;
  userEmail: string;
  customerId: string | null;
  customerName: string | null;
  maintenanceGroup: {
    id: string;
    key: string;
    name: string;
  } | null;
}

export interface LocationActions {
  actions: string[];
  conditions?: PolicyConditions;
}

export interface DomainPolicies {
  [domain: string]: {
    [equipment: string]: {
      [location: string]: LocationActions;
    };
  };
}

export interface FeaturePolicy {
  access: FeatureAccessType;
  conditions?: PolicyConditions;
  expiresAt?: string;
}

export interface FeaturePolicies {
  [featureKey: string]: FeaturePolicy;
}

export interface BundlePermissions {
  allowed: string[];
  denied: string[];
}

export interface BundleMetadata {
  generatedAt: string;
  expiresAt: string;
  ttlSeconds: number;
  scope: string;
  sourceRoles: string[];
  sourcePolicies: string[];
  checksum: string;
}

export interface UserAccessBundle {
  version: '1.0';
  profile: BundleProfile;
  domainPolicies: DomainPolicies;
  featurePolicies: FeaturePolicies;
  permissions: BundlePermissions;
  metadata: BundleMetadata;
}

// =============================================================================
// Bundle Cache Entity
// =============================================================================

export interface UserBundleCache {
  id: string;
  tenantId: string;
  userId: string;
  scope: string;
  bundle: UserAccessBundle;
  checksum: string;
  generatedAt: string;
  expiresAt: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Bundle Generation Options
// =============================================================================

export interface BundleGenerationOptions {
  scope?: string;
  includeFeatures?: boolean;
  includeDomains?: boolean;
  includeFlat?: boolean;
  ttlSeconds?: number;
  useCache?: boolean;
}

export const DEFAULT_BUNDLE_OPTIONS: Required<BundleGenerationOptions> = {
  scope: '*',
  includeFeatures: true,
  includeDomains: true,
  includeFlat: true,
  ttlSeconds: 3600, // 1 hour
  useCache: true,
};

// =============================================================================
// Bundle Utility Functions
// =============================================================================

export function isBundleExpired(bundle: UserAccessBundle): boolean {
  return new Date(bundle.metadata.expiresAt) < new Date();
}

export function canAccessDomain(
  bundle: UserAccessBundle,
  domain: string,
  equipment: string,
  location: string,
  action: string
): boolean {
  return bundle.domainPolicies[domain]
    ?.[equipment]
    ?.[location]
    ?.actions.includes(action) ?? false;
}

export function hasFeatureAccess(
  bundle: UserAccessBundle,
  featureKey: string
): boolean {
  const policy = bundle.featurePolicies[featureKey];
  return policy?.access === 'guaranteed' || policy?.access === 'granted';
}

export function getFeatureAccessType(
  bundle: UserAccessBundle,
  featureKey: string
): FeatureAccessType {
  return bundle.featurePolicies[featureKey]?.access ?? 'not_granted';
}
