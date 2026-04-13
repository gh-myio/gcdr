#!/bin/bash
# =============================================================================
# DRY RUN — Sync alarm_config fields from Mont Serrat (master) to 5 customers
# =============================================================================
# Fields synced: value, valueHigh, operator, aggregation, duration,
#                startAt, endAt, daysOfWeek
# Description:   customer name appended at the end
#
# Matching strategy: partial name — strips known customer suffixes,
#                    normalizes whitespace, and finds best substring match
#
# This script makes NO changes. It only prints what would be updated.
# =============================================================================

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
API_KEY="gcdr_alarm_integration_key_2026"
TMPDIR="$(dirname "$0")/.dry-run-tmp"
mkdir -p "$TMPDIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# -----------------------------------------------------------------------------
# Customers
# -----------------------------------------------------------------------------
declare -A CUSTOMER_IDS=(
  ["mont-serrat"]="a4c64215-f7eb-4102-80b5-e10b98e2f94e"
  ["mestre-alvaro"]="e04046d4-baa4-44e9-a378-4dfebe4140f1"
  ["metropole-ananindeua"]="c4030d78-1cf4-4bf6-8eed-c12b4e7c281a"
  ["moxuara"]="84e0370e-636a-4741-9874-504b5e0b3577"
  ["rio-poty"]="8f9af056-10c2-4cd4-a45f-ab0c99377aca"
  ["shopping-da-ilha"]="f1fcf434-532b-428a-a5e1-0b68e8ae1056"
)

declare -A CUSTOMER_DISPLAY=(
  ["mont-serrat"]="Mont Serrat"
  ["mestre-alvaro"]="Mestre Álvaro"
  ["metropole-ananindeua"]="Metrópole Ananindeua"
  ["moxuara"]="Moxuara"
  ["rio-poty"]="Rio Poty"
  ["shopping-da-ilha"]="Shopping da Ilha"
)

TARGET_CUSTOMERS=("mestre-alvaro" "metropole-ananindeua" "moxuara" "rio-poty" "shopping-da-ilha")

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

# Normalize a rule name: lowercase, collapse spaces, remove known customer suffixes
normalize_name() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/ - mont serrat//g' \
    | sed 's/ - mestre álvaro//g' \
    | sed 's/ - metrópole ananindeua//g' \
    | sed 's/ - moxuara//g' \
    | sed 's/ - rio poty//g' \
    | sed 's/ - shopping da ilha//g' \
    | sed 's/  */ /g' \
    | sed 's/^ //;s/ $//'
}

# Fetch all rules for a customer (follows pagination up to 100)
fetch_rules() {
  local slug="$1"
  local customer_id="${CUSTOMER_IDS[$slug]}"
  local out="$TMPDIR/${slug}.json"

  curl -s "${API_URL}/api/v1/customers/${customer_id}/rules?limit=100" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Accept: application/json" \
    -o "$out"

  if ! jq -e '.success' "$out" > /dev/null 2>&1; then
    echo "ERROR fetching rules for $slug"
    cat "$out"
    exit 1
  fi
}

# -----------------------------------------------------------------------------
# Step 1 — Fetch all customers
# -----------------------------------------------------------------------------
echo -e "${BOLD}=== Step 1: Fetching rules from all customers ===${NC}"
for slug in "mont-serrat" "${TARGET_CUSTOMERS[@]}"; do
  display="${CUSTOMER_DISPLAY[$slug]}"
  fetch_rules "$slug"
  count=$(jq '.data.pagination.total' "$TMPDIR/${slug}.json")
  echo "  ✓ ${display}: ${count} rules"
done
echo ""

# -----------------------------------------------------------------------------
# Step 2 — Build comparison map
# -----------------------------------------------------------------------------
echo -e "${BOLD}=== Step 2: Comparison map (Mont Serrat master vs each customer) ===${NC}"
echo ""

MASTER_FILE="$TMPDIR/mont-serrat.json"
MASTER_COUNT=$(jq '.data.items | length' "$MASTER_FILE")

# Overall stats
TOTAL_MATCH=0
TOTAL_DIVERGE=0
TOTAL_NO_MATCH=0
TOTAL_ORPHAN=0

for target_slug in "${TARGET_CUSTOMERS[@]}"; do
  TARGET_DISPLAY="${CUSTOMER_DISPLAY[$target_slug]}"
  TARGET_FILE="$TMPDIR/${target_slug}.json"
  TARGET_COUNT=$(jq '.data.items | length' "$TARGET_FILE")

  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  ${TARGET_DISPLAY} (${TARGET_COUNT} rules)${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  MATCHED_TARGET_IDS=()

  # For each Mont Serrat rule, find best match in target
  while IFS= read -r master_rule; do
    master_id=$(echo "$master_rule" | jq -r '.id')
    master_name=$(echo "$master_rule" | jq -r '.name')
    master_norm=$(normalize_name "$master_name")

    master_value=$(echo "$master_rule"       | jq -r '.alarmConfig.value        // "null"')
    master_valueHigh=$(echo "$master_rule"   | jq -r '.alarmConfig.valueHigh    // "null"')
    master_operator=$(echo "$master_rule"    | jq -r '.alarmConfig.operator     // "null"')
    master_aggregation=$(echo "$master_rule" | jq -r '.alarmConfig.aggregation  // "null"')
    master_duration=$(echo "$master_rule"    | jq -r '.alarmConfig.duration     // "null"')
    master_startAt=$(echo "$master_rule"     | jq -r '.alarmConfig.startAt      // "null"')
    master_endAt=$(echo "$master_rule"       | jq -r '.alarmConfig.endAt        // "null"')
    master_dow=$(echo "$master_rule"         | jq -c '.alarmConfig.daysOfWeek   // "null"')
    master_desc=$(echo "$master_rule"        | jq -r '.description              // ""')

    # Find best match in target by partial name
    best_match=""
    best_score=0

    while IFS= read -r target_rule; do
      target_name=$(echo "$target_rule" | jq -r '.name')
      target_norm=$(normalize_name "$target_name")

      # Score: exact match = 100, substring match = 50
      score=0
      if [ "$master_norm" = "$target_norm" ]; then
        score=100
      elif echo "$target_norm" | grep -qF "$master_norm"; then
        score=50
      elif echo "$master_norm" | grep -qF "$target_norm"; then
        score=40
      fi

      if [ "$score" -gt "$best_score" ]; then
        best_score=$score
        best_match="$target_rule"
      fi
    done < <(jq -c '.data.items[]' "$TARGET_FILE")

    if [ "$best_score" -eq 0 ] || [ -z "$best_match" ]; then
      echo -e "  ${RED}✗ NO MATCH${NC}  \"${master_name}\""
      echo -e "           → Rule does not exist in ${TARGET_DISPLAY}"
      TOTAL_NO_MATCH=$((TOTAL_NO_MATCH+1))
      continue
    fi

    target_id=$(echo "$best_match"          | jq -r '.id')
    target_name=$(echo "$best_match"        | jq -r '.name')
    target_value=$(echo "$best_match"       | jq -r '.alarmConfig.value        // "null"')
    target_valueHigh=$(echo "$best_match"   | jq -r '.alarmConfig.valueHigh    // "null"')
    target_operator=$(echo "$best_match"    | jq -r '.alarmConfig.operator     // "null"')
    target_aggregation=$(echo "$best_match" | jq -r '.alarmConfig.aggregation  // "null"')
    target_duration=$(echo "$best_match"    | jq -r '.alarmConfig.duration     // "null"')
    target_startAt=$(echo "$best_match"     | jq -r '.alarmConfig.startAt      // "null"')
    target_endAt=$(echo "$best_match"       | jq -r '.alarmConfig.endAt        // "null"')
    target_dow=$(echo "$best_match"         | jq -c '.alarmConfig.daysOfWeek   // "null"')
    target_desc=$(echo "$best_match"        | jq -r '.description              // ""')

    MATCHED_TARGET_IDS+=("$target_id")

    # Build expected description
    expected_desc="${master_desc} — ${TARGET_DISPLAY}"

    # Detect divergences
    DIFFS=()
    [ "$master_value"       != "$target_value"       ] && DIFFS+=("value: ${target_value} → ${master_value}")
    [ "$master_valueHigh"   != "$target_valueHigh"   ] && DIFFS+=("valueHigh: ${target_valueHigh} → ${master_valueHigh}")
    [ "$master_operator"    != "$target_operator"    ] && DIFFS+=("operator: ${target_operator} → ${master_operator}")
    [ "$master_aggregation" != "$target_aggregation" ] && DIFFS+=("aggregation: ${target_aggregation} → ${master_aggregation}")
    [ "$master_duration"    != "$target_duration"    ] && DIFFS+=("duration: ${target_duration} → ${master_duration}")
    [ "$master_startAt"     != "$target_startAt"     ] && DIFFS+=("startAt: ${target_startAt} → ${master_startAt}")
    [ "$master_endAt"       != "$target_endAt"       ] && DIFFS+=("endAt: ${target_endAt} → ${master_endAt}")
    [ "$master_dow"         != "$target_dow"         ] && DIFFS+=("daysOfWeek: ${target_dow} → ${master_dow}")
    [ "$target_desc"        != "$expected_desc"      ] && DIFFS+=("description: \"${target_desc}\" → \"${expected_desc}\"")

    if [ "${#DIFFS[@]}" -eq 0 ]; then
      echo -e "  ${GREEN}✓ IN SYNC${NC}  \"${target_name}\""
      TOTAL_MATCH=$((TOTAL_MATCH+1))
    else
      echo -e "  ${YELLOW}≠ DIVERGE${NC}  Mont Serrat: \"${master_name}\""
      echo -e "             Target:     \"${target_name}\"  [${target_id}]"
      for diff in "${DIFFS[@]}"; do
        echo -e "             ${YELLOW}△${NC} ${diff}"
      done
      TOTAL_DIVERGE=$((TOTAL_DIVERGE+1))
    fi

  done < <(jq -c '.data.items[]' "$MASTER_FILE")

  # Find orphan rules in target (no match in Mont Serrat)
  while IFS= read -r target_rule; do
    target_id=$(echo "$target_rule" | jq -r '.id')
    target_name=$(echo "$target_rule" | jq -r '.name')

    is_matched=false
    for mid in "${MATCHED_TARGET_IDS[@]}"; do
      [ "$mid" = "$target_id" ] && is_matched=true && break
    done

    if [ "$is_matched" = false ]; then
      echo -e "  ${CYAN}+ ORPHAN${NC}   \"${target_name}\"  [${target_id}]"
      echo -e "             → Exists in ${TARGET_DISPLAY} but has no equivalent in Mont Serrat"
      TOTAL_ORPHAN=$((TOTAL_ORPHAN+1))
    fi
  done < <(jq -c '.data.items[]' "$TARGET_FILE")

  echo ""
done

# -----------------------------------------------------------------------------
# Step 3 — Summary
# -----------------------------------------------------------------------------
echo -e "${BOLD}=== Summary ===${NC}"
echo -e "  ${GREEN}✓ IN SYNC${NC}   ${TOTAL_MATCH}"
echo -e "  ${YELLOW}≠ DIVERGE${NC}   ${TOTAL_DIVERGE}  ← would be updated"
echo -e "  ${RED}✗ NO MATCH${NC}  ${TOTAL_NO_MATCH}  ← rule exists in Mont Serrat but not in target"
echo -e "  ${CYAN}+ ORPHAN${NC}    ${TOTAL_ORPHAN}  ← rule exists in target but not in Mont Serrat"
echo ""
echo -e "${BOLD}No changes were made. This was a dry run.${NC}"
echo -e "To apply: run ${BOLD}apply-sync-rules-from-mont-serrat.sh${NC} after reviewing this output."

# Cleanup
rm -rf "$TMPDIR"
