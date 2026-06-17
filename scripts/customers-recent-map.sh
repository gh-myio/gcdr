#!/usr/bin/env bash
#
# customers-recent-map.sh — build a map of recently-created GCDR customers.
#
# Pages through GET /api/v1/customers, keeps the ones created within the last
# N days, sorts them newest-first, writes a JSON map to a file and prints a
# table to stdout.
#
# Auth & config come from the ENVIRONMENT (never pasted on the command line, so
# tokens don't leak into shell history / process lists). Required: a token OR
# an API key.
#
#   GCDR_TOKEN      JWT bearer token            (Authorization: Bearer ...)
#   GCDR_API_KEY    partner/customer API key    (X-API-Key: ...)   [alt to token]
#
# Optional:
#   GCDR_API_BASE   default: https://gcdr-api.a.myio-bas.com/api/v1
#   DAYS            window in days, default 7   (created within the last N days)
#   ALL            set to 1 to ignore DAYS and map every customer
#   LIMIT          page size, default 100
#   OUT            output file, default customers-recent-map.json
#
# Examples:
#   GCDR_TOKEN=eyJ... ./scripts/customers-recent-map.sh
#   GCDR_API_KEY=gcdr_pk_... DAYS=30 OUT=/tmp/new-customers.json ./scripts/customers-recent-map.sh
#   GCDR_API_BASE=http://localhost:3015/api/v1 GCDR_TOKEN=$TOKEN ALL=1 ./scripts/customers-recent-map.sh
#
set -euo pipefail

BASE="${GCDR_API_BASE:-https://gcdr-api.a.myio-bas.com/api/v1}"
LIMIT="${LIMIT:-100}"
DAYS="${DAYS:-7}"
ALL="${ALL:-0}"
OUT="${OUT:-customers-recent-map.json}"

command -v curl >/dev/null 2>&1 || { echo "ERROR: 'curl' is required." >&2; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "ERROR: 'jq' is required."   >&2; exit 1; }

# Build the auth header from the environment (kept out of argv).
auth=()
if [[ -n "${GCDR_TOKEN:-}" ]]; then
  auth=(-H "Authorization: Bearer ${GCDR_TOKEN}")
elif [[ -n "${GCDR_API_KEY:-}" ]]; then
  auth=(-H "X-API-Key: ${GCDR_API_KEY}")
else
  echo "ERROR: set GCDR_TOKEN (Bearer) or GCDR_API_KEY (X-API-Key) in the environment." >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.new" "$tmp.chunk" 2>/dev/null || true' EXIT
echo "[]" > "$tmp"

echo "Fetching customers from ${BASE} ..." >&2
page=1
while :; do
  resp="$(curl -fsS "${auth[@]}" "${BASE}/customers?page=${page}&limit=${LIMIT}")" \
    || { echo "ERROR: request failed on page ${page} (check base URL / auth)." >&2; exit 1; }

  # The list endpoint returns { success, data: { data: [...], pagination } }.
  echo "$resp" | jq -c '.data.data // .data.items // .data // []' > "$tmp.chunk"
  cnt="$(jq 'length' "$tmp.chunk")"
  [[ "$cnt" -eq 0 ]] && break

  jq -s '.[0] + .[1]' "$tmp" "$tmp.chunk" > "$tmp.new" && mv "$tmp.new" "$tmp"

  total_pages="$(echo "$resp" | jq -r '.data.pagination.totalPages // empty')"
  if [[ -n "$total_pages" && "$page" -ge "$total_pages" ]]; then break; fi
  [[ "$cnt" -lt "$LIMIT" ]] && break
  page=$((page + 1))
done

# Filter to the recently-created window, sort newest-first, project key fields.
jq --argjson days "$DAYS" --argjson all "$ALL" '
  [ .[] | {
      id, name,
      code: (.code // null),
      status,
      parentCustomerId: (.parentCustomerId // null),
      externalId: (.externalId // null),
      createdAt
    } ]
  | map(select(
      ($all == 1)
      or (((.createdAt[0:19] + "Z") | fromdateiso8601) >= (now - ($days * 86400)))
    ))
  | sort_by(.createdAt) | reverse
' "$tmp" > "$OUT"

count="$(jq 'length' "$OUT")"
total="$(jq 'length' "$tmp")"

if [[ "$ALL" == "1" ]]; then
  echo "Mapeados ${count} customers (todos) → ${OUT}" >&2
else
  echo "Mapeados ${count} de ${total} customers criados nos últimos ${DAYS} dia(s) → ${OUT}" >&2
fi
echo >&2
printf '%-20s  %-10s  %-9s  %-7s  %s\n' "CRIADO EM (UTC)" "ID" "CODE" "STATUS" "NOME" >&2
jq -r '.[] | [ (.createdAt[0:19]), (.id[0:8] + "…"), (.code // "-"), .status, .name ] | @tsv' "$OUT" \
  | while IFS=$'\t' read -r created id code status name; do
      printf '%-20s  %-10s  %-9s  %-7s  %s\n' "$created" "$id" "$code" "$status" "$name"
    done
