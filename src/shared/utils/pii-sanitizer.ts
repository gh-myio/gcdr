// =============================================================================
// RFC-0009: PII Sanitizer
// =============================================================================
// Sanitizes personally identifiable information before persisting to audit logs

/**
 * Patterns that indicate sensitive data that should be redacted
 */
const SENSITIVE_PATTERNS = [
  'password',
  'senha',
  'secret',
  'token',
  'apikey',
  'api_key',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'ssn',
  'cpf',
  'cnpj',
  'privatekey',
  'private_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
  'bearer',
];

/**
 * Redaction placeholder for sensitive values
 */
const REDACTED = '***REDACTED***';

/**
 * Check if a key contains a sensitive pattern
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase().replace(/[-_]/g, '');
  return SENSITIVE_PATTERNS.some(pattern =>
    lowerKey.includes(pattern.toLowerCase().replace(/[-_]/g, ''))
  );
}

/**
 * Mask an email address (e.g., "john.doe@example.com" -> "j******e@example.com")
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;

  const maskedLocal = local.length > 2
    ? local[0] + '*'.repeat(Math.min(local.length - 2, 6)) + local[local.length - 1]
    : '**';

  return `${maskedLocal}@${domain}`;
}

/**
 * Mask an IP address (e.g., "192.168.1.100" -> "192.168.***.***")
 */
function maskIpAddress(ip: string): string {
  // IPv4
  const ipv4Parts = ip.split('.');
  if (ipv4Parts.length === 4) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.***.***`;
  }

  // IPv6 - mask last half
  const ipv6Parts = ip.split(':');
  if (ipv6Parts.length >= 4) {
    const half = Math.floor(ipv6Parts.length / 2);
    return ipv6Parts.slice(0, half).join(':') + ':****:****';
  }

  return ip;
}

/**
 * Recursively sanitize an object, removing PII
 */
export function sanitizePII(
  data: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    // Skip null/undefined values
    if (value === null || value === undefined) {
      result[key] = value;
      continue;
    }

    // Redact sensitive keys
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
      continue;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      result[key] = value.map(item => {
        if (item && typeof item === 'object') {
          return sanitizePII(item as Record<string, unknown>);
        }
        return item;
      });
      continue;
    }

    // Handle nested objects
    if (typeof value === 'object') {
      result[key] = sanitizePII(value as Record<string, unknown>);
      continue;
    }

    // Handle string values
    if (typeof value === 'string') {
      const lowerKey = key.toLowerCase();

      // Mask email addresses
      if (lowerKey.includes('email') && value.includes('@')) {
        result[key] = maskEmail(value);
        continue;
      }

      // Mask IP addresses (but only for IP-related fields)
      if ((lowerKey.includes('ip') || lowerKey === 'ipaddress' || lowerKey === 'ip_address') &&
          /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) {
        result[key] = maskIpAddress(value);
        continue;
      }

      // Truncate very long strings
      if (value.length > 1000) {
        result[key] = value.substring(0, 1000) + '...[truncated]';
        continue;
      }
    }

    // Pass through other values
    result[key] = value;
  }

  return result;
}

/**
 * Sanitize a single value (for non-object values)
 */
export function sanitizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (isSensitiveKey(key)) {
    return REDACTED;
  }

  if (typeof value === 'string') {
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('email') && value.includes('@')) {
      return maskEmail(value);
    }

    if (value.length > 1000) {
      return value.substring(0, 1000) + '...[truncated]';
    }
  }

  if (typeof value === 'object') {
    return sanitizePII(value as Record<string, unknown>);
  }

  return value;
}

/**
 * Calculate diff between two objects (for oldValues/newValues)
 * Returns only the fields that changed
 */
export function calculateDiff(
  oldObj: Record<string, unknown> | null | undefined,
  newObj: Record<string, unknown> | null | undefined
): { oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  if (!oldObj && !newObj) {
    return { oldValues, newValues };
  }

  if (!oldObj) {
    return {
      oldValues: {},
      newValues: sanitizePII(newObj),
    };
  }

  if (!newObj) {
    return {
      oldValues: sanitizePII(oldObj),
      newValues: {},
    };
  }

  // Find all keys
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    // Skip if values are the same
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) {
      continue;
    }

    // Record the change
    if (oldVal !== undefined) {
      oldValues[key] = sanitizeValue(key, oldVal);
    }
    if (newVal !== undefined) {
      newValues[key] = sanitizeValue(key, newVal);
    }
  }

  return { oldValues, newValues };
}
