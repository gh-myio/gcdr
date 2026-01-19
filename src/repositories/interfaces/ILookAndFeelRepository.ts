import { LookAndFeel } from '../../domain/entities/LookAndFeel';
import { CreateLookAndFeelDTO, UpdateLookAndFeelDTO } from '../../dto/request/LookAndFeelDTO';
import { PaginatedResult } from '../../shared/types';

export interface ILookAndFeelRepository {
  create(tenantId: string, data: CreateLookAndFeelDTO, createdBy: string): Promise<LookAndFeel>;
  getById(tenantId: string, id: string): Promise<LookAndFeel | null>;
  update(tenantId: string, id: string, data: UpdateLookAndFeelDTO, updatedBy: string): Promise<LookAndFeel>;
  delete(tenantId: string, id: string): Promise<void>;

  // List
  list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<LookAndFeel>>;
  listByCustomer(tenantId: string, customerId: string): Promise<LookAndFeel[]>;

  // Default theme
  getDefaultByCustomer(tenantId: string, customerId: string): Promise<LookAndFeel | null>;
  setDefault(tenantId: string, customerId: string, themeId: string): Promise<LookAndFeel>;

  // Inheritance
  getByParentTheme(tenantId: string, parentThemeId: string): Promise<LookAndFeel[]>;
}
