import { eq, and, isNull } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Template, TemplateSummary, TemplateType } from '../domain/entities/Template';
import { CreateTemplateDTO, UpdateTemplateDTO } from '../dto/request/TemplateDTO';
import { ITemplateRepository, ListTemplatesFilter } from './interfaces/ITemplateRepository';

function mapRow(row: typeof schema.templates.$inferSelect): Template {
  return {
    id: row.id,
    slug: row.slug,
    tenantId: row.tenantId,
    customerId: row.customerId ?? null,
    name: row.name,
    type: row.type as Template['type'],
    status: row.status as Template['status'],
    htmlContent: row.htmlContent,
    description: row.description ?? undefined,
    version: row.version,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapSummary(row: typeof schema.templates.$inferSelect): TemplateSummary {
  const { htmlContent: _html, ...rest } = mapRow(row);
  return rest;
}

export class TemplateRepository implements ITemplateRepository {
  async create(tenantId: string, data: CreateTemplateDTO, userId: string): Promise<Template> {
    const [row] = await db.insert(schema.templates).values({
      slug: data.slug,
      tenantId,
      customerId: data.customerId ?? null,
      name: data.name,
      type: data.type,
      status: data.status ?? 'DRAFT',
      htmlContent: data.htmlContent,
      description: data.description ?? null,
      createdBy: userId,
    }).returning();
    return mapRow(row);
  }

  async getBySlug(tenantId: string, slug: string): Promise<Template | null> {
    const [row] = await db
      .select()
      .from(schema.templates)
      .where(and(eq(schema.templates.tenantId, tenantId), eq(schema.templates.slug, slug)));
    return row ? mapRow(row) : null;
  }

  async list(tenantId: string, filter?: ListTemplatesFilter): Promise<TemplateSummary[]> {
    const conditions = [eq(schema.templates.tenantId, tenantId)];
    if (filter?.type) conditions.push(eq(schema.templates.type, filter.type));
    if (filter?.status) conditions.push(eq(schema.templates.status, filter.status));

    const rows = await db
      .select()
      .from(schema.templates)
      .where(and(...conditions))
      .orderBy(schema.templates.createdAt);

    return rows.map(mapSummary);
  }

  async update(tenantId: string, slug: string, data: UpdateTemplateDTO): Promise<Template> {
    // Fetch current to increment version
    const existing = await this.getBySlug(tenantId, slug);
    if (!existing) throw new Error(`Template ${slug} not found`);

    const [row] = await db
      .update(schema.templates)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.htmlContent !== undefined && { htmlContent: data.htmlContent }),
        ...(data.description !== undefined && { description: data.description }),
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.templates.tenantId, tenantId), eq(schema.templates.slug, slug)))
      .returning();
    return mapRow(row);
  }

  async archive(tenantId: string, slug: string): Promise<void> {
    await db
      .update(schema.templates)
      .set({ status: 'ARCHIVED', updatedAt: new Date() })
      .where(and(eq(schema.templates.tenantId, tenantId), eq(schema.templates.slug, slug)));
  }

  async getActiveByType(tenantId: string, type: TemplateType): Promise<Template | null> {
    const [row] = await db
      .select()
      .from(schema.templates)
      .where(
        and(
          eq(schema.templates.tenantId, tenantId),
          isNull(schema.templates.customerId),
          eq(schema.templates.type, type),
          eq(schema.templates.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async getActiveByTypeForCustomer(tenantId: string, customerId: string, type: TemplateType): Promise<Template | null> {
    const [row] = await db
      .select()
      .from(schema.templates)
      .where(
        and(
          eq(schema.templates.tenantId, tenantId),
          eq(schema.templates.customerId, customerId),
          eq(schema.templates.type, type),
          eq(schema.templates.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async getByTypeAndVersion(tenantId: string, type: TemplateType, version: number): Promise<Template | null> {
    const [row] = await db
      .select()
      .from(schema.templates)
      .where(
        and(
          eq(schema.templates.tenantId, tenantId),
          eq(schema.templates.type, type),
          eq(schema.templates.version, version),
        ),
      )
      .limit(1);
    return row ? mapRow(row) : null;
  }
}

export const templateRepository = new TemplateRepository();
