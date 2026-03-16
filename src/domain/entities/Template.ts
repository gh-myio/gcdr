export type TemplateType = 'EMAIL_ALARM' | 'EMAIL_REPORT' | 'EMAIL_WELCOME' | 'RELEASE_NOTE' | 'NOTIFICATION' | 'INSIGHT';
export type TemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface Template {
  id: string;
  slug: string;
  tenantId: string;
  /** null = tenant default template; set = customer-level override */
  customerId: string | null;
  name: string;
  type: TemplateType;
  status: TemplateStatus;
  htmlContent: string;
  description?: string;
  version: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Template without htmlContent — used in list responses to avoid large payloads */
export type TemplateSummary = Omit<Template, 'htmlContent'>;
