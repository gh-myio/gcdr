import { TemplateTypeRecord } from '../../domain/entities/TemplateTypeRecord';
import { UpdateTemplateTypeDTO } from '../../dto/request/TemplateTypeDTO';

export interface ITemplateTypeRepository {
  getAll(): Promise<TemplateTypeRecord[]>;
  getByType(type: string): Promise<TemplateTypeRecord | null>;
  update(type: string, data: UpdateTemplateTypeDTO): Promise<TemplateTypeRecord>;
}
