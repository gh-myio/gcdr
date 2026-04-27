#!/usr/bin/env bash
#
# Download MYIO device icons from dashboard.myio-bas.com and upload them
# to GCDR FileAssets API with stable public slugs.
#
# After this runs, every icon is reachable via a brand-friendly URL like:
#
#   https://gcdr-api.a.myio-bas.com/api/v1/public/files/by-slug/device-icons/escada-rolante?redirect=true
#
# Idempotent — re-running checks if the slug is already taken and skips
# duplicate uploads.
#
# Prerequisites:
#   - curl
#   - jq
#   - The migration 0023_file_assets_public_slug.sql applied in prod
#   - The /api/v1/public/files router mounted (commit 8e124d9 onward)
#
# Usage:
#   API_BASE=https://gcdr-api.a.myio-bas.com \
#   TENANT=11111111-1111-1111-1111-111111111111 \
#   ./scripts/seed-myio-device-icons.sh
#
# In dev (against MinIO + local API):
#   API_BASE=http://localhost:3015 ./scripts/seed-myio-device-icons.sh

set -euo pipefail

API_BASE="${API_BASE:-https://gcdr-api.a.myio-bas.com}"
TENANT="${TENANT:-11111111-1111-1111-1111-111111111111}"
TEMP_DIR="${TEMP_DIR:-./TEMP/device-icons}"
SLUG_PREFIX="${SLUG_PREFIX:-device-icons}"

# Auth header is optional — when DISABLE_AUTH=true is on in prod, no bearer
# is needed. When the platform tightens auth, set BEARER=<token> in the env.
AUTH_HEADER=()
if [ -n "${BEARER:-}" ]; then
  AUTH_HEADER=(-H "Authorization: Bearer $BEARER")
fi

# ─── Source map: deviceProfile → public image URL ────────────────────────────
declare -A IMAGES=(
  [ESCADA_ROLANTE]="https://dashboard.myio-bas.com/api/images/public/EJ997iB2HD1AYYUHwIloyQOOszeqb2jp"
  [ELEVADOR]="https://dashboard.myio-bas.com/api/images/public/rAjOvdsYJLGah6w6BABPJSD9znIyrkJX"
  [MOTOR]="https://dashboard.myio-bas.com/api/images/public/Rge8Q3t0CP5PW8XyTn9bBK9aVP6uzSTT"
  [BOMBA_HIDRAULICA]="https://dashboard.myio-bas.com/api/images/public/rbO2wQb6iKBtX0Ec04DFDcO3Qg04EOoD"
  [BOMBA_CAG]="https://dashboard.myio-bas.com/api/images/public/rbO2wQb6iKBtX0Ec04DFDcO3Qg04EOoD"
  [BOMBA_INCENDIO]="https://dashboard.myio-bas.com/api/images/public/YJkELCk9kluQSM6QXaFINX6byQWI7vbB"
  [BOMBA]="https://dashboard.myio-bas.com/api/images/public/Rge8Q3t0CP5PW8XyTn9bBK9aVP6uzSTT"
  [3F_MEDIDOR]="https://dashboard.myio-bas.com/api/images/public/f9Ce4meybsdaAhAkUlAfy5ei3I4kcN4k"
  [RELOGIO]="https://dashboard.myio-bas.com/api/images/public/ljHZostWg0G5AfKiyM8oZixWRIIGRASB"
  [ENTRADA]="https://dashboard.myio-bas.com/api/images/public/TQHPFqiejMW6lOSVsb8Pi85WtC0QKOLU"
  [SUBESTACAO]="https://dashboard.myio-bas.com/api/images/public/TQHPFqiejMW6lOSVsb8Pi85WtC0QKOLU"
  [FANCOIL]="https://dashboard.myio-bas.com/api/images/public/4BWMuVIFHnsfqatiV86DmTrOB7IF0X8Y"
  [CHILLER]="https://dashboard.myio-bas.com/api/images/public/27Rvy9HbNoPz8KKWPa0SBDwu4kQ827VU"
  [HIDROMETRO]="https://dashboard.myio-bas.com/api/images/public/aMQYFJbGHs9gQbQkMn6XseAlUZHanBR4"
  [HIDROMETRO_AREA_COMUM]="https://dashboard.myio-bas.com/api/images/public/IbEhjsvixAxwKg1ntGGZc5xZwwvGKv2t"
  [HIDROMETRO_SHOPPING]="https://dashboard.myio-bas.com/api/images/public/OIMmvN4ZTKYDvrpPGYY5agqMRoSaWNTI"
  [CAIXA_DAGUA]="https://dashboard.myio-bas.com/api/images/public/3t6WVhMQJFsrKA8bSZmrngDsNPkZV7fq"
  [TERMOSTATO]="https://dashboard.myio-bas.com/api/images/public/rtCcq6kZZVCD7wgJywxEurRZwR8LA7Q7"
)

# ─── Helpers ─────────────────────────────────────────────────────────────────

profile_to_slug() {
  # ESCADA_ROLANTE → escada-rolante
  # 3F_MEDIDOR     → 3f-medidor
  echo "$1" | tr '[:upper:]_' '[:lower:]-'
}

ext_from_content_type() {
  case "$1" in
    image/png)            echo "png" ;;
    image/jpeg|image/jpg) echo "jpg" ;;
    image/gif)            echo "gif" ;;
    image/webp)           echo "webp" ;;
    image/svg+xml)        echo "svg" ;;
    *)                    echo "bin" ;;
  esac
}

mkdir -p "$TEMP_DIR"

echo "▶ Seeding ${#IMAGES[@]} MYIO device icons"
echo "  API:    $API_BASE"
echo "  TENANT: $TENANT"
echo "  TEMP:   $TEMP_DIR"
echo ""

CREATED=0
SKIPPED=0
FAILED=0

for profile in "${!IMAGES[@]}"; do
  url="${IMAGES[$profile]}"
  slug_part="$(profile_to_slug "$profile")"
  slug="${SLUG_PREFIX}/${slug_part}"

  printf "▶ %-25s slug=%s ... " "$profile" "$slug"

  # Check if slug already taken (idempotent re-run)
  existing="$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "X-Tenant-Id: $TENANT" \
    "${AUTH_HEADER[@]}" \
    "${API_BASE}/api/v1/public/files/by-slug/${slug}" || echo "000")"

  if [ "$existing" = "200" ] || [ "$existing" = "302" ]; then
    echo "already present (skipping)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Download to TEMP, capturing Content-Type to choose extension
  headers_file="$(mktemp)"
  body_file="${TEMP_DIR}/${profile}"
  if ! curl -sS -D "$headers_file" -o "$body_file" "$url"; then
    echo "FAIL (download)"
    FAILED=$((FAILED + 1))
    rm -f "$headers_file"
    continue
  fi
  ctype="$(grep -i '^content-type:' "$headers_file" | tr -d '\r' | awk '{print $2}' | head -1)"
  ext="$(ext_from_content_type "${ctype:-application/octet-stream}")"
  rm -f "$headers_file"

  final_path="${body_file}.${ext}"
  mv "$body_file" "$final_path"

  # Upload via POST /api/v1/files with publicSlug
  resp="$(curl -sS -X POST "${API_BASE}/api/v1/files" \
    -H "X-Tenant-Id: $TENANT" \
    "${AUTH_HEADER[@]}" \
    -F "file=@${final_path}" \
    -F "ownerType=free" \
    -F "publicSlug=${slug}" \
    -F "metadata={\"deviceProfile\":\"${profile}\",\"sourceUrl\":\"${url}\"}" \
    -w '__HTTP_%{http_code}__')" || true

  http_code="$(echo "$resp" | grep -oE '__HTTP_[0-9]+__' | tr -dc '0-9')"
  body="$(echo "$resp" | sed 's/__HTTP_[0-9]*__$//')"

  if [ "$http_code" = "201" ]; then
    asset_id="$(echo "$body" | jq -r '.data.id // empty')"
    echo "OK (id=${asset_id:-?})"
    CREATED=$((CREATED + 1))
  elif [ "$http_code" = "409" ]; then
    echo "conflict on slug (skipping)"
    SKIPPED=$((SKIPPED + 1))
  else
    err="$(echo "$body" | jq -r '.error.message // empty' 2>/dev/null)"
    echo "FAIL HTTP=$http_code ${err:-}"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "Done. created=${CREATED} skipped=${SKIPPED} failed=${FAILED}"
echo ""
echo "Stable URLs (use ?redirect=true for direct image embedding):"
for profile in "${!IMAGES[@]}"; do
  slug_part="$(profile_to_slug "$profile")"
  slug="${SLUG_PREFIX}/${slug_part}"
  printf "  %-25s %s/api/v1/public/files/by-slug/%s?redirect=true\n" \
    "$profile" "$API_BASE" "$slug"
done
