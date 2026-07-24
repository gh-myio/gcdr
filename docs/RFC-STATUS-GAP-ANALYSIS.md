# GCDR — Análise de Lacunas: RFCs e Melhorias Não Implementadas

**Data:** 2026-07-24
**Escopo:** backend (`gcdr.git`) + frontend (`gcdr-frontend.git`)
**Branch de referência:** `origin/desenv` nos dois repos (é a branch de integração real; `main` está congelada desde janeiro/2026)

---

## Metodologia

O status declarado no cabeçalho dos RFCs **está desatualizado em vários casos** — vários docs dizem `Draft` mas o código já está em `desenv`, e outros dizem `Implemented` mas nunca foram mergeados. Por isso este levantamento **não confia no campo `Status:`**. Cada item foi classificado cruzando três evidências:

1. **Status declarado** no `.md` do RFC (`docs/rfcs/*.md`, `docs/*.md` no frontend);
2. **Código presente em `origin/desenv`** (controllers, tabelas do schema Drizzle, greps por símbolos da feature);
3. **Estado da branch** (`git merge-base --is-ancestor <branch> origin/desenv`).

Onde a evidência é indireta, o item está marcado com ⚠️ e a incerteza está explicitada.

### Legenda

| Marca | Significado |
|---|---|
| 🔴 **NÃO IMPLEMENTADO** | Nenhum código correspondente em `desenv`, nenhuma branch em voo |
| 🟠 **PRONTO, NÃO MERGEADO** | Código existe numa branch, mas fora de `desenv` |
| 🟡 **PARCIAL** | Parte em `desenv`, parte pendente |
| 🔵 **GAP DE PARIDADE** | Backend pronto, frontend ausente (ou vice-versa) |
| ⚠️ | Classificação com evidência indireta — confirmar |

---

## 1. Panorama executivo

| Categoria | Qtd |
|---|---|
| RFCs backend catalogados | ~60 arquivos em `docs/rfcs/` |
| 🔴 Nunca implementados | **11** |
| 🟠 Implementados mas não mergeados | **6** (backend) + **5** (frontend) |
| 🟡 Parciais / com pontas soltas | **7** |
| 🔵 Gaps de paridade back↔front | **4** |

**Os três riscos maiores, na minha leitura:**

1. **`main` está congelada desde 28–29/01/2026 nos dois repos**, com 543 commits de diferença para `desenv` em cada. Seja qual for a branch que prod deploya, existe uma divergência enorme e não rastreada entre o que está versionado como "principal" e o que está em uso. Isso precisa de uma decisão explícita (promover `desenv`, ou assumir `desenv` como default branch).
2. **Quatro PRs de feature ficaram parados** (`central-wifi-command`, `signal-topology`, `rfc-0045-email-ingestion`, `rfc-0050-presetup`), todos com trabalho pronto e revisado. É estoque de valor parado.
3. **RFC-0054 (metas monetárias/tarifas) está APPROVED & FROZEN mas fora de `desenv`** — é a feature em curso e a mais exposta a conflito quanto mais tempo ficar na branch.

---

## 2. 🔴 RFCs nunca implementados

Nenhum código correspondente encontrado em `origin/desenv`, e nenhuma branch aberta.

| RFC | Título | Status no doc | Evidência da ausência |
|---|---|---|---|
| **RFC-0012** | Features Registry | Draft | `featureRegistry` / `features_registry`: 0 arquivos; sem tabela no schema |
| **RFC-0022** | ThingsBoard–GCDR Device Conformity | Draft | `conformity`: 0 arquivos em `src` |
| **RFC-0031** | Wiki Engagement Export and Admin | Draft | `engagement`: 0 arquivos (a wiki base do RFC-0030 **existe**; só o módulo de engajamento/export não) |
| **RFC-0049** | Dashboard Governance | Draft | `dashboard_governance`: 0 arquivos |
| **RFC-0048** | Dokploy Log Cockpit / On-call | Draft (proposta, infra) | Sem contrapartida no código — é runbook de infraestrutura |
| **RFC-0040** | Device Label Only (remover `displayName`) | DRAFT — não aprovado | Deliberadamente não implementado; estudo de impacto em 5 repos, `alarms-backend` é o consumidor crítico |
| **RFC-0014** | Device–Rules Association | Draft | Superado na prática por `scope_entity_ids uuid[]` nas rules ⚠️ |
| **RFC-0016** | ThingsBoard Entity Mapping | Draft | Parcialmente absorvido: `external_id` em customers existe, mas o mapeamento completo do RFC não ⚠️ |
| **RFC-0002** | GCDR Authorization Model | Draft | O RBAC operante existe (`authorization.controller.ts`, `policies`, `roles`), mas o doc nunca foi promovido a Implemented — **provável dívida de documentação, não de código** ⚠️ |
| **RFC-0013** | User Access Profile Bundle (backend) | Draft | `access-bundle.controller.ts` existe em `desenv` → provável dívida de doc ⚠️ (o RFC do frontend já está `Implemented`) |
| **RFC-0032 Fase 5** | QR Checker — Fase 5 | Pendente (Fases 1–4 ✅) | Fases 5–8 marcadas RETIRED no RFC principal; a Fase 5 tem doc próprio ainda "Pendente" — **conflito entre os dois docs, precisa decisão** |

> **Ação sugerida:** RFC-0002, RFC-0013, RFC-0014 e RFC-0016 parecem ser **dívida de documentação** (código existe, doc não foi atualizado). Vale uma passada de curadoria fechando esses status antes de tratá-los como backlog real — senão inflam o backlog artificialmente.

---

## 3. 🟠 Implementados mas NÃO mergeados em `desenv`

Trabalho pronto (em alguns casos já revisado) parado fora da branch de integração. **É aqui que está o valor imediato.**

### Backend (`gcdr.git`)

| Branch | RFC / feature | Commits à frente | Situação |
|---|---|---|---|
| `feat/rfc-0054-tariffs-p1` | **RFC-0054** Metas monetárias + tarifas | +5 | APPROVED & FROZEN. `customer_tariffs` **não existe** em `desenv` (grep `tariff` = 0 arquivos). É a branch de trabalho atual |
| `feat/signal-topology` | Topologia de sinal (device-topology) | +11 | **PR #19** — em `CHANGES_REQUESTED`: conflito de merge + CodeQL SSRF em aberto |
| `feat/central-wifi-command` | SET_WIFI para centrais CM4 | +6 | **PR #20** — em `CHANGES_REQUESTED`: verificar credencial fora do histórico, numeração 0056/0057, agent monorepo#31 |
| `feature/rfc-0028-device-calibration-offsets` | **RFC-0028** Offsets de calibração | +6 | Confirmado ausente de `desenv`: as 4 ocorrências de `calibration` em `desenv` são de `AlarmBundle`/`Rule` (calibração de regra), **não** dos offsets por device do RFC-0028 |
| `feat/rfc-0045-email-ingestion` | **RFC-0045** Email → Ticket | +1 | `work_orders_ticket_meta` já existe em `desenv`, então parte do alicerce entrou; o ingestor em si não ⚠️ |
| `feat/rfc-0050-presetup-backend` | **RFC-0050** Migração presetup → GCDR | +1 | Aguardando aprovação do RFC antes de portar o código |

### Frontend (`gcdr-frontend.git`)

| Branch | Feature | Commits à frente | Situação |
|---|---|---|---|
| `feat/signal-topology` | View SVG da topologia | +4 | **PR #16** — `CHANGES_REQUESTED`; depende do backend #19 |
| `feat/central-wifi-command` | UI Configurar WiFi | +3 | **PR #17** — `CHANGES_REQUESTED`; depende do backend #20 + agent |
| `feat/rfc-0020-presetup-migration` | **RFC-0020** Presetup (frontend) | +1 | Par do RFC-0050 backend |
| `feat/rfc-0045-email-ingestion` | Email → Ticket (UI) | +1 | Par do backend |
| `docs/rfc-0022-ci-quality-gates` | CI / quality gates | +2 | Relevante: **as branches de PR não reportam checks de CI** (levantado nas reviews de #16 e #17) |
| `fix/modal-scroll-overflow` | Fix de scroll em modal | +1 | Fix isolado parado |

---

## 4. 🟡 Implementados parcialmente / com pontas soltas

| RFC | O que já está em `desenv` | O que falta |
|---|---|---|
| **RFC-0051** Work Order Groups | `work_orders.parent_id` + índice parcial já existem no schema (linha ~1886) | O tipo `GRUPO` e a lógica de agrupamento não aparecem (`wo_group`: 0 arquivos). Status "Draft — urgent" ⚠️ |
| **RFC-0041** WO Rules Engine | Tabela `work_orders_lifecycle_rules` existe | Motor de regras propriamente dito não confirmado (`wo_rules`/`woRules`: 0 arquivos) ⚠️ |
| **RFC-0001** Integration Marketplace | Tabelas `integration_packages`, `package_subscriptions` | Doc declara "In Progress — Phase 1 MVP ~60%". Os 40% restantes não estão especificados em lugar nenhum |
| **BACKEND-RFC-0021-v2** HTML Templates | Engine implementada (`templates.controller.ts`, `template_types`) | Doc declara literalmente "**novos endpoints pendentes + frontend pendente**" |
| **RFC-0046 Addendum A** Metas por device | Branch **mergeada** em `desenv` (back + front) | Migrations 0060/0061 pendentes; curadoria Moxuara; coluna `device` no CSV |
| **RFC-0033** Customer Integration Sync State | Implementado | Parcialmente superseded pelo RFC-0035 — vale marcar formalmente o que foi substituído |
| **RFC-0026** Device Availability Tracking | — | **SUPERSEDED** — pode sair do backlog ativo |

---

## 5. 🔵 Gaps de paridade backend ↔ frontend

Backend pronto em `desenv`, frontend ausente. São features **já pagas** que o usuário final não alcança.

| Feature | Backend em `desenv` | Frontend em `desenv` | Lacuna |
|---|---|---|---|
| **RFC-0018** Overrides de valor por device | ✅ `valueOverride`/`deviceOverride`: 5 arquivos | ❌ `valueOverride`: 0 arquivos | **Sem UI.** Backend entregue, inacessível pelo operador |
| **RFC-0054** Tarifas | 🟠 só na branch | ❌ `tariff`: 0 arquivos | Frontend nem começou |
| **Topologia de dispositivos** | 🟠 só na branch (#19) | 🟠 só na branch (#16) | Nenhum dos dois em `desenv` |
| **RFC-0028** Offsets de calibração | 🟠 só na branch | ⚠️ `calibration`: 3 arquivos (verificar se é da feature ou de rules) | Verificar |

> Observação: `deviceOverride` aparece em 2 arquivos do frontend contra 5 do backend — sugere UI apenas parcial, não ausente. Confirmar antes de planejar.

---

## 6. Melhorias técnicas pendentes (levantadas nas reviews dos PRs em aberto)

Não são RFCs, mas são débitos registrados e ainda não resolvidos.

### Arquitetura

| Item | Origem | Descrição |
|---|---|---|
| **GET que muta o banco** | PR #19 | `GET /centrals/:id/device-topology` reconcilia `connection_status` e `connectivity_status` como efeito colateral da leitura. Quebra idempotência de GET (cache/retry/replica viram escrita) e faz as contagens da lista só ficarem frescas depois que alguém abre a topologia. **Deveria ser um reconciler agendado ou push do cloud-server.** Sem issue de rastreio até agora |
| **Poll de 8s amplifica o item acima** | PR #16 | O hook do frontend chama esse GET a cada 8s enquanto a tela estiver aberta → uma escrita no banco a cada 8s por central + devices. A cadência do frontend dirige writes do backend |

### Segurança

| Item | Origem | Descrição |
|---|---|---|
| **Senha WiFi via `argv` / `ps`** | PR #20 / #17 | A senha passada como argumento para `myio-wifi-set` fica visível no `ps` da central. Mitigações de transporte e persistência já entraram (strip/null/redact); **este vetor segue diferido** e depende de mudança no próprio `myio-wifi-set`. Sem issue de rastreio |
| **CodeQL SSRF #184** | PR #19 | Mitigação (allowlist UUID + `encodeURIComponent`) já está no código; o alerta segue aberto — falta dismissar ou subir a validação para a camada de rota/DTO |

### Processo / infraestrutura

| Item | Descrição |
|---|---|
| **CI ausente nas branches do frontend** | PRs #16 e #17 não reportam checks; validação é `tsc --noEmit` + eslint local colados no PR. Existe branch `docs/rfc-0022-ci-quality-gates` parada, não mergeada |
| **Cobertura de testes ~12%** | Reportado pelo CI do backend (12,02% linhas / 10,79% statements / 11,19% branches) |
| **Colisão de numeração de migrations** | Migrations são numeradas manualmente com runner custom; PRs paralelos disputam número (ex.: PR #20 usa 0056/0057 sendo que a árvore já passou de 0063). Sem mecanismo de reserva |
| **Journal do Drizzle congelado no 0012** | A cadeia não reconstrói o schema do zero (quebra em 0017/templates). Runner custom `schema_migrations` |
| **`main` congelada desde jan/2026** | 543 commits de diferença para `desenv` nos **dois** repos. Precisa de decisão explícita |

---

## 7. Priorização sugerida

Ordenado por (valor destravado) ÷ (esforço), na minha leitura:

### Faixa 1 — destravar estoque parado (dias)
1. **Fechar PRs #19/#16 e #20/#17.** São 4 PRs revisados com o trabalho feito; o que falta é rebase, CodeQL e coordenação de ordem de merge. Maior retorno imediato do backlog inteiro.
2. **Mergear RFC-0054 (tarifas) em `desenv`.** Está APPROVED & FROZEN e acumulando risco de conflito.
3. **Mergear `fix/modal-scroll-overflow`** — fix isolado, custo ~zero.

### Faixa 2 — decisões que destravam o resto (horas de decisão)
4. **Resolver `main` vs `desenv`.** Enquanto não houver decisão, "o que está em produção" é ambíguo — e isso contamina toda avaliação de risco de deploy.
5. **Curadoria de status dos RFCs.** Fechar RFC-0002, 0013, 0014, 0016 como implementados/superseded. Resolve o conflito RFC-0032 Fase 5 (RETIRED vs Pendente). Backlog encolhe sem escrever uma linha de código.
6. **Aprovar ou arquivar RFC-0050/RFC-0020 (presetup).** Duas branches paradas esperando decisão desde 03/07.

### Faixa 3 — dívida com prazo (semanas)
7. **Issue para o "GET que muta"** e migrar o reconcile para fora do read path.
8. **Issue para o vetor `argv`/`ps`** da senha WiFi.
9. **Mergear `docs/rfc-0022-ci-quality-gates`** — CI de verdade nas branches do frontend.
10. **UI do RFC-0018** (overrides por device) — backend entregue e inacessível.

### Faixa 4 — backlog real de produto
11. RFC-0051 (WO Groups — marcado urgente, alicerce parcialmente pronto)
12. RFC-0045 (email→ticket, +1 commit de distância)
13. RFC-0028 (offsets de calibração, +6 commits)
14. RFC-0001 (completar os 40% do marketplace — **precisa ser especificado antes**)
15. RFC-0012, 0022, 0031, 0049 (nunca iniciados — revalidar se ainda fazem sentido)

---

## 8. Itens que precisam de confirmação (⚠️)

Não consegui fechar com a evidência disponível. Recomendo confirmar antes de planejar em cima:

- **RFC-0041** — `work_orders_lifecycle_rules` existe, mas o motor de regras não foi localizado. Pode estar sob outro nome.
- **RFC-0051** — `parent_id` existe em `work_orders`; falta saber se o tipo `GRUPO` foi implementado sob outra nomenclatura.
- **RFC-0028** — os 3 arquivos de `calibration` no frontend precisam ser inspecionados (feature vs. calibração de rules).
- **RFC-0045** — `work_orders_ticket_meta` em `desenv` sugere que parte entrou; a branch tem só +1 commit.
- **RFC-0032 Fase 5** — o RFC principal diz Fases 5–8 RETIRED; o doc da Fase 5 diz "Pendente". **Conflito documental que precisa de decisão humana.**
- **RFC-0002 / 0013 / 0014 / 0016** — classificados como provável dívida de documentação; confirmar antes de fechar.

---

*Documento gerado a partir do estado de `origin/desenv` em 2026-07-24. As classificações de "implementado" se baseiam na presença de código, não em validação funcional.*
