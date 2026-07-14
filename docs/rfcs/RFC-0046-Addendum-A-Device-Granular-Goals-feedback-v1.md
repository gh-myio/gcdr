# RFC-0046 — Feedback v1 sobre a implementação existente

- **Data da revisão:** 2026-07-14
- **Escopo:** documentação, API/backend em `gcdr.git` e frontend em `gcdr-frontend.git`
- **Documento deliberadamente excluído:** `RFC-0046-Addendum-A-Device-Granular-Goals.md`
- **Objetivo:** avaliar a base atual do RFC-0046 antes de usá-la ou estendê-la para metas granulares por dispositivo
- **Parecer:** **não aprovar a base como concluída/segura para extensão enquanto os itens P0 e P1 abaixo não forem corrigidos e cobertos por testes**

## 1. Material revisado

Foram lidos integralmente todos os Markdown do RFC-0046, exceto o Addendum A solicitado:

1. `RFC-0046-Customer-Consumption-Goals.md`
2. `RFC-0046-Goals-API.md`
3. `RFC-0046-Goals-schema.md`
4. `RFC-0046-Customer-Consumption-Goals-feedback.md`
5. `RFC-0046-Customer-Consumption-Goals-feedback.pt-BR.md`
6. `RFC-0046-Customer-Consumption-Goals-feedback-v2.md`

No backend, a revisão cobriu montagem de rotas, autenticação, controller, Zod DTOs, serviço, repositório, Drizzle schema, migrations `0047`/`0048`, OpenAPI e testes existentes. No frontend, cobriu tipos, serviço HTTP, hooks, aba de metas, importação CSV, timeline e templates CSV.

## 2. Resumo executivo

A direção arquitetural final é boa: armazenamento canônico por hora, agregação fixa por domínio, distribuição na escrita, roll-up na leitura, versão por `(tenant, customer, domain, year)`, histórico separado e importação stateless. A implementação contém partes cuidadosas, como validação de calendário, transação para `PUT`/`PATCH`/import, upsert em chunks e separação clara entre domínio e UI.

Entretanto, há dois riscos impeditivos:

1. **Autorização insuficiente nas rotas de metas:** chaves `SELF`/`SUBTREE` podem atingir outros clientes do mesmo tenant, e um JWT válido não precisa demonstrar `goals:read`/`goals:write`.
2. **Perda silenciosa de granularidade no frontend:** salvar a grade mensal executa um `PUT` do ano inteiro usando apenas totais mensais derivados. Metas diárias/horárias existentes são apagadas e redistribuídas como metas mensais, sem confirmação destrutiva.

Além disso, o contrato de árvore mista não é cumprido pelo backend, a preservação de horas explícitas pode inflar totais `SUM`, o tratamento de `409` do frontend fica preso em conflito, o delete anual não é atômico e o histórico fica órfão. A ausência de testes do núcleo do RFC permitiu que essas inconsistências sobrevivessem mesmo com ambos os projetos compilando.

## 3. Matriz de conformidade

| Capacidade | Backend/API | Frontend | Parecer |
| --- | --- | --- | --- |
| Grão canônico horário | Implementado | Consumido corretamente | **Atende** |
| `SUM` para energia/água e `AVERAGE` para temperatura | Implementado | Renderização diferenciada | **Atende**, com cálculo provisório incorreto na grade mensal de temperatura |
| `PUT` replace / `PATCH` merge | Implementado no caso simples | Usa ambos | **Parcial**: árvore profunda e preservação de granularidade falham |
| Concorrência otimista | Parcial no backend | Fluxo de recuperação quebrado | **Não atende integralmente** |
| Histórico por operação | Implementado | Timeline implementada | **Parcial**: valores antigos/contagens e lifecycle do histórico são incorretos |
| Importação CSV com dry-run e parcial | Núcleo implementado | Modal implementado | **Parcial**: UX e limites não fecham o RFC |
| Escopos e hierarquia | Escopo só é efetivo para API key; hierarquia não é aplicada | N/A | **Não atende / risco de segurança** |
| OpenAPI como contrato utilizável | Desatualizado | N/A | **Não atende** |
| Testes do RFC-0046 | Ausentes | Ausentes | **Não atende** |

## 4. Achados P0 — impeditivos

### P0.1 — As rotas permitem acesso fora da hierarquia e não aplicam RBAC de metas ao JWT

**Evidências**

- `hybridAuthMiddleware` aceita um Bearer válido e chama `next()` sem verificar o `requiredScope`: `src/middleware/auth.ts:196-208`.
- Para API key, o middleware registra `apiKeyHierarchyAccess` e `customerId`: `src/middleware/auth.ts:230-240`.
- O controller de metas ignora esses dois campos e apenas confirma que o cliente pertence ao tenant: `src/controllers/consumption-goals.controller.ts:93-96`.
- O middleware específico de hierarquia (`deepCustomers`) não está montado nessa rota.

**Impacto**

- Uma API key `SELF` pode ler ou alterar metas de outro cliente do mesmo tenant conhecendo o UUID.
- Uma API key `SUBTREE` não fica restrita à própria subárvore.
- Qualquer JWT aceito pelo middleware — salvo o papel especial explicitamente bloqueado — alcança leitura e escrita sem comprovar `goals:read`/`goals:write`.

Isso contradiz diretamente o RFC, que promete escopo e hierarquia `SELF/SUBTREE/TENANT`.

**Recomendação**

Criar um middleware obrigatório para a rota que:

1. valide `customerId` contra `req.context.customerId` e `apiKeyHierarchyAccess`;
2. resolva descendentes para `SUBTREE`;
3. aplique a permissão RBAC equivalente para JWT, separando leitura e escrita;
4. devolva `404` ou `403` conforme a convenção definida pelo projeto;
5. tenha testes de integração cobrindo JWT sem permissão, `SELF`, `SUBTREE`, `TENANT` e acesso cross-tenant.

### P0.2 — Salvar a grade mensal destrói silenciosamente detalhes diários/horários

**Evidências**

- No modo mensal, o frontend busca somente a árvore agregada em `granularity=month`: `CustomerGoalsTab.tsx:156-164`.
- O draft é preenchido com os valores mensais derivados: `CustomerGoalsTab.tsx:92-99` e `:199-201`.
- Ao salvar, ele constrói um payload somente com folhas `MONTH` para todos os meses preenchidos e executa `replaceGoals`: `CustomerGoalsTab.tsx:325-345`.
- O backend cumpre o replace apagando todas as horas antes de materializar o payload: `src/services/ConsumptionGoalService.ts:466-472`.

**Cenário reproduzível por inspeção**

Um ano possui março detalhado por hora. O usuário abre a edição mensal, altera apenas abril e salva. O frontend reenvia março como um único total mensal. O backend apaga as horas originais e recria março por divisão uniforme. Os valores explícitos e a sua granularidade são perdidos.

**Impacto**

Perda silenciosa de informação de negócio e do estado “sugerido versus confirmado”. O histórico registra um `REPLACE`, mas não permite reconstruir os milhares de valores perdidos, pois guarda somente uma amostra de até 50 buckets e `oldValue` geralmente nulo.

**Recomendação**

Uma das seguintes abordagens deve ser escolhida explicitamente:

- salvar o mês editado via `PATCH`, preservando os demais ramos; ou
- carregar a árvore horária completa e montar um `PUT` realmente completo; ou
- tratar o `PUT` mensal como operação de colapso destrutivo, exibir diff/contagem dos detalhes que serão descartados e exigir confirmação inequívoca.

Para a UX proposta nas revisões anteriores, `PATCH` por bucket alterado é a opção mais segura.

## 5. Achados P1 — alta prioridade

### P1.1 — O `PUT` com árvore profunda ignora o valor do pai em vez de aplicá-lo como default

O contrato mostra um mês com `value`, um dia com `value` e uma hora confirmada dentro dele. Porém, `flattenReplaceBody` só cria a folha `MONTH` quando não há nenhum dia e só cria a folha `DAY` quando não há nenhuma hora: `src/services/ConsumptionGoalService.ts:1067-1091`.

Assim, o exemplo de árvore profunda de `RFC-0046-Goals-API.md` não preenche “o mês, com exceções mais finas”. Com um único dia/hora filho, o restante do mês/dia desaparece. Isso também conflita com `materialiseBuckets`, que foi escrito para ordenar coarse→fine e permitir “finest wins”.

**Correção esperada:** manter pai e filhos no flatten; materializar o pai primeiro e sobrescrever somente os descendentes informados. Se a intenção real for “filho torna o pai puramente calculado”, então os campos `value` dos pais devem deixar de ser obrigatórios no DTO e o exemplo/contrato precisam ser reescritos.

### P1.2 — Preservar horas explícitas infla o total de buckets `SUM`

`mergeBuckets` preserva horas existentes com `derived=false`, mas `distributeBucket` continua dividindo o valor integral do pai pelo total original de horas: `src/services/ConsumptionGoalService.ts:262-282` e `:929-954`.

Exemplo: meta diária de `3.500 kWh` com uma hora explícita de `500 kWh`. A implementação distribui `3.500 / 24` e depois preserva/sobrescreve a hora explícita. O total passa a aproximadamente `3.854,17 kWh`, embora o bucket enviado continue dizendo `3.500`.

Esse problema aparece tanto em edições sucessivas quanto em payloads mistos no mesmo `PATCH`/CSV.

**Correção esperada para `SUM`:** distribuir o residual `(parentValue - somaDasHorasConfirmadas)` apenas entre as horas derivadas restantes, com validação quando o residual for negativo. Para `AVERAGE`, definir matematicamente como valores confirmados participam da média alvo; copiar o pai para as horas restantes também pode não preservar a média desejada.

### P1.3 — O fluxo de `409` no frontend não recarrega nem reaplica

O hook atual grava `conflictVersion` em state e retorna `null`: `src/hooks/useGoals.ts:93-116`. Logo após o `await`, `CustomerGoalsTab` testa o valor de `conflictVersion` capturado pelo render anterior: `CustomerGoalsTab.tsx:344-352` e `:388-395`. Esse valor ainda é `null`, portanto o ramo de refetch não executa.

No render seguinte, o erro aparece, mas as metas continuam na versão antiga. Uma nova tentativa zera `conflictVersion` e envia novamente o mesmo `expectedVersion`, criando um loop de conflito. Mesmo se o refetch ocorresse, o `useEffect` que resemeia o draft substituiria a intenção do operador; não há “reapply”.

**Correção esperada:** `run` deve devolver um resultado discriminado (`success | conflict | error`) contendo `currentVersion`. O componente deve preservar um snapshot do patch/draft, refazer o GET, reaplicar o delta local e pedir nova confirmação quando houver colisão no mesmo bucket.

### P1.4 — `expectedVersion` é ignorado na criação

Se o parent não existe, `openGoalForWrite` cria a meta sem validar o valor recebido em `expectedVersion`: `src/services/ConsumptionGoalService.ts:850-863`. Assim, `expectedVersion: 7` contra versão corrente `0` cria a meta em vez de responder `409`.

**Correção esperada:** em criação, aceitar somente ausência de guarda ou uma convenção explícita para versão zero. O contrato atual diz para omitir na primeira escrita; qualquer versão positiva deveria conflitar com `currentVersion: 0`.

### P1.5 — O delete anual não é atômico e deixa histórico órfão

- O delete anual faz `bumpVersion`, `deleteHours` e `deleteGoal` fora de `withTransaction`: `src/services/ConsumptionGoalService.ts:782-794`.
- `consumption_goal_history.goal_id` não tem FK: `src/infrastructure/database/drizzle/schema.ts:2284-2287` e migration `0047_consumption_goals.sql:93-96`.
- `deleteGoal` apaga somente o parent: `src/repositories/consumptionGoalRepository.ts:283-288`.

Portanto, o texto do RFC dizendo que o delete anual “cascades and removes ... its history” é falso: somente as horas possuem FK com cascade. As linhas de histórico ficam órfãs e inacessíveis pela API. Além disso, existe janela de corrida entre a guarda de versão e o delete efetivo.

**Correção esperada:** executar a operação inteira numa transação e decidir uma política única:

- preservar auditoria: adicionar identidade estável/tenant/customer/domain/year no histórico e não depender do parent apagado; ou
- apagar auditoria: adicionar FK `ON DELETE CASCADE`.

A primeira alternativa é mais coerente com “fonte auditável” e com a necessidade de provar um delete anual.

### P1.6 — Não há testes do comportamento-base do RFC-0046

A busca em `tests/` encontrou somente `ConsumptionGoalService.margin.test.ts`, referente ao RFC-0052. Não há teste de:

- distribuição `YEAR/MONTH/DAY/HOUR`;
- roll-up `SUM/AVERAGE` e ano bissexto;
- árvore mista e precedência finest-wins;
- preservação de horas confirmadas;
- `PUT`/`PATCH`/delete e rollback transacional;
- conflito de versão em criação/atualização;
- importação parcial e conflitos de granularidade;
- escopo/hierarquia/autorização;
- contrato controller/OpenAPI;
- fluxos da UI.

Este é o principal motivo estrutural para os problemas acima não terem sido detectados.

## 6. Achados P2 — importantes

### P2.1 — A UI envia toda a grade, não somente células alteradas

Ao salvar dias, a tela envia todos os dias preenchidos; ao salvar horas, envia todas as 24 horas preenchidas: `CustomerGoalsTab.tsx:356-379`. Isso:

- cria histórico com muitos buckets para uma edição de uma célula;
- transforma horas apenas derivadas em `HOUR/derived=false`, marcando-as como confirmadas sem ação explícita do operador;
- interage com P1.2 e pode alterar totais ao reenviar dias que contêm horas confirmadas.

É necessário manter dirty state por célula e enviar somente o delta. Limpar uma célula também não chama `DELETE`; em dia/hora o valor vazio é apenas ignorado. A tela sequer extrai `removeGoals` do hook, portanto não oferece o revert/delete descrito pelo domínio.

### P2.2 — A prévia de temperatura na grade mensal não é ponderada

`computedTotal` usa média aritmética dos meses preenchidos e o próprio comentário chama isso de aproximação: `CustomerGoalsTab.tsx:273-288`. O backend pondera por horas, logo fevereiro e março não podem ter o mesmo peso na média anual.

O frontend deve usar a mesma ponderação do servidor ou não exibir um total provisório que diverge do resultado após salvar.

### P2.3 — A experiência de importação está incompleta em relação ao RFC

Pontos positivos: upload/texto, dry-run, confirmação, diagnósticos por linha, import parcial e log visível estão implementados.

Faltam, porém:

- ghost tree/diff visual do estado futuro;
- download do relatório de erros;
- download do log completo aplicado;
- confirmação que descreva mudanças de granularidade;
- contagem real por nível.

`levelCountsFromPreview` tenta inferir quantidades a partir de uma árvore agregada em mês: `GoalsCsvImportModal.tsx:74-91`. Uma importação de 120 horas em um mês pode aparecer como apenas um nó `HOUR`, porque a prévia do backend não retorna as 120 folhas. O texto de confirmação, portanto, não representa o que será gravado.

Também não existe limite de bytes/linhas para `csv`. A API limita `PATCH` a 8.760 buckets, mas o importador aceita texto e número de linhas sem teto, gerando risco desnecessário de CPU/memória e de resposta/log muito grande.

### P2.4 — O histórico não contém os dados que o contrato promete

`appendOperation` grava `oldValue: null` em todas as operações e calcula `hoursAffected` pela soma dos escopos, mesmo quando buckets se sobrepõem: `src/services/ConsumptionGoalService.ts:1002-1035`.

Consequências:

- uma edição de bucket único nunca mostra o valor anterior;
- `DAY + HOUR` dentro do mesmo dia reporta 25 horas afetadas, embora existam somente 24 linhas únicas;
- deletes também registram `oldValue: null`;
- o histórico não é suficiente para reconstrução ou investigação precisa.

Calcular a diferença real entre estado anterior e posterior resolveria `oldValue`, `hoursAffected` e permitiria idempotência/no-op consciente.

### P2.5 — O OpenAPI não descreve a API existente

Exemplos de drift em `docs/openapi.yaml`:

- GET exige sempre `domain/year`, mas o código também usa a mesma rota sem query para listar domínios;
- não documenta `granularity`;
- afirma `404` quando não há meta, enquanto o serviço retorna `200`, `version: 0`, `tree: {}`;
- `GoalTree` expõe `method`, `total` e `source`, mas a resposta real usa `aggregationMethod` e um objeto `tree` (`docs/openapi.yaml:5185-5215`);
- `GoalsMergeBody` omite o campo obrigatório `level` (`:5261-5275`);
- `GoalsDeleteBody.bucket` omite `level` (`:5285-5295`);
- afirma que writes retornam `X-Version-Id`, mas o controller só envia a versão no body (`:5219` e `:6364`/`:6391`).

O arquivo `src/dto/response/GoalsResponseDTO.ts` também descreve uma árvore aninhada, enquanto serviço e frontend usam mapas planos `monthly`, `daily` e `hourly`. Manter múltiplos contratos incompatíveis aumenta o risco para qualquer consumidor futuro.

### P2.6 — A documentação do RFC se contradiz

Exemplos:

- `RFC-0046-Customer-Consumption-Goals.md:3` declara produção aplicada, mas `:6` e `:250` dizem “pending prod”.
- `:33-35` diz que `CUSTOMER_GOALS_UPDATED` é planejado/não emitido, mas `:242` promete emissão em toda escrita.
- O RFC afirma que o delete anual remove o histórico por cascade, mas schema/migration não possuem a FK.
- Exemplos alternam o significado de `derived=false` para DAY, embora a implementação marque como `false` somente uma hora explicitamente definida.
- A migration `0047` ainda possui cabeçalho de template “Migration NNNN” e referências antigas de caminho.

Recomendo declarar um único documento normativo (provavelmente `RFC-0046-Goals-API.md`), gerar/validar OpenAPI a partir dele e mover feedbacks históricos para uma seção claramente não normativa.

## 7. Pontos positivos

- O pivot de JSONB para uma estrutura normalizada e canônica por hora foi acertado para o requisito de pior caso.
- O modelo de domínio `SUM`/`AVERAGE` evita somar temperatura e suporta média ponderada por hora.
- Validação de ano, mês, dia real, ano bissexto, hora, formato de ref e sinal por domínio está bem centralizada.
- `PUT`, `PATCH` e persistência de import usam transação para horas + version bump + histórico.
- O upsert é dividido em lotes de 1.000, evitando o limite de bind parameters do PostgreSQL: `src/repositories/consumptionGoalRepository.ts:309-349`.
- Import stateless com dry-run, aplicação parcial explícita e diagnóstico por linha está funcional no caminho principal.
- O frontend separa tipos, wire service, hooks e componentes, e representa corretamente a árvore plana realmente emitida pelo serviço.
- A timeline por operação, apesar das lacunas de conteúdo, é melhor para uso humano do que uma linha por hora.

## 8. Verificações executadas

| Verificação | Resultado |
| --- | --- |
| Backend `npm run typecheck` | **Passou** |
| Frontend `npm run typecheck` | **Passou** |
| `ConsumptionGoalService.margin.test.ts` | **9 testes passaram** |
| Exit do comando Jest isolado | **Falhou por thresholds globais de coverage**, não por falha dos 9 testes |
| Testes específicos do núcleo RFC-0046 | **Não existem** |

Não foram executados testes de integração contra PostgreSQL/API porque não há suíte dedicada ao RFC-0046 no repositório e a revisão não deve assumir um banco local com estado/migrations compatíveis.

## 9. Ordem recomendada de correção

1. Fechar autorização/hierarquia e adicionar testes de integração de segurança.
2. Impedir o `PUT` mensal destrutivo no frontend.
3. Fixar uma semântica única para árvore profunda e para distribuição residual com horas confirmadas.
4. Refazer o fluxo de `409` como reload + reapply real.
5. Tornar delete anual atômico e decidir retenção auditável do histórico.
6. Criar suíte de domínio com casos matemáticos e mixed granularity antes de alterar o modelo para dispositivo.
7. Enviar somente células dirty e implementar delete/revert na UI.
8. Completar import UX, limites de payload e histórico real de diffs.
9. Reconciliar RFC, DTOs de resposta e OpenAPI.

## 10. Impressão final

A implementação tem uma fundação conceitual melhor do que a primeira versão do RFC e mostra boa preocupação com volume, calendário, precisão operacional e usabilidade. O problema não é a escolha do armazenamento horário; ela é defensável e extensível. O problema está nas bordas entre contrato, concorrência, autorização e UI.

Hoje eu classificaria o trabalho como **feature funcional em happy path, mas ainda não como source of truth segura e auditável**. O maior risco técnico é silencioso: a tela pode substituir dados horários válidos por uma redistribuição mensal sem o operador perceber. O maior risco de segurança é igualmente direto: o alcance hierárquico prometido não é aplicado.

Minha recomendação é **não iniciar a implementação do Addendum A em cima desta base antes de corrigir P0/P1**. Acrescentar `deviceId` agora multiplicaria cada problema de granularidade, autorização, concorrência e histórico por dispositivo, tornando a correção posterior mais cara e mais difícil de migrar. Com esses pontos resolvidos e uma suíte de contrato/domínio forte, o modelo canônico horário pode servir bem como base para a próxima evolução.
