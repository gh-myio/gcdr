import { z } from 'zod';

// Color validation (hex color)
const hexColorSchema = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/);

// Color Palette Schema
const ColorPaletteSchema = z.object({
  primary: hexColorSchema,
  primaryLight: hexColorSchema.optional(),
  primaryDark: hexColorSchema.optional(),
  secondary: hexColorSchema,
  secondaryLight: hexColorSchema.optional(),
  secondaryDark: hexColorSchema.optional(),
  accent: hexColorSchema.optional(),
  background: hexColorSchema,
  surface: hexColorSchema,
  error: hexColorSchema,
  warning: hexColorSchema,
  success: hexColorSchema,
  info: hexColorSchema,
  textPrimary: hexColorSchema,
  textSecondary: hexColorSchema,
  textDisabled: hexColorSchema.optional(),
  divider: hexColorSchema.optional(),
});

// Typography Schema
const TypographySchema = z.object({
  fontFamily: z.string().max(500),
  fontFamilySecondary: z.string().max(500).optional(),
  fontSize: z.object({
    xs: z.string(),
    sm: z.string(),
    base: z.string(),
    lg: z.string(),
    xl: z.string(),
    '2xl': z.string(),
    '3xl': z.string(),
  }),
  fontWeight: z.object({
    light: z.number().min(100).max(900),
    normal: z.number().min(100).max(900),
    medium: z.number().min(100).max(900),
    semibold: z.number().min(100).max(900),
    bold: z.number().min(100).max(900),
  }),
  lineHeight: z.object({
    tight: z.number().min(1).max(3),
    normal: z.number().min(1).max(3),
    relaxed: z.number().min(1).max(3),
  }),
});

// Logo Config Schema
const LogoConfigSchema = z.object({
  primaryUrl: z.string().url(),
  secondaryUrl: z.string().url().optional(),
  iconUrl: z.string().url().optional(),
  faviconUrl: z.string().url().optional(),
  darkModeUrl: z.string().url().optional(),
  width: z.number().min(10).max(1000).optional(),
  height: z.number().min(10).max(1000).optional(),
});

// Layout Config Schema
const LayoutConfigSchema = z.object({
  sidebarPosition: z.enum(['left', 'right']),
  sidebarCollapsed: z.boolean(),
  headerHeight: z.number().min(32).max(200),
  footerHeight: z.number().min(0).max(200),
  maxContentWidth: z.number().min(800).max(3000),
  borderRadius: z.object({
    none: z.string(),
    sm: z.string(),
    md: z.string(),
    lg: z.string(),
    full: z.string(),
  }),
  spacing: z.object({
    xs: z.string(),
    sm: z.string(),
    md: z.string(),
    lg: z.string(),
    xl: z.string(),
  }),
});

// Component Styles Schema
const ComponentStylesSchema = z.object({
  buttons: z.object({
    borderRadius: z.string(),
    textTransform: z.enum(['none', 'uppercase', 'capitalize']),
    fontWeight: z.number().min(100).max(900),
  }),
  cards: z.object({
    borderRadius: z.string(),
    shadow: z.string(),
    borderWidth: z.string(),
  }),
  inputs: z.object({
    borderRadius: z.string(),
    borderWidth: z.string(),
    focusRingWidth: z.string(),
  }),
  tables: z.object({
    headerBackground: hexColorSchema,
    stripedRows: z.boolean(),
    hoverEffect: z.boolean(),
    borderStyle: z.enum(['none', 'horizontal', 'vertical', 'full']),
  }),
});

// Custom CSS Schema
const CustomCSSSchema = z.object({
  global: z.string().max(50000).optional(),
  header: z.string().max(10000).optional(),
  sidebar: z.string().max(10000).optional(),
  content: z.string().max(10000).optional(),
  footer: z.string().max(10000).optional(),
});

// Create Look and Feel DTO
export const CreateLookAndFeelSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().default(false),
  mode: z.enum(['light', 'dark', 'system']).default('light'),
  colors: ColorPaletteSchema,
  darkModeColors: ColorPaletteSchema.optional(),
  typography: TypographySchema.optional(),
  logo: LogoConfigSchema,
  brandName: z.string().max(100).optional(),
  tagline: z.string().max(200).optional(),
  layout: LayoutConfigSchema.optional(),
  components: ComponentStylesSchema.optional(),
  customCss: CustomCSSSchema.optional(),
  inheritFromParent: z.boolean().default(false),
  parentThemeId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type CreateLookAndFeelDTO = z.infer<typeof CreateLookAndFeelSchema>;

// Update Look and Feel DTO
export const UpdateLookAndFeelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  isDefault: z.boolean().optional(),
  mode: z.enum(['light', 'dark', 'system']).optional(),
  colors: ColorPaletteSchema.partial().optional(),
  darkModeColors: ColorPaletteSchema.partial().optional().nullable(),
  typography: TypographySchema.partial().optional(),
  logo: LogoConfigSchema.partial().optional(),
  brandName: z.string().max(100).optional().nullable(),
  tagline: z.string().max(200).optional().nullable(),
  layout: LayoutConfigSchema.partial().optional(),
  components: ComponentStylesSchema.partial().optional(),
  customCss: CustomCSSSchema.optional().nullable(),
  inheritFromParent: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateLookAndFeelDTO = z.infer<typeof UpdateLookAndFeelSchema>;

// Quick Theme Update (simplified)
export const QuickThemeUpdateSchema = z.object({
  primaryColor: hexColorSchema.optional(),
  secondaryColor: hexColorSchema.optional(),
  logoUrl: z.string().url().optional(),
  faviconUrl: z.string().url().optional(),
  brandName: z.string().max(100).optional(),
  mode: z.enum(['light', 'dark', 'system']).optional(),
});

export type QuickThemeUpdateDTO = z.infer<typeof QuickThemeUpdateSchema>;
