 Review do Review                                                                                                                                                                                                     
                                                                                                                                                                                                                         O que está correto no diagnóstico                                                                                                                                                                                    
                                                                                                                                                                                                                       
  O problema central é real: criamos uma tabela local que duplica configuração que o GCDR já tem. Com dois donos da config, não existe fonte da verdade única.

  ┌───────────────────────────────────────────────────────────────────────────┬──────────┐
  │                            Problema levantado                             │ Correto? │
  ├───────────────────────────────────────────────────────────────────────────┼──────────┤
  │ dispatch_configs duplica customer_channels/group_dispatch_configs do GCDR │ ✅       │
  ├───────────────────────────────────────────────────────────────────────────┼──────────┤
  │ Rotas PUT/DELETE no alarm backend → frontend chama 2 backends             │ ✅       │
  ├───────────────────────────────────────────────────────────────────────────┼──────────┤
  │ isActive() consultando dado local stale                                   │ ✅       │
  ├───────────────────────────────────────────────────────────────────────────┼──────────┤
  │ Cache de dado local é anti-padrão                                         │ ✅       │
  └───────────────────────────────────────────────────────────────────────────┴──────────┘

  O que está certo na implementação atual (manter)

  O documento também diz isso explicitamente:

  - filterChannelsByConfig() no DecisionEngine — correto, só precisa de outra fonte de dados
  - isActive() como gate antes de enfileirar — correto
  - handleOpen/handleEscalation/handleResolvedEvent filtrando canais — correto

  A lógica está certa. O problema é de onde os dados vêm.

  ---
  Plano de Ação

  Fase 1 — Remover a camada local (urgente, antes do deploy em prod)

  O que remover:
  - dispatch_configs table do schema.ts
  - drizzle/0006_dispatch_configs.sql (ou adicionar drop migration)
  - dispatch-config.repository.pg.ts e CachedDispatchConfigRepository
  - Rotas GET/PUT/DELETE /dispatch-configs de dispatch-config.routes.ts + index.ts

  O que manter:
  - filterChannelsByConfig() no DecisionEngine
  - DispatchConfigPort interface em decision.types.ts
  - Gates em alarms.routes.ts (enqueueNotificationRelay)

  Fase 2 — Implementar via GCDR (Opção B)

  Criar GCDRDispatchConfigAdapter que implementa DispatchConfigPort:

  // isActive() consulta GCDR:
  // GET /customers/:customerId/channels → kill switch por canal
  // GET /groups/:groupId/dispatch       → matriz canal × action

  Cache TTL aqui faz sentido (dados externos, latência real).

  Bloqueio: os endpoints GCDR (/customers/:id/channels, /groups/:id/dispatch) precisam existir. Você sabe se eles já estão disponíveis no GCDR?

  Fase 3 — Bundle (Opção A, a prazo)

  Incluir dispatch config no bundle GET /customers/:id/alarm-rules/bundle/simple — elimina calls extras ao GCDR em tempo de execução.

  ---
  Decisão imediata

  Antes de deployar em prod: devemos reverter a Fase 1 para não criar a tabela dispatch_configs desnecessariamente. Os gates de lógica ficam dormentes (isActive retorna true sempre) até o GCDR expor a config.       

  Os endpoints GCDR existem hoje?