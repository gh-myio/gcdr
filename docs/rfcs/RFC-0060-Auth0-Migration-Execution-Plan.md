# RFC-0060 — Auth0 Migration Execution Plan (GCDR)

- **Feature Name:** `auth0_migration_execution_plan`
- **Start Date:** 2026-08-21
- **RFC PR:** _(this PR)_
- **Tracking Issue:** ED-1134
- **Status:** Draft
- **Authors:** GCDR Core Team
- **Domain:** Authentication / Identity / Authorization / Centrals
- **Extends:** [RFC-0059 — Auth0 Identity Platform & GCDR Grant Service](./RFC-0059-Auth0-Identity-Platform.md)
- **Related:** [RFC-0002 — GCDR Authorization Model](./RFC-0002-GCDR-Authorization-Model.md),
  [RFC-0009 — Events Audit Logs](./RFC-0009-Events-Audit-Logs.md), RFC-0011 (User
  Registration & Approval), RFC-0056 (Central API Key Bootstrap)

---

## Summary

RFC-0059 define **o quê** e **por quê**: GCDR como diretório autoritativo de usuários, Auth0
como camada de credencial, e um Grant Service que emite central grants ES256 assinados por
KMS. Este RFC define **como e em que ordem executar** — fase a fase, com cada item separado
entre o que é código deste repositório (GCDR) e o que depende de outros repositórios, painéis
de terceiros ou decisões organizacionais, para que cada fase possa virar subtasks executáveis.
Registra também um achado de segurança levantado durante o preparo deste plano, independente
da migração Auth0.

## Motivation

RFC-0059 já documenta três defeitos em produção que motivam a migração:

- **M1** — senha armazenada como SHA-256 sem sal (`src/services/AuthService.ts:111-116`,
  `hashPassword`/`verifyPassword`), equivalente a texto plano.
- **M2** — TOTP caseiro incompatível com apps autenticadores (contador de 4 bytes em vez de 8,
  secret lido como hex em vez de base32).
- **M3** — refresh tokens num `Map` em memória de processo. O Dokploy já roda **2 réplicas**
  em produção (`dokploy.yml:21`), então essa falha já está ativa hoje, não é hipotética.

O RFC-0059 chega a um desenho (três planos: autenticação via Auth0, identidade/autorização no
GCDR, verificação offline via central grant), mas deixa a execução — ordem das fases, o que é
interno vs. externo ao GCDR, dependências cross-repo — para ser detalhada depois. Esse é o
propósito deste RFC.

## Guide-level explanation

RFC-0059 §7 numera 6 fases. **Fases 2 e 5 são trabalho de plataforma/central, fora do GCDR**
(RFC-0059, nota entre parênteses no fim da tabela §7: *"Phases 2 and 5 — central
dual-acceptance burndown and service `client_credentials` — are platform/central work; see
the source RFC"*). As que o GCDR executa são **0, 1, 3, 4, 6**, nessa ordem — cada uma
bloqueada pela anterior. Só a Fase 0 é imediatamente acionável; as demais dependem de decisões
que a Fase 0 produz (o modelo multi-tenant do Auth0, a chave KMS, o tenant Auth0 provisionado).

Este RFC segue a branch `ED-1134-fase-0-auth0-prep` (aberta a partir de
`docs/rfc-0059-auth0-identity-platform`) para o trabalho da Fase 0. Fases seguintes devem abrir
suas próprias branches quando começarem, referenciando este RFC.

## Reference-level explanation

### Achado crítico adicional (fora do escopo formal do RFC-0059 — tratar em paralelo, com urgência)

Levantado durante o preparo deste plano, não estava documentado em nenhum RFC anterior:

- `authMiddleware` (`src/middleware/auth.ts:98-129`), que protege praticamente toda a
  superfície `/api/v1/*` (ver `docs/GCDR-USER.md`), chama `decodeJWT`
  (`src/middleware/context.ts:104-147`) para validar o Bearer token. **`decodeJWT` nunca
  verifica a assinatura HMAC do token** — só faz base64url-decode do payload, checa `exp` e
  valida que `tenant_id` parece um UUID. Não há nenhuma comparação contra `JWT_SECRET`.
- Na prática, qualquer requisição pode forjar um Bearer token hoje, com `sub`, `tenant_id`,
  `roles: ['*']` e `type: 'SERVICE_ACCOUNT'` arbitrários, sem conhecer `JWT_SECRET`, e será
  tratada como autenticada em qualquer rota que use `authMiddleware`.
- A implementação correta já existe e está sem uso: `AuthService.verifyJWT()`
  (`src/services/AuthService.ts:99-109`) chama `verifyHs256Signature()`
  (`src/shared/utils/jwtHs256.ts:30-48`, que compara a assinatura via
  `crypto.timingSafeEqual`) — mas nada no repositório chama `verifyJWT`, e `authMiddleware`
  usa o `decodeJWT` de `context.ts`, não esse.

**Recomendação:** abrir um hotfix separado, pequeno e independente da migração Auth0, que
troque o decode-sem-verificação de `decodeJWT` pela verificação de assinatura já implementada
em `verifyHs256Signature`. Isso fecha o buraco imediatamente, sem esperar a Fase 4 (RS256
contra o Auth0). Não é critério de aceite de nenhuma fase abaixo — é uma recomendação para
escalar com quem cuida de triagem de segurança em produção, em paralelo a este RFC.

### Fase 0 — Prep

RFC-0059 §7: *"Audit `(tenantId, email)` collisions (§1); provision KMS grant key; Terraform
Auth0 tenants."* O §1 bloqueia o Terraform: GCDR garante unicidade de email só por tenant
(`uniqueIndex('users_tenant_email_unique').on(tenantId, email)`,
`src/infrastructure/database/drizzle/schema.ts:254`), mas o Auth0 exige email único dentro de
uma Database Connection.

**Dentro do GCDR:**

- Criar `scripts/db/ops/audit-tenant-email-collisions.sql` (segue a convenção já existente em
  `scripts/db/ops/*.sql`): agrupar por `LOWER(email)`, contar `tenant_id` distintos, listar
  `COUNT(DISTINCT tenant_id) > 1` (id do usuário, tenant, status, `created_at`).
- Rodar contra réplica de leitura ou snapshot; classificar cada colisão (legítima vs.
  acidental/teste) — resultado alimenta a decisão do §1.
- Achado relacionado, ticket à parte: `UserRepository.findByEmail()`
  (`src/repositories/UserRepository.ts:333`) busca por email **sem filtrar por tenant**,
  usado por `AuthService.login()` (`AuthService.ts:167`, comentário "tenant-independent" no
  código) — se já existe colisão real, o login hoje já escolhe uma linha arbitrária.
- Atualizar a seção "Unresolved questions" do RFC-0059 com a decisão do §1 (opção a ou b) e a
  justificativa — desbloqueia o Terraform.
- Adicionar `GRANT_KMS_KEY_ID`/`GRANT_KMS_REGION` a `.env.example` e a `dokploy.yml`
  (referenciando `fromSecret:`, sem valor real commitado).
- Se o caminho `serverless.yml` estiver confirmado ativo (ver "Fora do GCDR"): adicionar a
  chave como recurso `AWS::KMS::Key` no bloco `resources:` (mesmo padrão do `GcdrEventBus`,
  `serverless.yml:2074`).
- Criar `infra/terraform/auth0/` (novo diretório — hoje não existe `.tf` no repo):
  `provider.tf`, `backend.tf`, `variables.tf`, e recursos `auth0_connection` (1 ou N conforme
  a decisão do §1), `auth0_client` (app humano PKCE), `auth0_action` (injeta `tid` de
  `app_metadata`), `auth0_resource_server` (audience RS256 da Fase 4), `auth0_client` M2M para
  o `Auth0ProvisioningService` (usado só na Fase 4, mas criado aqui).
- Adicionar workflow de CI (`fmt`/`validate`/`plan` em PR) para o Terraform.

**Fora do GCDR:**

- **AWS** — confirmar conta/região para a chave KMS (`sa-east-1`, default do
  `serverless.yml`); criar a chave (`ECC_NIST_P256`, `SIGN_VERIFY`, não exportável) via
  console/CLI se a via escolhida não for IaC; criar usuário IAM restrito a
  `kms:Sign`+`kms:GetPublicKey` só nessa chave (o Dokploy não é runtime nativo AWS, não tem
  role de execução).
- **Painel do Dokploy** — cadastrar os valores reais das novas variáveis de KMS no cofre de
  secrets.
- **AWS ou Terraform Cloud** — provisionar o backend de state do Terraform (bucket S3 + tabela
  DynamoDB de lock, ou workspace) — infra nova, uma vez.
- **Auth0 Dashboard** — confirmar/criar os tenants (dev + prod); criar manualmente a
  Machine-to-Machine Application com acesso à Management API (Terraform não pode criar as
  próprias credenciais que usa para se autenticar — pré-requisito obrigatório antes de rodar
  qualquer `terraform apply`).
- **GitHub** — novos secrets do repositório (credenciais Management API do Auth0 + AWS) para
  o CI rodar Terraform.
- **Produto/Segurança** — aval formal sobre a decisão do §1 (opção a vs. b).
- **Segurança/Operações** — decisão de custódia de break-glass da chave KMS (papel
  responsável, rotação de plantão) — Unresolved Question do próprio RFC-0059.
- **Dono da infra AWS** — confirmar se o caminho Lambda/`serverless.yml` ainda está ativo em
  produção paralelamente ao Dokploy (define onde a chave KMS entra).

**Critérios de aceite:**

- [ ] Auditoria executada, colisões classificadas, decisão do §1 registrada no RFC-0059.
- [ ] Chave KMS provisionada, política de acesso mínima, break-glass documentado.
- [ ] Terraform inicial aplicado (tenant, connection(s), action, resource server, client M2M).

### Fase 1 — Grant Service, dark

RFC-0059 §7: *"Ship the Grant Service behind a flag; integration tests only."* Bloqueada pela
Fase 0 (precisa da chave KMS e da decisão do modelo Auth0). É a única fase praticamente 100%
contida neste repositório — nada de novo "fora do GCDR" além do que a Fase 0 já provisionou.

**Dentro do GCDR:**

- Implementar `POST /v1/grants` (novo módulo, ex. `src/services/GrantService.ts` +
  `src/controllers/grants.controller.ts`), os 7 passos do RFC-0059 §5:
  1. Verificar o token Auth0 (assinatura JWKS, `iss`, `aud`, `exp`) — construir aqui o
     verificador RS256/JWKS reutilizável que a Fase 4 depois pluga no `authMiddleware` geral.
  2. Resolver o usuário GCDR a partir do `sub` (`auth0|<uuid>`, cruzado com
     `app_metadata.gcdr_user_id`); confirmar `status = ACTIVE`.
  3. Checar autorização via `AuthorizationService.evaluatePermission()`
     (`src/services/AuthorizationService.ts:373`) — modelar a permissão "operar central" no
     formato `resource.action.target` do RFC-0002 (ex. `centrals.grant.issue`).
  4. Intersectar escopos pedidos com escopos concedidos — nunca alargar.
  5. Se `offline`, exigir escopo `offline_field` + justificativa; teto de 30 dias (tabela RFC
     §5: online 15 min, offline rotina 7 dias, offline estendido 30 dias + `central:admin` +
     segundo aprovador).
  6. Assinar com a chave KMS (`ECDSA_SHA_256`) — dependência nova: `@aws-sdk/client-kms`.
     Atenção: KMS retorna a assinatura em DER, JOSE ES256 exige R‖S bruto — a conversão é
     ponto clássico de bug, merece teste dedicado.
  7. Gravar `jti`, subject, central, escopos, expiração, justificativa no audit log (RFC-0009,
     já implementado — escrita direta, não a captura automática via middleware de request).
- Validar `central_uuid` contra `CentralRepository`/`CentralService` existentes antes de
  emitir `aud: central:<uuid>`.
- Feature flag nova (ex. `GRANT_SERVICE_ENABLED`, default `false`), seguindo o padrão já usado
  por `DISABLE_AUTH` (`src/middleware/auth.ts:8`).
- Dependências novas no `package.json`: `jose` ou `jwks-rsa`, `@aws-sdk/client-kms`.
- Testes de integração (só integração nesta fase, por RFC) cobrindo emissão online/offline,
  negação cross-tenant, não-escalonamento de escopo, teto de 30 dias — seguir o padrão de
  `tests/unit/middleware/centralAuth.test.ts`.

**Fora do GCDR:** nenhuma configuração nova além da já feita na Fase 0 (tenant Auth0, chave
KMS). O Grant Service fica atrás de flag, sem cliente real ainda consumindo.

**Critérios de aceite:**

- [ ] `POST /v1/grants` funcional atrás da flag, cobrindo os 7 passos do §5.
- [ ] Verificador RS256/JWKS isolado em módulo reutilizável (reusado na Fase 4).
- [ ] Testes de integração cobrindo os casos acima.
- [ ] Auditoria RFC-0009 recebendo cada grant emitido.

### Fase 2 e Fase 5 — 100% fora do GCDR (não geram subtasks aqui)

A numeração pula de 1→3 e de 4→6 de propósito. RFC-0059 §7: *"Phases 2 and 5 — central
dual-acceptance burndown and service `client_credentials` — are platform/central work; see
the source RFC."*

- **Fase 2 — Central dual-acceptance burndown:** janela em que os centrals (CM4) aceitam tanto
  o esquema antigo (M5: a chave de verificação do central é a própria chave de assinatura)
  quanto o novo central grant ES256, até 100% da frota reconhecer o novo formato. Trabalho de
  firmware (`hubot_auth.erl`, RFC-0059 §6).
- **Fase 5 — `client_credentials` de serviço:** fluxo M2M do Auth0 para serviços da
  plataforma, possivelmente substituindo os shared secrets M2M restantes.

Ambas pertencem ao RFC de plataforma maior (`features/05-auth0-identity-platform-rfc.md`,
citado como "Based on" no cabeçalho do RFC-0059) — **esse arquivo não existe neste
repositório**, é de outro repo do ecossistema MYIO. Planejamento dessas duas fases precisa vir
de quem cuida do firmware/central, não deste repositório.

### Fase 3 — Consolidar Users

RFC-0059 §7: *"Migrate monorepo `Users` into GCDR; GCDR becomes the only user directory."* O
"monorepo" é o repositório irmão `data-ingestion` (`energy-platform`, yarn workspaces) — não é
este repositório. Trabalho aqui é majoritariamente cross-repo.

**Dentro do GCDR:**

- Mapear campos `data-ingestion.User` (TypeORM, email único global, bcrypt correto) →
  `gcdr.users` (tipo, status, tenant/customer).
- Registrar a decisão de distribuição tenant/customer para os usuários importados (decisão de
  negócio, mas o registro dela é um documento neste repo).
- Registrar a decisão sobre senha: importar hash bcrypt via `custom_password_hash` do Auth0
  (aceita bcrypt, ao contrário do SHA-256 do GCDR) vs. reset forçado uniforme para todos —
  RFC-0059 não resolve isso, é lacuna a decidir aqui.
- Escrever e rodar o script de import GCDR-side (lê do Postgres do `data-ingestion` ou de um
  export, cria linhas em `users` com o tenant decidido, preserva `id` quando possível).

**Fora do GCDR:**

- **`data-ingestion/packages/backend`** — descomissionar `AuthService`/`UserService`/rotas de
  auth (`auth.routes`, `userAuth.routes`, `management/user.management.routes`) depois da
  migração.
- **`data-ingestion/packages/dashboard`** e **`packages/presetup-nextjs`** — repontar
  `AuthContext.tsx`/`auth.ts`/`thingsboard-auth.ts` para GCDR + Auth0.
- **Risco de integridade referencial:** outras tabelas do `data-ingestion` referenciam
  `User.id` por FK — coordenar com os donos desse repositório antes de migrar/trocar ids.
- **`data-ingestion/packages/goals-backend`** — inventariar seu auth M2M próprio
  (`ApiClient` clientId/clientSecret); não é bloqueio da Fase 3, candidato a Auth0 M2M futuro.
- **`alarms-backend`** — não tem tabela própria de Users (hoje confia direto no `JWT_SECRET`
  do GCDR); não é alvo de migração de dados aqui, mas precisa mudar em paralelo à Fase 4 —
  mencionado aqui porque foi descoberto durante este levantamento.
- **Coordenação organizacional** com os donos de `data-ingestion` — sem isso a Fase 3 não
  anda, boa parte do trabalho não está no controle do time do GCDR.

**Critérios de aceite:**

- [ ] Decisões de distribuição de tenant e de política de senha registradas.
- [ ] Script de import rodado, usuários do `data-ingestion` presentes no GCDR sem duplicidade.
- [ ] `data-ingestion` e seus consumidores repontados para GCDR + Auth0; rotas antigas de auth
      removidas de lá.

### Fase 4 — Auth0 cutover

RFC-0059 §7: *"Identity-only import; password reset for all; RS256 middleware;
`/auth/login → 410 Gone`; delete `hashPassword`/`verifyPassword`/`verifyTOTP`/refresh map →
M1/M2/M3 close."* Bloqueada pelas Fases 0-3 e pelo sign-off jurídico de LGPD.

**Dentro do GCDR:**

- Implementar `Auth0ProvisioningService` (ao lado de `UserService`/`RegistrationService`),
  sentido único GCDR→Auth0: usuário criado/aprovado → `POST /api/v2/users` + ticket de reset;
  `status→SUSPENDED/INACTIVE` → `PATCH blocked:true`; `status→ACTIVE` → `PATCH blocked:false`;
  email alterado → `PATCH` + `email_verified:false`; deletado → `DELETE`. Idempotente por id
  do usuário GCDR, enfileirado e com retry — decidir mecanismo (o `GcdrEventBus` já existe,
  `serverless.yml:2074`, ou uma tabela outbox + worker, já que o runtime real é Dokploy, não
  Lambda).
- Job de reconciliação noturna (drift sempre resolvido a favor do GCDR) — precisa de um
  scheduler; avaliar padrão de `CentralRestoreSweep.ts` como referência de "sweep" existente.
- Substituir `authMiddleware` → `decodeJWT` (`auth.ts:98`, `context.ts:104`) pelo verificador
  RS256/JWKS construído na Fase 1 (cache JWKS ~12h, refresh sob rate limit em `kid`
  desconhecido); resolver usuário via `sub`, carregar roles via `AuthorizationService`.
- `/auth/login` → 410 Gone. Revisar `/auth/refresh`, `/auth/mfa/verify`, `/auth/logout`
  (obsoletos — sessão/MFA passam a ser do Auth0). Redesenhar o fluxo de auto-registro
  (RFC-0011: `/auth/register`, `/auth/verify-email`, `/auth/forgot-password`,
  `/auth/reset-password`) — o RFC-0059 não define como isso funciona com Auth0; provável que o
  GCDR continue criando o registro `PENDING_APPROVAL`/`UNVERIFIED` mas o Auth0 passe a mandar o
  e-mail de verificação/senha via provisioning. **Lacuna de design a resolver antes de
  implementar** (ver Unresolved questions).
- Deletar `hashPassword`/`verifyPassword`/`verifyTOTP` (`AuthService.ts:111-145`) e o mapa de
  refresh em memória (`AuthService.ts:150-151`) + `refresh()`/`logout()`/
  `logoutAllDevices()`/`generateTokens()` — fecha M1/M2/M3.
- Validar que `hybridAuthMiddleware` (`auth.ts:182`, Bearer JWT com fallback para
  `X-API-Key`) continua funcionando com o novo verificador RS256 (Partner/Customer API Key
  continuam sem mudança, RFC-0059 §4).

**Fora do GCDR:**

- **Jurídico** — sign-off de LGPD sobre transferência internacional de email/nome (Auth0 sem
  região BR) — gate obrigatório antes desta fase, iniciar cedo pelo lead time.
- **Negócio/Procurement** — validação de pricing do Auth0 (MAU + M2M) vs. projeção de 3 anos.
- **Auth0 Dashboard** — configurar templates de e-mail (reset de senha, verificação) e
  política de MFA/passkeys; disparar o import de identidade em massa e o convite de reset de
  senha para todos os usuários no cutover.
- **Painel do Dokploy** — cadastrar as credenciais do client M2M do
  `Auth0ProvisioningService`.
- **`alarms-backend`** (repo separado) — atualizar `auth.middleware.ts` (validação de token) e
  `gcdr.service-auth.ts` (hoje faz login de conta de serviço via `POST /auth/login`, que deixa
  de existir) para o novo esquema — sem isso o Alarms para no dia do cutover. Coordenação
  cross-repo obrigatória, não é algo que o GCDR resolve sozinho.

**Critérios de aceite:**

- [ ] Sign-off jurídico de LGPD obtido.
- [ ] Import de identidade concluído, reset de senha disparado para 100% dos usuários.
- [ ] Middleware RS256/JWKS em produção; `/auth/login` retornando 410.
- [ ] `hashPassword`/`verifyPassword`/`verifyTOTP`/mapa de refresh removidos do código.
- [ ] `alarms-backend` migrado, sem regressão.
- [ ] Fluxo de auto-registro (RFC-0011) redesenhado e funcionando com Auth0.

### Fase 6 — Removal

RFC-0059 §7: *"Drop `security.passwordHash`, `JWT_SECRET`; remove dead auth deps."*

**Dentro do GCDR:**

- Parar de ler/escrever `security.passwordHash` (campo dentro do JSONB `security`, não é
  coluna própria) + script de limpeza opcional para as linhas existentes.
- Remover `JWT_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE`/`JWT_EXPIRES_IN`/`JWT_REFRESH_EXPIRES_IN`
  de `.env.example` e `dokploy.yml`.
- **Cuidado:** `src/shared/utils/jwtHs256.ts` (`verifyHs256Signature`) também é usado por
  `src/middleware/centralAuth.ts` (JWT HS256 do poll-loop dos centrals, Plano 3 do RFC-0059,
  explicitamente **não tocado** por esse RFC) — não remover esse arquivo, só o uso ligado a
  usuário humano.
- Remover rotas/controllers mortos de `auth.controller.ts` e os handlers Lambda equivalentes
  em `src/handlers/auth/*`, condicionado à confirmação (Fase 0) de se o caminho
  Lambda/`serverless.yml` segue ativo.
- Auditar e atualizar `scripts/db/seeds` (provavelmente ainda populam
  `security.passwordHash` para usuários de teste).

**Fora do GCDR:**

- **Painel do Dokploy** — desativar `JWT_SECRET` e demais variáveis JWT do cofre de secrets.
- **Dono da infra AWS** — se `serverless.yml` for confirmado morto, decidir sobre desligar de
  vez o stack Lambda associado.

**Critérios de aceite:**

- [ ] `security.passwordHash` não é mais lido/escrito em nenhum caminho de código.
- [ ] `JWT_SECRET` removido do código e do cofre do Dokploy.
- [ ] Dependências mortas removidas, `jwtHs256.ts` preservado (uso do central agent).
- [ ] Seeds/fixtures de teste atualizados.

### Verificação (ponta a ponta, por fase)

- **Fase 0:** re-rodar o script de auditoria (zero colisões não resolvidas); `terraform plan`
  sem diff pós-`apply`; `aws kms describe-key` confirmando spec/política; `kms:Sign` validado
  contra `aws kms get-public-key`.
- **Fase 1:** suíte de integração cobrindo emissão online/offline, negação cross-tenant,
  não-escalonamento de escopo, teto de 30 dias; grant emitido aparece no audit log.
- **Fase 3:** contagem de usuários migrados bate com a origem; login via GCDR funciona para um
  usuário migrado; dashboard/presetup-nextjs do `data-ingestion` autenticam via GCDR.
- **Fase 4:** token forjado sem assinatura Auth0 válida é rejeitado (fecha também o achado
  crítico deste RFC); `/auth/login` retorna 410; `alarms-backend` continua funcionando
  pós-cutover.
- **Fase 6:** grep por `passwordHash`/`JWT_SECRET` no código retorna vazio (fora de
  `centralAuth`/`jwtHs256.ts`, que permanecem).

## Drawbacks

Os mesmos do RFC-0059 (reset de senha obrigatório para todos, custo escalando com MAU+M2M,
lock-in de credencial no Auth0, LGPD/residência, dependência de disponibilidade do Auth0 para
novos logins, mais peças móveis operacionais). Este RFC não adiciona novos drawbacks — só
sequencia o trabalho.

## Rationale and alternatives

Ver RFC-0059 (Alternativas A/B/C). Este RFC assume a decisão já tomada de seguir com Auth0 +
Grant Service e foca em como executar isso com o mínimo de surpresas cross-repo.

## Unresolved questions

Herdadas do RFC-0059 (não resolvidas por este RFC, só sequenciadas):

- Modelo multi-tenant do Auth0 (§1) — resolvido pela Fase 0.1/0.2 deste plano.
- Obrigações de disclosure de M1 (LGPD) — jurídico, independente deste RFC.
- Região do Auth0 + sign-off de transferência internacional — jurídico, gate da Fase 4.
- Pricing do Auth0 vs. projeção de 3 anos.
- Teto de 30 dias offline confere com a realidade de campo? — operações de campo precisa
  confirmar.
- Custódia de break-glass da chave KMS.

Novas, levantadas durante este levantamento:

- **Fluxo de auto-registro (RFC-0011) com Auth0** — RFC-0059 não define como
  `/auth/register`/verificação de e-mail/reset de senha funcionam depois do cutover. Precisa
  de desenho antes da Fase 4.
- **Mecanismo de fila do `Auth0ProvisioningService`** — `GcdrEventBus` (EventBridge) existente
  vs. tabela outbox + worker (dado que o runtime real é Dokploy, não Lambda). Decidir antes da
  Fase 4.
- **`serverless.yml`/Lambda ainda está ativo em produção?** — precisa de confirmação do dono
  da infra AWS; afeta onde a chave KMS entra (Fase 0) e se há rotas/handlers mortos para
  remover (Fase 6).
- **Import de hash bcrypt (`data-ingestion`) vs. reset forçado uniforme** — RFC-0059 só
  resolve isso para as senhas SHA-256 nativas do GCDR; a Fase 3 precisa de uma decisão própria
  para a base do `data-ingestion`, que já tem bcrypt correto.
- **`decodeJWT` sem verificação de assinatura** (`src/middleware/context.ts:104-147`) — achado
  de segurança independente deste RFC, recomendado como hotfix em paralelo (ver seção acima).

## Prior art

Ver RFC-0059.

## Future possibilities

Ver RFC-0059.
