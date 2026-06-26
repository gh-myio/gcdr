#!/usr/bin/env bash
# =============================================================================
# seed-local-bulk.sh — aplica o seed farto de teste no Docker DB local e
# reporta contagens antes/depois. Idempotente (o .sql limpa o seed anterior).
#
# Uso:  scripts/db/ops/seed-local-bulk.sh
# Env:  DB_CONTAINER (default gcdr-db-local) · DB_NAME (db_gcdr) · DB_USER (postgres)
# =============================================================================
set -euo pipefail

CONTAINER="${DB_CONTAINER:-gcdr-db-local}"
DB="${DB_NAME:-db_gcdr}"
DBUSER="${DB_USER:-postgres}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="$HERE/seed-local-bulk.sql"

q() { docker exec -i "$CONTAINER" psql -U "$DBUSER" -d "$DB" -tAc "$1"; }

COUNTS="SELECT 'customers',count(*) FROM customers
 UNION ALL SELECT 'assets',count(*) FROM assets
 UNION ALL SELECT 'devices',count(*) FROM devices
 UNION ALL SELECT 'centrals',count(*) FROM centrals
 UNION ALL SELECT 'rules',count(*) FROM rules
 UNION ALL SELECT 'users',count(*) FROM users
 UNION ALL SELECT 'work_orders',count(*) FROM work_orders
 UNION ALL SELECT 'entities',count(*) FROM entities
 UNION ALL SELECT 'consumption_goals',count(*) FROM consumption_goals
 UNION ALL SELECT 'consumption_goal_hours',count(*) FROM consumption_goal_hours ORDER BY 1;"

echo "== container=$CONTAINER db=$DB =="
echo "== ANTES =="
docker exec -i "$CONTAINER" psql -U "$DBUSER" -d "$DB" -c "$COUNTS"

echo "== aplicando $SQL =="
docker exec -i "$CONTAINER" psql -U "$DBUSER" -d "$DB" -v ON_ERROR_STOP=1 < "$SQL"

echo "== DEPOIS =="
docker exec -i "$CONTAINER" psql -U "$DBUSER" -d "$DB" -c "$COUNTS"

echo "== amostra: shoppings criados =="
docker exec -i "$CONTAINER" psql -U "$DBUSER" -d "$DB" -c \
 "SELECT name, code, type, depth FROM customers WHERE code LIKE 'SEED-%' ORDER BY code LIMIT 6;"
