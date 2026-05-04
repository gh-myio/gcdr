-- =============================================================================
-- OPS: WIKI WRITE ACCESS DIAGNOSTIC for a single user
-- =============================================================================
-- Dado um user_id, mostra:
--   1) dados do usuário (tenant, type, customerId, partnerId)
--   2) atribuições de role ativas
--   3) policies vinculadas a essas roles
--   4) permissions wiki.* granted (allow) e bloqueados (deny)
--   5) veredito final (sim/não) para cada permission-chave do fluxo de escrita
--
-- Como rodar:
--   psql ... -v user_id="'7c3aed83-fae1-4fde-807a-876f2576a88d'" \
--            -f scripts/db/ops/check-wiki-access-for-user.sql
--
-- Ou edite a CTE `params` abaixo e rode direto.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---- Parameter (edite aqui se não passar via -v user_id=...) ----------------
\if :{?user_id}
\else
  \set user_id '\'7c3aed83-fae1-4fde-807a-876f2576a88d\''
\endif

\echo
\echo '============================================================================='
\echo '  Wiki access report — user_id =' :user_id
\echo '============================================================================='

-- =============================================================================
-- 1) Quem é o usuário
-- =============================================================================
\echo
\echo '--- (1) USER ----------------------------------------------------------------'
SELECT
    id,
    tenant_id,
    email,
    type,
    customer_id,
    partner_id,
    status,
    created_at
FROM users
WHERE id = :user_id;

-- =============================================================================
-- 2) Atribuições de role ATIVAS (sem expirar)
-- =============================================================================
\echo
\echo '--- (2) ACTIVE ROLE ASSIGNMENTS ---------------------------------------------'
SELECT
    ra.role_key,
    ra.scope,
    ra.status,
    ra.expires_at,
    ra.granted_at,
    ra.granted_by,
    ra.reason
FROM role_assignments ra
WHERE ra.user_id = :user_id
  AND ra.status  = 'active'
  AND (ra.expires_at IS NULL OR ra.expires_at > now())
ORDER BY ra.role_key, ra.scope;

-- =============================================================================
-- 3) Roles e suas policies (JSON expandido)
-- =============================================================================
\echo
\echo '--- (3) ROLES & POLICY KEYS -------------------------------------------------'
WITH ra AS (
    SELECT ra.tenant_id, ra.role_key
    FROM role_assignments ra
    WHERE ra.user_id = :user_id
      AND ra.status  = 'active'
      AND (ra.expires_at IS NULL OR ra.expires_at > now())
)
SELECT
    r.key                                    AS role_key,
    r.display_name                           AS role_name,
    r.risk_level                             AS role_risk,
    jsonb_array_length(r.policies)           AS policy_count,
    r.policies                               AS policy_keys
FROM roles r
JOIN ra ON ra.tenant_id = r.tenant_id AND ra.role_key = r.key
ORDER BY r.key;

-- =============================================================================
-- 4) Policies em detalhe (com allow / deny das wiki.*)
-- =============================================================================
\echo
\echo '--- (4) POLICIES — wiki.* allow + deny --------------------------------------'
WITH ra AS (
    SELECT ra.tenant_id, ra.role_key
    FROM role_assignments ra
    WHERE ra.user_id = :user_id
      AND ra.status  = 'active'
      AND (ra.expires_at IS NULL OR ra.expires_at > now())
),
role_policy_keys AS (
    SELECT DISTINCT
        r.tenant_id,
        jsonb_array_elements_text(r.policies) AS policy_key
    FROM roles r
    JOIN ra ON ra.tenant_id = r.tenant_id AND ra.role_key = r.key
)
SELECT
    p.key                                                              AS policy_key,
    p.display_name                                                     AS policy_name,
    p.risk_level                                                       AS policy_risk,
    -- só os elementos que começam com 'wiki.' para cortar ruído
    (
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements_text(p.allow) AS elem
        WHERE elem LIKE 'wiki.%' OR elem LIKE 'wiki%'
    )                                                                  AS allow_wiki,
    (
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements_text(p.deny) AS elem
        WHERE elem LIKE 'wiki.%' OR elem LIKE 'wiki%'
    )                                                                  AS deny_wiki
FROM policies p
JOIN role_policy_keys rpk
  ON rpk.tenant_id = p.tenant_id AND rpk.policy_key = p.key
ORDER BY p.key;

-- =============================================================================
-- 5) Permissions wiki.* AGREGADAS (DISTINCT, achatadas)
-- =============================================================================
\echo
\echo '--- (5) AGGREGATED wiki.* permissions ---------------------------------------'
WITH ra AS (
    SELECT ra.tenant_id, ra.role_key
    FROM role_assignments ra
    WHERE ra.user_id = :user_id
      AND ra.status  = 'active'
      AND (ra.expires_at IS NULL OR ra.expires_at > now())
),
role_policy_keys AS (
    SELECT DISTINCT
        r.tenant_id,
        jsonb_array_elements_text(r.policies) AS policy_key
    FROM roles r
    JOIN ra ON ra.tenant_id = r.tenant_id AND ra.role_key = r.key
),
pol AS (
    SELECT p.tenant_id, p.key, p.allow, p.deny
    FROM policies p
    JOIN role_policy_keys rpk
      ON rpk.tenant_id = p.tenant_id AND rpk.policy_key = p.key
),
allow_flat AS (
    SELECT DISTINCT jsonb_array_elements_text(allow) AS perm FROM pol
),
deny_flat AS (
    SELECT DISTINCT jsonb_array_elements_text(deny)  AS perm FROM pol
)
SELECT 'ALLOW' AS kind, perm
FROM allow_flat WHERE perm LIKE 'wiki%'
UNION ALL
SELECT 'DENY'  AS kind, perm
FROM deny_flat  WHERE perm LIKE 'wiki%'
ORDER BY 1, 2;

-- =============================================================================
-- 6) VEREDITO — pode ou não fazer cada operação-chave?
--
-- Match de wildcard: granted permissions com '*' viram LIKE-pattern com '%'.
-- Uma permission-alvo X é ALLOWED se ∃ p em allow tal que X LIKE p,
-- e NÃO existe d em deny tal que X LIKE d.
-- =============================================================================
\echo
\echo '--- (6) VERDICT — required permissions for the integrations form -----------'
WITH ra AS (
    SELECT ra.tenant_id, ra.role_key
    FROM role_assignments ra
    WHERE ra.user_id = :user_id
      AND ra.status  = 'active'
      AND (ra.expires_at IS NULL OR ra.expires_at > now())
),
role_policy_keys AS (
    SELECT DISTINCT
        r.tenant_id,
        jsonb_array_elements_text(r.policies) AS policy_key
    FROM roles r
    JOIN ra ON ra.tenant_id = r.tenant_id AND ra.role_key = r.key
),
pol AS (
    SELECT p.allow, p.deny
    FROM policies p
    JOIN role_policy_keys rpk
      ON rpk.tenant_id = p.tenant_id AND rpk.policy_key = p.key
),
allow_patterns AS (
    SELECT DISTINCT replace(jsonb_array_elements_text(allow), '*', '%') AS pattern FROM pol
),
deny_patterns AS (
    SELECT DISTINCT replace(jsonb_array_elements_text(deny),  '*', '%') AS pattern FROM pol
),
required AS (
    SELECT * FROM (VALUES
        ('wiki.page.read'),
        ('wiki.page.create'),
        ('wiki.page.update'),
        ('wiki.page.publish'),
        ('wiki.page.move'),
        ('wiki.page.archive'),
        ('wiki.page.delete'),
        ('wiki.namespace.read'),
        ('wiki.namespace.create'),
        ('wiki.attachment.upload'),
        ('wiki.visibility.public'),
        ('wiki.visibility.myio-internal'),
        ('wiki.visibility.tenant-private'),
        ('wiki.visibility.partners'),
        ('wiki.visibility.holding-customers'),
        ('wiki.visibility.non-holding-customers')
    ) AS t(perm)
)
SELECT
    req.perm                                          AS required_permission,
    EXISTS (
        SELECT 1 FROM allow_patterns ap
        WHERE req.perm LIKE ap.pattern
    )                                                  AS in_allow,
    EXISTS (
        SELECT 1 FROM deny_patterns dp
        WHERE req.perm LIKE dp.pattern
    )                                                  AS in_deny,
    CASE
        WHEN EXISTS (SELECT 1 FROM deny_patterns dp WHERE req.perm LIKE dp.pattern)
            THEN 'DENIED (explicit)'
        WHEN EXISTS (SELECT 1 FROM allow_patterns ap WHERE req.perm LIKE ap.pattern)
            THEN 'ALLOWED'
        ELSE 'NOT_GRANTED'
    END                                                AS verdict
FROM required req
ORDER BY req.perm;

-- =============================================================================
-- 7) RESUMO — pode usar o endpoint POST /wiki/integrations/from-form ?
-- =============================================================================
\echo
\echo '--- (7) SUMMARY for POST /wiki/integrations/from-form -----------------------'
WITH ra AS (
    SELECT ra.tenant_id, ra.role_key
    FROM role_assignments ra
    WHERE ra.user_id = :user_id
      AND ra.status  = 'active'
      AND (ra.expires_at IS NULL OR ra.expires_at > now())
),
role_policy_keys AS (
    SELECT DISTINCT
        r.tenant_id,
        jsonb_array_elements_text(r.policies) AS policy_key
    FROM roles r
    JOIN ra ON ra.tenant_id = r.tenant_id AND ra.role_key = r.key
),
pol AS (
    SELECT p.allow, p.deny
    FROM policies p
    JOIN role_policy_keys rpk
      ON rpk.tenant_id = p.tenant_id AND rpk.policy_key = p.key
),
allow_patterns AS (
    SELECT DISTINCT replace(jsonb_array_elements_text(allow), '*', '%') AS pattern FROM pol
),
deny_patterns AS (
    SELECT DISTINCT replace(jsonb_array_elements_text(deny),  '*', '%') AS pattern FROM pol
),
chk AS (
    SELECT
        EXISTS (SELECT 1 FROM allow_patterns ap WHERE 'wiki.page.create'        LIKE ap.pattern)
            AND NOT EXISTS (SELECT 1 FROM deny_patterns dp WHERE 'wiki.page.create' LIKE dp.pattern)
                AS can_create_page,
        EXISTS (SELECT 1 FROM allow_patterns ap WHERE 'wiki.visibility.public'  LIKE ap.pattern)
            AND NOT EXISTS (SELECT 1 FROM deny_patterns dp WHERE 'wiki.visibility.public' LIKE dp.pattern)
                AS can_assign_public
)
SELECT
    can_create_page,
    can_assign_public,
    (can_create_page AND can_assign_public)         AS can_use_integration_form,
    CASE
        WHEN can_create_page AND can_assign_public
            THEN 'OK — usuário pode chamar POST /wiki/integrations/from-form e publicar com PUBLIC.'
        WHEN can_create_page AND NOT can_assign_public
            THEN 'PARCIAL — pode criar páginas mas será bloqueado por ForbiddenError ao tentar PUBLIC. Atribua policy:wiki-myio-admin (ou crie role com wiki.visibility.public).'
        WHEN NOT can_create_page
            THEN 'BLOQUEADO — falta wiki.page.create. Atribua role com policy:wiki-author (ou superior).'
    END                                              AS recommendation
FROM chk;

\echo
\echo '============================================================================='
\echo '  Done.'
\echo '============================================================================='
