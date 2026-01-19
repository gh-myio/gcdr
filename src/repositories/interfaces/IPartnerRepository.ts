import { Partner, ApiKey, OAuthClient, WebhookSubscription } from '../../domain/entities/Partner';
import { RegisterPartnerDTO, UpdatePartnerDTO, ApprovePartnerDTO, UpdateWebhookDTO } from '../../dto/request/PartnerDTO';
import { PaginatedResult, PartnerStatus } from '../../shared/types';
import { IRepository } from './IRepository';

export interface ListPartnersParams {
  limit?: number;
  cursor?: string;
  status?: PartnerStatus;
}

export interface IPartnerRepository extends IRepository<Partner, RegisterPartnerDTO, UpdatePartnerDTO> {
  getByStatus(tenantId: string, status: PartnerStatus): Promise<Partner[]>;
  getByEmail(tenantId: string, email: string): Promise<Partner | null>;
  approve(tenantId: string, id: string, data: ApprovePartnerDTO, approvedBy: string): Promise<Partner>;
  reject(tenantId: string, id: string, reason: string, rejectedBy: string): Promise<Partner>;
  suspend(tenantId: string, id: string, reason: string, suspendedBy: string): Promise<Partner>;
  activate(tenantId: string, id: string, activatedBy: string): Promise<Partner>;
  addApiKey(tenantId: string, partnerId: string, apiKey: ApiKey): Promise<Partner>;
  revokeApiKey(tenantId: string, partnerId: string, apiKeyId: string): Promise<Partner>;
  addOAuthClient(tenantId: string, partnerId: string, client: OAuthClient): Promise<Partner>;
  revokeOAuthClient(tenantId: string, partnerId: string, clientId: string): Promise<Partner>;
  addWebhook(tenantId: string, partnerId: string, webhook: WebhookSubscription): Promise<Partner>;
  updateWebhook(tenantId: string, partnerId: string, webhookId: string, data: UpdateWebhookDTO): Promise<Partner>;
  deleteWebhook(tenantId: string, partnerId: string, webhookId: string): Promise<Partner>;
  listWithFilters(tenantId: string, params: ListPartnersParams): Promise<PaginatedResult<Partner>>;
  updateUsage(tenantId: string, partnerId: string, requestCount: number): Promise<void>;
}
