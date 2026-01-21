import { BaseEntity } from '../../shared/types';

/**
 * Scopes available for Customer API Keys
 */
export type ApiKeyScope =
  | 'bundles:read'      // Read alarm bundles
  | 'devices:read'      // Read devices
  | 'rules:read'        // Read rules
  | 'assets:read'       // Read assets
  | 'groups:read'       // Read groups
  | '*:read';           // Read all resources

/**
 * Customer API Key for M2M authentication
 * Used by systems like Node-RED to access GCDR without user authentication
 */
export interface CustomerApiKey extends BaseEntity {
  /** Customer this key belongs to */
  customerId: string;

  /** SHA-256 hash of the API key (never store plain text) */
  keyHash: string;

  /** First 8 characters of the key for identification (gcdr_cust_XXXXXXXX) */
  keyPrefix: string;

  /** Human-readable name for this key */
  name: string;

  /** Description of what this key is used for */
  description?: string;

  /** Scopes/permissions granted to this key */
  scopes: ApiKeyScope[];

  /** Expiration date (ISO8601), null means never expires */
  expiresAt?: string | null;

  /** Last time this key was used */
  lastUsedAt?: string;

  /** Last IP address that used this key */
  lastUsedIp?: string;

  /** Whether the key is active */
  isActive: boolean;

  /** Usage statistics */
  usageCount: number;
}

/**
 * Result returned when creating a new API key
 * The plaintext key is only returned once at creation time
 */
export interface CreateApiKeyResult {
  /** The API key entity (without the plain key) */
  apiKey: CustomerApiKey;

  /** The plaintext API key - ONLY RETURNED ONCE AT CREATION */
  plaintextKey: string;
}

/**
 * Validated API key context for use in handlers
 */
export interface ApiKeyContext {
  keyId: string;
  tenantId: string;
  customerId: string;
  scopes: ApiKeyScope[];
  name: string;
}

/**
 * Check if a scope matches the required scope
 */
export function hasScope(grantedScopes: ApiKeyScope[], requiredScope: ApiKeyScope): boolean {
  // Check for wildcard read access
  if (grantedScopes.includes('*:read') && requiredScope.endsWith(':read')) {
    return true;
  }
  // Check for exact match
  return grantedScopes.includes(requiredScope);
}

/**
 * Generate the key prefix format
 */
export function formatKeyPrefix(prefix: string): string {
  return `gcdr_cust_${prefix}`;
}
