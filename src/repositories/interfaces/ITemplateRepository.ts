import { Template, TemplateSummary, TemplateType, TemplateStatus } from '../../domain/entities/Template';
import { CreateTemplateDTO, UpdateTemplateDTO } from '../../dto/request/TemplateDTO';

export interface ListTemplatesFilter {
  type?: TemplateType;
  status?: TemplateStatus;
}

export interface ITemplateRepository {
  create(tenantId: string, data: CreateTemplateDTO, userId: string): Promise<Template>;
  getBySlug(tenantId: string, slug: string): Promise<Template | null>;
  list(tenantId: string, filter?: ListTemplatesFilter): Promise<TemplateSummary[]>;
  update(tenantId: string, slug: string, data: UpdateTemplateDTO): Promise<Template>;
  archive(tenantId: string, slug: string): Promise<void>;
  getActiveByType(tenantId: string, type: TemplateType): Promise<Template | null>;
}
