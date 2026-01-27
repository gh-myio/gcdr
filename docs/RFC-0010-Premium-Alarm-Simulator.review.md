# Review � RFC-0010: Premium Alarm Simulator

- **Arquivo avaliado**: `docs/RFC-0010-Premium-Alarm-Simulator.md`
- **Data do review**: 2026-01-27
- **Status do RFC**: Implemented (MVP)

## Resumo
A proposta descreve um simulador premium de alarmes com componentes bem definidos (busca de bundle, refresh, gera��o de telemetria, avalia��o de regras e monitor). A arquitetura e os fluxos principais est�o claros, por�m faltam crit�rios operacionais e de seguran�a para evitar polui��o de dados e abuso de recursos, al�m de detalhes de multi-tenant e observabilidade.

## Pontos fortes
- Objetivo e motiva��o claros, com valor para dev/QA/demo/treinamento.
- Fluxo fim a fim bem delineado (bundle ? regras ? eventos ? orquestrador).
- Especifica��o de endpoints, eventos WS e schemas auxiliares �teis para implementa��o.
- Checklist de implementa��o estruturado por fases.

## Riscos e lacunas
1. **Isolamento de dados simulados**: n�o h� estrat�gia concreta para impedir mistura com alarmes reais (tags, tenant isolado, canal separado, cleanup autom�tico). Isso � citado como risco, mas sem mitiga��o.
2. **Rate limiting e custo**: o RFC n�o define limites por tenant/usu�rio, quota de sess�es ou custos de CPU/mem�ria; pode gerar abuso e impacto em produ��o.
3. **Seguran�a do endpoint de bundle**: uso de API key fixa; n�o h� pol�tica de rota��o, expira��o, escopo por tenant ou auditoria.
4. **Multi-tenant e autoriza��o**: falta detalhar como o `simulationId` se relaciona com `tenantId` e quais garantias de isolamento existem nos endpoints e WS.
5. **Observabilidade**: faltam m�tricas sugeridas (lat�ncia de scan, fila, taxa de candidatos, erros), logs estruturados e tracing.
6. **Compatibilidade com regras reais**: n�o est� claro se o simulador usa exatamente o mesmo motor de regras do Central/Orchestrator ou uma implementa��o paralela (risco de drift).
7. **Persist�ncia x mem�ria**: `activeSessions` em mem�ria pode perder estado em restart; falta estrat�gia de recovery/replay a partir de `simulator_sessions` e `simulator_events`.
8. **Privacidade e dados sens�veis**: eventos de telemetria simulada podem conter dados semelhantes a dados reais; faltam diretrizes de reten��o e masking.
9. **Diagrama com encoding quebrado**: o diagrama ASCII aparece ileg�vel (caracteres `─` etc.), dificultando leitura.

## Quest�es em aberto (sugest�es de decis�o)
- O simulador deve operar em ambiente isolado (cluster separado) ou compartilhar infraestrutura com produ��o?
- Como ser� o modelo de cobran�a: por sess�o ativa, por volume de scans, ou por tempo de execu��o?
- Qual o limite padr�o de sess�es simult�neas por tenant e o mecanismo de override para clientes premium?
- O `AlarmCandidateRaised` de simula��o deve ir para uma fila/namespace separada?
- Qual pol�tica de expira��o/cleanup de sess�es e eventos? (ex.: 7/30 dias)

## Recomenda��es
- Definir **pol�tica de isolamento** (tags/tenant/namespace) e **cleanup autom�tico** para evitar polui��o de dados.
- Adicionar **rate limits** e **quotas** por tenant/usu�rio; incluir no checklist.
- Especificar **authn/authz** para API key e endpoints de controle (escopo, rota��o, auditoria).
- Padronizar **m�tricas e logs**: contadores de scans, lat�ncia, erro de bundle, backlog da fila, taxa de alarmes.
- Corrigir o **diagrama** para UTF-8 v�lido ou substituir por Mermaid.
- Definir estrat�gia de **state recovery** para rein�cios (recarregar sess�es a partir do banco).

## Decis�o sugerida
Aprovar a dire��o geral **com pend�ncias**; exigir resolu��o dos itens de isolamento, rate limiting, seguran�a e observabilidade antes de iniciar Fase 3.
