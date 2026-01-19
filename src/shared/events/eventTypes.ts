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

  // Device Operations
  DEVICE_CREATED: { code: 'DEVICE_CREATED', description: 'Device created' },
  DEVICE_UPDATED: { code: 'DEVICE_UPDATED', description: 'Device updated' },
  DEVICE_DELETED: { code: 'DEVICE_DELETED', description: 'Device deleted' },

  // Rule Operations
  RULE_CREATED: { code: 'RULE_CREATED', description: 'Rule created' },
  RULE_UPDATED: { code: 'RULE_UPDATED', description: 'Rule updated' },
  RULE_DELETED: { code: 'RULE_DELETED', description: 'Rule deleted' },

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

  // Health
  HEALTH_CHECK: { code: 'HEALTH_CHECK', description: 'Health check performed' },
} as const;

export type EventTypeCode = keyof typeof EventType;
export type EventTypeValue = (typeof EventType)[EventTypeCode];
