# Review — RFC-0010: Premium Alarm Simulator

- **Arquivo avaliado**: `docs/RFC-0010-Premium-Alarm-Simulator.md`
- **Data do review**: 2026-01-27
- **Status do RFC**: Draft

## Resumo
A proposta descreve um simulador premium de alarmes com componentes bem definidos (busca de bundle, refresh, geração de telemetria, avaliação de regras e monitor). A arquitetura e os fluxos principais estão claros, porém faltam critérios operacionais e de segurança para evitar poluição de dados e abuso de recursos, além de detalhes de multi-tenant e observabilidade.

## Pontos fortes
- Objetivo e motivação claros, com valor para dev/QA/demo/treinamento.
- Fluxo fim a fim bem delineado (bundle ? regras ? eventos ? orquestrador).
- Especificação de endpoints, eventos WS e schemas auxiliares úteis para implementação.
- Checklist de implementação estruturado por fases.

## Riscos e lacunas
1. **Isolamento de dados simulados**: não há estratégia concreta para impedir mistura com alarmes reais (tags, tenant isolado, canal separado, cleanup automático). Isso é citado como risco, mas sem mitigação.
2. **Rate limiting e custo**: o RFC não define limites por tenant/usuário, quota de sessões ou custos de CPU/memória; pode gerar abuso e impacto em produção.
3. **Segurança do endpoint de bundle**: uso de API key fixa; não há política de rotação, expiração, escopo por tenant ou auditoria.
4. **Multi-tenant e autorização**: falta detalhar como o `simulationId` se relaciona com `tenantId` e quais garantias de isolamento existem nos endpoints e WS.
5. **Observabilidade**: faltam métricas sugeridas (latência de scan, fila, taxa de candidatos, erros), logs estruturados e tracing.
6. **Compatibilidade com regras reais**: não está claro se o simulador usa exatamente o mesmo motor de regras do Central/Orchestrator ou uma implementação paralela (risco de drift).
7. **Persistência x memória**: `activeSessions` em memória pode perder estado em restart; falta estratégia de recovery/replay a partir de `simulator_sessions` e `simulator_events`.
8. **Privacidade e dados sensíveis**: eventos de telemetria simulada podem conter dados semelhantes a dados reais; faltam diretrizes de retenção e masking.
9. **Diagrama com encoding quebrado**: o diagrama ASCII aparece ilegível (caracteres `â”€` etc.), dificultando leitura.

## Questões em aberto (sugestões de decisão)
- O simulador deve operar em ambiente isolado (cluster separado) ou compartilhar infraestrutura com produção?
- Como será o modelo de cobrança: por sessão ativa, por volume de scans, ou por tempo de execução?
- Qual o limite padrão de sessões simultâneas por tenant e o mecanismo de override para clientes premium?
- O `AlarmCandidateRaised` de simulação deve ir para uma fila/namespace separada?
- Qual política de expiração/cleanup de sessões e eventos? (ex.: 7/30 dias)

## Recomendações
- Definir **política de isolamento** (tags/tenant/namespace) e **cleanup automático** para evitar poluição de dados.
- Adicionar **rate limits** e **quotas** por tenant/usuário; incluir no checklist.
- Especificar **authn/authz** para API key e endpoints de controle (escopo, rotação, auditoria).
- Padronizar **métricas e logs**: contadores de scans, latência, erro de bundle, backlog da fila, taxa de alarmes.
- Corrigir o **diagrama** para UTF-8 válido ou substituir por Mermaid.
- Definir estratégia de **state recovery** para reinícios (recarregar sessões a partir do banco).

## Decisão sugerida
Aprovar a direção geral **com pendências**; exigir resolução dos itens de isolamento, rate limiting, segurança e observabilidade antes de iniciar Fase 3.
