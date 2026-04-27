-- =============================================================================
-- SEED: WIKI ONBOARDING — Engineering (backend, internal) — RFC-0030
-- =============================================================================
-- Creates a namespace `Onboarding` and 13 wiki pages targeting a NEW BACKEND
-- INTERNAL collaborator. Visibility = MYIO_INTERNAL, status = PUBLISHED.
-- Source: docs/ONBOARDING.md (12 sections + checklist).
--
-- Pages:
--   1. index                  — Welcome + how to navigate
--   2. project-overview       — What is GCDR / why it exists
--   3. api-and-auth           — Endpoints, JWT, API keys, examples
--   4. environment-setup      — Prereqs, clone, env, healthcheck
--   5. architecture           — High-level diagram, services, layers
--   6. code-structure         — Directory tree + layer responsibilities
--   7. data-flows             — Create customer / approve partner / authz check
--   8. conventions            — Naming, error handling, Zod
--   9. local-development      — npm scripts, workflow, DB Admin UI, debug
--  10. testing                — Structure, sample test, run commands
--  11. common-tasks           — Add endpoint / entity / audit log
--  12. troubleshooting        — Common errors and fixes
--  13. resources-and-checklist— RFCs, external docs, contacts, onboarding checklist
--
-- Everything is idempotent — re-running is safe.
-- =============================================================================

DO $$
DECLARE
    v_tenant_id  UUID := '11111111-1111-1111-1111-111111111111';
    v_admin_id   UUID := 'bbbb1111-1111-1111-1111-111111111111';

    v_page_id    UUID;
    v_rev_id     UUID;

    -- Page bodies
    v_body_index             TEXT;
    v_body_overview          TEXT;
    v_body_api_auth          TEXT;
    v_body_env_setup         TEXT;
    v_body_architecture      TEXT;
    v_body_code_structure    TEXT;
    v_body_data_flows        TEXT;
    v_body_conventions       TEXT;
    v_body_local_dev         TEXT;
    v_body_testing           TEXT;
    v_body_common_tasks      TEXT;
    v_body_troubleshooting   TEXT;
    v_body_resources         TEXT;

    v_html_placeholder       TEXT;
BEGIN
    -- -------------------------------------------------------------------------
    -- Namespace
    -- -------------------------------------------------------------------------
    INSERT INTO wiki_namespaces (tenant_id, name, description, review_required)
    VALUES (
        v_tenant_id,
        'Onboarding',
        'Engineering onboarding for new backend collaborators on GCDR.',
        false
    )
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- -------------------------------------------------------------------------
    -- Page bodies
    -- -------------------------------------------------------------------------

    -- 1) index ----------------------------------------------------------------
    v_body_index := E'# Bem-vindo ao GCDR\n\n' ||
E'Este é o ponto de partida para um novo dev backend interno do GCDR (Global Central Data Registry). As páginas abaixo cobrem desde a visão de produto até troubleshooting do dia-a-dia, e foram extraídas de `docs/ONBOARDING.md`.\n\n' ||
E'## Trilha sugerida (primeiro dia ao primeiro PR)\n\n' ||
E'1. [Visão Geral do Projeto](/wiki/p/Onboarding/project-overview) — o que é o GCDR e por que ele existe.\n' ||
E'2. [API & Autenticação](/wiki/p/Onboarding/api-and-auth) — módulos, headers, JWT, API keys.\n' ||
E'3. [Setup do Ambiente](/wiki/p/Onboarding/environment-setup) — pré-requisitos, clone, healthcheck.\n' ||
E'4. [Arquitetura](/wiki/p/Onboarding/architecture) — containers, camadas, serviços Docker.\n' ||
E'5. [Estrutura do Código](/wiki/p/Onboarding/code-structure) — `src/` por camada.\n' ||
E'6. [Fluxos de Dados](/wiki/p/Onboarding/data-flows) — exemplos canônicos.\n' ||
E'7. [Padrões e Convenções](/wiki/p/Onboarding/conventions) — naming, errors, Zod.\n' ||
E'8. [Desenvolvimento Local](/wiki/p/Onboarding/local-development) — comandos, DB Admin, debug.\n' ||
E'9. [Testes](/wiki/p/Onboarding/testing) — estrutura, exemplo, comandos.\n' ||
E'10. [Tarefas Comuns](/wiki/p/Onboarding/common-tasks) — adicionar endpoint/entidade/audit.\n' ||
E'11. [Troubleshooting](/wiki/p/Onboarding/troubleshooting) — erros comuns.\n' ||
E'12. [Recursos & Checklist](/wiki/p/Onboarding/resources-and-checklist) — RFCs, links e checklist final.\n\n' ||
E'## Resumo rápido\n\n' ||
E'- **Stack**: Node.js 20 + TypeScript 5 + Express + PostgreSQL 16 (Drizzle) + Docker Compose. Validação com Zod, testes com Jest, deploy via Dokploy.\n' ||
E'- **Branch ativa**: `desenv` (PRs vão pra `main`).\n' ||
E'- **Local**: http://localhost:3015 — Swagger em `/docs`, DB Admin em `/admin/db`.\n' ||
E'- **Camadas**: Controllers → Services → Repositories → Drizzle/PostgreSQL.\n' ||
E'- **Auth**: JWT Bearer (multi-audience), Partner API Key (`gcdr_pk_*`), Customer API Key M2M (`gcdr_cust_*`), OAuth2 Client Credentials.\n\n' ||
E'## O que esperamos no seu primeiro PR\n\n' ||
E'1. Subir o ambiente local com `docker compose up -d` e validar `/health` + `/health/ready`.\n' ||
E'2. Rodar `npm test` com sucesso.\n' ||
E'3. Fazer uma alteração simples (ex: ajuste em mensagem, novo campo opcional, novo teste unitário).\n' ||
E'4. Abrir um PR contra `main` mesmo que pequeno — preferimos passos curtos.\n\n' ||
E'> Em caso de dúvida, fala no canal **#dev** (Slack) ou marca o tech lead. Veja contatos em [Recursos & Checklist](/wiki/p/Onboarding/resources-and-checklist).\n';

    -- 2) project-overview -----------------------------------------------------
    v_body_overview := E'# Visão Geral do Projeto\n\n' ||
E'## O que é o GCDR?\n\n' ||
E'O **GCDR (Global Central Data Registry)** é o **Single Source of Truth** para os dados mestres do ecossistema MYIO. Funciona como um cadastro central que:\n\n' ||
E'1. **Gerencia clientes** com hierarquia (Holding → Empresa → Filial → Franquia).\n' ||
E'2. **Registra parceiros** que integram via API.\n' ||
E'3. **Controla autorização** com roles, policies e scopes.\n' ||
E'4. **Registra audit logs** para compliance e rastreabilidade (RFC-0009).\n\n' ||
E'## Por que ele existe?\n\n' ||
E'Sem o GCDR, cada sistema (ThingsBoard, NodeHub, OS, etc.) mantinha sua própria versão dos dados, causando:\n\n' ||
E'- **Divergência de dados**: nomes, contatos e regras diferentes em cada sistema.\n' ||
E'- **Sincronização manual**: atualizar um cliente em 5 lugares.\n' ||
E'- **Falta de governança**: sem auditoria de quem mudou o quê.\n' ||
E'- **Permissões inconsistentes**: cada sistema com suas regras.\n\n' ||
E'O GCDR resolve isso centralizando tudo num único lugar autoritativo, e expondo APIs consumidas por:\n\n' ||
E'- **Frontend MYIO** (web/mobile) — via JWT.\n' ||
E'- **Parceiros integradores** — via OAuth2 Client Credentials ou API Key (`gcdr_pk_*`).\n' ||
E'- **Integrações M2M de cliente** (ex: Node-RED baixando bundles de alarme) — via Customer API Key (`gcdr_cust_*`).\n' ||
E'- **Outros serviços do ecossistema** (ex: alarm-orchestrator) — JWT com `aud` múltiplo (RFC-0003).\n\n' ||
E'## Domínios principais\n\n' ||
E'- **Customers** — hierarquia ROOT → RESELLER → ENTERPRISE → BUSINESS → INDIVIDUAL.\n' ||
E'- **Partners** + API Keys + OAuth Clients.\n' ||
E'- **Authorization (RBAC)** — Roles, Policies, Assignments, Scopes.\n' ||
E'- **Assets** — SITE → BUILDING → FLOOR → AREA → EQUIPMENT.\n' ||
E'- **Devices IoT** — filtros por `centralId`, `slaveId`; relocação via `POST /devices/:id/move`.\n' ||
E'- **Rules Engine** — ALARM_THRESHOLD, SLA, ESCALATION, MAINTENANCE_WINDOW.\n' ||
E'- **Alarm Bundles** — `/alarm-rules/bundle/simple` com versionamento (`X-Version-Id` → 304).\n' ||
E'- **Audit Logs** (RFC-0009) — local PostgreSQL.\n' ||
E'- **Centrals**, **Groups**, **Users**, **Themes**, **Integrations**, **Public Single Apps** (RFC-0020), **Templates** HTML (RFC-0021), **Device Sync Jobs** (RFC-0023).\n\n' ||
E'Próxima página: [API & Autenticação](/wiki/p/Onboarding/api-and-auth).\n';

    -- 3) api-and-auth ---------------------------------------------------------
    v_body_api_auth := E'# API & Autenticação\n\n' ||
E'## Ambientes\n\n' ||
E'| Ambiente | URL Base |\n' ||
E'|----------|----------|\n' ||
E'| **Local** | `http://localhost:3015` |\n' ||
E'| **Production** | `https://gcdr-server.apps.myio-bas.com` |\n' ||
E'| **Production (alarm-bundle)** | `https://gcdr-api.a.myio-bas.com` |\n\n' ||
E'Documentação OpenAPI:\n' ||
E'- Swagger UI: `http://localhost:3015/docs` / `https://gcdr-api.a.myio-bas.com/docs/`\n' ||
E'- JSON: `/docs/openapi.json`\n' ||
E'- Arquivo: `docs/openapi.yaml` (5.850+ linhas, 155+ endpoints).\n\n' ||
E'## Headers obrigatórios\n\n' ||
E'```http\n' ||
E'Content-Type: application/json\n' ||
E'x-tenant-id: <uuid-do-tenant>\n' ||
E'Authorization: Bearer <jwt-token>\n' ||
E'```\n\n' ||
E'Endpoints de parceiros aceitam API Key:\n\n' ||
E'```http\n' ||
E'X-API-Key: <api-key>\n' ||
E'```\n\n' ||
E'## Métodos de autenticação\n\n' ||
E'### 1. JWT Bearer (frontend/mobile)\n\n' ||
E'Estrutura do payload:\n\n' ||
E'```json\n' ||
E'{\n' ||
E'  "sub": "user-uuid",\n' ||
E'  "tenant_id": "tenant-uuid",\n' ||
E'  "email": "user@empresa.com",\n' ||
E'  "roles": ["role:super-admin", "role:operator"],\n' ||
E'  "type": "CUSTOMER",\n' ||
E'  "iss": "gcdr",\n' ||
E'  "aud": ["gcdr-api", "alarm-orchestrator"]\n' ||
E'}\n' ||
E'```\n\n' ||
E'Roles são carregadas dinamicamente do `AuthorizationService` a cada login, MFA verify e refresh. Multi-audience (RFC-0003) permite que o mesmo token seja aceito por outros serviços do ecossistema.\n\n' ||
E'### 2. Partner API Key — `gcdr_pk_*`\n\n' ||
E'Para integrações de parceiros (header `X-API-Key`).\n\n' ||
E'### 3. OAuth2 Client Credentials\n\n' ||
E'```bash\n' ||
E'curl -X POST https://api.gcdr.io/partners/token \\\n' ||
E'  -H "Content-Type: application/json" \\\n' ||
E'  -d ''{\n' ||
E'    "grant_type": "client_credentials",\n' ||
E'    "client_id": "partner-client-id",\n' ||
E'    "client_secret": "partner-client-secret",\n' ||
E'    "scope": "customers:read devices:read"\n' ||
E'  }''\n' ||
E'```\n\n' ||
E'### 4. Customer API Key M2M — `gcdr_cust_*`\n\n' ||
E'Para integrações M2M de clientes (ex: Node-RED baixando bundles).\n\n' ||
E'**Scopes disponíveis**: `bundles:read`, `devices:read`, `devices:write`, `rules:read`, `assets:read`, `assets:write`, `customers:write`, `groups:read`, `*:read`.\n\n' ||
E'**Campo `hierarchyAccess`**: `SELF` (apenas o customer dono) | `SUBTREE` (customer + descendentes) | `TENANT` (todos do tenant) — controla qual nível da árvore a chave acessa.\n\n' ||
E'## Estados do usuário (RFC-0011)\n\n' ||
E'| Status | Transições |\n' ||
E'|--------|------------|\n' ||
E'| `UNVERIFIED` | → PENDING_APPROVAL (após verificar email) |\n' ||
E'| `PENDING_APPROVAL` | → ACTIVE (aprovado) ou INACTIVE (rejeitado) |\n' ||
E'| `ACTIVE` | → INACTIVE (desativado) ou LOCKED (6 falhas de login) |\n' ||
E'| `INACTIVE` | → ACTIVE (reativado) |\n' ||
E'| `LOCKED` | → ACTIVE (admin desbloqueia ou reset de senha) |\n\n' ||
E'## Padrão de resposta\n\n' ||
E'**Sucesso:**\n\n' ||
E'```json\n' ||
E'{\n' ||
E'  "success": true,\n' ||
E'  "data": { },\n' ||
E'  "meta": { "requestId": "uuid", "timestamp": "ISO" }\n' ||
E'}\n' ||
E'```\n\n' ||
E'**Erro:**\n\n' ||
E'```json\n' ||
E'{\n' ||
E'  "success": false,\n' ||
E'  "error": { "code": "NOT_FOUND", "message": "..." },\n' ||
E'  "meta": { "requestId": "uuid", "timestamp": "ISO" }\n' ||
E'}\n' ||
E'```\n\n' ||
E'**Lista paginada:** `data.items[]` + `data.pagination { total, totalPages, hasMore, nextCursor }`. Todos os 27 endpoints paginados retornam `total` e `totalPages`.\n\n' ||
E'## Rate limits\n\n' ||
E'| Tipo | Limite |\n' ||
E'|------|--------|\n' ||
E'| Por IP | 1.000 req/min |\n' ||
E'| Por API Key | conforme plano do partner |\n' ||
E'| Por User | 100 req/min |\n\n' ||
E'## Exemplos rápidos\n\n' ||
E'**Login (tenant default):**\n\n' ||
E'```bash\n' ||
E'curl -X POST http://localhost:3015/auth/login \\\n' ||
E'  -H "Content-Type: application/json" \\\n' ||
E'  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \\\n' ||
E'  -d ''{ "email": "admin@gcdr.io", "password": "Test123!" }''\n' ||
E'```\n\n' ||
E'**Bundle simplificado (Customer API Key):**\n\n' ||
E'```bash\n' ||
E'curl http://localhost:3015/customers/33333333-3333-3333-3333-333333333333/alarm-rules/bundle/simple \\\n' ||
E'  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \\\n' ||
E'  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026"\n' ||
E'```\n\n' ||
E'**Device por central + slave:**\n\n' ||
E'```bash\n' ||
E'curl "http://localhost:3015/api/v1/devices?centralId=<central-uuid>&slaveId=4" \\\n' ||
E'  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \\\n' ||
E'  -H "Authorization: Bearer <token>"\n' ||
E'```\n\n' ||
E'## Usuários de teste (seed)\n\n' ||
E'| Email | Senha | Tipo |\n' ||
E'|-------|-------|------|\n' ||
E'| admin@gcdr.io | Test123! | Admin |\n' ||
E'| joao.silva@acmetech.com | Test123! | User |\n' ||
E'| dev@techpartner.com | Test123! | Partner |\n' ||
E'| service@gcdr.io | Test123! | Service |\n\n' ||
E'> Veja a integração detalhada Node-RED em `docs/ONBOARDING-NODERED-ALARM-BUNDLE.md`.\n';

    -- 4) environment-setup ----------------------------------------------------
    v_body_env_setup := E'# Setup do Ambiente\n\n' ||
E'## Stack\n\n' ||
E'| Tecnologia | Para quê |\n' ||
E'|------------|----------|\n' ||
E'| Node.js 20 LTS | Runtime |\n' ||
E'| TypeScript 5 | Tipagem estática |\n' ||
E'| Express.js | Framework HTTP |\n' ||
E'| PostgreSQL 16 | Banco relacional |\n' ||
E'| Drizzle ORM | Acesso ao banco |\n' ||
E'| Docker / Compose | Orquestração local |\n' ||
E'| Dokploy | Deploy em produção |\n' ||
E'| Zod | Validação de schemas |\n' ||
E'| Jest | Testes |\n\n' ||
E'> O projeto foi migrado de AWS Lambda/DynamoDB para containers Docker com PostgreSQL — veja RFC-0005.\n\n' ||
E'## Pré-requisitos\n\n' ||
E'```bash\n' ||
E'node --version           # v20.x\n' ||
E'npm --version            # 9.x ou superior\n' ||
E'git --version\n' ||
E'docker --version         # Docker 20+\n' ||
E'docker compose version   # Compose v2+\n' ||
E'```\n\n' ||
E'Recomendamos usar `nvm` (Linux/Mac) ou `nvm-windows`:\n\n' ||
E'```bash\n' ||
E'nvm install 20\n' ||
E'nvm use 20\n' ||
E'```\n\n' ||
E'## Clone e instalação\n\n' ||
E'```bash\n' ||
E'git clone https://github.com/gh-myio/gcdr.git\n' ||
E'cd gcdr\n\n' ||
E'npm install\n' ||
E'cp .env.example .env       # ajuste se precisar\n' ||
E'npm test                   # smoke test\n' ||
E'```\n\n' ||
E'## Subindo com Docker (recomendado)\n\n' ||
E'```bash\n' ||
E'docker compose up -d\n' ||
E'docker compose ps\n' ||
E'curl http://localhost:3015/health         # {"status":"ok"}\n' ||
E'curl http://localhost:3015/health/ready   # {"status":"ready"}\n' ||
E'docker compose logs -f api\n' ||
E'```\n\n' ||
E'## Sem Docker (Postgres já rodando localmente)\n\n' ||
E'```bash\n' ||
E'# Configure DATABASE_URL no .env apontando pro seu Postgres\n' ||
E'npm run build\n' ||
E'npm run dev          # hot reload (tsx watch)\n' ||
E'curl http://localhost:3015/health\n' ||
E'```\n\n' ||
E'## Variáveis de ambiente (principais)\n\n' ||
E'| Variável | Default | Uso |\n' ||
E'|----------|---------|-----|\n' ||
E'| `DATABASE_URL` | `postgresql://postgres:password@postgres:5432/db_gcdr` | Conexão Postgres (dentro do Docker) |\n' ||
E'| `POSTGRES_PORT` | `5433` | Porta exposta no host |\n' ||
E'| `JWT_SECRET` | gerado | Chave de assinatura JWT (compartilhada com alarm-orchestrator) |\n' ||
E'| `JWT_ISSUER` | `gcdr` | Emissor do JWT |\n' ||
E'| `JWT_AUDIENCE` | `gcdr-api,alarm-orchestrator` | Audiences (comma-separated) |\n' ||
E'| `DB_ADMIN_PASSWORD` | `myio2026` | Senha do DB Admin UI |\n\n' ||
E'> Dentro do Docker, use `postgres` como host. Fora dele, `localhost:5433`. Erros aqui são uma das causas mais comuns — veja [Troubleshooting](/wiki/p/Onboarding/troubleshooting).\n';

    -- 5) architecture ---------------------------------------------------------
    v_body_architecture := E'# Arquitetura do Sistema\n\n' ||
E'## Visão de alto nível\n\n' ||
E'```\n' ||
E'                  Dokploy Platform\n\n' ||
E'  Traefik (proxy)  ──>  GCDR API Container (Express.js)\n' ||
E'                          │\n' ||
E'                          ├── Controllers (HTTP)\n' ||
E'                          ├── Services    (lógica de negócio)\n' ||
E'                          └── Repositories (Drizzle ORM)\n' ||
E'                                  │\n' ||
E'                          PostgreSQL 16   Redis (opcional)\n' ||
E'                                  │\n' ||
E'                          Sistemas externos: ThingsBoard, NodeHub, alarm-orchestrator\n' ||
E'```\n\n' ||
E'## Serviços Docker\n\n' ||
E'| Serviço | Container | Porta | Descrição |\n' ||
E'|---------|-----------|-------|-----------|\n' ||
E'| API | `gcdr-api` | 3015 | Aplicação Express.js |\n' ||
E'| Database | `gcdr-postgres` | 5433 | PostgreSQL 16 |\n\n' ||
E'## Camadas (responsabilidades)\n\n' ||
E'| Camada | Responsabilidade |\n' ||
E'|--------|------------------|\n' ||
E'| **Controllers** | Recebem HTTP, validam input com Zod, chamam o service correto. Sem lógica de negócio. |\n' ||
E'| **Services** | Lógica de negócio, orquestração entre repositories e regras de domínio. |\n' ||
E'| **Repositories** | Acesso a dados via Drizzle ORM. Encapsulam queries SQL. |\n' ||
E'| **DTOs** | Schemas Zod de request/response. |\n' ||
E'| **Middleware** | Auth (JWT/API Key), context (`req.context`), error handling, response helpers. |\n' ||
E'| **Audit Logs** | Registro local de eventos (PostgreSQL) — RFC-0009. |\n\n' ||
E'## Multi-tenancy\n\n' ||
E'Todas as queries são scoped por `tenantId`. O middleware `context` extrai o `x-tenant-id` do header e injeta em `req.context`, junto com `userId` e `requestId`. Repositories sempre recebem `tenantId` como parâmetro — **nunca confie em IDs vindos do body sem validar contra o tenant**.\n\n' ||
E'## Audit logs\n\n' ||
E'O sistema de eventos externo (AWS EventBridge) foi removido em fev/2026. O GCDR usa apenas audit logs locais no PostgreSQL para rastreabilidade — `auditLogService.log({ tenantId, userId, action, resourceType, resourceId, changes, ip })`.\n\n' ||
E'## Integração com outros sistemas\n\n' ||
E'Tokens emitidos pelo GCDR são aceitos por serviços do ecossistema MYIO via **Multiple Audience** (RFC 7519 §4.1.3). O `aud` é um array (`["gcdr-api", "alarm-orchestrator"]`) e cada serviço valida apenas a sua audience. Veja RFC-0003.\n\n' ||
E'Próxima página: [Estrutura do Código](/wiki/p/Onboarding/code-structure).\n';

    -- 6) code-structure -------------------------------------------------------
    v_body_code_structure := E'# Estrutura do Código\n\n' ||
E'## Árvore principal\n\n' ||
E'```\n' ||
E'src/\n' ||
E'├── domain/entities/         # Interfaces TypeScript (Customer, Partner, Role, ...)\n' ||
E'├── dto/\n' ||
E'│   ├── request/             # Zod schemas de entrada\n' ||
E'│   └── response/            # DTOs de saída\n' ||
E'├── controllers/             # Routers Express (auth, customers, devices, rules, ...)\n' ||
E'│   └── admin/               # DB Admin UI controllers\n' ||
E'├── middleware/              # auth, context, errorHandler, response\n' ||
E'├── services/                # Lógica de negócio\n' ||
E'├── repositories/\n' ||
E'│   ├── *.ts                 # Implementações com Drizzle\n' ||
E'│   └── interfaces/          # Contratos (ports)\n' ||
E'├── infrastructure/database/drizzle/\n' ||
E'│   ├── schema.ts            # Tabelas + tipos\n' ||
E'│   ├── client.ts            # Conexão Postgres\n' ||
E'│   └── migrations/          # SQL migrations\n' ||
E'└── shared/                  # config, errors, types, utils\n\n' ||
E'tests/\n' ||
E'├── unit/\n' ||
E'├── integration/\n' ||
E'└── helpers/setup.ts\n' ||
E'```\n\n' ||
E'## Camada por camada\n\n' ||
E'### `domain/entities/`\n\n' ||
E'Interfaces TypeScript puras — sem lógica, sem ORM:\n\n' ||
E'```typescript\n' ||
E'interface Customer {\n' ||
E'  id: string;\n' ||
E'  tenantId: string;\n' ||
E'  parentCustomerId: string | null;\n' ||
E'  path: string;          // /tenant/parent/child\n' ||
E'  depth: number;\n' ||
E'  name: string;\n' ||
E'  type: ''HOLDING'' | ''COMPANY'' | ''BRANCH'' | ''FRANCHISE'';\n' ||
E'  status: ''ACTIVE'' | ''INACTIVE'' | ''SUSPENDED'';\n' ||
E'}\n' ||
E'```\n\n' ||
E'### `dto/`\n\n' ||
E'Schemas Zod para validação no controller:\n\n' ||
E'```typescript\n' ||
E'const createCustomerSchema = z.object({\n' ||
E'  name: z.string().min(1).max(255),\n' ||
E'  type: z.enum([''HOLDING'',''COMPANY'',''BRANCH'',''FRANCHISE'']),\n' ||
E'  parentCustomerId: z.string().uuid().optional(),\n' ||
E'});\n' ||
E'```\n\n' ||
E'### `controllers/`\n\n' ||
E'Cada controller é um `Router` Express. Sem lógica de negócio — só parse, validação e delegação:\n\n' ||
E'```typescript\n' ||
E'router.get(''/:id'', async (req, res, next) => {\n' ||
E'  try {\n' ||
E'    const { tenantId, requestId } = req.context;\n' ||
E'    const customer = await customerService.findById(tenantId, req.params.id);\n' ||
E'    sendSuccess(res, customer, 200, requestId);\n' ||
E'  } catch (err) { next(err); }\n' ||
E'});\n' ||
E'```\n\n' ||
E'### `services/`\n\n' ||
E'Coordenam regras de negócio e múltiplos repositories. É onde mora a inteligência do domínio:\n\n' ||
E'```typescript\n' ||
E'class CustomerService {\n' ||
E'  async createCustomer(data: CreateCustomerDTO): Promise<Customer> {\n' ||
E'    // 1. valida regras\n' ||
E'    // 2. calcula path/depth\n' ||
E'    // 3. persiste\n' ||
E'    // 4. registra audit log\n' ||
E'  }\n' ||
E'}\n' ||
E'```\n\n' ||
E'### `repositories/`\n\n' ||
E'Encapsulam queries Drizzle. Sempre recebem `tenantId`:\n\n' ||
E'```typescript\n' ||
E'class CustomerRepository implements ICustomerRepository {\n' ||
E'  async findById(tenantId: string, id: string): Promise<Customer | null>;\n' ||
E'  async findChildren(tenantId: string, parentId: string): Promise<Customer[]>;\n' ||
E'  async findDescendants(tenantId: string, path: string): Promise<Customer[]>;\n' ||
E'}\n' ||
E'```\n\n' ||
E'### `infrastructure/database/drizzle/schema.ts`\n\n' ||
E'Tabelas + tipos. **Toda mudança de schema vira migration** em `migrations/` — nunca altere o banco direto sem migration correspondente.\n\n' ||
E'### `shared/errors/AppError.ts`\n\n' ||
E'Classes `AppError`, `NotFoundError`, `ValidationError`. Veja [Convenções](/wiki/p/Onboarding/conventions).\n';

    -- 7) data-flows -----------------------------------------------------------
    v_body_data_flows := E'# Fluxos de Dados\n\n' ||
E'Três fluxos canônicos pra entender como as camadas se conversam.\n\n' ||
E'## Fluxo 1 — Criar Customer\n\n' ||
E'```\n' ||
E'1. REQUEST\n' ||
E'   POST /customers\n' ||
E'   { "name": "Filial SP", "type": "BRANCH", "parentCustomerId": "..." }\n\n' ||
E'2. CONTROLLER (customers.controller.ts)\n' ||
E'   - Zod parse do body\n' ||
E'   - Extrai tenantId, userId, requestId de req.context\n' ||
E'   - Chama CustomerService.createCustomer()\n\n' ||
E'3. SERVICE (CustomerService.ts)\n' ||
E'   - Valida que o parent existe e pertence ao tenant\n' ||
E'   - Calcula path: "/tenant/holding-123/sao-paulo"\n' ||
E'   - Calcula depth: 2\n' ||
E'   - Gera UUID\n' ||
E'   - Chama Repository.create()\n\n' ||
E'4. REPOSITORY (CustomerRepository.ts)\n' ||
E'   - INSERT via Drizzle ORM\n\n' ||
E'5. AUDIT LOG\n' ||
E'   - auditLogService.log({ action: "customer.created", ... })\n\n' ||
E'6. RESPONSE — 201 Created\n' ||
E'   { "id": "...", "path": "/tenant/holding-123/sao-paulo", "depth": 2 }\n' ||
E'```\n\n' ||
E'## Fluxo 2 — Aprovar Partner\n\n' ||
E'```\n' ||
E'1. REQUEST\n' ||
E'   POST /partners/{id}/approve { "approvedBy": "admin@myio.com" }\n\n' ||
E'2. CONTROLLER\n' ||
E'   - Valida partnerId\n' ||
E'   - Chama PartnerService.approve()\n\n' ||
E'3. SERVICE\n' ||
E'   - Busca partner\n' ||
E'   - Valida status == ''PENDING''\n' ||
E'   - Atualiza status para ''APPROVED''\n' ||
E'   - Gera API keys\n\n' ||
E'4. AUDIT LOG\n' ||
E'   - "partner.approved"\n\n' ||
E'5. RESPONSE — 200 OK\n' ||
E'   { "id": "...", "status": "APPROVED", "apiKeys": [...] }\n' ||
E'```\n\n' ||
E'## Fluxo 3 — Check de permissão\n\n' ||
E'```\n' ||
E'1. REQUEST\n' ||
E'   POST /authorization/check\n' ||
E'   {\n' ||
E'     "userId": "user-joao",\n' ||
E'     "permission": "energy.settings.read",\n' ||
E'     "resourceScope": "customer:loja-123"\n' ||
E'   }\n\n' ||
E'2. SERVICE\n' ||
E'   - Busca role assignments do usuário\n' ||
E'   - Resolve policies de cada role\n' ||
E'   - Avalia DENY rules primeiro (explicit deny wins)\n' ||
E'   - Avalia ALLOW rules\n' ||
E'   - Verifica conditions (MFA, business hours, etc.)\n\n' ||
E'3. RESPONSE — 200 OK\n' ||
E'   {\n' ||
E'     "allowed": true,\n' ||
E'     "reason": "granted_by_policy_tech_v1",\n' ||
E'     "scopeMatched": "customer:campinas"\n' ||
E'   }\n' ||
E'```\n\n' ||
E'## Padrões transversais\n\n' ||
E'- **Sempre escope por `tenantId`** nos repositories.\n' ||
E'- **Audit log no service**, depois da operação dar sucesso (não antes).\n' ||
E'- **Controller só formata HTTP** (status, headers); a regra de negócio mora no service.\n' ||
E'- **Erros sobem como exceções** das classes em `shared/errors/AppError`; o middleware global mapeia pra HTTP.\n';

    -- 8) conventions ----------------------------------------------------------
    v_body_conventions := E'# Padrões e Convenções\n\n' ||
E'## Nomenclatura\n\n' ||
E'| Tipo | Padrão | Exemplo |\n' ||
E'|------|--------|---------|\n' ||
E'| Arquivos | camelCase | `CustomerService.ts` |\n' ||
E'| Classes | PascalCase | `CustomerService` |\n' ||
E'| Interfaces | PascalCase com `I` | `ICustomerRepository` |\n' ||
E'| Funções | camelCase | `findByTenantId()` |\n' ||
E'| Constantes | SCREAMING_SNAKE | `DEFAULT_PAGE_SIZE` |\n' ||
E'| Tipos / Enums | PascalCase | `CustomerType` |\n\n' ||
E'## Estrutura de arquivo\n\n' ||
E'```typescript\n' ||
E'// 1. Imports externos\n' ||
E'import { db } from ''../infrastructure/database/drizzle/db'';\n' ||
E'import { z } from ''zod'';\n\n' ||
E'// 2. Imports internos\n' ||
E'import { Customer } from ''../domain/entities/Customer'';\n' ||
E'import type { ICustomerRepository } from ''./interfaces/ICustomerRepository'';\n\n' ||
E'// 3. Tipos / interfaces locais\n' ||
E'interface ServiceConfig { connectionString: string; }\n\n' ||
E'// 4. Constantes\n' ||
E'const DEFAULT_PAGE_SIZE = 50;\n\n' ||
E'// 5. Classe / função principal\n' ||
E'export class CustomerService { /* ... */ }\n' ||
E'```\n\n' ||
E'## Error handling\n\n' ||
E'Use as classes em `shared/errors/AppError`:\n\n' ||
E'```typescript\n' ||
E'import { AppError, NotFoundError, ValidationError } from ''../shared/errors/AppError'';\n\n' ||
E'throw new NotFoundError(''Customer'', customerId);\n' ||
E'throw new ValidationError(''Parent customer not found'');\n' ||
E'throw new AppError(''FORBIDDEN'', 403, ''Insufficient permissions'');\n' ||
E'```\n\n' ||
E'O middleware `errorHandler` mapeia para o response padrão (`success: false, error: { code, message }`).\n\n' ||
E'> Erros operacionais (4xx) logam apenas `[401] UNAUTHORIZED: msg`. Erros 5xx mantêm stack trace. Reduz ruído nos logs do Dokploy.\n\n' ||
E'## Validação com Zod\n\n' ||
E'Sempre valide input nos controllers — nunca confie no body:\n\n' ||
E'```typescript\n' ||
E'const schema = z.object({\n' ||
E'  name: z.string().min(1).max(255),\n' ||
E'  email: z.string().email().optional(),\n' ||
E'});\n\n' ||
E'const result = schema.safeParse(body);\n' ||
E'if (!result.success) throw new ValidationError(result.error.message);\n' ||
E'```\n\n' ||
E'## Response helpers\n\n' ||
E'Nunca devolva JSON cru — use os helpers do middleware:\n\n' ||
E'```typescript\n' ||
E'sendSuccess(res, data, 200, requestId);\n' ||
E'sendCreated(res, newEntity, requestId);\n' ||
E'```\n\n' ||
E'## `req.context`\n\n' ||
E'O middleware `context` injeta `tenantId`, `userId` e `requestId` em todo request autenticado. **Sempre extraia daí** — não pegue de query/body.\n\n' ||
E'```typescript\n' ||
E'const { tenantId, userId, requestId } = req.context;\n' ||
E'```\n\n' ||
E'## Multi-tenancy\n\n' ||
E'Repositories **sempre** recebem `tenantId` como primeiro parâmetro. IDs vindos do request precisam ser validados contra o `tenantId` do context — caso contrário, vira IDOR.\n';

    -- 9) local-development ----------------------------------------------------
    v_body_local_dev := E'# Desenvolvimento Local\n\n' ||
E'## Comandos npm\n\n' ||
E'```bash\n' ||
E'# Desenvolvimento\n' ||
E'npm run dev                 # tsx watch (hot reload)\n' ||
E'npm run build               # compila TS\n' ||
E'npm start                   # roda código compilado\n\n' ||
E'# Docker\n' ||
E'docker compose up -d        # inicia API + Postgres\n' ||
E'docker compose down\n' ||
E'docker compose logs -f api\n' ||
E'docker compose ps\n' ||
E'docker compose restart api\n\n' ||
E'# Database (seeds e admin)\n' ||
E'npm run db:seed             # popula com dados de teste\n' ||
E'npm run db:seed:clear       # limpa tudo\n' ||
E'npm run db:seed:verify\n' ||
E'npm run db:seed:list\n' ||
E'npm run db:seed:menu        # menu interativo\n\n' ||
E'# Qualidade\n' ||
E'npm run lint                # ESLint\n' ||
E'npm run lint:fix\n' ||
E'npm run typecheck\n' ||
E'npm run quality             # lint + tests com cobertura\n\n' ||
E'# Testes\n' ||
E'npm test\n' ||
E'npm run test:watch\n' ||
E'npm run test:coverage\n' ||
E'npm run test:unit\n' ||
E'npm run test:integration\n' ||
E'```\n\n' ||
E'## Workflow padrão\n\n' ||
E'```bash\n' ||
E'git checkout -b feature/minha-feature\n' ||
E'# ...alterações...\n' ||
E'npm run lint && npm run typecheck && npm test\n' ||
E'git add .\n' ||
E'git commit -m "feat: descrição"\n' ||
E'git push origin feature/minha-feature\n' ||
E'```\n\n' ||
E'PRs vão pra `main` (a branch ativa de trabalho é `desenv`).\n\n' ||
E'## DB Admin UI\n\n' ||
E'Interface web em `http://localhost:3015/admin/db`.\n\n' ||
E'- **Auth**: senha de admin (`DB_ADMIN_PASSWORD`, default `myio2026`).\n' ||
E'- **Dashboard**: estatísticas (table counts, users por status, customers por tipo).\n' ||
E'- **Scripts**: roda seeds individualmente ou todos.\n' ||
E'- **Logs**: histórico de execuções com filtros.\n' ||
E'- **Query Console**: SQL ad-hoc com exemplos prontos.\n\n' ||
E'**Atalhos**: Run All Seeds, Clear All, Quick Reset (clear + seed), Verify, Refresh Stats. Veja RFC-0006 e RFC-0007.\n\n' ||
E'## Alarm Simulator (Premium)\n\n' ||
E'`http://localhost:3015/admin/simulator` — clique no botão **🚀 DEMO** pra criar tenant + customer + devices + regras automaticamente. Veja `docs/SIMULATOR-MANUAL.md`.\n\n' ||
E'## Debug com VS Code\n\n' ||
E'Crie `.vscode/launch.json`:\n\n' ||
E'```json\n' ||
E'{\n' ||
E'  "version": "0.2.0",\n' ||
E'  "configurations": [\n' ||
E'    {\n' ||
E'      "name": "Debug API (Express)",\n' ||
E'      "type": "node",\n' ||
E'      "request": "launch",\n' ||
E'      "runtimeExecutable": "npm",\n' ||
E'      "runtimeArgs": ["run", "dev"],\n' ||
E'      "console": "integratedTerminal",\n' ||
E'      "envFile": "${workspaceFolder}/.env"\n' ||
E'    },\n' ||
E'    {\n' ||
E'      "name": "Debug Tests",\n' ||
E'      "type": "node",\n' ||
E'      "request": "launch",\n' ||
E'      "runtimeExecutable": "npm",\n' ||
E'      "runtimeArgs": ["test", "--", "--runInBand", "${relativeFile}"],\n' ||
E'      "console": "integratedTerminal"\n' ||
E'    },\n' ||
E'    {\n' ||
E'      "name": "Attach to Docker",\n' ||
E'      "type": "node",\n' ||
E'      "request": "attach",\n' ||
E'      "port": 9229,\n' ||
E'      "restart": true,\n' ||
E'      "localRoot": "${workspaceFolder}",\n' ||
E'      "remoteRoot": "/app"\n' ||
E'    }\n' ||
E'  ]\n' ||
E'}\n' ||
E'```\n\n' ||
E'## Smoke tests com curl\n\n' ||
E'```bash\n' ||
E'curl http://localhost:3015/health\n' ||
E'curl http://localhost:3015/health/ready\n' ||
E'curl http://localhost:3015/customers \\\n' ||
E'  -H "x-tenant-id: 11111111-1111-1111-1111-111111111111" \\\n' ||
E'  -H "Authorization: Bearer <token>"\n' ||
E'```\n\n' ||
E'> URLs **não têm** mais o prefixo `/dev/` da época Lambda. Se algum doc antigo referenciar `/dev/...`, ignore o prefixo.\n';

    -- 10) testing -------------------------------------------------------------
    v_body_testing := E'# Testes\n\n' ||
E'## Estrutura\n\n' ||
E'```\n' ||
E'tests/\n' ||
E'├── unit/                    # Testes unitários (services, utils)\n' ||
E'│   └── services/CustomerService.test.ts\n' ||
E'├── integration/             # Testes de integração (HTTP + DB real)\n' ||
E'│   └── api/customers.test.ts\n' ||
E'└── helpers/setup.ts         # Setup global\n' ||
E'```\n\n' ||
E'## Exemplo — teste unitário\n\n' ||
E'```typescript\n' ||
E'// tests/unit/services/CustomerService.test.ts\n' ||
E'import { CustomerService } from ''../../../src/services/CustomerService'';\n\n' ||
E'describe(''CustomerService'', () => {\n' ||
E'  let service: CustomerService;\n' ||
E'  let mockRepository: jest.Mocked<ICustomerRepository>;\n\n' ||
E'  beforeEach(() => {\n' ||
E'    mockRepository = {\n' ||
E'      findById: jest.fn(),\n' ||
E'      create: jest.fn(),\n' ||
E'      findChildren: jest.fn(),\n' ||
E'    };\n' ||
E'    service = new CustomerService(mockRepository);\n' ||
E'  });\n\n' ||
E'  describe(''createCustomer'', () => {\n' ||
E'    it(''should create root customer when no parent'', async () => {\n' ||
E'      mockRepository.create.mockResolvedValue(mockCustomer);\n\n' ||
E'      const result = await service.createCustomer({\n' ||
E'        tenantId: ''tenant-1'',\n' ||
E'        name: ''Root Customer'',\n' ||
E'        type: ''HOLDING'',\n' ||
E'      });\n\n' ||
E'      expect(result.depth).toBe(0);\n' ||
E'      expect(result.path).toContain(''/tenant-1/'');\n' ||
E'    });\n\n' ||
E'    it(''should throw when parent not found'', async () => {\n' ||
E'      mockRepository.findById.mockResolvedValue(null);\n\n' ||
E'      await expect(\n' ||
E'        service.createCustomer({\n' ||
E'          tenantId: ''tenant-1'',\n' ||
E'          name: ''Child'',\n' ||
E'          type: ''BRANCH'',\n' ||
E'          parentCustomerId: ''invalid-id'',\n' ||
E'        })\n' ||
E'      ).rejects.toThrow(''Parent customer not found'');\n' ||
E'    });\n' ||
E'  });\n' ||
E'});\n' ||
E'```\n\n' ||
E'## Rodar testes específicos\n\n' ||
E'```bash\n' ||
E'# Arquivo específico\n' ||
E'npm test -- tests/unit/services/CustomerService.test.ts\n\n' ||
E'# Por nome\n' ||
E'npm test -- -t "CustomerService"\n\n' ||
E'# Watch mode\n' ||
E'npm run test:watch -- tests/unit/services/CustomerService.test.ts\n\n' ||
E'# Cobertura\n' ||
E'npm run test:coverage\n' ||
E'```\n\n' ||
E'## Boas práticas\n\n' ||
E'- **Unit**: mock de repositories. Foco em regras de negócio do service.\n' ||
E'- **Integration**: HTTP + Postgres real (Docker). Roda mais devagar — use pra fluxos críticos.\n' ||
E'- **Sempre mocke todos os métodos** do repository que o service usa, mesmo os que não vai chamar (evita timeout estranho).\n' ||
E'- **Teste o caminho de erro** explicitamente — se o service lança `NotFoundError`, valide com `.rejects.toThrow(NotFoundError)`.\n';

    -- 11) common-tasks --------------------------------------------------------
    v_body_common_tasks := E'# Tarefas Comuns\n\n' ||
E'Receitas pra três cenários frequentes.\n\n' ||
E'## Adicionar novo endpoint\n\n' ||
E'1. **Crie ou edite o controller** em `src/controllers/{domain}.controller.ts`:\n\n' ||
E'```typescript\n' ||
E'import { Router, Request, Response, NextFunction } from ''express'';\n' ||
E'import { sendSuccess, sendCreated } from ''../middleware/response'';\n' ||
E'import { ValidationError } from ''../shared/errors/AppError'';\n\n' ||
E'const router = Router();\n\n' ||
E'router.get(''/'', async (req: Request, res: Response, next: NextFunction) => {\n' ||
E'  try {\n' ||
E'    const { tenantId, requestId } = req.context;\n' ||
E'    const result = await myService.list(tenantId);\n' ||
E'    sendSuccess(res, result, 200, requestId);\n' ||
E'  } catch (err) { next(err); }\n' ||
E'});\n\n' ||
E'router.post(''/'', async (req: Request, res: Response, next: NextFunction) => {\n' ||
E'  try {\n' ||
E'    const { tenantId, userId, requestId } = req.context;\n' ||
E'    const data = MySchema.parse(req.body);\n' ||
E'    const result = await myService.create(tenantId, data, userId);\n' ||
E'    sendCreated(res, result, requestId);\n' ||
E'  } catch (err) { next(err); }\n' ||
E'});\n\n' ||
E'export default router;\n' ||
E'```\n\n' ||
E'2. **Registre no `app.ts`**:\n\n' ||
E'```typescript\n' ||
E'import myController from ''./controllers/my.controller'';\n' ||
E'app.use(''/my-domain'', authMiddleware, myController);\n' ||
E'```\n\n' ||
E'3. **Exporte no `controllers/index.ts`** (se existir).\n' ||
E'4. **Crie testes** em `tests/unit/controllers/` (e `tests/integration/api/` pros fluxos críticos).\n' ||
E'5. **Atualize `docs/openapi.yaml`** com o novo endpoint (request/response schemas).\n\n' ||
E'## Adicionar nova entidade\n\n' ||
E'1. **Defina a entidade** em `src/domain/entities/MyEntity.ts`:\n\n' ||
E'```typescript\n' ||
E'export interface MyEntity {\n' ||
E'  id: string;\n' ||
E'  tenantId: string;\n' ||
E'  // ...\n' ||
E'}\n' ||
E'```\n\n' ||
E'2. **Crie DTOs** em `src/dto/request/` e `src/dto/response/`.\n\n' ||
E'3. **Crie o repository** em `src/repositories/MyEntityRepository.ts`:\n\n' ||
E'```typescript\n' ||
E'export class MyEntityRepository implements IMyEntityRepository {\n' ||
E'  async findById(tenantId: string, id: string): Promise<MyEntity | null> {\n' ||
E'    const result = await db.select()\n' ||
E'      .from(myEntities)\n' ||
E'      .where(and(eq(myEntities.tenantId, tenantId), eq(myEntities.id, id)))\n' ||
E'      .limit(1);\n' ||
E'    return result[0] ?? null;\n' ||
E'  }\n' ||
E'}\n' ||
E'```\n\n' ||
E'4. **Crie o service** em `src/services/`.\n\n' ||
E'5. **Adicione a tabela** em `src/infrastructure/database/drizzle/schema.ts`:\n\n' ||
E'```typescript\n' ||
E'export const myEntities = pgTable(''my_entities'', {\n' ||
E'  id: uuid(''id'').primaryKey().defaultRandom(),\n' ||
E'  tenantId: uuid(''tenant_id'').notNull(),\n' ||
E'  name: varchar(''name'', { length: 255 }).notNull(),\n' ||
E'  createdAt: timestamp(''created_at'', { withTimezone: true }).notNull().defaultNow(),\n' ||
E'}, (table) => ({\n' ||
E'  tenantIdx: index(''my_entities_tenant_idx'').on(table.tenantId),\n' ||
E'}));\n' ||
E'```\n\n' ||
E'6. **Gere a migration** SQL correspondente em `migrations/`.\n\n' ||
E'7. **Crie o controller** seguindo a receita anterior.\n\n' ||
E'## Adicionar audit log\n\n' ||
E'Pra registrar ações de uma nova entidade pra compliance (RFC-0009):\n\n' ||
E'```typescript\n' ||
E'import { auditLogService } from ''./AuditLogService'';\n\n' ||
E'await auditLogService.log({\n' ||
E'  tenantId,\n' ||
E'  userId,\n' ||
E'  action: ''CREATE'',          // ou ''UPDATE'', ''DELETE''\n' ||
E'  resourceType: ''my_entity'',\n' ||
E'  resourceId: entity.id,\n' ||
E'  changes: { /* campos alterados */ },\n' ||
E'  ip: requestIp,\n' ||
E'});\n' ||
E'```\n\n' ||
E'**Sempre depois** da operação dar sucesso (não antes). O sistema externo de eventos (AWS EventBridge) foi removido — só audit logs locais no Postgres.\n\n' ||
E'## Verificar conformidade de devices\n\n' ||
E'`scripts/api/engine-check-inconformidades/` tem o pipeline completo de verificação e sincronização de devices entre uma fonte externa e o GCDR. Pipeline em 4 passos via `run-all.sh`:\n\n' ||
E'```\n' ||
E'Step 1 — check-inconformidades.sh × N arquivos → inconformidades-report-*.json\n' ||
E'Step 2 — generate-action-plan.sh                → action-plan-*.json\n' ||
E'Step 3 — detect-relocations.sh                  → relocation-plan-*.json\n' ||
E'Step 4 — generate-registry.sh                   → device-registry-*.txt\n' ||
E'```\n\n' ||
E'```bash\n' ||
E'cd scripts/api/engine-check-inconformidades\n' ||
E'export GCDR_API_KEY=gcdr_cust_xxxxx\n' ||
E'export GCDR_CUSTOMER_ID=<uuid>\n' ||
E'export DEFAULT_GCDR_ASSET_ID=<uuid>\n\n' ||
E'./run-all.sh --customer montserrat               # pipeline completo\n' ||
E'./run-all.sh --customer montserrat --checks-only # só verificar\n' ||
E'```\n\n' ||
E'Pra aplicar correções: `./relocate-devices.sh`, `./consolidate-creates.sh`, `./apply-updates.sh` (cada um aceita `--dry-run`). Veja RFC-0022 e RFC-0023 (Job API).\n';

    -- 12) troubleshooting -----------------------------------------------------
    v_body_troubleshooting := E'# Troubleshooting\n\n' ||
E'## "Cannot find module"\n\n' ||
E'**Causa**: módulo não compilado ou path errado.\n\n' ||
E'```bash\n' ||
E'npm run build\n' ||
E'# ou cheque os paths no tsconfig.json\n' ||
E'```\n\n' ||
E'## "Validation error" no PostgreSQL\n\n' ||
E'**Causa**: dados não passaram em Zod ou em constraint do banco.\n\n' ||
E'**Solução**: confirme que `tenantId` e `id` estão presentes e que campos obrigatórios foram preenchidos. Cheque o detalhe do erro no log.\n\n' ||
E'## Container não inicia / porta em uso\n\n' ||
E'```bash\n' ||
E'# Windows\n' ||
E'netstat -ano | findstr :3015\n' ||
E'taskkill /PID <pid> /F\n\n' ||
E'# Linux/Mac\n' ||
E'lsof -i :3015\n' ||
E'kill -9 <pid>\n\n' ||
E'# Containers\n' ||
E'docker ps -a\n' ||
E'docker stop <id>\n' ||
E'docker compose down && docker compose up -d\n' ||
E'```\n\n' ||
E'## Erro de conexão com PostgreSQL\n\n' ||
E'```bash\n' ||
E'docker compose ps\n' ||
E'docker compose logs postgres\n' ||
E'docker compose exec postgres psql -U postgres -d db_gcdr -c "SELECT 1"\n' ||
E'```\n\n' ||
E'Confira `POSTGRES_PORT=5433` no `.env`.\n\n' ||
E'## API não conecta ao banco dentro do Docker\n\n' ||
E'**Dentro do Docker**, use o nome do serviço (`postgres`), não `localhost`:\n\n' ||
E'```\n' ||
E'DATABASE_URL=postgresql://postgres:password@postgres:5432/db_gcdr\n' ||
E'```\n\n' ||
E'**Fora do Docker** (`npm run dev` local), use `localhost` com a porta exposta:\n\n' ||
E'```\n' ||
E'DATABASE_URL=postgresql://postgres:password@localhost:5433/db_gcdr\n' ||
E'```\n\n' ||
E'## Testes falhando com timeout\n\n' ||
E'**Causa**: mock incompleto. Garanta que todos os métodos do repository que o service consulta estão mockados:\n\n' ||
E'```typescript\n' ||
E'mockRepository.findById = jest.fn().mockResolvedValue(null);\n' ||
E'mockRepository.create   = jest.fn().mockResolvedValue(mockCustomer);\n' ||
E'```\n\n' ||
E'## TypeScript não reconhece tipos\n\n' ||
E'```bash\n' ||
E'rm -rf dist/\n' ||
E'npm run build\n' ||
E'# No VS Code: Cmd/Ctrl+Shift+P → "TypeScript: Restart TS Server"\n' ||
E'```\n\n' ||
E'## Bundle de alarme com cache desatualizado\n\n' ||
E'Se você atualizou rules/devices direto no banco e o bundle continua antigo, invalide o cache em memória:\n\n' ||
E'```bash\n' ||
E'curl -X DELETE \\\n' ||
E'  http://localhost:3015/api/v1/customers/<customer-id>/alarm-rules/bundle/cache \\\n' ||
E'  -H "Authorization: Bearer <jwt>"\n' ||
E'# 204 No Content\n' ||
E'```\n\n' ||
E'## "22P02 invalid input syntax for type uuid"\n\n' ||
E'Ao percorrer hierarquia de customers (ex: `getAncestors`, bundle auth) — geralmente é Drizzle serializando array como string. Use `inArray(customers.id, ids)` em vez de `sql\\`${customers.id} = ANY(${ids})\\``.\n\n' ||
E'## Moxuara — UUID malformado em `scope_entity_id`\n\n' ||
E'Bug histórico: `scope_entity_id` com `"` trailing por double-serialization ao salvar rules via API. Já corrigido no código. Pra dados antigos, rode `scripts/db/ops/fix-moxuara-malformed-uuid.sql`.\n';

    -- 13) resources-and-checklist --------------------------------------------
    v_body_resources := E'# Recursos & Checklist\n\n' ||
E'## RFCs e docs internas\n\n' ||
E'| RFC / Doc | Tema |\n' ||
E'|-----------|------|\n' ||
E'| RFC-0001 | GCDR Core & Marketplace (especificação completa) |\n' ||
E'| RFC-0002 | Authorization Model |\n' ||
E'| RFC-0003 | JWT Multiple Audience (autenticação entre serviços) |\n' ||
E'| RFC-0004 | Migration DynamoDB → PostgreSQL |\n' ||
E'| RFC-0005 | Container Deployment (Docker + Dokploy) |\n' ||
E'| RFC-0006 | Database Seed Scripts |\n' ||
E'| RFC-0007 | Database Admin UI |\n' ||
E'| RFC-0009 | Events & Audit Logs |\n' ||
E'| RFC-0010 | Premium Alarm Simulator |\n' ||
E'| RFC-0011 | User Registration / Approval Workflow |\n' ||
E'| RFC-0015 | Alarm Bundle Version History |\n' ||
E'| RFC-0016 | ThingsBoard Entity Mapping |\n' ||
E'| RFC-0020 | Public Single Apps (formulários versionados) |\n' ||
E'| RFC-0021 | HTML Templates Engine + Template Types |\n' ||
E'| RFC-0022 | Device Conformity Tooling |\n' ||
E'| RFC-0023 | Device Sync Job API (substitui shell scripts) |\n' ||
E'| RFC-0030 | MYIO Wiki (este módulo) |\n' ||
E'| RULE-ENTITY | Documentação do motor de regras |\n' ||
E'| GCDR-USER | Canônico para users/auth/RBAC/groups/bundle/contacts |\n' ||
E'| SIMULATOR-MANUAL | Manual do simulador de alarmes |\n' ||
E'| NODE-RED Alarm Bundle | Integração Node-RED |\n' ||
E'| FRONTEND-Themes-TemplateTypes | Guia frontend para temas por tipo |\n' ||
E'| FRONTEND-Users-Groups-Roles | Guia frontend para RBAC |\n' ||
E'| FRONTEND-Device-Sync-Jobs | Guia frontend para Device Sync Jobs |\n' ||
E'| ARCHITECTURE-Device-Sync-Jobs | Arquitetura do pipeline de 6 fases |\n\n' ||
E'## Docs externas\n\n' ||
E'| Recurso | Link |\n' ||
E'|---------|------|\n' ||
E'| TypeScript | https://www.typescriptlang.org/docs/ |\n' ||
E'| Express.js | https://expressjs.com/ |\n' ||
E'| Drizzle ORM | https://orm.drizzle.team/ |\n' ||
E'| PostgreSQL | https://www.postgresql.org/docs/ |\n' ||
E'| Docker | https://docs.docker.com/ |\n' ||
E'| Docker Compose | https://docs.docker.com/compose/ |\n' ||
E'| Zod | https://zod.dev/ |\n' ||
E'| Jest | https://jestjs.io/docs/getting-started |\n' ||
E'| Dokploy | https://dokploy.com/docs |\n\n' ||
E'## Ferramentas recomendadas\n\n' ||
E'**VS Code Extensions**: ESLint, Prettier, Error Lens, GitLens, Thunder Client, Docker, PostgreSQL (`cweijan.vscode-postgresql-client2`).\n\n' ||
E'**CLI / GUI**: Docker Desktop, DBeaver, pgAdmin.\n\n' ||
E'## Contatos\n\n' ||
E'- **Tech Lead**: Rodrigo Lago — rodrigo@myio.com.br\n' ||
E'- **Dev Team**: canal `#dev` no Slack\n\n' ||
E'## IDs de teste (seed)\n\n' ||
E'| Recurso | Valor |\n' ||
E'|---------|-------|\n' ||
E'| Tenant default | `11111111-1111-1111-1111-111111111111` |\n' ||
E'| Customer teste | `33333333-3333-3333-3333-333333333333` |\n' ||
E'| Customer Moxuara | `84e0370e-636a-4741-9874-504b5e0b3577` |\n' ||
E'| Central Moxuara | `e982edf9-edb1-4aa6-8a14-4782465ae5a3` |\n' ||
E'| API Key teste bundle | `gcdr_cust_test_bundle_key_myio2026` |\n' ||
E'| API Key prod alarm | `gcdr_alarm_integration_key_2026` |\n\n' ||
E'## Checklist de Onboarding\n\n' ||
E'Use isto como guia para a primeira semana:\n\n' ||
E'- [ ] Docker instalado e funcionando (`docker --version`).\n' ||
E'- [ ] Repositório clonado e `npm install` ok.\n' ||
E'- [ ] `docker compose up -d` subiu API + Postgres sem erro.\n' ||
E'- [ ] `curl http://localhost:3015/health` → `{"status":"ok"}`.\n' ||
E'- [ ] `curl http://localhost:3015/health/ready` → `{"status":"ready"}`.\n' ||
E'- [ ] `npm test` passou.\n' ||
E'- [ ] Login local funcionando com `admin@gcdr.io` / `Test123!`.\n' ||
E'- [ ] Swagger UI aberto em `/docs` e algum endpoint testado.\n' ||
E'- [ ] DB Admin UI explorada em `/admin/db`.\n' ||
E'- [ ] Leu RFC-0001 (GCDR Core), RFC-0002 (Authz) e RFC-0005 (Containers).\n' ||
E'- [ ] Entendeu a separação Controller → Service → Repository.\n' ||
E'- [ ] Entendeu como `req.context` é populado e por que `tenantId` é crítico.\n' ||
E'- [ ] Fez uma alteração simples (mensagem, campo opcional, teste novo).\n' ||
E'- [ ] Criou um teste unitário que passa.\n' ||
E'- [ ] Abriu um PR contra `main` (mesmo que pequeno).\n\n' ||
E'**Bem-vindo ao time!**\n';

    -- -------------------------------------------------------------------------
    -- Inserts (each page wrapped in NOT EXISTS guard so the seed is idempotent)
    -- -------------------------------------------------------------------------

    -- 1) index ---------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'index'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_index,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'index',
            'Bem-vindo ao GCDR — Onboarding (Engineering)',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','engineering','index','gcdr']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object(
                'owner',        'engineering@myio',
                'audience',     'backend-internal',
                'sourceDoc',    'docs/ONBOARDING.md'
            ),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Bem-vindo ao GCDR — Onboarding (Engineering)',
            v_body_index, v_html_placeholder,
            jsonb_build_object('owner','engineering@myio'),
            'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 2) project-overview ----------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'project-overview'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_overview,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'project-overview',
            'Visão Geral do Projeto',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','overview','gcdr','single-source-of-truth']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Visão Geral do Projeto',
            v_body_overview, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 3) api-and-auth --------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'api-and-auth'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_api_auth,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'api-and-auth',
            'API & Autenticação',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','api','auth','jwt','api-key','oauth2']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'API & Autenticação',
            v_body_api_auth, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 4) environment-setup ---------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'environment-setup'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_env_setup,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'environment-setup',
            'Setup do Ambiente',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','setup','docker','node','postgres','env']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Setup do Ambiente',
            v_body_env_setup, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 5) architecture --------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'architecture'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_architecture,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'architecture',
            'Arquitetura do Sistema',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','architecture','express','docker','postgres','multi-tenant']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Arquitetura do Sistema',
            v_body_architecture, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 6) code-structure ------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'code-structure'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_code_structure,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'code-structure',
            'Estrutura do Código',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','code','structure','controllers','services','repositories','drizzle']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Estrutura do Código',
            v_body_code_structure, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 7) data-flows ----------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'data-flows'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_data_flows,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'data-flows',
            'Fluxos de Dados',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','data-flow','customer','partner','authorization']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Fluxos de Dados',
            v_body_data_flows, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 8) conventions ---------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'conventions'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_conventions,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'conventions',
            'Padrões e Convenções',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','conventions','naming','errors','zod','multi-tenant']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Padrões e Convenções',
            v_body_conventions, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 9) local-development ---------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'local-development'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_local_dev,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'local-development',
            'Desenvolvimento Local',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','dev','npm','docker','db-admin','vscode']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Desenvolvimento Local',
            v_body_local_dev, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 10) testing ------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'testing'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_testing,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'testing',
            'Testes',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','tests','jest','unit','integration']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Testes',
            v_body_testing, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 11) common-tasks -------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'common-tasks'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_common_tasks,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'common-tasks',
            'Tarefas Comuns',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','tasks','endpoint','entity','audit-log']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Tarefas Comuns',
            v_body_common_tasks, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 12) troubleshooting ----------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'troubleshooting'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_troubleshooting,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'troubleshooting',
            'Troubleshooting',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','troubleshooting','docker','postgres','typescript','cache']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Troubleshooting',
            v_body_troubleshooting, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 13) resources-and-checklist --------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Onboarding' AND slug = 'resources-and-checklist'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_resources,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Onboarding', 'resources-and-checklist',
            'Recursos & Checklist',
            'PUBLISHED',
            NULL,
            ARRAY['onboarding','resources','rfcs','checklist','contacts']::text[],
            ARRAY['MYIO_INTERNAL']::text[],
            jsonb_build_object('owner','engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Recursos & Checklist',
            v_body_resources, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;
END $$;
