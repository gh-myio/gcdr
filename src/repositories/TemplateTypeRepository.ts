import { eq } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { TemplateTypeRecord } from '../domain/entities/TemplateTypeRecord';
import { UpdateTemplateTypeDTO } from '../dto/request/TemplateTypeDTO';
import { ITemplateTypeRepository } from './interfaces/ITemplateTypeRepository';
import { AppError } from '../shared/errors/AppError';

const { templateTypes } = schema;

export class TemplateTypeRepository implements ITemplateTypeRepository {

  async getAll(): Promise<TemplateTypeRecord[]> {
    const results = await db
      .select()
      .from(templateTypes)
      .orderBy(templateTypes.sortOrder, templateTypes.type);

    return results.map(this.mapToEntity);
  }

  async getByType(type: string): Promise<TemplateTypeRecord | null> {
    const [result] = await db
      .select()
      .from(templateTypes)
      .where(eq(templateTypes.type, type))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(type: string, data: UpdateTemplateTypeDTO): Promise<TemplateTypeRecord> {
    const existing = await this.getByType(type);
    if (!existing) {
      throw new AppError('TEMPLATE_TYPE_NOT_FOUND', `Template type '${type}' not found`, 404);
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (data.label       !== undefined) updateData.label       = data.label;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.icon        !== undefined) updateData.icon        = data.icon;
    if (data.sortOrder   !== undefined) updateData.sortOrder   = data.sortOrder;
    if (data.active      !== undefined) updateData.active      = data.active;

    const [result] = await db
      .update(templateTypes)
      .set(updateData)
      .where(eq(templateTypes.type, type))
      .returning();

    return this.mapToEntity(result);
  }

  private mapToEntity(row: typeof templateTypes.$inferSelect): TemplateTypeRecord {
    return {
      type:        row.type,
      label:       row.label,
      description: row.description || undefined,
      icon:        row.icon || undefined,
      sortOrder:   row.sortOrder,
      active:      row.active,
      createdAt:   row.createdAt.toISOString(),
      updatedAt:   row.updatedAt.toISOString(),
    };
  }
}

export const templateTypeRepository = new TemplateTypeRepository();
