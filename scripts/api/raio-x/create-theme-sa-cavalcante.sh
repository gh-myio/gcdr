#!/bin/bash
# =============================================================================
# Cria o theme de Sá Cavalcante com a paleta de cores institucional
#
# Customer ID: b1000000-0000-0000-0000-000000000001
#
# Paleta (Paleta de Cores Institucional):
#   Verde Menta   #7FC1AA   (primaryLight / success)
#   Verde Mar     #2F5848   (primary)
#   Verde Floresta#1F3A35   (primaryDark)
#   Branco OffWhite #F2F2F2 (background)
#   Cinza         #828282   (textSecondary)
#   Preto         #292724   (textPrimary)
#   Laranja       #F39019   (accent / warning)
#   Marrom        #753D00   (secondary)
#
# Uso:
#   ./create-theme-sa-cavalcante.sh
#   GCDR_API_URL=http://localhost:3015 GCDR_API_KEY=gcdr_pk_dev_local ./create-theme-sa-cavalcante.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/config.env" ]] && source "$SCRIPT_DIR/config.env"

API_URL="${GCDR_API_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_myio_tenant_bundle_key_2026}"

CUSTOMER_ID="b1000000-0000-0000-0000-000000000001"

echo ""
echo "  Criando theme Sá Cavalcante..."
echo "  URL: $API_URL"
echo ""

curl -s -X POST "$API_URL/api/v1/themes" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "'"$CUSTOMER_ID"'",
    "name": "Sá Cavalcante",
    "description": "Tema institucional Sá Cavalcante — Paleta de Cores Institucional (verdes + laranja + marrom)",
    "isDefault": true,
    "mode": "light",
    "brandName": "Sá Cavalcante",
    "tagline": "Trazemos a humanidade e os negócios como proposta visual.",

    "colors": {
      "primary":          "#2F5848",
      "primaryLight":     "#7FC1AA",
      "primaryDark":      "#1F3A35",
      "secondary":        "#753D00",
      "secondaryLight":   "#F39019",
      "secondaryDark":    "#4A2700",
      "accent":           "#F39019",
      "background":       "#F2F2F2",
      "surface":          "#FFFFFF",
      "error":            "#D32F2F",
      "warning":          "#F39019",
      "success":          "#7FC1AA",
      "info":             "#2F5848",
      "textPrimary":      "#292724",
      "textSecondary":    "#828282",
      "textDisabled":     "#B0B0B0",
      "divider":          "#E0E0E0"
    },

    "logo": {
      "primaryUrl": "https://gcdr-api.a.myio-bas.com/static/logos/sa-cavalcante/logo.png"
    },

    "typography": {
      "fontFamily": "Inter, system-ui, sans-serif",
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
        "tight":   1.25,
        "normal":  1.5,
        "relaxed": 1.75
      }
    },

    "layout": {
      "sidebarPosition": "left",
      "sidebarCollapsed": false,
      "headerHeight": 64,
      "footerHeight": 0,
      "maxContentWidth": 1440,
      "borderRadius": {
        "none": "0px",
        "sm":   "4px",
        "md":   "8px",
        "lg":   "12px",
        "full": "9999px"
      },
      "spacing": {
        "xs": "4px",
        "sm": "8px",
        "md": "16px",
        "lg": "24px",
        "xl": "32px"
      }
    },

    "components": {
      "buttons": {
        "borderRadius": "6px",
        "textTransform": "none",
        "fontWeight": 600
      },
      "cards": {
        "borderRadius": "8px",
        "shadow": "0 1px 3px rgba(41,39,36,0.10)",
        "borderWidth": "1px"
      },
      "inputs": {
        "borderRadius": "6px",
        "borderWidth": "1px",
        "focusRingWidth": "2px"
      },
      "tables": {
        "headerBackground": "#1F3A35",
        "stripedRows": true,
        "hoverEffect": true,
        "borderStyle": "horizontal"
      }
    },

    "metadata": {
      "brand": "Sá Cavalcante",
      "palette": "Paleta de Cores Institucional",
      "colors": {
        "verdeMenta":    "#7FC1AA",
        "verdeMar":      "#2F5848",
        "verdeForesta":  "#1F3A35",
        "brancoOffWhite":"#F2F2F2",
        "cinza":         "#828282",
        "preto":         "#292724",
        "laranja":       "#F39019",
        "marrom":        "#753D00"
      }
    }
  }' | jq '.'
