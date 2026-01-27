// =============================================================================
// RFC-0009: Audit Configuration
// =============================================================================

import {
  EventType,
  EventCategory,
  ActionType,
  AuditLevel,
  AuditLevelValue,
} from '../types/audit.types';

// =============================================================================
// Payload Limits
// =============================================================================

export const AUDIT_PAYLOAD_LIMITS = {
  description: {
    maxLength: 500,
  },
  metadata: {
    maxKeys: 20,
    maxKeyLength: 50,
    maxValueLength: 1000,
    maxTotalSize: 10000, // 10KB
  },
  httpPath: {
    maxLength: 500,
  },
  errorMessage: {
    maxLength: 2000,
  },
  userAgent: {
    maxLength: 500,
  },
  externalLink: {
    maxLength: 255,
  },
};

// =============================================================================
// Enforce Payload Limits
// =============================================================================

export function truncateString(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  return value.length > maxLength ? value.substring(0, maxLength) : value;
}

export function truncateMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!metadata) return {};

  const entries = Object.entries(metadata).slice(0, AUDIT_PAYLOAD_LIMITS.metadata.maxKeys);
  const result: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    const truncatedKey = key.slice(0, AUDIT_PAYLOAD_LIMITS.metadata.maxKeyLength);
    let truncatedValue: unknown;

    if (typeof value === 'string') {
      truncatedValue = value.slice(0, AUDIT_PAYLOAD_LIMITS.metadata.maxValueLength);
    } else if (value !== null && typeof value === 'object') {
      const stringified = JSON.stringify(value);
      if (stringified.length > AUDIT_PAYLOAD_LIMITS.metadata.maxValueLength) {
        truncatedValue = stringified.slice(0, AUDIT_PAYLOAD_LIMITS.metadata.maxValueLength) + '...';
      } else {
        truncatedValue = value;
      }
    } else {
      truncatedValue = value;
    }

    result[truncatedKey] = truncatedValue;
  }

  return result;
}

// =============================================================================
// Event Type Inference
// =============================================================================

/**
 * Infer event category from event type
 */
export function inferEventCategory(eventType: EventType): EventCategory {
  if (eventType.includes('_VIEWED') || eventType.includes('_LIST_')) {
    return EventCategory.QUERY;
  }
  if (eventType.startsWith('AUTH_')) {
    return EventCategory.AUTH;
  }
  if (eventType.includes('_TRIGGERED') || eventType.includes('_CHANGED')) {
    return EventCategory.SYSTEM_EVENT;
  }
  if (eventType.includes('PACKAGE_') || eventType.includes('INTEGRATION_')) {
    return EventCategory.INTEGRATION;
  }
  return EventCategory.ENTITY_CHANGE;
}

/**
 * Infer action type from event type
 */
export function inferActionType(eventType: EventType): ActionType {
  if (eventType.includes('_CREATED') || eventType.includes('_REGISTERED')) {
    return ActionType.CREATE;
  }
  if (eventType.includes('_UPDATED') || eventType.includes('_CHANGED') ||
      eventType.includes('_ENABLED') || eventType.includes('_DISABLED') ||
      eventType.includes('_MOVED') || eventType.includes('_ASSIGNED') ||
      eventType.includes('_APPROVED') || eventType.includes('_REJECTED') ||
      eventType.includes('_SUSPENDED') || eventType.includes('_ACTIVATED')) {
    return ActionType.UPDATE;
  }
  if (eventType.includes('_DELETED') || eventType.includes('_REVOKED') ||
      eventType.includes('_REMOVED')) {
    return ActionType.DELETE;
  }
  if (eventType.includes('_VIEWED') || eventType.includes('_DOWNLOADED') ||
      eventType.includes('_GENERATED')) {
    return ActionType.READ;
  }
  return ActionType.EXECUTE;
}

/**
 * Infer audit level from event type
 */
export function inferAuditLevel(eventType: EventType): AuditLevel {
  // Critical - always log
  if (eventType.includes('_DELETED') || eventType.includes('_REVOKED') ||
      eventType === EventType.AUTH_LOGIN_FAILED ||
      eventType.includes('AUTH_PASSWORD') ||
      eventType.includes('API_KEY_')) {
    return AuditLevel.MINIMAL;
  }

  // Verbose - queries/reads
  if (eventType.includes('_VIEWED') || eventType.includes('_LIST_')) {
    return AuditLevel.VERBOSE;
  }

  // Debug
  if (eventType === EventType.AUTH_TOKEN_REFRESHED) {
    return AuditLevel.DEBUG;
  }

  return AuditLevel.STANDARD;
}

/**
 * Infer entity type from event type
 */
export function inferEntityType(eventType: EventType): string {
  const match = eventType.match(/^([A-Z]+)_/);
  return match ? match[1].toLowerCase() : 'unknown';
}

// =============================================================================
// Audit Level Configuration
// =============================================================================

/**
 * Get current audit level from environment
 */
export function getCurrentAuditLevel(): AuditLevel {
  const level = process.env.AUDIT_LEVEL?.toUpperCase();
  if (level && level in AuditLevel) {
    return level as AuditLevel;
  }
  return AuditLevel.STANDARD;
}

/**
 * Check if an event should be logged based on current audit level
 */
export function shouldLogEvent(eventLevel: AuditLevel): boolean {
  const currentLevel = getCurrentAuditLevel();
  return AuditLevelValue[currentLevel] >= AuditLevelValue[eventLevel];
}

// =============================================================================
// Query Limits
// =============================================================================

export const AUDIT_QUERY_LIMITS = {
  maxDateRangeDays: 30,
  defaultLimit: 50,
  maxLimit: 100,
  maxExportRecords: 10000,
};

// =============================================================================
// Rate Limiting
// =============================================================================

export const AUDIT_RATE_LIMITS = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,     // 10 requests per minute for audit log queries
};
