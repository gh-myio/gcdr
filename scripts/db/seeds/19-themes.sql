-- =============================================================================
-- SEED: THEMES (Look and Feels - extended)
-- =============================================================================
-- Temas realistas para os customers do seed:
--   • MYIO Platform   — holding (22222222…) — tema base da plataforma
--   • Dimension       — 77777777…           — engenharia, laranja
--   • ACME Industrial — 44444444…           — manufatura, aço/cinza
--   • ACME Tech SP    — 55555555…           — branch, herda de company1
-- =============================================================================

DO $$
DECLARE
    v_tenant_id      UUID := '11111111-1111-1111-1111-111111111111';
    v_holding_id     UUID := '22222222-2222-2222-2222-222222222222';
    v_company2_id    UUID := '44444444-4444-4444-4444-444444444444';
    v_branch1_id     UUID := '55555555-5555-5555-5555-555555555555';
    v_dimension_id   UUID := '77777777-7777-7777-7777-777777777777';

    -- IDs dos temas pai (já inseridos em 12-look-and-feels.sql)
    v_acme_light_id  UUID := 'faf00001-0001-0001-0001-000000000001';
    v_acme_tech_id   UUID := 'faf00001-0001-0001-0001-000000000002';
BEGIN

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
    ) VALUES (
        'b1e70001-0001-0001-0001-000000000001',
        v_tenant_id,
        v_holding_id,
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
    );

    -- =========================================================================
    -- 2. Dimension — tema engenharia (laranja estrutural + cinza escuro)
    -- =========================================================================
    INSERT INTO look_and_feels (
        id, tenant_id, customer_id, name, description,
        is_default, mode,
        colors, dark_mode_colors,
        typography, logo, brand_name, tagline,
        layout, components,
        inherit_from_parent, parent_theme_id, metadata, version
    ) VALUES (
        'b1e70001-0001-0001-0001-000000000002',
        v_tenant_id,
        v_dimension_id,
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
        true,
        v_acme_light_id,
        '{"industry": "engineering", "segment": "industrial-iot"}',
        1
    );

    -- =========================================================================
    -- 3. ACME Industrial — manufatura (aço, azul industrial)
    -- =========================================================================
    INSERT INTO look_and_feels (
        id, tenant_id, customer_id, name, description,
        is_default, mode,
        colors,
        typography, logo, brand_name, tagline,
        layout, components,
        inherit_from_parent, parent_theme_id, metadata, version
    ) VALUES (
        'b1e70001-0001-0001-0001-000000000003',
        v_tenant_id,
        v_company2_id,
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
        v_acme_light_id,
        '{"industry": "manufacturing", "erp": "SAP"}',
        1
    );

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
    ) VALUES (
        'b1e70001-0001-0001-0001-000000000004',
        v_tenant_id,
        v_branch1_id,
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
        v_acme_tech_id,
        '{"branch": "SP", "region": "sudeste"}',
        1
    );

    RAISE NOTICE 'Inserted 4 themes (look_and_feels)';
END $$;

-- Verificar todos os temas
SELECT
    lf.name           AS theme,
    c.name            AS customer,
    lf.mode,
    lf.is_default,
    lf.inherit_from_parent,
    parent.name       AS parent_theme
FROM look_and_feels lf
LEFT JOIN customers   c      ON c.id = lf.customer_id
LEFT JOIN look_and_feels parent ON parent.id = lf.parent_theme_id
ORDER BY c.name, lf.is_default DESC;
