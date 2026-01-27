import { eq, and } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import {
  LookAndFeel,
  createDefaultColorPalette,
  createDefaultTypography,
  createDefaultLayoutConfig,
  createDefaultComponentStyles,
} from '../domain/entities/LookAndFeel';
import { CreateLookAndFeelDTO, UpdateLookAndFeelDTO } from '../dto/request/LookAndFeelDTO';
import { PaginatedResult } from '../shared/types';
import { ILookAndFeelRepository } from './interfaces/ILookAndFeelRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { lookAndFeels } = schema;

export class LookAndFeelRepository implements ILookAndFeelRepository {

  async create(tenantId: string, data: CreateLookAndFeelDTO, createdBy: string): Promise<LookAndFeel> {
    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(lookAndFeels).values({
      id,
      tenantId,
      customerId: data.customerId,
      name: data.name,
      description: data.description || null,
      isDefault: data.isDefault || false,
      mode: data.mode || 'light',
      colors: data.colors || createDefaultColorPalette(),
      darkModeColors: data.darkModeColors || null,
      typography: data.typography || createDefaultTypography(),
      logo: data.logo || {},
      brandName: data.brandName || null,
      tagline: data.tagline || null,
      layout: data.layout || createDefaultLayoutConfig(),
      components: data.components || createDefaultComponentStyles(),
      customCss: data.customCss || null,
      inheritFromParent: data.inheritFromParent ?? true,
      parentThemeId: data.parentThemeId || null,
      metadata: data.metadata || {},
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    // If this is set as default, unset other defaults for this customer
    if (data.isDefault) {
      await this.unsetOtherDefaults(tenantId, data.customerId, id);
    }

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<LookAndFeel | null> {
    const [result] = await db
      .select()
      .from(lookAndFeels)
      .where(and(eq(lookAndFeels.tenantId, tenantId), eq(lookAndFeels.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(tenantId: string, id: string, data: UpdateLookAndFeelDTO, updatedBy: string): Promise<LookAndFeel> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('THEME_NOT_FOUND', 'Theme not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
    if (data.mode !== undefined) updateData.mode = data.mode;
    if (data.brandName !== undefined) updateData.brandName = data.brandName;
    if (data.tagline !== undefined) updateData.tagline = data.tagline;
    if (data.customCss !== undefined) updateData.customCss = data.customCss;
    if (data.inheritFromParent !== undefined) updateData.inheritFromParent = data.inheritFromParent;
    if (data.metadata !== undefined) updateData.metadata = { ...existing.metadata, ...data.metadata };

    // Deep merge colors if provided
    if (data.colors !== undefined) {
      updateData.colors = { ...existing.colors, ...data.colors };
    }

    if (data.darkModeColors !== undefined) {
      updateData.darkModeColors = data.darkModeColors;
    }

    // Deep merge other nested objects
    if (data.typography !== undefined) {
      updateData.typography = { ...existing.typography, ...data.typography };
    }

    if (data.layout !== undefined) {
      updateData.layout = { ...existing.layout, ...data.layout };
    }

    if (data.components !== undefined) {
      updateData.components = { ...existing.components, ...data.components };
    }

    if (data.logo !== undefined) {
      updateData.logo = { ...existing.logo, ...data.logo };
    }

    const [result] = await db
      .update(lookAndFeels)
      .set(updateData)
      .where(and(
        eq(lookAndFeels.tenantId, tenantId),
        eq(lookAndFeels.id, id),
        eq(lookAndFeels.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Theme was modified by another process', 409);
    }

    // If this is set as default, unset other defaults
    if (data.isDefault === true) {
      await this.unsetOtherDefaults(tenantId, existing.customerId, id);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (existing && existing.isDefault) {
      throw new AppError('CANNOT_DELETE_DEFAULT', 'Cannot delete the default theme. Set another theme as default first.', 400);
    }

    await db
      .delete(lookAndFeels)
      .where(and(eq(lookAndFeels.tenantId, tenantId), eq(lookAndFeels.id, id)));
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<LookAndFeel>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const results = await db
      .select()
      .from(lookAndFeels)
      .where(eq(lookAndFeels.tenantId, tenantId))
      .orderBy(lookAndFeels.name)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<LookAndFeel[]> {
    const results = await db
      .select()
      .from(lookAndFeels)
      .where(and(
        eq(lookAndFeels.tenantId, tenantId),
        eq(lookAndFeels.customerId, customerId)
      ))
      .orderBy(lookAndFeels.name);

    return results.map(this.mapToEntity);
  }

  async getDefaultByCustomer(tenantId: string, customerId: string): Promise<LookAndFeel | null> {
    const [result] = await db
      .select()
      .from(lookAndFeels)
      .where(and(
        eq(lookAndFeels.tenantId, tenantId),
        eq(lookAndFeels.customerId, customerId),
        eq(lookAndFeels.isDefault, true)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async setDefault(tenantId: string, customerId: string, themeId: string): Promise<LookAndFeel> {
    // First, unset all other defaults for this customer
    await this.unsetOtherDefaults(tenantId, customerId, themeId);

    // Then set the new default
    const [result] = await db
      .update(lookAndFeels)
      .set({
        isDefault: true,
        updatedAt: new Date(),
      })
      .where(and(
        eq(lookAndFeels.tenantId, tenantId),
        eq(lookAndFeels.id, themeId)
      ))
      .returning();

    if (!result) {
      throw new AppError('THEME_NOT_FOUND', 'Theme not found', 404);
    }

    return this.mapToEntity(result);
  }

  async getByParentTheme(tenantId: string, parentThemeId: string): Promise<LookAndFeel[]> {
    const results = await db
      .select()
      .from(lookAndFeels)
      .where(and(
        eq(lookAndFeels.tenantId, tenantId),
        eq(lookAndFeels.parentThemeId, parentThemeId)
      ))
      .orderBy(lookAndFeels.name);

    return results.map(this.mapToEntity);
  }

  private async unsetOtherDefaults(tenantId: string, customerId: string, exceptThemeId: string): Promise<void> {
    const customerThemes = await this.listByCustomer(tenantId, customerId);

    for (const theme of customerThemes) {
      if (theme.id !== exceptThemeId && theme.isDefault) {
        await db
          .update(lookAndFeels)
          .set({
            isDefault: false,
            updatedAt: new Date(),
          })
          .where(and(
            eq(lookAndFeels.tenantId, tenantId),
            eq(lookAndFeels.id, theme.id)
          ));
      }
    }
  }

  private mapToEntity(row: typeof lookAndFeels.$inferSelect): LookAndFeel {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      name: row.name,
      description: row.description || undefined,
      isDefault: row.isDefault,
      mode: row.mode as LookAndFeel['mode'],
      colors: row.colors as LookAndFeel['colors'],
      darkModeColors: row.darkModeColors as LookAndFeel['darkModeColors'],
      typography: row.typography as LookAndFeel['typography'],
      logo: row.logo as LookAndFeel['logo'],
      brandName: row.brandName || undefined,
      tagline: row.tagline || undefined,
      layout: row.layout as LookAndFeel['layout'],
      components: row.components as LookAndFeel['components'],
      customCss: row.customCss as LookAndFeel['customCss'],
      inheritFromParent: row.inheritFromParent,
      parentThemeId: row.parentThemeId || undefined,
      metadata: row.metadata as Record<string, unknown>,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
    };
  }
}

// Export singleton instance
export const lookAndFeelRepository = new LookAndFeelRepository();
