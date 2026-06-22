# RFC-0046 — Metas de Consumo do Cliente · Feedback da Revisão

- **Revisão de:** `docs/RFC-0046-Customer-Consumption-Goals.md`
- **Data:** 2026-06-18
- **Formato:** Roundtable BMAD (party-mode) — revisores independentes
- **Revisores:** 🏗️ Winston (Arquiteto de Sistemas) · 📋 John (Product Manager) · 🎨 Sally (UX Designer) · 💻 Amelia (Engenheira de Software Sênior)
- **Status do RFC após a revisão:** Draft — **ainda não pronto para implementação.** Três decisões são bloqueantes; o formato de armazenamento em si está endossado.

---

## Resumo executivo

A escolha de armazenamento — **envelope JSONB por `(customer, domain)`** — é **endossada por todos os revisores**, justamente porque o shape `goalsData` é um contrato pertencente a um componente externo (`GoalsPanel`); logo, guardá-lo byte-a-byte e devolvê-lo sem tradução é a opção de menor risco. Os volumes de mês/dia são pequenos; deixar **hora** fora, num armazenamento time-series separado, está correto.

R: não vejo sentido para guardar mês, dia em JSONB e hora fora, na verdade minha dor hoje é a "hora" quero modelar o banco para o pior caso.

Porém, o RFC trata como "questões em aberto" itens que a mesa considerou de fato **bloqueantes** — eles ficam na interseção de modelagem de dados, UX e implementação. A revisão converge para **três decisões obrigatórias antes de codar** e um conjunto de esclarecimentos.

---

## Consenso — decisões bloqueantes (resolver antes de implementar)

1. **B-1 — Semântica de temperatura.** `TEMPERATURE` é setpoint/faixa, não é aditivo; `annual.total` não tem significado para ela. Apontado pelos *quatro* revisores como bloqueante de modelo **e** UX **e** código. Decidir uma de:
   - (a) um sub-shape específico do domínio (ex.: `{ setpoint, min, max }`) — quebra a premissa do "shape único"; ou
   - (b) manter `total` carregando o setpoint, **desabilitar** o roll-up dia→mês→ano, e documentar — *apenas se o `GoalsPanel` já tolerar isso* (depende do contrato do painel).
   - Corolário de engenharia: definir **exatamente o que o `GET` devolve em mês/ano para temperatura** (`null`? média? setpoint? — "desabilitado" não é um valor de resposta).

R: Nesse caso teríamos que ter uma espécie de annual.total = 25 , seria 25 graus celsius, e o domain type temperature, e uma variável que guardasse annualTypeNumber, ou annularTypeValue ou annualValueType, sei lá, algo assim, onde annualValueType = AVERAGE

se fosse para domain energy, annualValueType = SUM

2. **B-2 — Chave do asset (`gcdrAssetId` vs id do ThingsBoard).** Porta de mão única e a **única questão em aberto que bloqueia integração** (o join meta↔real do dashboard precisa de uma chave estável). Arquitetura + Produto concordam: chavear por **`gcdrAssetId`** (GCDR é a fonte da verdade de dado mestre); traduzir para o id do TB na borda. Mudar depois = migração de dados em todos os envelopes.

R: Não entendi aqui.

3. **B-3 — Semântica do `PUT`: replace vs merge.** Não está dito no RFC e é a ambiguidade mais cara. Se replace → simples e idempotente. Se merge → o verbo deveria ser `PATCH`. Definir também: o roll-up roda **na escrita (materializado)** ou **na leitura (computado)**, e qual entre `daily`/`monthly` é a fonte da verdade quando ambos existem.

R: Nao entendi

---

## Arquitetura (🏗️ Winston)

- **Endossa o envelope e rejeita normalização precoce** — o contrato é externo; camadas de tradução arriscam drift silencioso. Tabelas de bucket só se justificam para **hora** e para análises pesadas cross-customer (fora de escopo).
R: Bem na verdade o cliente agora quer METAS analisadas por HORA e temos que ter histórico de mudanças se ele mudar algum valor.

- **Tirar o `history` do envelope** para uma tabela própria (`customer_goals_history`, append-only, FK para o goal). Inlining acopla o caminho quente (ler/gravar a meta atual) ao caminho frio (auditoria), e o limite "~20" vira poda manual que alguém esquece. (Engenharia aceita inline *somente se* append
+trim+version-bump for um único comando atômico — ver Q-9.)

R: acho que history deve ser uma tabela anexa mesmo.
mas talvez endpoint pessoa ter fetchHistory=true e trazer 100 históricos limit 

- **Promover colunas de roteamento** — expor `domain` (e provavelmente `year`/`granularity`) como colunas top-level ao lado do payload JSONB, para `WHERE`/index sem desnormalizar o conteúdo (padrão "colunas de roteamento + payload JSONB"). Barato agora; caro depois.
R: Não entendi

- **Documentar a semântica de concorrência** — o lock é o envelope `(customer, domain)` inteiro; dois operadores editando meses diferentes colidem. Aceitável (dado de baixa 
contenção), mas o RFC precisa dizer isso, e o front precisa tratar o `409` como **recarregar-e-reaplicar**, não recarregar-e-descartar.

R: acho que não sendo JSONB e com uma modelagem mais eficiente estaria resolvido certo ?

- **Um parágrafo sobre a reconciliação hora↔envelope** — quando a hora chegar, ela vive num segundo store com versão/audit próprios; descrever como coexistem desde já, mesmo que a implementação fique para depois.

R: Implementação é para agora e nào mais para depois.

## Produto (📋 John)

- **Nomear o JTBD explicitamente** no RFC: o job do GCDR é "uma fonte única, versionada e auditável de *alvos*, para cada dashboard parar de inventar a sua" — e não "o shopping está dentro da meta" (esse é o job do consumidor). Metade das questões em aberto some quando isso é escrito.
R: OK

- **Manter a separação metas-vs-real** (dado mestre vs série temporal). O risco de fricção *não* é a separação — é **não documentar o contrato do join** (qual chave casa meta↔real). Resolver B-2 já.

R: Não entendi

- **Cortar do MVP / deferir:** roll-up de holding/ROOT-RESELLER (derivável = uma soma; e re-importa o problema da não-aditividade da temperatura; ninguém pediu), **TEMPERATURE**, granularidade **DAILY**, e política de retenção do history (append-only basta; retenção é operação).
R: Revise isso.

- **Onde NÃO economizar:** concorrência otimista, escopos `goals:read`/`goals:write`, e auditoria — a espinha de uma "fonte da verdade".
R: ok

- **MVP proposto:** ENERGY + WATER · annual + monthly · chave de asset decidida e documentada · concorrência otimista + escopos + audit · separação mantida com o contrato do join escrito.
R: revise

- **Duas perguntas que decidem a aprovação:** (1) Quem é o consumidor *nomeado* chamando `GET /customers/:id/goals` na semana 1? Sem nome → não tem MVP. (2) Espelhar o JSON do `GoalsPanel` é "round-trip esperto" ou "o GCDR herdando o formato de uma UI como contrato de domínio"? **Quem manda no schema — o domínio ou a tela?**

R: domínio, mas revise isso

## UX (🎨 Sally)

- **O contrato espelho é a melhor decisão e a mais perigosa** — regras de negócio que hoje moram na cabeça do painel viram contrato invisível do backend. O RFC precisa declarar, **no documento**, qual campo é fonte da verdade e qual é derivado (para uma escrita direta de API em `monthly` não rachar o espelho em silêncio).
R: algumas regras básicas precisam existir como se escolher mes a mes, não pode escrever ano, ano é calcumado, se escrever dia a dia, não pode definir a meta do mês, é calculada e ano também, se escrever hora a hora, dia é calculado, mês e ano também

- **Temperatura é "mentira de interface"** — pôr um setpoint na grade aditiva de 12 meses faz o operador ler a coluna anual como total. Precisa de semântica/componente próprios, não "mais um domínio na mesma grade somativa". Questão aberta: **faixa de conforto ou alvo único?** — muda o componente inteiro.

R: revise com o que eu disse antes

- **A troca de granularidade é uma armadilha de perda de dados** — quando o import diário torna o mensal derivado, o que acontece com os meses digitados na mão? O RFC precisa especificar a **máquina de estados da transição** e o texto do aviso ("ao importar diário, o mensal passa a ser calculado — seus valores manuais serão substituídos. Continuar?"). Transição silenciosa = o ticket de suporte nº 1.

R: vamos revisar, por o user pode escolher a meta do ano, pode escolher a meta mes a mes, mas cada mes ele pode definir o valor do mes ou para um mes específico pode definir a meta dia a dia e para cada dia desse, pode eventualmente definir o valor do dia ou valor de hora.

- **Hora desabilitada** — precisa de tooltip explícito ("disponível em breve"), não `disabled` cru, e **nenhum `hourly: null` fantasma** vazando para o contrato.
R: precisa para agora mesmo

- **Metas por asset** — definir se os assets precisam fechar com o total do mall (erro / warning / liberado, com a mensagem exata) e exigir uma **chave de asset estável e resolvível** para assets renomeados/desativados não virarem "asset desconhecido".

R: Por asset não disponível

- **Tratar o import CSV como experiência, não como parse** — 365 linhas com 3 erradas: rejeita tudo? importa o parcial? preview antes de gravar? citar a linha. O RFC nomeia "importado via CSV" como se fosse um botão.

R: importa parcial e aponta erro, sempre gera um preview dry run antes de persistir, pede confirmação e persiste e depois um LOG completo

- **Questão aberta que re-pesa tudo:** o fluxo do operador é mais digitação manual no grid ou mais CSV? Se for ~90% CSV, o grid editável é teatro e o rigor de design vai para import/preview/erro.

R: meio a meio
muitas vezes vai importar um ano inteiro, com granularidade hora a hora para alguns meses, dia a dia para outros, e o user poder especificar via UI depois para hora por exemplo

## Engenharia (💻 Amelia) — esclarecimentos e ACs obrigatórios

Áreas subespecificadas: validação Zod do envelope esparso, concorrência otimista, idempotência do PUT, agregação dia→mês (+ temperatura), `history` bounded atômico, isolamento de tenant.

**Critérios de aceite a adicionar antes de a story ser estimável:**

- **AC1** — `PUT` = replace total do envelope do ano (ou renomear para `PATCH`); definir `200/201/404/422`.
- **AC2** — `PUT` sem `version` num recurso existente → `428 Precondition Required` (recomendado).
- **AC3** — update condicional atômico `SET version = version + 1 WHERE id = ? AND version = ?`; `rowCount = 0` → `409` com body trazendo `currentVersion`.
- **AC4** — regex de mês `^(0[1-9]|1[0-2])$`; diário `^\d{4}-\d{2}-\d{2}$` **+ validação de data real** (29/02 bissexto) **+** o ano da chave deve bater com o `:year` da rota.
- **AC5** — `granularity:"hour"` → `422`; `daily` presente com `granularity:"month"` → `422`.
- **AC6** — valores `.finite()`, `>= 0` para ENERGY/WATER (definir teto e precisão decimal); TEMPERATURE pode ser negativo.
- **AC7** — spec do roll-up: momento (leitura vs escrita), fonte da verdade, comportamento com mês parcial (ex.: 10 de 30 dias → soma parcial ou `null`), e o valor de leitura de temperatura em mês/ano.
- **AC8** — `unit` é enum fechado por domínio; o roll-up rejeita unidades mistas (não somar `kWh` + `MWh`).
- **AC9** — schema do item de `history` `{ version, ts, userId, snapshot|diff }`, cap exato (ex.: 20), append + trim + version-bump em **uma transação**; `DELETE` também deve ser versionado/auditado (append-only + delete físico = história perdida).
- **AC10** — shape exato de `assets{}` / `metaTag` (ou um `z.passthrough()` declarado **e** um teto de bytes no envelope, dado `history` × `daily` denso).
- **AC11** — idempotência: `PUT` idêntico repetido é no-op (version inalterado) — recomendado.
- **AC12** — isolamento de tenant em todo `WHERE` (`tenant_id` + `customer_id` + `domain`); teste cross-tenant retorna `404`.

**Bloqueantes antes da estimativa:** B-1 (valor de leitura de temperatura), B-3 (`PUT` replace vs merge) e o momento do roll-up (escrita vs leitura).


R: Depois posso me aprofundar aqui, mas talvez Amelia possa fazer um review com pontos que eu citei acima
---

## Decisões em aberto a fechar (responsável → autor do RFC)

| # | Decisão | Recomendação da revisão |
| --- | --- | --- |
| B-1 | Shape de temperatura + valor de leitura em mês/ano | Decidir sub-shape vs roll-up-desligado; cravar o valor de leitura. Provavelmente deferir TEMPERATURE para fora do MVP. |
| B-2 | Chave de asset | `gcdrAssetId`; traduzir para id do TB na borda. |
| B-3 | `PUT` replace vs merge + momento do roll-up | Replace total por ano; roll-up materializado na escrita; `daily` é a fonte quando presente. |
| D-4 | Armazenamento do history | Preferir tabela própria `customer_goals_history`; se inline, torná-lo atômico + capped + limitado por bytes. |
| D-5 | Colunas de roteamento | Promover `domain` (+ `year`/`granularity`) para colunas top-level. |
| D-6 | Dono do schema | Declarar quem é o dono do schema (domínio vs `GoalsPanel`) e a política de versão/compat se o JSON do painel mudar. |
| D-7 | Escopo do MVP | ENERGY + WATER, annual + monthly; deferir TEMPERATURE, DAILY, holding roll-up, retenção. |
| D-8 | Consumidor nomeado do MVP | Identificar o dashboard que chama o endpoint na semana 1, ou o MVP é especulativo. |
| D-9 | Fluxo do operador | Confirmar manual-grid vs CSV-dominante; pesar o rigor de UX de acordo (import/preview/erro). |

---

## Pontos de acordo (manter inalterados)

- Envelope JSONB por `(tenant, customer, domain)`; **não** normalizar buckets para mês/dia.
- Manter a hora **fora** do JSON → store time-series separado.
- Manter a separação metas-vs-real (GCDR guarda só os alvos).
- Manter concorrência otimista, escopos `goals:read`/`goals:write` e o evento de auditoria `CUSTOMER_GOALS_UPDATED`.
- ENERGY + WATER com **soma** dia→mês é o caminho limpo e endossado; os casos difíceis são temperatura, transição de granularidade e assets órfãos.

---

## Divergência a resolver

- **Local do `history`** — Winston: mover para tabela própria (desacoplar quente/frio). Amelia: inline é aceitável *se* for atômico + capped + limitado por bytes. → Escolher um; ambos são seguros se as restrições forem atendidas.
- **Dono do schema (provocação do John)** — não endereçado no RFC: espelhar o JSON do `GoalsPanel` é round-trip esperto ou herdar um formato de UI como contrato de domínio? Adicionar uma política de compat/versão para quando o JSON do painel evoluir.

_Gerado a partir de uma revisão BMAD party-mode do RFC-0046. Apenas design; nenhuma implementação implícita._
