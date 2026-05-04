-- =============================================================================
-- SEED: WIKI INTERNAL INTEGRATIONS — RFC-0030
-- =============================================================================
-- Cria o namespace `Integrations` e páginas para mapear as integrações /
-- ferramentas SaaS usadas internamente pela MYIO (ex.: Lovable + Supabase para
-- o App Comercial Gerador de Propostas, Omie, Freshdesk, OS, etc.).
--
-- Visibilidade: PUBLIC.
-- Status: PUBLISHED (template/índice servem como ponto de partida; pages
-- específicas devem ser preenchidas pelos owners).
--
-- Pages criadas:
--   1. index               — visão geral + lista de integrações
--   2. template            — modelo padrão para clonar ao adicionar uma nova
--   3. lovable-propostas   — App Comercial Gerador de Propostas (Lovable + Supabase)
--   4. omie                — Omie ERP
--   5. freshdesk           — Freshdesk (helpdesk)
--   6. os-ordem-de-servico — Sistema de Ordem de Serviço (a confirmar fornecedor)
--
-- Idempotente — re-rodar é seguro.
-- =============================================================================

DO $$
DECLARE
    v_tenant_id  UUID := '11111111-1111-1111-1111-111111111111';
    v_admin_id   UUID := 'bbbb1111-1111-1111-1111-111111111111';

    v_page_id    UUID;
    v_rev_id     UUID;

    -- Page bodies
    v_body_index       TEXT;
    v_body_template    TEXT;
    v_body_lovable     TEXT;
    v_body_omie        TEXT;
    v_body_freshdesk   TEXT;
    v_body_os          TEXT;

    v_html_placeholder TEXT;
BEGIN
    -- -------------------------------------------------------------------------
    -- Namespace
    -- -------------------------------------------------------------------------
    INSERT INTO wiki_namespaces (tenant_id, name, description, review_required)
    VALUES (
        v_tenant_id,
        'Integrations',
        'Inventário de integrações e ferramentas SaaS usadas internamente pela MYIO (ERP, helpdesk, apps proprietários, automações, etc.).',
        false
    )
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- -------------------------------------------------------------------------
    -- Page bodies
    -- -------------------------------------------------------------------------

    -- 1) index ---------------------------------------------------------------
    v_body_index := E'# Integrações Internas MYIO\n\n' ||
E'Esta página é o ponto de entrada do inventário de **ferramentas e integrações** que a MYIO usa internamente — sejam SaaS de terceiros (Omie, Freshdesk), apps proprietários (Lovable + Supabase) ou sistemas legados.\n\n' ||
E'## Como usar este espaço\n\n' ||
E'1. Para **adicionar uma nova integração**, copie o [Template Padrão](/wiki/p/Integrations/template) e preencha todos os campos.\n' ||
E'2. Cada integração tem **um owner interno** responsável por manter a página atualizada (custo, plano, contatos).\n' ||
E'3. Sempre que uma integração for **descontinuada**, mude o status para `DESCONTINUADO` em vez de apagar a página — o histórico interessa.\n\n' ||
E'## Estrutura padrão de uma página de integração\n\n' ||
E'Toda página segue o mesmo conjunto de seções (ver [template](/wiki/p/Integrations/template)):\n\n' ||
E'- **Descrição** — o que a ferramenta é/faz.\n' ||
E'- **Motivação** — por que usamos (problema que resolve).\n' ||
E'- **Categoria** — ERP, CRM, Helpdesk, App Interno, Automação, etc.\n' ||
E'- **URL / Acesso** — endpoint principal e como entrar.\n' ||
E'- **API / Webhooks** — endpoints, docs, modo de auth.\n' ||
E'- **Custo** — mensal/anual, moeda, modelo de cobrança.\n' ||
E'- **Plano atual** — tier contratado.\n' ||
E'- **Usuários suportados / Limites** — seats, requests, storage.\n' ||
E'- **Owner interno** — pessoa/squad responsável.\n' ||
E'- **Status** — `ATIVO`, `AVALIAÇÃO`, `DESCONTINUADO`.\n' ||
E'- **Datas** — contratação, renovação, encerramento.\n' ||
E'- **Integração com GCDR** — se há flow, API key, webhook conectado ao backend.\n' ||
E'- **Notas / Observações** — gotchas, contatos do fornecedor, links de contrato.\n\n' ||
E'## Inventário atual\n\n' ||
E'| Integração | Categoria | Status | Owner | Página |\n' ||
E'| --- | --- | --- | --- | --- |\n' ||
E'| App Comercial Gerador de Propostas | App Interno (Lovable + Supabase) | ATIVO | Comercial | [lovable-propostas](/wiki/p/Integrations/lovable-propostas) |\n' ||
E'| Omie | ERP | ATIVO | Financeiro | [omie](/wiki/p/Integrations/omie) |\n' ||
E'| Freshdesk | Helpdesk / Suporte | ATIVO | Suporte | [freshdesk](/wiki/p/Integrations/freshdesk) |\n' ||
E'| OS (Ordem de Serviço) | Field Service | A confirmar | Operações | [os-ordem-de-servico](/wiki/p/Integrations/os-ordem-de-servico) |\n\n' ||
E'> **TODO:** este inventário ainda está incompleto. Adicione abaixo qualquer ferramenta paga ou integração externa que esteja em uso.\n';

    -- 2) template ------------------------------------------------------------
    v_body_template := E'# Template — Página de Integração\n\n' ||
E'> **Como usar:** copie este conteúdo ao criar uma nova página de integração no namespace `Integrations`. Mantenha exatamente a mesma ordem de seções para que o inventário fique uniforme.\n\n' ||
E'---\n\n' ||
E'# {{Nome da Integração}}\n\n' ||
E'## Descrição\n\n' ||
E'_O que é a ferramenta/sistema, em 2-4 linhas. Se for um app interno, descreva também a stack._\n\n' ||
E'## Motivação\n\n' ||
E'_Qual problema essa integração resolve? Por que escolhemos ela em vez das alternativas?_\n\n' ||
E'## Categoria\n\n' ||
E'_Ex.: ERP, CRM, Helpdesk, App Interno, Automação, BI, Observabilidade, Comunicação._\n\n' ||
E'## URL / Acesso\n\n' ||
E'- **URL principal:** _https://exemplo.com_\n' ||
E'- **Login:** _SSO / e-mail+senha / link mágico_\n' ||
E'- **Ambiente de homologação (se houver):** _https://staging.exemplo.com_\n\n' ||
E'## API / Webhooks\n\n' ||
E'- **Docs:** _link para a documentação pública_\n' ||
E'- **Auth:** _API Key / OAuth2 / Bearer JWT_\n' ||
E'- **Endpoints relevantes:** _liste os principais usados internamente_\n' ||
E'- **Webhooks consumidos pelo GCDR:** _path / evento / handler_\n\n' ||
E'## Custo\n\n' ||
E'- **Valor:** _R$ X / mês ou USD Y / ano_\n' ||
E'- **Moeda:** _BRL / USD_\n' ||
E'- **Modelo de cobrança:** _por seat / por uso / fixo_\n\n' ||
E'## Plano atual\n\n' ||
E'_Nome do tier contratado (ex.: Business, Pro, Enterprise) e principais features inclusas._\n\n' ||
E'## Usuários suportados / Limites\n\n' ||
E'- **Seats:** _N usuários_\n' ||
E'- **Requests/mês:** _N (se aplicável)_\n' ||
E'- **Storage:** _N GB (se aplicável)_\n' ||
E'- **Outros limites:** _rate limits, automações, integrações_\n\n' ||
E'## Owner interno\n\n' ||
E'- **Responsável:** _nome / e-mail / squad_\n' ||
E'- **Backup:** _segunda pessoa que tem acesso administrativo_\n\n' ||
E'## Status\n\n' ||
E'_`ATIVO` | `AVALIAÇÃO` | `DESCONTINUADO`_\n\n' ||
E'## Datas\n\n' ||
E'- **Contratação:** _YYYY-MM-DD_\n' ||
E'- **Renovação:** _YYYY-MM-DD_\n' ||
E'- **Encerramento (se descontinuado):** _YYYY-MM-DD_\n\n' ||
E'## Integração com GCDR\n\n' ||
E'_Há fluxo conectando essa ferramenta ao backend GCDR? API key emitida? Webhook recebendo eventos? Linkar a documentação técnica relevante._\n\n' ||
E'## Notas / Observações\n\n' ||
E'_Gotchas, contatos do fornecedor, links de contrato, tickets abertos, etc._\n';

    -- 3) lovable-propostas ---------------------------------------------------
    v_body_lovable := E'# App Comercial — Gerador de Propostas (Lovable + Supabase)\n\n' ||
E'## Descrição\n\n' ||
E'App interno construído na plataforma **Lovable** (low-code / generative UI) com **Supabase** como backend (Postgres gerenciado + Auth + Storage). Usado pelo time comercial para gerar propostas comerciais padronizadas para clientes MYIO.\n\n' ||
E'## Motivação\n\n' ||
E'Substituir a montagem manual de propostas em planilhas/Word por um app que:\n\n' ||
E'- Padroniza catálogo de produtos/SKUs e preços.\n' ||
E'- Gera PDF com identidade visual MYIO.\n' ||
E'- Mantém histórico de propostas por cliente/oportunidade.\n\n' ||
E'## Categoria\n\n' ||
E'App Interno (Lovable + Supabase).\n\n' ||
E'## URL / Acesso\n\n' ||
E'- **URL principal:** _TODO_ (ex.: https://propostas.myio.com.br)\n' ||
E'- **Lovable workspace:** _TODO_\n' ||
E'- **Supabase project:** _TODO_\n' ||
E'- **Login:** Supabase Auth (e-mail + senha) — apenas e-mails @myio\n\n' ||
E'## API / Webhooks\n\n' ||
E'- **Docs:** Supabase REST/Realtime auto-gerado a partir do schema.\n' ||
E'- **Auth:** Supabase JWT (anon key + service role).\n' ||
E'- **Endpoints relevantes:** `/rest/v1/proposals`, `/rest/v1/customers`, `/storage/v1/object/proposals/*`.\n' ||
E'- **Integração com GCDR:** _avaliar_ — espelhar `customers` do GCDR para evitar reentrada de dados.\n\n' ||
E'## Custo\n\n' ||
E'- **Lovable:** _TODO_ — USD/mês conforme plano do workspace.\n' ||
E'- **Supabase:** _TODO_ — USD/mês (Free / Pro / Team).\n' ||
E'- **Modelo de cobrança:** assinatura mensal por workspace/projeto.\n\n' ||
E'## Plano atual\n\n' ||
E'- **Lovable:** _TODO (Free / Pro / Teams)_\n' ||
E'- **Supabase:** _TODO (Free / Pro / Team / Enterprise)_\n\n' ||
E'## Usuários suportados / Limites\n\n' ||
E'- **Seats Lovable:** _TODO_\n' ||
E'- **Supabase MAU:** depende do plano (Free 50k / Pro 100k).\n' ||
E'- **Storage:** _TODO_\n' ||
E'- **Database size:** _TODO_\n\n' ||
E'## Owner interno\n\n' ||
E'- **Responsável:** _TODO — squad Comercial_\n' ||
E'- **Backup técnico:** _TODO — squad Engenharia_\n\n' ||
E'## Status\n\n' ||
E'`ATIVO`\n\n' ||
E'## Datas\n\n' ||
E'- **Contratação:** _TODO_\n' ||
E'- **Renovação:** _TODO_\n\n' ||
E'## Integração com GCDR\n\n' ||
E'Hoje **não há integração direta**. Avaliar fluxo onde:\n\n' ||
E'1. App lê catálogo de clientes do GCDR via API key parceiro (`X-API-Key: gcdr_pk_*`).\n' ||
E'2. Ao fechar uma proposta, dispara webhook para o GCDR registrar a oportunidade.\n\n' ||
E'## Notas / Observações\n\n' ||
E'- O Lovable gera React + Tailwind exportável — em caso de migração, o código é portável.\n' ||
E'- Backups do Supabase: ativar **Point-in-Time Recovery** se ainda não estiver no plano Pro.\n' ||
E'- _TODO:_ documentar schema do banco Supabase (tabelas `proposals`, `proposal_items`, `customers`, `templates`).\n';

    -- 4) omie ----------------------------------------------------------------
    v_body_omie := E'# Omie\n\n' ||
E'## Descrição\n\n' ||
E'**Omie** é o ERP em nuvem usado pela MYIO para gestão financeira, fiscal e comercial: emissão de NF-e/NFS-e, contas a pagar/receber, fluxo de caixa, cadastro de clientes e fornecedores.\n\n' ||
E'## Motivação\n\n' ||
E'ERP brasileiro com forte cobertura fiscal (NF-e, NFS-e, SPED) e API REST decente. Substitui planilhas e dá rastreabilidade contábil.\n\n' ||
E'## Categoria\n\n' ||
E'ERP.\n\n' ||
E'## URL / Acesso\n\n' ||
E'- **URL principal:** https://app.omie.com.br\n' ||
E'- **Login:** e-mail + senha (com 2FA opcional)\n\n' ||
E'## API / Webhooks\n\n' ||
E'- **Docs:** https://developer.omie.com.br/\n' ||
E'- **Auth:** `app_key` + `app_secret` por aplicação registrada.\n' ||
E'- **Endpoints relevantes:**\n' ||
E'  - `ListarClientes` / `IncluirCliente`\n' ||
E'  - `ListarOrdemServico` / `IncluirOrdemServico`\n' ||
E'  - `ListarPedidos` / `IncluirPedido`\n' ||
E'  - `ListarContasReceber`\n' ||
E'- **Rate limit:** 60 chamadas / minuto por app_key (verificar plano).\n\n' ||
E'## Custo\n\n' ||
E'- **Valor:** _TODO — R$ X / mês_\n' ||
E'- **Moeda:** BRL.\n' ||
E'- **Modelo de cobrança:** assinatura mensal por plano.\n\n' ||
E'## Plano atual\n\n' ||
E'_TODO — confirmar com Financeiro (Essencial / Avançado / Premium)._\n\n' ||
E'## Usuários suportados / Limites\n\n' ||
E'- **Seats:** _TODO_\n' ||
E'- **NF-e/mês incluídas:** _TODO_\n' ||
E'- **Limites de API:** 60 req/min por app_key.\n\n' ||
E'## Owner interno\n\n' ||
E'- **Responsável:** _TODO — Financeiro_\n' ||
E'- **Backup técnico:** _TODO — Engenharia (para integrações via API)_\n\n' ||
E'## Status\n\n' ||
E'`ATIVO`\n\n' ||
E'## Datas\n\n' ||
E'- **Contratação:** _TODO_\n' ||
E'- **Renovação:** _TODO_\n\n' ||
E'## Integração com GCDR\n\n' ||
E'_A definir:_ sincronizar `customers` do GCDR ↔ Omie (CNPJ como chave). Ver RFC futura.\n\n' ||
E'## Notas / Observações\n\n' ||
E'- Credenciais (`app_key`, `app_secret`) **nunca** devem aparecer em chat/PR — usar cofre de secrets do GCDR.\n' ||
E'- API tem comportamento "tudo POST com `call`/`param`/`app_key`/`app_secret` no body" — não é REST puro.\n';

    -- 5) freshdesk -----------------------------------------------------------
    v_body_freshdesk := E'# Freshdesk\n\n' ||
E'## Descrição\n\n' ||
E'**Freshdesk** é a plataforma de helpdesk/ticketing usada pela MYIO para receber e tratar chamados de clientes (suporte L1/L2) e parceiros.\n\n' ||
E'## Motivação\n\n' ||
E'Centralizar canais de suporte (e-mail, formulário, chat) em um único pipeline com SLA, automações e relatórios. Substitui caixas de e-mail compartilhadas.\n\n' ||
E'## Categoria\n\n' ||
E'Helpdesk / Suporte.\n\n' ||
E'## URL / Acesso\n\n' ||
E'- **URL principal:** https://_TODO_.freshdesk.com\n' ||
E'- **Portal do cliente:** _TODO_\n' ||
E'- **Login:** SSO Google Workspace + senha local.\n\n' ||
E'## API / Webhooks\n\n' ||
E'- **Docs:** https://developers.freshdesk.com/api/\n' ||
E'- **Auth:** API Key (Basic Auth com `apikey:X`).\n' ||
E'- **Endpoints relevantes:**\n' ||
E'  - `GET /api/v2/tickets`\n' ||
E'  - `POST /api/v2/tickets`\n' ||
E'  - `PUT /api/v2/tickets/:id` (atualizar status/prioridade)\n' ||
E'  - `GET /api/v2/contacts`\n' ||
E'- **Webhooks:** suportados via Automations → Observers (gatilhos por mudança de campo).\n\n' ||
E'## Custo\n\n' ||
E'- **Valor:** _TODO_\n' ||
E'- **Moeda:** _TODO (USD ou BRL convertido)_\n' ||
E'- **Modelo de cobrança:** assinatura por agente/mês.\n\n' ||
E'## Plano atual\n\n' ||
E'_TODO — confirmar (Free / Growth / Pro / Enterprise)._\n\n' ||
E'## Usuários suportados / Limites\n\n' ||
E'- **Agentes:** _TODO_\n' ||
E'- **Tickets/mês:** ilimitado nos planos pagos.\n' ||
E'- **API rate limit:** depende do plano (tipicamente 1000 req/h).\n\n' ||
E'## Owner interno\n\n' ||
E'- **Responsável:** _TODO — Suporte_\n' ||
E'- **Backup técnico:** _TODO — Engenharia_\n\n' ||
E'## Status\n\n' ||
E'`ATIVO`\n\n' ||
E'## Datas\n\n' ||
E'- **Contratação:** _TODO_\n' ||
E'- **Renovação:** _TODO_\n\n' ||
E'## Integração com GCDR\n\n' ||
E'_Avaliar:_ ao abrir um ticket relacionado a um device, popular automaticamente `centralId`/`customerId` lendo do GCDR. Pode ser via webhook bidirecional.\n\n' ||
E'## Notas / Observações\n\n' ||
E'- API key fica vinculada ao usuário-dono — **não usar key de pessoa física**, criar usuário dedicado de integração.\n';

    -- 6) os-ordem-de-servico -------------------------------------------------
    v_body_os := E'# OS — Ordem de Serviço\n\n' ||
E'## Descrição\n\n' ||
E'Sistema de **Ordem de Serviço** (Field Service Management) para acompanhamento de visitas técnicas, instalações e manutenções nos sites dos clientes.\n\n' ||
E'> **TODO:** confirmar qual sistema está em uso (Omie OS embutido? Bitrix24? OneSignal? Sistema próprio?). A página está marcada como `AVALIAÇÃO` até que o owner confirme.\n\n' ||
E'## Motivação\n\n' ||
E'Garantir rastreabilidade de visitas técnicas — quem foi, quando, o que foi feito, peças trocadas, evidências (fotos), assinatura do cliente.\n\n' ||
E'## Categoria\n\n' ||
E'Field Service / Operações.\n\n' ||
E'## URL / Acesso\n\n' ||
E'- **URL principal:** _TODO_\n' ||
E'- **App mobile (técnicos):** _TODO_\n' ||
E'- **Login:** _TODO_\n\n' ||
E'## API / Webhooks\n\n' ||
E'- **Docs:** _TODO_\n' ||
E'- **Auth:** _TODO_\n' ||
E'- **Endpoints relevantes:** _TODO_\n' ||
E'- **Integração com GCDR:** o ideal é que cada OS aponte para `central_id` / `device_id` do GCDR — assim o histórico de manutenção fica linkado ao asset.\n\n' ||
E'## Custo\n\n' ||
E'- **Valor:** _TODO_\n' ||
E'- **Moeda:** _TODO_\n' ||
E'- **Modelo de cobrança:** _TODO_\n\n' ||
E'## Plano atual\n\n' ||
E'_TODO_\n\n' ||
E'## Usuários suportados / Limites\n\n' ||
E'- **Técnicos:** _TODO_\n' ||
E'- **OS/mês:** _TODO_\n\n' ||
E'## Owner interno\n\n' ||
E'- **Responsável:** _TODO — Operações_\n' ||
E'- **Backup técnico:** _TODO_\n\n' ||
E'## Status\n\n' ||
E'`AVALIAÇÃO` — aguardando confirmação do fornecedor/sistema.\n\n' ||
E'## Datas\n\n' ||
E'- **Contratação:** _TODO_\n' ||
E'- **Renovação:** _TODO_\n\n' ||
E'## Integração com GCDR\n\n' ||
E'_Proposta:_ cada OS gravar `central_id` e `customer_id` (UUIDs do GCDR) como referência cruzada. Assim o histórico de visitas técnicas fica conectado ao inventário de assets.\n\n' ||
E'## Notas / Observações\n\n' ||
E'_TODO — preencher após confirmação do owner._\n';

    -- -------------------------------------------------------------------------
    -- Helper-ish inline: insert page -> insert revision -> update page pointer.
    -- Cada página é guardada com NOT EXISTS para a seed ser idempotente.
    -- (Um DO block não pode definir funções, então repetimos o padrão 3-passos.)
    -- -------------------------------------------------------------------------

    -- 1) index ---------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Integrations' AND slug = 'index'
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
            v_page_id, v_tenant_id, 'Integrations', 'index',
            'Integrações Internas MYIO',
            'PUBLISHED',
            NULL,
            ARRAY['integrations','inventory','saas','myio-internal']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object('owner', 'engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Integrações Internas MYIO',
            v_body_index, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 2) template ------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Integrations' AND slug = 'template'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_template,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Integrations', 'template',
            'Template — Página de Integração',
            'PUBLISHED',
            NULL,
            ARRAY['integrations','template','meta']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object('owner', 'engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Template — Página de Integração',
            v_body_template, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 3) lovable-propostas ---------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Integrations' AND slug = 'lovable-propostas'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_lovable,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Integrations', 'lovable-propostas',
            'App Comercial — Gerador de Propostas (Lovable + Supabase)',
            'PUBLISHED',
            NULL,
            ARRAY['integrations','lovable','supabase','comercial','propostas','app-interno']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object(
                'owner',    'comercial@myio',
                'category', 'App Interno',
                'status',   'ATIVO'
            ),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'App Comercial — Gerador de Propostas (Lovable + Supabase)',
            v_body_lovable, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 4) omie ----------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Integrations' AND slug = 'omie'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_omie,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Integrations', 'omie',
            'Omie',
            'PUBLISHED',
            NULL,
            ARRAY['integrations','omie','erp','financeiro','fiscal']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object(
                'owner',    'financeiro@myio',
                'category', 'ERP',
                'status',   'ATIVO'
            ),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Omie',
            v_body_omie, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 5) freshdesk -----------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Integrations' AND slug = 'freshdesk'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_freshdesk,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Integrations', 'freshdesk',
            'Freshdesk',
            'PUBLISHED',
            NULL,
            ARRAY['integrations','freshdesk','helpdesk','suporte','tickets']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object(
                'owner',    'suporte@myio',
                'category', 'Helpdesk',
                'status',   'ATIVO'
            ),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Freshdesk',
            v_body_freshdesk, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 6) os-ordem-de-servico -------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'Integrations' AND slug = 'os-ordem-de-servico'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_os,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'Integrations', 'os-ordem-de-servico',
            'OS — Ordem de Serviço',
            'PUBLISHED',
            NULL,
            ARRAY['integrations','os','ordem-de-servico','field-service','operacoes']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object(
                'owner',    'operacoes@myio',
                'category', 'Field Service',
                'status',   'AVALIACAO'
            ),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'OS — Ordem de Serviço',
            v_body_os, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;
END $$;
