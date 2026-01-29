export const EventType = {
  // Customer Operations
  CUSTOMER_CREATED: { code: 'CUSTOMER_CREATED', description: 'Customer created' },
  CUSTOMER_UPDATED: { code: 'CUSTOMER_UPDATED', description: 'Customer updated' },
  CUSTOMER_DELETED: { code: 'CUSTOMER_DELETED', description: 'Customer deleted' },
  CUSTOMER_RETRIEVED: { code: 'CUSTOMER_RETRIEVED', description: 'Customer retrieved' },
  CUSTOMER_LIST: { code: 'CUSTOMER_LIST', description: 'Customer list retrieved' },
  CUSTOMER_MOVED: { code: 'CUSTOMER_MOVED', description: 'Customer moved to new parent' },
  CUSTOMER_CHILDREN_RETRIEVED: { code: 'CUSTOMER_CHILDREN_RETRIEVED', description: 'Customer children retrieved' },
  CUSTOMER_DESCENDANTS_RETRIEVED: { code: 'CUSTOMER_DESCENDANTS_RETRIEVED', description: 'Customer descendants retrieved' },
  CUSTOMER_TREE_RETRIEVED: { code: 'CUSTOMER_TREE_RETRIEVED', description: 'Customer tree retrieved' },

  // Partner Operations
  PARTNER_REGISTERED: { code: 'PARTNER_REGISTERED', description: 'Partner registration submitted' },
  PARTNER_APPROVED: { code: 'PARTNER_APPROVED', description: 'Partner approved' },
  PARTNER_REJECTED: { code: 'PARTNER_REJECTED', description: 'Partner rejected' },
  PARTNER_SUSPENDED: { code: 'PARTNER_SUSPENDED', description: 'Partner suspended' },
  PARTNER_ACTIVATED: { code: 'PARTNER_ACTIVATED', description: 'Partner activated' },
  PARTNER_UPDATED: { code: 'PARTNER_UPDATED', description: 'Partner info updated' },
  PARTNER_API_KEY_CREATED: { code: 'PARTNER_API_KEY_CREATED', description: 'Partner API key created' },
  PARTNER_API_KEY_REVOKED: { code: 'PARTNER_API_KEY_REVOKED', description: 'Partner API key revoked' },

  // Asset Operations
  ASSET_CREATED: { code: 'ASSET_CREATED', description: 'Asset created' },
  ASSET_UPDATED: { code: 'ASSET_UPDATED', description: 'Asset updated' },
  ASSET_DELETED: { code: 'ASSET_DELETED', description: 'Asset deleted' },
  ASSET_MOVED: { code: 'ASSET_MOVED', description: 'Asset moved to new parent/customer' },

  // Device Operations
  DEVICE_CREATED: { code: 'DEVICE_CREATED', description: 'Device created' },
  DEVICE_UPDATED: { code: 'DEVICE_UPDATED', description: 'Device updated' },
  DEVICE_DELETED: { code: 'DEVICE_DELETED', description: 'Device deleted' },

  // Rule Operations
  RULE_CREATED: { code: 'RULE_CREATED', description: 'Rule created' },
  RULE_UPDATED: { code: 'RULE_UPDATED', description: 'Rule updated' },
  RULE_DELETED: { code: 'RULE_DELETED', description: 'Rule deleted' },
  RULE_ACTIVATED: { code: 'RULE_ACTIVATED', description: 'Rule activated' },
  RULE_DEACTIVATED: { code: 'RULE_DEACTIVATED', description: 'Rule deactivated' },
  RULE_TRIGGERED: { code: 'RULE_TRIGGERED', description: 'Rule condition triggered' },

  // Auth Operations
  USER_LOGIN: { code: 'USER_LOGIN', description: 'User logged in' },
  USER_LOGOUT: { code: 'USER_LOGOUT', description: 'User logged out' },
  PARTNER_AUTH: { code: 'PARTNER_AUTH', description: 'Partner authenticated' },

  // Authorization Operations (RFC-0002)
  PERMISSION_EVALUATED: { code: 'PERMISSION_EVALUATED', description: 'Permission check performed' },
  ROLE_CREATED: { code: 'ROLE_CREATED', description: 'Role created' },
  ROLE_UPDATED: { code: 'ROLE_UPDATED', description: 'Role updated' },
  ROLE_DELETED: { code: 'ROLE_DELETED', description: 'Role deleted' },
  POLICY_CREATED: { code: 'POLICY_CREATED', description: 'Policy created' },
  POLICY_UPDATED: { code: 'POLICY_UPDATED', description: 'Policy updated' },
  POLICY_DELETED: { code: 'POLICY_DELETED', description: 'Policy deleted' },
  ROLE_ASSIGNED: { code: 'ROLE_ASSIGNED', description: 'Role assigned to user' },
  ROLE_REVOKED: { code: 'ROLE_REVOKED', description: 'Role revoked from user' },

  // Central Operations
  CENTRAL_CREATED: { code: 'CENTRAL_CREATED', description: 'Central created' },
  CENTRAL_UPDATED: { code: 'CENTRAL_UPDATED', description: 'Central updated' },
  CENTRAL_DELETED: { code: 'CENTRAL_DELETED', description: 'Central deleted' },
  CENTRAL_CONNECTED: { code: 'CENTRAL_CONNECTED', description: 'Central connected' },
  CENTRAL_DISCONNECTED: { code: 'CENTRAL_DISCONNECTED', description: 'Central disconnected' },
  CENTRAL_HEARTBEAT: { code: 'CENTRAL_HEARTBEAT', description: 'Central heartbeat received' },

  // Theme Operations
  THEME_CREATED: { code: 'THEME_CREATED', description: 'Theme created' },
  THEME_UPDATED: { code: 'THEME_UPDATED', description: 'Theme updated' },
  THEME_DELETED: { code: 'THEME_DELETED', description: 'Theme deleted' },
  THEME_SET_DEFAULT: { code: 'THEME_SET_DEFAULT', description: 'Theme set as default' },

  // User Operations
  USER_CREATED: { code: 'USER_CREATED', description: 'User created' },
  USER_UPDATED: { code: 'USER_UPDATED', description: 'User updated' },
  USER_DELETED: { code: 'USER_DELETED', description: 'User deleted' },
  USER_INVITED: { code: 'USER_INVITED', description: 'User invited' },
  USER_INVITATION_ACCEPTED: { code: 'USER_INVITATION_ACCEPTED', description: 'User invitation accepted' },
  USER_STATUS_CHANGED: { code: 'USER_STATUS_CHANGED', description: 'User status changed' },
  USER_EMAIL_VERIFIED: { code: 'USER_EMAIL_VERIFIED', description: 'User email verified' },
  USER_PASSWORD_CHANGED: { code: 'USER_PASSWORD_CHANGED', description: 'User password changed' },
  USER_PASSWORD_RESET_REQUESTED: { code: 'USER_PASSWORD_RESET_REQUESTED', description: 'Password reset requested' },
  USER_MFA_ENABLED: { code: 'USER_MFA_ENABLED', description: 'User MFA enabled' },
  USER_MFA_DISABLED: { code: 'USER_MFA_DISABLED', description: 'User MFA disabled' },
  USER_LOCKED: { code: 'USER_LOCKED', description: 'User account locked' },
  USER_UNLOCKED: { code: 'USER_UNLOCKED', description: 'User account unlocked' },

  // Health
  HEALTH_CHECK: { code: 'HEALTH_CHECK', description: 'Health check performed' },

  // RFC-0013: User Access Profile Bundle
  // Maintenance Group Operations
  MAINTENANCE_GROUP_CREATED: { code: 'MAINTENANCE_GROUP_CREATED', description: 'Maintenance group created' },
  MAINTENANCE_GROUP_UPDATED: { code: 'MAINTENANCE_GROUP_UPDATED', description: 'Maintenance group updated' },
  MAINTENANCE_GROUP_DELETED: { code: 'MAINTENANCE_GROUP_DELETED', description: 'Maintenance group deleted' },
  USER_GROUP_CHANGED: { code: 'USER_GROUP_CHANGED', description: 'User maintenance group assignment changed' },

  // Bundle Operations
  BUNDLE_GENERATED: { code: 'BUNDLE_GENERATED', description: 'Access bundle generated' },
  BUNDLE_INVALIDATED: { code: 'BUNDLE_INVALIDATED', description: 'Access bundle invalidated' },
  BUNDLE_REFRESHED: { code: 'BUNDLE_REFRESHED', description: 'Access bundle refreshed' },

  // Generic Entity Operations (for services that use generic patterns)
  ENTITY_CREATED: { code: 'ENTITY_CREATED', description: 'Entity created' },
  ENTITY_UPDATED: { code: 'ENTITY_UPDATED', description: 'Entity updated' },
  ENTITY_DELETED: { code: 'ENTITY_DELETED', description: 'Entity deleted' },
} as const;

export type EventTypeCode = keyof typeof EventType;
export type EventTypeValue = (typeof EventType)[EventTypeCode];
