import * as crypto from 'crypto';
import {
  UserAccessBundle,
  BundleProfile,
  DomainPolicies,
  FeaturePolicies,
  BundlePermissions,
  BundleMetadata,
  BundleGenerationOptions,
  DEFAULT_BUNDLE_OPTIONS,
  FeatureAccessType,
} from '../domain/entities/UserAccessBundle';
import { parseDomainPermissionKey } from '../domain/entities/DomainPermission';
import { PolicyConditions } from '../domain/entities/Policy';
import { userRepository, UserRepository } from '../repositories/UserRepository';
import { customerRepository, CustomerRepository } from '../repositories/CustomerRepository';
import { maintenanceGroupRepository, MaintenanceGroupRepository } from '../repositories/MaintenanceGroupRepository';
import { bundleCacheRepository, BundleCacheRepository } from '../repositories/BundleCacheRepository';
import { authorizationService, AuthorizationService } from './AuthorizationService';
import { eventService, EventType } from '../shared/events';
import { AppError } from '../shared/errors/AppError';

// Feature configuration (could be moved to database/config later)
const FEATURE_DEFINITIONS: Record<string, { requiredPermissions: string[]; defaultAccess: FeatureAccessType }> = {
  'dashboard_operational_indicators': {
    requiredPermissions: ['dashboards.operational.read'],
    defaultAccess: 'granted',
  },
  'dashboard_head_office': {
    requiredPermissions: ['dashboards.head_office.read'],
    defaultAccess: 'granted',
  },
  'alarm_management': {
    requiredPermissions: ['alarms.rules.read', 'alarms.rules.update'],
    defaultAccess: 'not_granted',
  },
  'user_administration': {
    requiredPermissions: ['identity.users.manage'],
    defaultAccess: 'not_granted',
  },
  'reports_export': {
    requiredPermissions: ['reports.export.execute'],
    defaultAccess: 'not_granted',
  },
  'device_commands': {
    requiredPermissions: ['devices.commands.execute'],
    defaultAccess: 'not_granted',
  },
};

export class BundleGeneratorService {
  constructor(
    private userRepo: UserRepository = userRepository,
    private customerRepo: CustomerRepository = customerRepository,
    private groupRepo: MaintenanceGroupRepository = maintenanceGroupRepository,
    private cacheRepo: BundleCacheRepository = bundleCacheRepository,
    private authService: AuthorizationService = authorizationService
  ) {}

  // =========================================================================
  // Main Bundle Generation
  // =========================================================================

  async generateBundle(
    tenantId: string,
    userId: string,
    options: BundleGenerationOptions = {}
  ): Promise<UserAccessBundle> {
    const opts = { ...DEFAULT_BUNDLE_OPTIONS, ...options };

    // Try cache first
    if (opts.useCache) {
      const cached = await this.cacheRepo.getBundle(tenantId, userId, opts.scope);
      if (cached) {
        return cached;
      }
    }

    // Generate fresh bundle
    const bundle = await this.buildBundle(tenantId, userId, opts);

    // Cache the bundle
    if (opts.useCache) {
      const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000);
      await this.cacheRepo.upsert(
        tenantId,
        userId,
        opts.scope,
        bundle,
        bundle.metadata.checksum,
        expiresAt
      );
    }

    return bundle;
  }

  async refreshBundle(
    tenantId: string,
    userId: string,
    scope: string = '*',
    reason?: string
  ): Promise<UserAccessBundle> {
    // Invalidate existing cache
    await this.cacheRepo.invalidateByScope(tenantId, userId, scope, reason);

    // Generate new bundle
    return this.generateBundle(tenantId, userId, { scope, useCache: true });
  }

  async invalidateBundle(
    tenantId: string,
    userId: string,
    reason?: string,
    scope?: string
  ): Promise<void> {
    if (scope) {
      await this.cacheRepo.invalidateByScope(tenantId, userId, scope, reason);
    } else {
      await this.cacheRepo.invalidate(tenantId, userId, reason);
    }

    await eventService.publish(EventType.BUNDLE_INVALIDATED, {
      tenantId,
      entityType: 'user_bundle',
      entityId: userId,
      action: 'INVALIDATE',
      newValues: { reason, scope },
    });
  }

  // =========================================================================
  // Permission Checking with Bundle
  // =========================================================================

  async checkDomainPermission(
    tenantId: string,
    userId: string,
    domain: string,
    equipment: string,
    location: string,
    action: string,
    scope?: string
  ): Promise<boolean> {
    const bundle = await this.generateBundle(tenantId, userId, { scope });

    return bundle.domainPolicies[domain]
      ?.[equipment]
      ?.[location]
      ?.actions.includes(action) ?? false;
  }

  async checkFeatureAccess(
    tenantId: string,
    userId: string,
    featureKey: string,
    scope?: string
  ): Promise<{ allowed: boolean; access: FeatureAccessType }> {
    const bundle = await this.generateBundle(tenantId, userId, { scope });

    const policy = bundle.featurePolicies[featureKey];
    const access = policy?.access ?? 'not_granted';
    const allowed = access === 'guaranteed' || access === 'granted';

    return { allowed, access };
  }

  // =========================================================================
  // Private Build Methods
  // =========================================================================

  private async buildBundle(
    tenantId: string,
    userId: string,
    options: Required<BundleGenerationOptions>
  ): Promise<UserAccessBundle> {
    // 1. Get user profile
    const user = await this.userRepo.getById(tenantId, userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    // 2. Get customer
    const customer = user.customerId
      ? await this.customerRepo.getById(tenantId, user.customerId)
      : null;

    // 3. Get maintenance group
    const maintenanceGroup = await this.groupRepo.getUserPrimaryGroup(tenantId, userId);

    // 4. Get effective permissions
    const effectivePermissions = await this.authService.getEffectivePermissions(
      tenantId,
      userId,
      options.scope
    );

    // 5. Build profile
    const profile: BundleProfile = {
      userId: user.id,
      userEmail: user.email,
      customerId: customer?.id || null,
      customerName: customer?.displayName || null,
      maintenanceGroup: maintenanceGroup ? {
        id: maintenanceGroup.id,
        key: maintenanceGroup.key,
        name: maintenanceGroup.name,
      } : null,
    };

    // 6. Build domain policies
    const domainPolicies = options.includeDomains
      ? this.buildDomainPolicies(effectivePermissions)
      : {};

    // 7. Build feature policies
    const featurePolicies = options.includeFeatures
      ? this.buildFeaturePolicies(effectivePermissions)
      : {};

    // 8. Build flat permissions
    const permissions = options.includeFlat
      ? this.buildFlatPermissions(effectivePermissions)
      : { allowed: [], denied: [] };

    // 9. Build metadata
    const now = new Date();
    const expiresAt = new Date(now.getTime() + options.ttlSeconds * 1000);

    // Get source roles and policies
    const sourceRoles = [...new Set(effectivePermissions.map(p => p.grantedByRole).filter(Boolean))] as string[];
    const sourcePolicies = [...new Set(effectivePermissions.map(p => p.grantedByPolicy).filter(Boolean))] as string[];

    // Build bundle without checksum first
    const bundleData = {
      version: '1.0' as const,
      profile,
      domainPolicies,
      featurePolicies,
      permissions,
      metadata: {
        generatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ttlSeconds: options.ttlSeconds,
        scope: options.scope,
        sourceRoles,
        sourcePolicies,
        checksum: '',
      },
    };

    // Calculate checksum
    bundleData.metadata.checksum = this.calculateChecksum(bundleData);

    return bundleData;
  }

  private buildDomainPolicies(
    permissions: Array<{ permission: string; allowed: boolean; conditions?: PolicyConditions }>
  ): DomainPolicies {
    const domainPolicies: DomainPolicies = {};

    for (const perm of permissions) {
      if (!perm.allowed) continue;

      // Try to parse as domain permission (domain.equipment.location:action)
      const parsed = parseDomainPermissionKey(perm.permission);
      if (!parsed) {
        // Try alternative format: domain.equipment.location.action (4 parts with dots)
        const parts = perm.permission.split('.');
        if (parts.length === 4) {
          const [domain, equipment, location, action] = parts;
          this.addToDomainPolicies(domainPolicies, domain, equipment, location, action, perm.conditions);
        }
        continue;
      }

      const { domain, equipment, location, action } = parsed;
      this.addToDomainPolicies(domainPolicies, domain, equipment, location, action, perm.conditions);
    }

    return domainPolicies;
  }

  private addToDomainPolicies(
    policies: DomainPolicies,
    domain: string,
    equipment: string,
    location: string,
    action: string,
    conditions?: PolicyConditions
  ): void {
    if (!policies[domain]) {
      policies[domain] = {};
    }
    if (!policies[domain][equipment]) {
      policies[domain][equipment] = {};
    }
    if (!policies[domain][equipment][location]) {
      policies[domain][equipment][location] = {
        actions: [],
        conditions,
      };
    }
    if (!policies[domain][equipment][location].actions.includes(action)) {
      policies[domain][equipment][location].actions.push(action);
    }
  }

  private buildFeaturePolicies(
    permissions: Array<{ permission: string; allowed: boolean; explicitlyDenied?: boolean }>
  ): FeaturePolicies {
    const featurePolicies: FeaturePolicies = {};
    const allowedPermissions = new Set(
      permissions.filter(p => p.allowed).map(p => p.permission)
    );
    const deniedPermissions = new Set(
      permissions.filter(p => p.explicitlyDenied).map(p => p.permission)
    );

    for (const [featureKey, definition] of Object.entries(FEATURE_DEFINITIONS)) {
      // Check if any required permission is denied
      const isDenied = definition.requiredPermissions.some(p => deniedPermissions.has(p));
      if (isDenied) {
        featurePolicies[featureKey] = { access: 'denied' };
        continue;
      }

      // Check if all required permissions are granted
      const hasAll = definition.requiredPermissions.every(p => allowedPermissions.has(p));
      if (hasAll) {
        featurePolicies[featureKey] = { access: 'granted' };
        continue;
      }

      // Use default access
      featurePolicies[featureKey] = { access: definition.defaultAccess };
    }

    // Add guaranteed features
    featurePolicies['dashboard_operational_indicators'] = { access: 'guaranteed' };
    featurePolicies['dashboard_head_office'] = { access: 'guaranteed' };

    return featurePolicies;
  }

  private buildFlatPermissions(
    permissions: Array<{ permission: string; allowed: boolean; explicitlyDenied?: boolean }>
  ): BundlePermissions {
    return {
      allowed: permissions.filter(p => p.allowed).map(p => p.permission),
      denied: permissions.filter(p => p.explicitlyDenied).map(p => p.permission),
    };
  }

  private calculateChecksum(bundle: Omit<UserAccessBundle, 'metadata'> & { metadata: Omit<BundleMetadata, 'checksum'> }): string {
    const content = JSON.stringify({
      profile: bundle.profile,
      domainPolicies: bundle.domainPolicies,
      featurePolicies: bundle.featurePolicies,
      permissions: bundle.permissions,
    });
    return `sha256:${crypto.createHash('sha256').update(content).digest('hex').substring(0, 16)}`;
  }
}

// Export singleton instance
export const bundleGeneratorService = new BundleGeneratorService();
