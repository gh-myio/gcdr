-- =============================================================================
-- OPS: CREATE TENANT-WIDE API KEY for GET /devices/exists
-- =============================================================================
-- Cria uma chave em `customer_api_keys` com:
--   - hierarchy_access = 'TENANT'   (sem restrição de customer)
--   - scopes           = ["devices:read"]
--   - expira em 365 dias
--
-- O plaintext NUNCA fica salvo em arquivo nem é embutido neste script.
-- Você gera o plaintext localmente, e o script só guarda o SHA-256.
--
-- =============================================================================
-- Como rodar (PowerShell / bash):
--
--   # 1) Gere um plaintext aleatório localmente (não vai pro git)
--   PLAINTEXT="gcdr_pk_devices_check_$(openssl rand -hex 16)"
--   echo "$PLAINTEXT" > .gcdr-devices-exists-key.txt   # gitignored
--
--   # 2) Rode o script passando o plaintext via -v
--   psql "$DATABASE_URL" \
--     -v plaintext_key="'$PLAINTEXT'" \
--     -v customer_id="'33333333-3333-3333-3333-333333333333'" \
--     -v key_name="'Devices Exists Check Key'" \
--     -f scripts/db/ops/create-api-key-devices-exists.sql
--
--   # 3) Use o conteúdo de .gcdr-devices-exists-key.txt no header
--   #    X-API-Key: <plaintext>
--
-- IMPORTANTE:
--   - `customer_id` é só o "owner" do registro — a key NÃO fica restrita a esse
--     customer porque hierarchy_access='TENANT' libera o tenant inteiro.
--     Use qualquer customer válido do tenant (ex: o customer de teste).
--   - Adicione `.gcdr-devices-exists-key.txt` ao `.gitignore` antes de criar.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?plaintext_key}
\else
  \echo 'ERROR: missing -v plaintext_key=<value>'
  \quit
\endif
\if :{?customer_id}
\else
  \echo 'ERROR: missing -v customer_id=<uuid>'
  \quit
\endif
\if :{?key_name}
\else
  \set key_name '\'Devices Exists Check Key\''
\endif

-- pgcrypto provê digest() — se ainda não estiver habilitado:
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Inserção (idempotente: update se já existe um registro com o mesmo hash).
WITH plaintext AS (
    SELECT :plaintext_key::text AS v
),
hashed AS (
    SELECT
        v,
        encode(digest(v, 'sha256'), 'hex') AS h
    FROM plaintext
)
INSERT INTO customer_api_keys (
    id, tenant_id, customer_id,
    key_hash, key_prefix,
    name, description, scopes,
    expires_at, usage_count, is_active,
    hierarchy_access,
    created_by, version
)
SELECT
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    :customer_id,
    h,
    'gcdr_pk_',
    :key_name,
    'Tenant-wide API key for GET /devices/exists (devices:read scope)',
    '["devices:read"]'::jsonb,
    NOW() + INTERVAL '365 days',
    0,
    true,
    'TENANT',
    '00000000-0000-0000-0000-000000000001',
    1
FROM hashed
ON CONFLICT (key_hash) DO UPDATE
    SET
        is_active        = true,
        expires_at       = NOW() + INTERVAL '365 days',
        hierarchy_access = 'TENANT',
        scopes           = '["devices:read"]'::jsonb,
        updated_at       = NOW();

-- Verificação (não imprime o plaintext nem o hash inteiro)
SELECT
    id,
    tenant_id,
    customer_id,
    name,
    key_prefix,
    LEFT(key_hash, 12) || '…'  AS key_hash_preview,
    scopes,
    hierarchy_access,
    is_active,
    expires_at
FROM customer_api_keys
WHERE key_hash = encode(digest(:plaintext_key::text, 'sha256'), 'hex');

\echo ''
\echo '============================================================================='
\echo '  Key created/refreshed. Use the plaintext from your local file as:'
\echo '    X-API-Key: <plaintext>'
\echo '============================================================================='
