import { BaseEntity } from '../../shared/types';

/**
 * Hierarchy access level for Customer API Keys
 * SELF    → key can only access its own customer data (default)
 * SUBTREE → key can access customer + all descendants (?deep=1)
 * TENANT  → key has no customer restriction (full tenant access)
 */
export type HierarchyAccess = 'SELF' | 'SUBTREE' | 'TENANT';

/**
 * Scopes available for Customer API Keys
 */
export type ApiKeyScope =
  | 'bundles:read'      // Read alarm bundles
  | 'customers:read'    // Read customers (RFC-0016)
  | 'customers:write'   // Write customers (RFC-0016)
  | 'devices:read'      // Read devices
  | 'devices:write'     // Write devices (RFC-0016)
  | 'rules:read'        // Read rules
  | 'rules:write'       // Create/update/delete rules
  | 'assets:read'       // Read assets
  | 'assets:write'      // Write assets (RFC-0016)
  | 'groups:read'       // Read groups
  | 'simulator:read'    // Read simulator bundles (RFC-0010)
  | 'simulator:write'   // Start/stop simulations (RFC-0010)
  | 'simulator:admin'   // Manage all tenant simulations (RFC-0010)
  | 'sync:write'        // Write integration mapping fields (RFC-0016)
  | 'goals:read'        // Read consumption goals (RFC-0046)
  | 'goals:write'       // Write consumption goals (RFC-0046)
  | 'tariffs:read'      // Read customer tariffs (RFC-0054)
  | 'tariffs:write'     // Write customer tariffs (RFC-0054)
  | 'entities:read'     // Read/resolve generic entity registry (RFC-0047)
  | 'entities:write'    // Write generic entity registry — MYIO operator only (RFC-0047)
  | 'entities:admin'    // Create entity_types + mutate is_system rows (RFC-0047)
  | 'templates:read'    // Read/render HTML templates (RFC-0021) — used by EMAIL_SENDER (M2M)
  | 'centrals:read'     // Read centrals/gateways — used by alarms-backend (M2M)
  | 'centrals:write'    // Write centrals/gateways (commands, enroll, mqtt, backup/restore)
  | '*:read';           // Read all resources

/**
 * Customer API Key for M2M authentication
 * Used by systems like Node-RED to access GCDR without user authentication
 */
export interface CustomerApiKey extends BaseEntity {
  /** Customer this key belongs to */
  customerId: string;

  /** SHA-256 hash of the API key (validation/lookup path) */
  keyHash: string;

  /** First 8 characters of the key for identification (gcdr_cust_XXXXXXXX) */
  keyPrefix: string;

  /**
   * Plaintext key, recoverable via the audit-logged reveal endpoint —
   * operators copy it into ThingsBoard SERVER_SCOPE attributes after
   * creation. NULL for keys minted before migration 0036.
   */
  keyPlain?: string | null;

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

  /** Hierarchy access control */
  hierarchyAccess: HierarchyAccess;

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
  hierarchyAccess: HierarchyAccess;
}

/**
 * Check if a scope matches the required scope
 */
export function hasScope(grantedScopes: ApiKeyScope[], requiredScope: ApiKeyScope): boolean {
  // Check for wildcard read access
  if (grantedScopes.includes('*:read') && requiredScope.endsWith(':read')) {
    return true;
  }

  // Check for simulator:admin (grants all simulator:* scopes)
  if (grantedScopes.includes('simulator:admin') && requiredScope.startsWith('simulator:')) {
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
