-- =============================================================================
-- SEED: LOOK AND FEELS
-- =============================================================================
-- Mock data for look_and_feels table (themes)
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_holding_id UUID := '22222222-2222-2222-2222-222222222222';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
BEGIN
    -- Default Light Theme
    INSERT INTO look_and_feels (id, tenant_id, customer_id, name, description, is_default, mode, colors, dark_mode_colors, typography, logo, brand_name, tagline, layout, components, inherit_from_parent, metadata, version)
    VALUES (
        'faf00001-0001-0001-0001-000000000001',
        v_tenant_id,
        v_holding_id,
        'ACME Default Light',
        'Default light theme for ACME Holdings',
        true,
        'light',
        '{"primary": "#1976D2", "primaryLight": "#42A5F5", "primaryDark": "#1565C0", "secondary": "#9C27B0", "secondaryLight": "#BA68C8", "secondaryDark": "#7B1FA2", "accent": "#FF5722", "background": "#FAFAFA", "surface": "#FFFFFF", "error": "#D32F2F", "warning": "#FFA000", "success": "#388E3C", "info": "#1976D2", "textPrimary": "#212121", "textSecondary": "#757575", "textDisabled": "#BDBDBD", "divider": "#E0E0E0"}',
        '{"primary": "#90CAF9", "primaryLight": "#BBDEFB", "primaryDark": "#64B5F6", "secondary": "#CE93D8", "background": "#121212", "surface": "#1E1E1E", "textPrimary": "#FFFFFF", "textSecondary": "#B0B0B0"}',
        '{"fontFamily": "Roboto, sans-serif", "fontFamilySecondary": "Open Sans, sans-serif", "fontSize": {"xs": "0.75rem", "sm": "0.875rem", "base": "1rem", "lg": "1.125rem", "xl": "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem"}, "fontWeight": {"light": 300, "normal": 400, "medium": 500, "semibold": 600, "bold": 700}, "lineHeight": {"tight": 1.25, "normal": 1.5, "relaxed": 1.75}}',
        '{"primaryUrl": "https://acmeholdings.com/logo.png", "iconUrl": "https://acmeholdings.com/icon.png", "faviconUrl": "https://acmeholdings.com/favicon.ico", "width": 180, "height": 40}',
        'ACME Holdings',
        'Innovation for a Connected Future',
        '{"sidebarPosition": "left", "sidebarCollapsed": false, "headerHeight": 64, "footerHeight": 48, "maxContentWidth": 1440, "borderRadius": {"none": "0", "sm": "0.25rem", "md": "0.5rem", "lg": "1rem", "full": "9999px"}, "spacing": {"xs": "0.25rem", "sm": "0.5rem", "md": "1rem", "lg": "1.5rem", "xl": "2rem"}}',
        '{"buttons": {"borderRadius": "0.5rem", "textTransform": "none", "fontWeight": 500}, "cards": {"borderRadius": "0.75rem", "shadow": "0 2px 8px rgba(0,0,0,0.1)", "borderWidth": "1px"}, "inputs": {"borderRadius": "0.5rem", "borderWidth": "1px", "focusRingWidth": "2px"}, "tables": {"headerBackground": "#F5F5F5", "stripedRows": true, "hoverEffect": true, "borderStyle": "horizontal"}}',
        false,
        '{"createdFrom": "template:default-light"}',
        1
    );

    -- Company 1 Custom Theme
    INSERT INTO look_and_feels (id, tenant_id, customer_id, name, description, is_default, mode, colors, typography, logo, brand_name, tagline, layout, components, inherit_from_parent, parent_theme_id, metadata, version)
    VALUES (
        'faf00001-0001-0001-0001-000000000002',
        v_tenant_id,
        v_company1_id,
        'ACME Tech Theme',
        'Custom theme for ACME Tech with tech-focused colors',
        true,
        'light',
        '{"primary": "#00BCD4", "primaryLight": "#4DD0E1", "primaryDark": "#00ACC1", "secondary": "#FF4081", "background": "#FAFAFA", "surface": "#FFFFFF", "error": "#F44336", "warning": "#FF9800", "success": "#4CAF50", "info": "#2196F3", "textPrimary": "#263238", "textSecondary": "#607D8B"}',
        '{"fontFamily": "Inter, sans-serif", "fontFamilySecondary": "Fira Code, monospace"}',
        '{"primaryUrl": "https://acmetech.com/logo.png", "iconUrl": "https://acmetech.com/icon.png", "width": 160, "height": 36}',
        'ACME Tech',
        'Building the Future',
        '{"sidebarPosition": "left", "sidebarCollapsed": false, "headerHeight": 60, "footerHeight": 40, "maxContentWidth": 1600}',
        '{"buttons": {"borderRadius": "0.375rem", "textTransform": "uppercase", "fontWeight": 600}}',
        true,
        'faf00001-0001-0001-0001-000000000001',
        '{"industry": "technology"}',
        1
    );

    -- Dark Theme variant
    INSERT INTO look_and_feels (id, tenant_id, customer_id, name, description, is_default, mode, colors, typography, logo, brand_name, layout, components, inherit_from_parent, metadata, version)
    VALUES (
        'faf00001-0001-0001-0001-000000000003',
        v_tenant_id,
        v_holding_id,
        'ACME Dark Mode',
        'Dark mode theme for ACME Holdings',
        false,
        'dark',
        '{"primary": "#90CAF9", "primaryLight": "#BBDEFB", "primaryDark": "#64B5F6", "secondary": "#CE93D8", "accent": "#FFAB40", "background": "#121212", "surface": "#1E1E1E", "error": "#EF5350", "warning": "#FFB74D", "success": "#66BB6A", "info": "#42A5F5", "textPrimary": "#FFFFFF", "textSecondary": "#B0B0B0", "textDisabled": "#616161", "divider": "#424242"}',
        '{"fontFamily": "Roboto, sans-serif"}',
        '{"primaryUrl": "https://acmeholdings.com/logo-dark.png", "iconUrl": "https://acmeholdings.com/icon-dark.png"}',
        'ACME Holdings',
        '{"sidebarPosition": "left", "headerHeight": 64}',
        '{"cards": {"shadow": "0 4px 12px rgba(0,0,0,0.3)"}}',
        false,
        '{"variant": "dark"}',
        1
    );

    RAISE NOTICE 'Inserted 3 look and feels';
END $$;

-- Verify
SELECT id, name, is_default, mode, customer_id FROM look_and_feels ORDER BY customer_id, is_default DESC;
