-- =============================================================================
-- SEED: THEMES (Look and Feels - extended)
-- =============================================================================
-- Temas realistas para os customers do seed:
--   • MYIO Platform   — holding (22222222…) — tema base da plataforma
--   • Dimension       — 77777777…           — engenharia, laranja
--   • ACME Industrial — 44444444…           — manufatura, aço/cinza
--   • ACME Tech SP    — 55555555…           — branch, herda de company1
--   • Mestre Álvaro   — e04046d4…           — gestão predial, azul+dourado
--   • Mont Serrat     — a4c64215…           — hospitalidade, verde+terracota
--   • Moxuara         — 84e0370e…           — industrial/portuário, cinza+laranja
--
-- NOTE: Cada INSERT usa SELECT ... WHERE EXISTS para ser condicional e
-- compatível com seed runners que dividem SQL em semicolons.
-- =============================================================================

-- =========================================================================
-- 1. MYIO Platform — tema padrão da plataforma (holding), modo light
--    Azul profundo MYIO + cyan accent
-- =========================================================================
INSERT INTO look_and_feels (
    id, tenant_id, customer_id, name, description,
    is_default, mode,
    colors, dark_mode_colors,
    typography, logo, brand_name, tagline,
    layout, components,
    inherit_from_parent, metadata, version
)
SELECT
    'b1e70001-0001-0001-0001-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'MYIO Platform',
    'Tema oficial da plataforma MYIO — azul profundo com accent cyan',
    false,
    'light',
    '{
        "primary":         "#0D47A1",
        "primaryLight":    "#1565C0",
        "primaryDark":     "#0A3070",
        "secondary":       "#00B8D4",
        "secondaryLight":  "#4DD8E8",
        "secondaryDark":   "#007C8E",
        "accent":          "#FF6F00",
        "background":      "#F5F7FA",
        "surface":         "#FFFFFF",
        "surfaceVariant":  "#EFF3FB",
        "error":           "#C62828",
        "warning":         "#E65100",
        "success":         "#2E7D32",
        "info":            "#0277BD",
        "textPrimary":     "#1A1F36",
        "textSecondary":   "#4A5568",
        "textDisabled":    "#A0AEC0",
        "divider":         "#E2E8F0",
        "border":          "#CBD5E0"
    }',
    '{
        "primary":         "#90CAF9",
        "primaryLight":    "#BBDEFB",
        "primaryDark":     "#64B5F6",
        "secondary":       "#80DEEA",
        "accent":          "#FFB74D",
        "background":      "#0F1117",
        "surface":         "#1A1D27",
        "surfaceVariant":  "#22263A",
        "error":           "#EF5350",
        "warning":         "#FFB74D",
        "success":         "#66BB6A",
        "info":            "#42A5F5",
        "textPrimary":     "#F7FAFC",
        "textSecondary":   "#A0AEC0",
        "textDisabled":    "#4A5568",
        "divider":         "#2D3748"
    }',
    '{
        "fontFamily":          "Inter, system-ui, sans-serif",
        "fontFamilySecondary": "JetBrains Mono, monospace",
        "fontSize": {
            "xs":   "0.75rem",
            "sm":   "0.875rem",
            "base": "1rem",
            "lg":   "1.125rem",
            "xl":   "1.25rem",
            "2xl":  "1.5rem",
            "3xl":  "1.875rem",
            "4xl":  "2.25rem"
        },
        "fontWeight": {
            "light":    300,
            "normal":   400,
            "medium":   500,
            "semibold": 600,
            "bold":     700
        },
        "lineHeight": {
            "tight":   1.25,
            "normal":  1.5,
            "relaxed": 1.75
        }
    }',
    '{
        "primaryUrl":  "https://myio.com.br/assets/logo.svg",
        "iconUrl":     "https://myio.com.br/assets/icon.svg",
        "faviconUrl":  "https://myio.com.br/favicon.ico",
        "darkLogoUrl": "https://myio.com.br/assets/logo-dark.svg",
        "width":  160,
        "height":  36
    }',
    'MYIO',
    'Plataforma de Gestão IoT',
    '{
        "sidebarPosition":  "left",
        "sidebarCollapsed": false,
        "sidebarWidth":     260,
        "headerHeight":     64,
        "footerHeight":     44,
        "maxContentWidth":  1440,
        "borderRadius": {
            "none": "0",
            "sm":   "0.25rem",
            "md":   "0.5rem",
            "lg":   "0.75rem",
            "xl":   "1rem",
            "full": "9999px"
        },
        "spacing": {
            "xs":  "0.25rem",
            "sm":  "0.5rem",
            "md":  "1rem",
            "lg":  "1.5rem",
            "xl":  "2rem",
            "2xl": "3rem"
        }
    }',
    '{
        "buttons": {
            "borderRadius":  "0.5rem",
            "textTransform": "none",
            "fontWeight":    600,
            "shadow":        "0 1px 3px rgba(13,71,161,0.3)"
        },
        "cards": {
            "borderRadius": "0.75rem",
            "shadow":       "0 2px 8px rgba(0,0,0,0.08)",
            "borderWidth":  "1px",
            "borderColor":  "#E2E8F0"
        },
        "inputs": {
            "borderRadius":   "0.5rem",
            "borderWidth":    "1px",
            "focusRingWidth": "2px",
            "focusRingColor": "#0D47A1"
        },
        "tables": {
            "headerBackground": "#EFF3FB",
            "stripedRows":      true,
            "hoverEffect":      true,
            "borderStyle":      "horizontal"
        },
        "charts": {
            "palette": ["#0D47A1","#00B8D4","#FF6F00","#2E7D32","#6A1B9A","#C62828"]
        },
        "badges": {
            "borderRadius": "9999px",
            "fontWeight":   600,
            "fontSize":     "0.75rem"
        }
    }',
    false,
    '{"platform": "myio", "version": "2026"}',
    1
WHERE EXISTS (SELECT 1 FROM customers WHERE id = '22222222-2222-2222-2222-222222222222')
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 2. Dimension — tema engenharia (laranja estrutural + cinza escuro)
-- =========================================================================
INSERT INTO look_and_feels (
    id, tenant_id, customer_id, name, description,
    is_default, mode,
    colors, dark_mode_colors,
    typography, logo, brand_name, tagline,
    layout, components,
    inherit_from_parent, metadata, version
)
SELECT
    'b1e70001-0001-0001-0001-000000000002',
    '11111111-1111-1111-1111-111111111111',
    '77777777-7777-7777-7777-777777777777',
    'Dimension Engenharia',
    'Tema oficial Dimension — laranja estrutural com cinza técnico',
    true,
    'light',
    '{
        "primary":         "#E65100",
        "primaryLight":    "#FF6D00",
        "primaryDark":     "#BF360C",
        "secondary":       "#37474F",
        "secondaryLight":  "#546E7A",
        "secondaryDark":   "#263238",
        "accent":          "#FFC107",
        "background":      "#FAFAFA",
        "surface":         "#FFFFFF",
        "surfaceVariant":  "#FFF3E0",
        "error":           "#D32F2F",
        "warning":         "#F57F17",
        "success":         "#1B5E20",
        "info":            "#01579B",
        "textPrimary":     "#1C1C1C",
        "textSecondary":   "#546E7A",
        "textDisabled":    "#B0BEC5",
        "divider":         "#ECEFF1",
        "border":          "#CFD8DC"
    }',
    '{
        "primary":         "#FF6D00",
        "primaryLight":    "#FF9100",
        "primaryDark":     "#E65100",
        "secondary":       "#90A4AE",
        "accent":          "#FFD54F",
        "background":      "#121212",
        "surface":         "#1D1D1D",
        "surfaceVariant":  "#2C2316",
        "error":           "#EF5350",
        "warning":         "#FFB300",
        "success":         "#4CAF50",
        "info":            "#29B6F6",
        "textPrimary":     "#FFFFFF",
        "textSecondary":   "#90A4AE",
        "textDisabled":    "#546E7A",
        "divider":         "#2D3748"
    }',
    '{
        "fontFamily":          "Roboto, sans-serif",
        "fontFamilySecondary": "Roboto Mono, monospace",
        "fontSize": {
            "xs":   "0.75rem",
            "sm":   "0.875rem",
            "base": "1rem",
            "lg":   "1.125rem",
            "xl":   "1.25rem",
            "2xl":  "1.5rem",
            "3xl":  "1.875rem"
        },
        "fontWeight": {
            "light":    300,
            "normal":   400,
            "medium":   500,
            "semibold": 600,
            "bold":     700
        },
        "lineHeight": {
            "tight":   1.25,
            "normal":  1.5,
            "relaxed": 1.625
        }
    }',
    '{
        "primaryUrl":  "https://dimension.com.br/logo.svg",
        "iconUrl":     "https://dimension.com.br/icon.svg",
        "faviconUrl":  "https://dimension.com.br/favicon.ico",
        "width":  180,
        "height":  42
    }',
    'Dimension',
    'Engenharia de Alta Performance',
    '{
        "sidebarPosition":  "left",
        "sidebarCollapsed": false,
        "sidebarWidth":     240,
        "headerHeight":     60,
        "footerHeight":     40,
        "maxContentWidth":  1400,
        "borderRadius": {
            "none": "0",
            "sm":   "0.125rem",
            "md":   "0.375rem",
            "lg":   "0.5rem",
            "xl":   "0.75rem",
            "full": "9999px"
        }
    }',
    '{
        "buttons": {
            "borderRadius":  "0.375rem",
            "textTransform": "none",
            "fontWeight":    700
        },
        "cards": {
            "borderRadius":  "0.5rem",
            "shadow":        "0 1px 4px rgba(0,0,0,0.1)",
            "borderWidth":   "1px",
            "borderColor":   "#CFD8DC",
            "accentBorder":  "3px solid #E65100"
        },
        "inputs": {
            "borderRadius":   "0.375rem",
            "borderWidth":    "1px",
            "focusRingWidth": "2px",
            "focusRingColor": "#E65100"
        },
        "tables": {
            "headerBackground": "#FFF3E0",
            "stripedRows":      false,
            "hoverEffect":      true,
            "borderStyle":      "all"
        },
        "charts": {
            "palette": ["#E65100","#37474F","#FFC107","#1B5E20","#01579B","#880E4F"]
        }
    }',
    false,
    '{"industry": "engineering", "segment": "industrial-iot"}',
    1
WHERE EXISTS (SELECT 1 FROM customers WHERE id = '77777777-7777-7777-7777-777777777777')
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 3. ACME Industrial — manufatura (aço, azul industrial)
-- =========================================================================
INSERT INTO look_and_feels (
    id, tenant_id, customer_id, name, description,
    is_default, mode,
    colors,
    typography, logo, brand_name, tagline,
    layout, components,
    inherit_from_parent, metadata, version
)
SELECT
    'b1e70001-0001-0001-0001-000000000003',
    '11111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444444',
    'ACME Industrial',
    'Tema para operações industriais — aço, eficiência e robustez',
    true,
    'light',
    '{
        "primary":         "#1565C0",
        "primaryLight":    "#1976D2",
        "primaryDark":     "#0D47A1",
        "secondary":       "#455A64",
        "secondaryLight":  "#607D8B",
        "secondaryDark":   "#263238",
        "accent":          "#F57C00",
        "background":      "#F4F6F9",
        "surface":         "#FFFFFF",
        "surfaceVariant":  "#ECEFF1",
        "error":           "#B71C1C",
        "warning":         "#E65100",
        "success":         "#1B5E20",
        "info":            "#0277BD",
        "textPrimary":     "#1A202C",
        "textSecondary":   "#455A64",
        "textDisabled":    "#90A4AE",
        "divider":         "#ECEFF1",
        "border":          "#B0BEC5"
    }',
    '{
        "fontFamily":          "Roboto, sans-serif",
        "fontFamilySecondary": "Roboto Condensed, sans-serif",
        "fontSize": {
            "xs":   "0.75rem",
            "sm":   "0.875rem",
            "base": "1rem",
            "lg":   "1.125rem",
            "xl":   "1.25rem",
            "2xl":  "1.5rem",
            "3xl":  "1.875rem"
        },
        "fontWeight": {
            "normal":   400,
            "medium":   500,
            "semibold": 600,
            "bold":     700
        }
    }',
    '{
        "primaryUrl": "https://acme-ind.com/logo.png",
        "iconUrl":    "https://acme-ind.com/icon.png",
        "width":  200,
        "height":  44
    }',
    'ACME Industrial',
    'Excelência na Manufatura',
    '{
        "sidebarPosition":  "left",
        "sidebarCollapsed": true,
        "sidebarWidth":     260,
        "headerHeight":     56,
        "maxContentWidth":  1600,
        "borderRadius": {
            "none": "0",
            "sm":   "0.125rem",
            "md":   "0.25rem",
            "lg":   "0.5rem",
            "full": "9999px"
        }
    }',
    '{
        "buttons": {
            "borderRadius":  "0.25rem",
            "textTransform": "uppercase",
            "fontWeight":    700,
            "letterSpacing": "0.05em"
        },
        "cards": {
            "borderRadius": "0.25rem",
            "shadow":       "none",
            "borderWidth":  "1px",
            "borderColor":  "#B0BEC5"
        },
        "inputs": {
            "borderRadius":   "0.25rem",
            "borderWidth":    "2px",
            "focusRingWidth": "0"
        },
        "tables": {
            "headerBackground": "#ECEFF1",
            "stripedRows":      true,
            "hoverEffect":      false,
            "borderStyle":      "all",
            "compact":          true
        },
        "charts": {
            "palette": ["#1565C0","#455A64","#F57C00","#1B5E20","#B71C1C","#6A1B9A"]
        }
    }',
    true,
    '{"industry": "manufacturing", "erp": "SAP"}',
    1
WHERE EXISTS (SELECT 1 FROM customers WHERE id = '44444444-4444-4444-4444-444444444444')
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 4. ACME Tech SP (branch) — herda do tema ACME Tech, sobrescreve logo/tagline
-- =========================================================================
INSERT INTO look_and_feels (
    id, tenant_id, customer_id, name, description,
    is_default, mode,
    colors,
    typography, logo, brand_name, tagline,
    layout, components,
    inherit_from_parent, parent_theme_id, metadata, version
)
SELECT
    'b1e70001-0001-0001-0001-000000000004',
    '11111111-1111-1111-1111-111111111111',
    '55555555-5555-5555-5555-555555555555',
    'ACME Tech SP',
    'Tema para filial São Paulo — herda ACME Tech com identidade local',
    true,
    'light',
    '{
        "primary":         "#00BCD4",
        "primaryLight":    "#4DD0E1",
        "primaryDark":     "#00ACC1",
        "secondary":       "#FF4081",
        "accent":          "#64DD17",
        "background":      "#FAFAFA",
        "surface":         "#FFFFFF",
        "error":           "#F44336",
        "warning":         "#FF9800",
        "success":         "#4CAF50",
        "info":            "#2196F3",
        "textPrimary":     "#263238",
        "textSecondary":   "#607D8B",
        "textDisabled":    "#90A4AE",
        "divider":         "#ECEFF1"
    }',
    '{
        "fontFamily": "Inter, sans-serif",
        "fontFamilySecondary": "Fira Code, monospace"
    }',
    '{
        "primaryUrl": "https://acmetech.com/sp/logo.png",
        "iconUrl":    "https://acmetech.com/icon.png",
        "width":  160,
        "height":  36
    }',
    'ACME Tech SP',
    'Inovação no Coração de São Paulo',
    '{
        "sidebarPosition":  "left",
        "sidebarCollapsed": false,
        "headerHeight":     60,
        "maxContentWidth":  1400
    }',
    '{
        "buttons": {
            "borderRadius":  "0.5rem",
            "textTransform": "none",
            "fontWeight":    600
        },
        "cards": {
            "borderRadius": "0.75rem",
            "shadow":       "0 2px 8px rgba(0,188,212,0.15)"
        },
        "charts": {
            "palette": ["#00BCD4","#FF4081","#64DD17","#2196F3","#FF9800","#9C27B0"]
        }
    }',
    true,
    -- parent_theme_id: reference only if the parent theme exists
    (SELECT id FROM look_and_feels WHERE id = 'faf00001-0001-0001-0001-000000000002'),
    '{"branch": "SP", "region": "sudeste"}',
    1
WHERE EXISTS (SELECT 1 FROM customers WHERE id = '55555555-5555-5555-5555-555555555555')
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 5. Mestre Álvaro — gestão de edifícios (azul corporativo + dourado)
-- =========================================================================
INSERT INTO look_and_feels (
    id, tenant_id, customer_id, name, description,
    is_default, mode,
    colors, dark_mode_colors,
    typography, logo, brand_name, tagline,
    layout, components,
    inherit_from_parent, metadata, version
)
SELECT
    'b1e70001-0001-0001-0001-000000000005',
    '11111111-1111-1111-1111-111111111111',
    'e04046d4-baa4-44e9-a378-4dfebe4140f1',
    'Mestre Álvaro',
    'Tema corporativo Mestre Álvaro — azul profissional com acento dourado',
    true,
    'light',
    '{
        "primary":         "#1A3A5C",
        "primaryLight":    "#245180",
        "primaryDark":     "#102438",
        "secondary":       "#C9A84C",
        "secondaryLight":  "#DFC077",
        "secondaryDark":   "#A07830",
        "accent":          "#E8B84B",
        "background":      "#F5F6F8",
        "surface":         "#FFFFFF",
        "surfaceVariant":  "#EEF1F6",
        "error":           "#C62828",
        "warning":         "#E65100",
        "success":         "#2E7D32",
        "info":            "#0277BD",
        "textPrimary":     "#1A1F36",
        "textSecondary":   "#4A5568",
        "textDisabled":    "#A0AEC0",
        "divider":         "#DDE2EC",
        "border":          "#C8D0DE"
    }',
    '{
        "primary":         "#5B8DB8",
        "primaryLight":    "#7AAACF",
        "primaryDark":     "#3D6F99",
        "secondary":       "#DFC077",
        "accent":          "#F0CC6A",
        "background":      "#0F1520",
        "surface":         "#182030",
        "surfaceVariant":  "#1F2D42",
        "error":           "#EF5350",
        "warning":         "#FFB74D",
        "success":         "#66BB6A",
        "info":            "#42A5F5",
        "textPrimary":     "#EDF2F7",
        "textSecondary":   "#94A3B8",
        "textDisabled":    "#4A5568",
        "divider":         "#2D3748"
    }',
    '{
        "fontFamily":          "Inter, system-ui, sans-serif",
        "fontFamilySecondary": "Georgia, serif",
        "fontSize": {
            "xs":   "0.75rem",
            "sm":   "0.875rem",
            "base": "1rem",
            "lg":   "1.125rem",
            "xl":   "1.25rem",
            "2xl":  "1.5rem",
            "3xl":  "1.875rem"
        },
        "fontWeight": {
            "light":    300,
            "normal":   400,
            "medium":   500,
            "semibold": 600,
            "bold":     700
        },
        "lineHeight": {
            "tight":   1.25,
            "normal":  1.5,
            "relaxed": 1.75
        }
    }',
    '{
        "primaryUrl":  "https://mestrealvaro.com.br/assets/logo.svg",
        "iconUrl":     "https://mestrealvaro.com.br/assets/icon.svg",
        "faviconUrl":  "https://mestrealvaro.com.br/favicon.ico",
        "width":  180,
        "height":  44
    }',
    'Mestre Álvaro',
    'Gestão Predial Inteligente',
    '{
        "sidebarPosition":  "left",
        "sidebarCollapsed": false,
        "sidebarWidth":     256,
        "headerHeight":     64,
        "footerHeight":     44,
        "maxContentWidth":  1440,
        "borderRadius": {
            "none": "0",
            "sm":   "0.25rem",
            "md":   "0.5rem",
            "lg":   "0.75rem",
            "xl":   "1rem",
            "full": "9999px"
        }
    }',
    '{
        "buttons": {
            "borderRadius":  "0.5rem",
            "textTransform": "none",
            "fontWeight":    600,
            "shadow":        "0 1px 3px rgba(26,58,92,0.3)"
        },
        "cards": {
            "borderRadius":  "0.75rem",
            "shadow":        "0 2px 8px rgba(0,0,0,0.08)",
            "borderWidth":   "1px",
            "borderColor":   "#DDE2EC",
            "accentBorder":  "3px solid #C9A84C"
        },
        "inputs": {
            "borderRadius":   "0.5rem",
            "borderWidth":    "1px",
            "focusRingWidth": "2px",
            "focusRingColor": "#1A3A5C"
        },
        "tables": {
            "headerBackground": "#EEF1F6",
            "stripedRows":      true,
            "hoverEffect":      true,
            "borderStyle":      "horizontal"
        },
        "charts": {
            "palette": ["#1A3A5C","#C9A84C","#245180","#2E7D32","#C62828","#7B5EA7"]
        },
        "badges": {
            "borderRadius": "9999px",
            "fontWeight":   600,
            "fontSize":     "0.75rem"
        }
    }',
    false,
    '{"industry": "building-management", "segment": "facilities"}',
    1
WHERE EXISTS (SELECT 1 FROM customers WHERE id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1')
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 6. Mont Serrat — hospitalidade / condomínio (verde sereno + terracota)
-- =========================================================================
INSERT INTO look_and_feels (
    id, tenant_id, customer_id, name, description,
    is_default, mode,
    colors, dark_mode_colors,
    typography, logo, brand_name, tagline,
    layout, components,
    inherit_from_parent, metadata, version
)
SELECT
    'b1e70001-0001-0001-0001-000000000006',
    '11111111-1111-1111-1111-111111111111',
    'a4c64215-f7eb-4102-80b5-e10b98e2f94e',
    'Mont Serrat',
    'Tema Mont Serrat — verde sereno com terracota, identidade de hospitalidade',
    true,
    'light',
    '{
        "primary":         "#2D6A4F",
        "primaryLight":    "#3D8A66",
        "primaryDark":     "#1B4D37",
        "secondary":       "#BC6C25",
        "secondaryLight":  "#D4845C",
        "secondaryDark":   "#8B4A13",
        "accent":          "#E9C46A",
        "background":      "#F8F5F0",
        "surface":         "#FFFFFF",
        "surfaceVariant":  "#EDF5EF",
        "error":           "#C62828",
        "warning":         "#D4580C",
        "success":         "#1B5E20",
        "info":            "#01579B",
        "textPrimary":     "#1C2B22",
        "textSecondary":   "#4A6358",
        "textDisabled":    "#9DB5A7",
        "divider":         "#DDE8E2",
        "border":          "#C8D8CC"
    }',
    '{
        "primary":         "#52B788",
        "primaryLight":    "#74C69D",
        "primaryDark":     "#40916C",
        "secondary":       "#E07A5F",
        "accent":          "#F2CC60",
        "background":      "#0F1A13",
        "surface":         "#162019",
        "surfaceVariant":  "#1E2E23",
        "error":           "#EF5350",
        "warning":         "#FF8A65",
        "success":         "#66BB6A",
        "info":            "#42A5F5",
        "textPrimary":     "#E8F5E9",
        "textSecondary":   "#95B8A3",
        "textDisabled":    "#4A6358",
        "divider":         "#2D3D32"
    }',
    '{
        "fontFamily":          "Merriweather, Georgia, serif",
        "fontFamilySecondary": "Inter, sans-serif",
        "fontSize": {
            "xs":   "0.75rem",
            "sm":   "0.875rem",
            "base": "1rem",
            "lg":   "1.125rem",
            "xl":   "1.25rem",
            "2xl":  "1.5rem",
            "3xl":  "1.875rem"
        },
        "fontWeight": {
            "light":    300,
            "normal":   400,
            "medium":   500,
            "semibold": 600,
            "bold":     700
        },
        "lineHeight": {
            "tight":   1.3,
            "normal":  1.6,
            "relaxed": 1.8
        }
    }',
    '{
        "primaryUrl":  "https://montserrat.com.br/assets/logo.svg",
        "iconUrl":     "https://montserrat.com.br/assets/icon.svg",
        "faviconUrl":  "https://montserrat.com.br/favicon.ico",
        "width":  170,
        "height":  48
    }',
    'Mont Serrat',
    'Bem-viver com Inteligência',
    '{
        "sidebarPosition":  "left",
        "sidebarCollapsed": false,
        "sidebarWidth":     260,
        "headerHeight":     68,
        "footerHeight":     44,
        "maxContentWidth":  1380,
        "borderRadius": {
            "none": "0",
            "sm":   "0.375rem",
            "md":   "0.625rem",
            "lg":   "1rem",
            "xl":   "1.5rem",
            "full": "9999px"
        }
    }',
    '{
        "buttons": {
            "borderRadius":  "0.625rem",
            "textTransform": "none",
            "fontWeight":    600,
            "shadow":        "0 2px 6px rgba(45,106,79,0.25)"
        },
        "cards": {
            "borderRadius":  "1rem",
            "shadow":        "0 4px 12px rgba(0,0,0,0.07)",
            "borderWidth":   "1px",
            "borderColor":   "#DDE8E2",
            "accentBorder":  "3px solid #2D6A4F"
        },
        "inputs": {
            "borderRadius":   "0.625rem",
            "borderWidth":    "1px",
            "focusRingWidth": "2px",
            "focusRingColor": "#2D6A4F"
        },
        "tables": {
            "headerBackground": "#EDF5EF",
            "stripedRows":      true,
            "hoverEffect":      true,
            "borderStyle":      "horizontal"
        },
        "charts": {
            "palette": ["#2D6A4F","#BC6C25","#E9C46A","#52B788","#C62828","#6A4F7B"]
        },
        "badges": {
            "borderRadius": "9999px",
            "fontWeight":   600,
            "fontSize":     "0.75rem"
        }
    }',
    false,
    '{"industry": "hospitality", "segment": "condominium"}',
    1
WHERE EXISTS (SELECT 1 FROM customers WHERE id = 'a4c64215-f7eb-4102-80b5-e10b98e2f94e')
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 7. Moxuara — industrial/portuário (cinza aço + laranja de segurança)
-- =========================================================================
INSERT INTO look_and_feels (
    id, tenant_id, customer_id, name, description,
    is_default, mode,
    colors, dark_mode_colors,
    typography, logo, brand_name, tagline,
    layout, components,
    inherit_from_parent, metadata, version
)
SELECT
    'b1e70001-0001-0001-0001-000000000007',
    '11111111-1111-1111-1111-111111111111',
    '84e0370e-636a-4741-9874-504b5e0b3577',
    'Moxuara',
    'Tema Moxuara — cinza industrial com laranja de segurança, robustez operacional',
    true,
    'light',
    '{
        "primary":         "#374151",
        "primaryLight":    "#4B5563",
        "primaryDark":     "#1F2937",
        "secondary":       "#EA580C",
        "secondaryLight":  "#F97316",
        "secondaryDark":   "#C2410C",
        "accent":          "#F59E0B",
        "background":      "#F3F4F6",
        "surface":         "#FFFFFF",
        "surfaceVariant":  "#E5E7EB",
        "error":           "#DC2626",
        "warning":         "#D97706",
        "success":         "#16A34A",
        "info":            "#0284C7",
        "textPrimary":     "#111827",
        "textSecondary":   "#374151",
        "textDisabled":    "#9CA3AF",
        "divider":         "#D1D5DB",
        "border":          "#9CA3AF"
    }',
    '{
        "primary":         "#9CA3AF",
        "primaryLight":    "#D1D5DB",
        "primaryDark":     "#6B7280",
        "secondary":       "#F97316",
        "accent":          "#FBBF24",
        "background":      "#111827",
        "surface":         "#1F2937",
        "surfaceVariant":  "#374151",
        "error":           "#EF4444",
        "warning":         "#F59E0B",
        "success":         "#22C55E",
        "info":            "#38BDF8",
        "textPrimary":     "#F9FAFB",
        "textSecondary":   "#D1D5DB",
        "textDisabled":    "#6B7280",
        "divider":         "#374151"
    }',
    '{
        "fontFamily":          "Roboto, system-ui, sans-serif",
        "fontFamilySecondary": "Roboto Mono, monospace",
        "fontSize": {
            "xs":   "0.75rem",
            "sm":   "0.875rem",
            "base": "1rem",
            "lg":   "1.125rem",
            "xl":   "1.25rem",
            "2xl":  "1.5rem",
            "3xl":  "1.875rem"
        },
        "fontWeight": {
            "normal":   400,
            "medium":   500,
            "semibold": 600,
            "bold":     700
        },
        "lineHeight": {
            "tight":   1.25,
            "normal":  1.5,
            "relaxed": 1.65
        }
    }',
    '{
        "primaryUrl":  "https://moxuara.com.br/assets/logo.svg",
        "iconUrl":     "https://moxuara.com.br/assets/icon.svg",
        "faviconUrl":  "https://moxuara.com.br/favicon.ico",
        "width":  160,
        "height":  40
    }',
    'Moxuara',
    'Monitoramento Industrial de Alta Confiabilidade',
    '{
        "sidebarPosition":  "left",
        "sidebarCollapsed": true,
        "sidebarWidth":     260,
        "headerHeight":     56,
        "footerHeight":     40,
        "maxContentWidth":  1600,
        "borderRadius": {
            "none": "0",
            "sm":   "0.125rem",
            "md":   "0.25rem",
            "lg":   "0.5rem",
            "xl":   "0.75rem",
            "full": "9999px"
        }
    }',
    '{
        "buttons": {
            "borderRadius":  "0.25rem",
            "textTransform": "uppercase",
            "fontWeight":    700,
            "letterSpacing": "0.05em"
        },
        "cards": {
            "borderRadius":  "0.25rem",
            "shadow":        "none",
            "borderWidth":   "1px",
            "borderColor":   "#D1D5DB",
            "accentBorder":  "3px solid #EA580C"
        },
        "inputs": {
            "borderRadius":   "0.25rem",
            "borderWidth":    "2px",
            "focusRingWidth": "0",
            "focusRingColor": "#EA580C"
        },
        "tables": {
            "headerBackground": "#E5E7EB",
            "stripedRows":      true,
            "hoverEffect":      false,
            "borderStyle":      "all",
            "compact":          true
        },
        "charts": {
            "palette": ["#374151","#EA580C","#F59E0B","#16A34A","#DC2626","#7C3AED"]
        },
        "badges": {
            "borderRadius": "0.25rem",
            "fontWeight":   700,
            "fontSize":     "0.72rem"
        }
    }',
    false,
    '{"industry": "industrial", "segment": "port-logistics", "customerId": "84e0370e-636a-4741-9874-504b5e0b3577"}',
    1
WHERE EXISTS (SELECT 1 FROM customers WHERE id = '84e0370e-636a-4741-9874-504b5e0b3577')
ON CONFLICT (id) DO NOTHING;

-- Verificar todos os temas
SELECT
    lf.name           AS theme,
    c.name            AS customer,
    lf.mode,
    lf.is_default,
    lf.inherit_from_parent,
    parent.name       AS parent_theme
FROM look_and_feels lf
LEFT JOIN customers      c      ON c.id = lf.customer_id
LEFT JOIN look_and_feels parent ON parent.id = lf.parent_theme_id
ORDER BY c.name, lf.is_default DESC;
