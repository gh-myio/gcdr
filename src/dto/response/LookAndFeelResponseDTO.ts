import { LookAndFeel, ColorPalette, Typography, LogoConfig, LayoutConfig, ComponentStyles } from '../../domain/entities/LookAndFeel';

export interface ThemeSummaryDTO {
  id: string;
  customerId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  mode: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  brandName?: string;
  inheritFromParent: boolean;
  updatedAt: string;
}

export interface ThemeDetailDTO {
  id: string;
  tenantId: string;
  customerId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  mode: string;
  colors: ColorPalette;
  darkModeColors?: ColorPalette;
  typography: Typography;
  logo: LogoConfig;
  brandName?: string;
  tagline?: string;
  layout: LayoutConfig;
  components: ComponentStyles;
  customCss?: {
    global?: string;
    header?: string;
    sidebar?: string;
    content?: string;
    footer?: string;
  };
  inheritFromParent: boolean;
  parentThemeId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Compiled theme with inherited values resolved
export interface CompiledThemeDTO {
  id: string;
  customerId: string;
  name: string;
  mode: string;
  colors: ColorPalette;
  darkModeColors?: ColorPalette;
  typography: Typography;
  logo: LogoConfig;
  brandName?: string;
  tagline?: string;
  layout: LayoutConfig;
  components: ComponentStyles;
  customCss?: {
    global?: string;
    header?: string;
    sidebar?: string;
    content?: string;
    footer?: string;
  };
  inheritanceChain: string[]; // List of theme IDs that contributed
}

export function toThemeSummaryDTO(theme: LookAndFeel): ThemeSummaryDTO {
  return {
    id: theme.id,
    customerId: theme.customerId,
    name: theme.name,
    description: theme.description,
    isDefault: theme.isDefault,
    mode: theme.mode,
    primaryColor: theme.colors.primary,
    secondaryColor: theme.colors.secondary,
    logoUrl: theme.logo.primaryUrl,
    brandName: theme.brandName,
    inheritFromParent: theme.inheritFromParent,
    updatedAt: theme.updatedAt,
  };
}

export function toThemeDetailDTO(theme: LookAndFeel): ThemeDetailDTO {
  return {
    id: theme.id,
    tenantId: theme.tenantId,
    customerId: theme.customerId,
    name: theme.name,
    description: theme.description,
    isDefault: theme.isDefault,
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
    inheritFromParent: theme.inheritFromParent,
    parentThemeId: theme.parentThemeId,
    metadata: theme.metadata,
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
  };
}
