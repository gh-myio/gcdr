import { BaseEntity } from '../../shared/types';

export interface ColorPalette {
  primary: string;
  primaryLight?: string;
  primaryDark?: string;
  secondary: string;
  secondaryLight?: string;
  secondaryDark?: string;
  accent?: string;
  background: string;
  surface: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  textPrimary: string;
  textSecondary: string;
  textDisabled?: string;
  divider?: string;
}

export interface Typography {
  fontFamily: string;
  fontFamilySecondary?: string;
  fontSize: {
    xs: string;
    sm: string;
    base: string;
    lg: string;
    xl: string;
    '2xl': string;
    '3xl': string;
  };
  fontWeight: {
    light: number;
    normal: number;
    medium: number;
    semibold: number;
    bold: number;
  };
  lineHeight: {
    tight: number;
    normal: number;
    relaxed: number;
  };
}

export interface LogoConfig {
  primaryUrl: string;
  secondaryUrl?: string;
  iconUrl?: string;
  faviconUrl?: string;
  darkModeUrl?: string;
  width?: number;
  height?: number;
}

export interface LayoutConfig {
  sidebarPosition: 'left' | 'right';
  sidebarCollapsed: boolean;
  headerHeight: number;
  footerHeight: number;
  maxContentWidth: number;
  borderRadius: {
    none: string;
    sm: string;
    md: string;
    lg: string;
    full: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
}

export interface ComponentStyles {
  buttons: {
    borderRadius: string;
    textTransform: 'none' | 'uppercase' | 'capitalize';
    fontWeight: number;
  };
  cards: {
    borderRadius: string;
    shadow: string;
    borderWidth: string;
  };
  inputs: {
    borderRadius: string;
    borderWidth: string;
    focusRingWidth: string;
  };
  tables: {
    headerBackground: string;
    stripedRows: boolean;
    hoverEffect: boolean;
    borderStyle: 'none' | 'horizontal' | 'vertical' | 'full';
  };
}

export interface CustomCSS {
  global?: string;
  header?: string;
  sidebar?: string;
  content?: string;
  footer?: string;
}

export interface LookAndFeel extends BaseEntity {
  // Owner
  customerId: string;

  // Basic Info
  name: string;
  description?: string;
  isDefault: boolean;

  // Theme Mode
  mode: 'light' | 'dark' | 'system';

  // Colors
  colors: ColorPalette;
  darkModeColors?: ColorPalette;

  // Typography
  typography: Typography;

  // Logos and Branding
  logo: LogoConfig;
  brandName?: string;
  tagline?: string;

  // Layout
  layout: LayoutConfig;

  // Component Styles
  components: ComponentStyles;

  // Custom CSS
  customCss?: CustomCSS;

  // Inheritance
  inheritFromParent: boolean;
  parentThemeId?: string;

  // Metadata
  metadata: Record<string, unknown>;
}

export function createDefaultColorPalette(): ColorPalette {
  return {
    primary: '#1976d2',
    primaryLight: '#42a5f5',
    primaryDark: '#1565c0',
    secondary: '#9c27b0',
    secondaryLight: '#ba68c8',
    secondaryDark: '#7b1fa2',
    accent: '#ff9800',
    background: '#ffffff',
    surface: '#f5f5f5',
    error: '#d32f2f',
    warning: '#ed6c02',
    success: '#2e7d32',
    info: '#0288d1',
    textPrimary: '#212121',
    textSecondary: '#757575',
    textDisabled: '#bdbdbd',
    divider: '#e0e0e0',
  };
}

export function createDefaultTypography(): Typography {
  return {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontFamilySecondary: "'Roboto Mono', monospace",
    fontSize: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
    },
    fontWeight: {
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.75,
    },
  };
}

export function createDefaultLayoutConfig(): LayoutConfig {
  return {
    sidebarPosition: 'left',
    sidebarCollapsed: false,
    headerHeight: 64,
    footerHeight: 48,
    maxContentWidth: 1440,
    borderRadius: {
      none: '0',
      sm: '0.25rem',
      md: '0.5rem',
      lg: '1rem',
      full: '9999px',
    },
    spacing: {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '1.5rem',
      xl: '2rem',
    },
  };
}

export function createDefaultComponentStyles(): ComponentStyles {
  return {
    buttons: {
      borderRadius: '0.5rem',
      textTransform: 'none',
      fontWeight: 500,
    },
    cards: {
      borderRadius: '0.75rem',
      shadow: '0 1px 3px rgba(0,0,0,0.12)',
      borderWidth: '1px',
    },
    inputs: {
      borderRadius: '0.5rem',
      borderWidth: '1px',
      focusRingWidth: '2px',
    },
    tables: {
      headerBackground: '#f5f5f5',
      stripedRows: true,
      hoverEffect: true,
      borderStyle: 'horizontal',
    },
  };
}
