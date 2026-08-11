# RFC-0057 Customer Config Document - feedback pre-merge v1

Data: 2026-08-10
Branch revisada: `feat/rfc-0057-customer-config`
Base comparada: `desenv`
RFC alvo: `docs/rfcs/RFC-0057-Customer-Config-Document.md`

## Resumo

A branch implementa uma boa base do documento consolidado: DTOs estritos,
normalizacao de defaults, mascara de secrets, CRUD `/customers/:customerId/config`,
sub-recurso `/config/secrets`, preservacao de `bundle`/secrets e testes unitarios
do service/DTO/controller.

Antes do merge, eu ajustaria principalmente autorizacao, contrato OpenAPI e alguns
detalhes de semantica do RFC. Os dois primeiros sao bloqueantes porque expõem um
endpoint de configuracao de cliente com escopo mais amplo que o especificado e
deixam o contrato publico divergente do backend.

## Achados bloqueantes

### P0.1 - Falta guarda de hierarquia/RBAC por cliente nos endpoints de config

`src/app.ts:297` monta `/customers/:customerId/config` somente com
`hybridAuthByMethod(customers:read, customers:write)`. Esse middleware autentica e,
para API key, valida escopo, mas nao valida se o `:customerId` esta dentro do
alcance `SELF`/`SUBTREE`/`TENANT` da chave. Para JWT, tambem nao avalia permissao
RBAC contra `customer:<id>`.

Impacto:

- Uma API key `SELF` com `customers:read`/`customers:write` pode chamar config de
  outro cliente do mesmo tenant, porque o service cai direto em
  `CustomerRepository.getById(tenantId, id)` (`src/repositories/CustomerRepository.ts:65`).
- Um JWT valido passa pelo `hybridAuthMiddleware` sem checagem de permissao
  especifica, diferente da matriz do RFC que exige reader/operator role.
- `GET /customers/:id?include=config` herda o mesmo problema, pois o router geral
  de customers tambem esta montado apenas com `hybridAuthByMethod`
  (`src/app.ts:354`) e injeta `configResolved` em `src/controllers/customers.controller.ts:146`.

O proprio projeto ja tem um padrao para esse fechamento em
`requireGoalsAccess`/`requireTariffAccess`: escopo ja autenticado no middleware
hibrido, depois guarda de hierarquia para API key e RBAC por resource scope para
JWT. Recomendo criar algo equivalente para customer config, por exemplo
`requireCustomerConfigAccess()`, e aplicar tanto ao mount `/config` quanto ao fluxo
inline `?include=config`.

Testes esperados pelo RFC DEC-8 ainda faltam em nivel de integracao:

- API key `SELF` nega outro customer do mesmo tenant com `404`.
- API key `SUBTREE` permite descendente e nega fora da subarvore.
- API key `TENANT` permite qualquer customer do tenant.
- Cross-tenant retorna `404`.
- JWT sem permissao de leitura/escrita recebe `403`.

### P0.2 - Secrets endpoint nao aplica `customers:secrets:read`

O controller tem TODO explicito em `src/controllers/customer-config.controller.ts:29`
dizendo que a guarda `customers:secrets:read` ainda nao existe. Hoje
`src/app.ts:296` monta `/customers/:customerId/config/secrets` com `authMiddleware`;
isso bloqueia customer API key comum, mas permite qualquer JWT valido revelar ou
alterar secrets se conhecer o customer id.

Isso diverge do RFC DEC-7/DEC-8:

- `GET /customers/:id/config/secrets`: operador + `customers:secrets:read`.
- `PUT /customers/:id/config/secrets`: operador + `customers:secrets:read`.
- API key negada.
- Reveal obrigatoriamente auditado.

O service audita reveal/write e nao loga valores, o que e bom. O gap e a
autorizacao antes de chegar ao service. Eu trataria como bloqueante porque esses
endpoints retornam plaintext de `clientSecret` e `masterAdminPassword`.

### P0.3 - `docs/openapi.yaml` nao foi atualizado

O diff da branch nao inclui `docs/openapi.yaml`, e uma busca por
`/customers/{customerId}/config`, `config/secrets`, `CustomerConfig` e
`configResolved` nao encontrou entradas na spec.

Isso falha a acceptance criteria #12 do RFC:

- documentar `GET/PUT/PATCH/DELETE /customers/:id/config`;
- documentar `GET/PUT /customers/:id/config/secrets`;
- documentar os tres DTOs/read model;
- incluir exemplos com secrets mascarados;
- documentar `GET /customers/:id?include=config` e `configResolved`.

Ha um `docs/api/API-Customer-Config.md` novo e util, mas ele nao substitui o
contrato formal servido pelo Swagger em `/docs`.

## Achados importantes

### P1.1 - Semantica de `null` do DEC-9 nao esta implementada para varios campos

O RFC DEC-9 diz que campo escalar `null` deve limpar para default, ou ser
preservado como `null` onde o campo permite. A implementacao atual rejeita `null`
em varias secoes governadas porque os schemas usam `z.boolean().optional()` ou
`z.number().optional()`:

- `alarms` em `src/dto/request/CustomerConfigDTO.ts:87`;
- `tickets` em `src/dto/request/CustomerConfigDTO.ts:95`;
- `temperature` em `src/dto/request/CustomerConfigDTO.ts:130`;
- `ingestion.clientId` em `src/dto/request/CustomerConfigDTO.ts:170`.

Exemplo de divergencia: `PATCH { "alarms": { "showOffline": null } }` deveria
limpar para o default `false` pelo RFC, mas hoje retorna `400`. Ha duas saidas
aceitaveis antes do merge:

- implementar `null` como clear-to-default em DTO/service;
- ou ajustar o RFC/API guide para dizer explicitamente que `null` nao e aceito
  nesses campos no MVP.

Como o RFC ja usa DEC-9 como contrato, eu preferiria implementar.

### P1.2 - `CUSTOMER_CONFIG_UPDATED` nao carrega `before`/`after`

O RFC DEC-12 pede evento/audit com `changedPaths`, `before` e `after` redigidos.
Hoje `emitConfigUpdated` recebe apenas `method`, `version` e `changedPaths`
(`src/services/CustomerConfigService.ts:341`), e as chamadas em PUT/PATCH/DELETE
passam `leafPaths(dto)` ou `['*']` (`src/services/CustomerConfigService.ts:120`,
`src/services/CustomerConfigService.ts:155`, `src/services/CustomerConfigService.ts:177`).

Isso e suficiente para trilha minima, mas nao atende o detalhe do RFC. Sugestao:
capturar read model redigido antes/depois, ou pelo menos incluir um diff redigido
por path para os campos alterados. Para secrets, manter o comportamento atual de
nunca incluir valores.

### P1.3 - Backfill TB -> GCDR e mapeamento `canShowDemandButtons` nao existem na branch

O RFC DEC-14 e a acceptance criteria #11 pedem backfill idempotente com dry-run,
diff, log por customer e verificacao dos tres casos:

- `true` -> todos os grupos `true`;
- `false` -> todos `false`;
- unset -> default `{ entrada:true, areacomum:true, lojas:false }`.

Nao encontrei script/service/teste novo para esse backfill nem referencias a
`canShowDemandButtons` na implementacao. O guia `docs/api/API-Customer-Config.md`
trata isso como follow-up, mas o RFC lista backfill no MVP. Antes do merge, vale
alinhar uma destas opcoes:

- incluir o backfill e testes nesta PR;
- ou alterar o RFC/status da PR deixando explicito que esta PR entrega apenas a
  API e que o backfill sera uma PR bloqueante antes do rollout do cliente.

### P1.4 - Testes atuais nao cobrem a cadeia real de auth

Os testes adicionados validam DTO, service e wiring do controller, mas o controller
test monta routers direto sem `authMiddleware`/`hybridAuthByMethod`
(`tests/unit/controllers/customer-config.controller.test.ts:44`). Isso deixa sem
cobertura exatamente os criterios de maior risco do DEC-8.

Sugestao: adicionar testes de integracao usando `app` real ou uma montagem com a
mesma cadeia de middlewares de `src/app.ts`, mockando repositorios de API key/RBAC
quando necessario.

## Melhorias recomendadas

### P2.1 - Separar a doc de API do contrato formal

`docs/api/API-Customer-Config.md` esta bom para consumidores, mas hoje menciona que
`docs/openapi.yaml` e a fonte formal mesmo sem a spec estar atualizada. Depois de
atualizar o OpenAPI, manter essa doc como guia narrativo e apontar para os schemas
reais evita drift.

### P2.2 - Revisar resposta para secrets vazios e audit de reveal

`getSecrets` retorna sempre as duas secoes com `null` quando unset, e audita
`fields` apenas dos valores existentes. Isso e defensavel, mas vale documentar no
OpenAPI: a resposta de reveal sempre inclui `ingestion.clientSecret` e
`security.masterAdminPassword`, podendo ser `null`; o audit `fields` lista apenas
os campos efetivamente revelados.

### P2.3 - Evitar mudar storage em PATCH vazio de `featureButtons`

`PATCH { "featureButtons": {} }` e aceito pelo DTO. Pelo service, quando nao ha
config existente, isso tende a persistir o default de `featureButtons`, embora o
RFC diga que `{}` em PATCH e no-op. O read model fica igual, mas storage/audit
podem indicar mudanca sem mudanca real. E menor, mas facil de ajustar: se o objeto
de patch de `featureButtons` nao tiver folhas, nao setar `nextConfig.featureButtons`
nem auditar path.

## Pontos ja bem cobertos

- Defaults completos e secrets mascarados no read model
  (`src/services/CustomerConfigService.ts:305`).
- `featureButtons` com matriz 2x3 e default canonico em
  `src/domain/entities/Customer.ts:110`.
- `PATCH featureButtons.demandPeak.lojas=true` preservando os outros toggles.
- Rejeicao de unknown keys em secoes governadas via Zod `.strict()`.
- Rejeicao de `ingestion.clientSecret` e `security.*` na rota geral `/config`.
- Secrets escritos via endpoint dedicado, com `"***"` rejeitado e `null` limpando.
- Preservacao de `bundle` e secrets em PUT/DELETE de config.

## Recomendacao de merge

Eu nao faria merge para `desenv` ainda sem pelo menos:

1. adicionar guarda de autorizacao/hierarquia para `/customers/:id/config` e
   `?include=config`;
2. aplicar `customers:secrets:read` nos endpoints de secrets;
3. atualizar `docs/openapi.yaml`;
4. decidir e registrar se o backfill DEC-14 entra nesta PR ou fica como PR
   bloqueante de rollout;
5. alinhar/implementar a semantica de `null` do DEC-9.

