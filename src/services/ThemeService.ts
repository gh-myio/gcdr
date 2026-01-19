import { LookAndFeel } from '../domain/entities/LookAndFeel';
import { CreateLookAndFeelDTO, UpdateLookAndFeelDTO, QuickThemeUpdateDTO } from '../dto/request/LookAndFeelDTO';
import { CompiledThemeDTO } from '../dto/response/LookAndFeelResponseDTO';
import { LookAndFeelRepository } from '../repositories/LookAndFeelRepository';
import { ILookAndFeelRepository } from '../repositories/interfaces/ILookAndFeelRepository';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ValidationError, ConflictError } from '../shared/errors/AppError';

export class ThemeService {
  private repository: ILookAndFeelRepository;

  constructor(repository?: ILookAndFeelRepository) {
    this.repository = repository || new LookAndFeelRepository();
  }

  async create(tenantId: string, data: CreateLookAndFeelDTO, userId: string): Promise<LookAndFeel> {
    // Validate parent theme if inheritance is enabled
    if (data.inheritFromParent && data.parentThemeId) {
      const parentTheme = await this.repository.getById(tenantId, data.parentThemeId);
      if (!parentTheme) {
        throw new NotFoundError(`Parent theme ${data.parentThemeId} not found`);
      }
    }

    // Cannot set inheritFromParent without parentThemeId
    if (data.inheritFromParent && !data.parentThemeId) {
      throw new ValidationError('Parent theme ID is required when inheritance is enabled');
    }

    const theme = await this.repository.create(tenantId, data, userId);

    // Publish event
    await eventService.publish(EventType.THEME_CREATED, {
      tenantId,
      entityType: 'theme',
      entityId: theme.id,
      action: 'created',
      data: {
        name: theme.name,
        customerId: theme.customerId,
        isDefault: theme.isDefault,
      },
      actor: { userId, type: 'user' },
    });

    return theme;
  }

  async getById(tenantId: string, id: string): Promise<LookAndFeel> {
    const theme = await this.repository.getById(tenantId, id);
    if (!theme) {
      throw new NotFoundError(`Theme ${id} not found`);
    }
    return theme;
  }

  async update(tenantId: string, id: string, data: UpdateLookAndFeelDTO, userId: string): Promise<LookAndFeel> {
    await this.getById(tenantId, id);

    const theme = await this.repository.update(tenantId, id, data, userId);

    // Publish event
    await eventService.publish(EventType.THEME_UPDATED, {
      tenantId,
      entityType: 'theme',
      entityId: theme.id,
      action: 'updated',
      data: { updatedFields: Object.keys(data) },
      actor: { userId, type: 'user' },
    });

    return theme;
  }

  async quickUpdate(tenantId: string, id: string, data: QuickThemeUpdateDTO, userId: string): Promise<LookAndFeel> {
    const existing = await this.getById(tenantId, id);

    const updateData: UpdateLookAndFeelDTO = {};

    if (data.primaryColor || data.secondaryColor) {
      updateData.colors = {};
      if (data.primaryColor) {
        updateData.colors.primary = data.primaryColor;
      }
      if (data.secondaryColor) {
        updateData.colors.secondary = data.secondaryColor;
      }
    }

    if (data.logoUrl || data.faviconUrl) {
      updateData.logo = {};
      if (data.logoUrl) {
        updateData.logo.primaryUrl = data.logoUrl;
      }
      if (data.faviconUrl) {
        updateData.logo.faviconUrl = data.faviconUrl;
      }
    }

    if (data.brandName !== undefined) {
      updateData.brandName = data.brandName;
    }

    if (data.mode !== undefined) {
      updateData.mode = data.mode;
    }

    return this.update(tenantId, id, updateData, userId);
  }

  async delete(tenantId: string, id: string, userId: string): Promise<void> {
    const theme = await this.getById(tenantId, id);

    // Check if there are child themes inheriting from this one
    const childThemes = await this.repository.getByParentTheme(tenantId, id);
    if (childThemes.length > 0) {
      throw new ConflictError(
        `Cannot delete theme: ${childThemes.length} theme(s) inherit from this theme`
      );
    }

    await this.repository.delete(tenantId, id);

    // Publish event
    await eventService.publish(EventType.THEME_DELETED, {
      tenantId,
      entityType: 'theme',
      entityId: id,
      action: 'deleted',
      data: {
        name: theme.name,
        customerId: theme.customerId,
      },
      actor: { userId, type: 'user' },
    });
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<LookAndFeel>> {
    return this.repository.list(tenantId, params);
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<LookAndFeel[]> {
    return this.repository.listByCustomer(tenantId, customerId);
  }

  async getDefaultByCustomer(tenantId: string, customerId: string): Promise<LookAndFeel | null> {
    return this.repository.getDefaultByCustomer(tenantId, customerId);
  }

  async setDefault(tenantId: string, customerId: string, themeId: string, userId: string): Promise<LookAndFeel> {
    const theme = await this.getById(tenantId, themeId);

    // Validate theme belongs to the customer
    if (theme.customerId !== customerId) {
      throw new ValidationError('Theme does not belong to this customer');
    }

    const updatedTheme = await this.repository.setDefault(tenantId, customerId, themeId);

    // Publish event
    await eventService.publish(EventType.THEME_SET_DEFAULT, {
      tenantId,
      entityType: 'theme',
      entityId: themeId,
      action: 'set_default',
      data: {
        name: theme.name,
        customerId,
      },
      actor: { userId, type: 'user' },
    });

    return updatedTheme;
  }

  /**
   * Compiles a theme by resolving inheritance chain
   * Returns the effective theme with all inherited values merged
   */
  async compileTheme(tenantId: string, themeId: string): Promise<CompiledThemeDTO> {
    const theme = await this.getById(tenantId, themeId);
    const inheritanceChain: string[] = [theme.id];

    // If no inheritance, return the theme as-is
    if (!theme.inheritFromParent || !theme.parentThemeId) {
      return {
        id: theme.id,
        customerId: theme.customerId,
        name: theme.name,
        mode: theme.mode,
        colors: theme.colors,
        darkModeColors: theme.darkModeColors,
        typography: theme.typography,
        logo: theme.logo,
        brandName: theme.brandName,
        tagline: theme.tagline,
        layout: theme.layout,
        components: theme.components,
        customCss: theme.customCss,
        inheritanceChain,
      };
    }

    // Build inheritance chain (up to 10 levels to prevent infinite loops)
    const themes: LookAndFeel[] = [theme];
    let currentTheme = theme;
    let depth = 0;
    const maxDepth = 10;

    while (currentTheme.inheritFromParent && currentTheme.parentThemeId && depth < maxDepth) {
      const parentTheme = await this.repository.getById(tenantId, currentTheme.parentThemeId);
      if (!parentTheme) {
        break;
      }
      themes.unshift(parentTheme); // Add parent at the beginning
      inheritanceChain.unshift(parentTheme.id);
      currentTheme = parentTheme;
      depth++;
    }

    // Merge themes from parent to child (parent values are overridden by child)
    const compiled = themes.reduce(
      (acc, t) => ({
        colors: { ...acc.colors, ...t.colors },
        darkModeColors: t.darkModeColors
          ? { ...acc.darkModeColors, ...t.darkModeColors }
          : acc.darkModeColors,
        typography: { ...acc.typography, ...t.typography },
        logo: { ...acc.logo, ...t.logo },
        layout: { ...acc.layout, ...t.layout },
        components: { ...acc.components, ...t.components },
        customCss: t.customCss
          ? {
              global: (acc.customCss?.global || '') + (t.customCss.global || ''),
              header: (acc.customCss?.header || '') + (t.customCss.header || ''),
              sidebar: (acc.customCss?.sidebar || '') + (t.customCss.sidebar || ''),
              content: (acc.customCss?.content || '') + (t.customCss.content || ''),
              footer: (acc.customCss?.footer || '') + (t.customCss.footer || ''),
            }
          : acc.customCss,
        brandName: t.brandName || acc.brandName,
        tagline: t.tagline || acc.tagline,
      }),
      {
        colors: {},
        darkModeColors: undefined as any,
        typography: {},
        logo: {},
        layout: {},
        components: {},
        customCss: undefined as any,
        brandName: undefined as string | undefined,
        tagline: undefined as string | undefined,
      }
    );

    return {
      id: theme.id,
      customerId: theme.customerId,
      name: theme.name,
      mode: theme.mode,
      colors: compiled.colors as LookAndFeel['colors'],
      darkModeColors: compiled.darkModeColors,
      typography: compiled.typography as LookAndFeel['typography'],
      logo: compiled.logo as LookAndFeel['logo'],
      brandName: compiled.brandName,
      tagline: compiled.tagline,
      layout: compiled.layout as LookAndFeel['layout'],
      components: compiled.components as LookAndFeel['components'],
      customCss: compiled.customCss,
      inheritanceChain,
    };
  }

  /**
   * Gets the effective theme for a customer
   * Returns the default theme if exists, otherwise returns null
   */
  async getEffectiveTheme(tenantId: string, customerId: string): Promise<CompiledThemeDTO | null> {
    const defaultTheme = await this.repository.getDefaultByCustomer(tenantId, customerId);
    if (!defaultTheme) {
      return null;
    }
    return this.compileTheme(tenantId, defaultTheme.id);
  }
}

export const themeService = new ThemeService();
