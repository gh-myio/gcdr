import { BaseEntity, PartnerStatus } from '../../shared/types';

export interface ApiKey {
  id: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  revokedAt?: string;
  status: 'ACTIVE' | 'REVOKED';
}

export interface OAuthClient {
  clientId: string;
  clientSecretHash: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  grantTypes: ('client_credentials' | 'authorization_code')[];
  createdAt: string;
  status: 'ACTIVE' | 'REVOKED';
}

export interface Partner extends BaseEntity {
  status: PartnerStatus;

  // Company Info
  companyName: string;
  companyWebsite: string;
  companyDescription: string;
  industry: string;
  country: string;

  // Contact
  contactName: string;
  contactEmail: string;
  contactPhone?: string;

  // Technical
  technicalContactEmail: string;
  webhookUrl?: string;
  ipWhitelist?: string[];

  // API Access
  apiKeys: ApiKey[];
  oauthClients: OAuthClient[];
  scopes: string[];

  // Limits
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  monthlyQuota: number;

  // Integration Packages
  subscribedPackages: string[];
  publishedPackages: string[];

  // Approval
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;

  // Suspension
  suspendedAt?: string;
  suspendedBy?: string;
  suspensionReason?: string;

  // Activation
  activatedAt?: string;
  activatedBy?: string;
}

export const PARTNER_SCOPES = [
  'customers:read',
  'customers:write',
  'customers:hierarchy',
  'assets:read',
  'assets:write',
  'devices:read',
  'devices:write',
  'rules:read',
  'rules:write',
  'integrations:read',
  'integrations:execute',
  'webhooks:manage',
  'events:subscribe',
] as const;

export type PartnerScope = (typeof PARTNER_SCOPES)[number];
