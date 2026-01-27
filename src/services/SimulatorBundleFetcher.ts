// =============================================================================
// Simulator Bundle Fetcher (RFC-0010)
// =============================================================================

import { AlarmBundleService } from './AlarmBundleService';
import { SimulatorRepository } from '../repositories/SimulatorRepository';
import { SimpleAlarmRulesBundle, SimpleBundleMeta } from '../domain/entities/AlarmBundle';
import { SimulatorSession, BundleFetchedEventData } from '../domain/entities/Simulator';

/**
 * Bundle fetch result
 */
export interface BundleFetchResult {
  bundle: SimpleAlarmRulesBundle;
  meta: SimpleBundleMeta;
  isUpdated: boolean;
  previousVersion?: string;
  previousSignature?: string;
}

/**
 * Service to fetch and manage alarm bundles for simulator sessions
 */
export class SimulatorBundleFetcher {
  private bundleService: AlarmBundleService;
  private repository: SimulatorRepository;

  // In-memory cache of bundles by session ID
  private bundleCache: Map<string, SimpleAlarmRulesBundle> = new Map();

  constructor(bundleService: AlarmBundleService, repository: SimulatorRepository) {
    this.bundleService = bundleService;
    this.repository = repository;
  }

  /**
   * Fetch bundle for a simulator session
   * Returns the bundle and whether it was updated since last fetch
   */
  async fetchBundle(session: SimulatorSession): Promise<BundleFetchResult> {
    try {
      // Generate the simplified bundle
      const bundle = await this.bundleService.generateSimplifiedBundle({
        tenantId: session.tenantId,
        customerId: session.customerId,
        includeDisabled: false,
      });

      // Check if bundle has changed
      const isUpdated = this.isBundleUpdated(session, bundle.meta);

      // Store previous values before updating
      const previousVersion = session.bundleVersion;
      const previousSignature = session.bundleSignature;

      // Update session with new bundle info
      if (isUpdated) {
        await this.repository.updateBundleInfo(
          session.id,
          bundle.meta.version,
          bundle.meta.signature
        );

        // Log the bundle fetch event
        await this.repository.createEvent(session.id, 'BUNDLE_FETCHED', {
          version: bundle.meta.version,
          signature: bundle.meta.signature,
          rulesCount: bundle.meta.rulesCount,
          devicesCount: bundle.meta.devicesCount,
          previousVersion,
          previousSignature,
        } satisfies BundleFetchedEventData & { previousVersion?: string; previousSignature?: string });

        console.log('[Simulator] Bundle fetched', {
          sessionId: session.id,
          tenantId: session.tenantId,
          version: bundle.meta.version,
          rulesCount: bundle.meta.rulesCount,
          devicesCount: bundle.meta.devicesCount,
          isUpdated: true,
        });
      } else {
        // Log unchanged bundle
        await this.repository.createEvent(session.id, 'BUNDLE_UNCHANGED', {
          version: bundle.meta.version,
          signature: bundle.meta.signature,
        });
      }

      // Cache the bundle
      this.bundleCache.set(session.id, bundle);

      return {
        bundle,
        meta: bundle.meta,
        isUpdated,
        previousVersion,
        previousSignature,
      };
    } catch (error) {
      console.error('[Simulator] Failed to fetch bundle', {
        sessionId: session.id,
        tenantId: session.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });

      await this.repository.createEvent(session.id, 'SESSION_ERROR', {
        error: 'BUNDLE_FETCH_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Get cached bundle for a session
   */
  getCachedBundle(sessionId: string): SimpleAlarmRulesBundle | undefined {
    return this.bundleCache.get(sessionId);
  }

  /**
   * Check if bundle has been updated since last fetch
   */
  private isBundleUpdated(session: SimulatorSession, newMeta: SimpleBundleMeta): boolean {
    // First fetch - always considered updated
    if (!session.bundleVersion || !session.bundleSignature) {
      return true;
    }

    // Compare version and signature
    return (
      session.bundleVersion !== newMeta.version ||
      session.bundleSignature !== newMeta.signature
    );
  }

  /**
   * Clear cached bundle for a session
   */
  clearCache(sessionId: string): void {
    this.bundleCache.delete(sessionId);
  }

  /**
   * Clear all cached bundles
   */
  clearAllCaches(): void {
    this.bundleCache.clear();
  }

  /**
   * Get rules count from cached bundle
   */
  getRulesCount(sessionId: string): number {
    const bundle = this.bundleCache.get(sessionId);
    return bundle ? Object.keys(bundle.rules).length : 0;
  }

  /**
   * Get devices count from cached bundle
   */
  getDevicesCount(sessionId: string): number {
    const bundle = this.bundleCache.get(sessionId);
    return bundle ? Object.keys(bundle.deviceIndex).length : 0;
  }

  /**
   * Get bundle stats
   */
  getBundleStats(sessionId: string): {
    rulesCount: number;
    devicesCount: number;
    version?: string;
    signature?: string;
  } | null {
    const bundle = this.bundleCache.get(sessionId);
    if (!bundle) {
      return null;
    }

    return {
      rulesCount: Object.keys(bundle.rules).length,
      devicesCount: Object.keys(bundle.deviceIndex).length,
      version: bundle.meta.version,
      signature: bundle.meta.signature,
    };
  }
}

// Export singleton instance
import { alarmBundleService } from './AlarmBundleService';
import { simulatorRepository } from '../repositories/SimulatorRepository';
export const simulatorBundleFetcher = new SimulatorBundleFetcher(alarmBundleService, simulatorRepository);
