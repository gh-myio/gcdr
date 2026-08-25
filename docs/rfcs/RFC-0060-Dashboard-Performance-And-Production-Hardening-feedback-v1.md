# RFC-0060 - Dashboard Performance and Production Hardening - Feedback v1

- **Revisao de:** `docs/rfcs/RFC-0060-Dashboard-Performance-And-Production-Hardening.md`
- **Data:** 2026-08-24
- **Escopo:** backend GCDR, contrato de API, auditoria, operacao em producao
- **Parecer:** **aprovar a direcao, mas ajustar o plano antes de implementar**

## 1. Resumo executivo

O RFC acerta no diagnostico principal: o endpoint `/api/v1/dashboard` esta fazendo trabalho analitico caro em cima de uma tabela OLTP de auditoria que cresce sem limite. A solucao tambem aponta para a direcao correta: separar hot path do dashboard, usar rollups, parar de gravar eventos de alta frequencia em `audit_logs`, corrigir higiene de erros e dar visibilidade a clientes M2M quebrados.

O problema e a ordem e alguns limites do desenho. Do jeito que esta, os passos 2 e 3 podem reduzir a latencia percebida, mas ainda deixam a fonte do crescimento ativa ate o passo 4. Alem disso, o plano de write-through em `audit_stats_hourly` pode adicionar write amplification justamente enquanto `RULE_TRIGGERED` ainda inunda o banco. Para um incidente de producao, a primeira fase precisa ser uma mitigacao curta e reversivel que pare o sangramento antes da solucao estrutural.

## 2. Veredito

**Nao bloquearia o RFC por arquitetura**, mas pediria uma revisao antes do PR:

1. adicionar uma Fase 0 para cortar ou redirecionar `RULE_TRIGGERED` imediatamente;
2. manter compatibilidade temporaria do contrato de `GET /dashboard`;
3. separar rollup de auditoria de contadores de falha de auth;
4. corrigir a descricao de `ZodError` para refletir o codigo atual;
5. explicitar atomicidade, backfill, retencao e operacao do backlog de dezenas de milhoes de linhas.

## 3. Achados P0 - antes de implementar

### P0.1 - A ordem de rollout deixa a causa raiz ativa por tempo demais

O RFC propoe:

1. Zod/templates;
2. `audit_stats_hourly`;
3. split/cache do dashboard;
4. so entao redirecionar `RULE_TRIGGERED`;
5. retencao.

Isso melhora sintomas antes de parar a fonte do problema. Enquanto `RULE_TRIGGERED` continuar entrando em `audit_logs`, a tabela segue crescendo em aproximadamente milhoes de linhas por mes. Pior: se o write-through de `audit_stats_hourly` entrar antes do redirecionamento, cada evento de flood passa a fazer tambem um upsert de rollup.

**Recomendacao:** inserir uma **Fase 0 operacional**:

- parar de persistir `RULE_TRIGGERED` em `audit_logs` imediatamente, por allowlist/denylist explicita no audit writer ou por configuracao;
- manter `RuleService.recordTrigger()` como fonte minima de `triggerCount` e `lastTriggeredAt` ate existir `rule_execution_stats_hourly`;
- adicionar metrica/log unico por minuto indicando quantos triggers foram suprimidos;
- so depois ativar write-through de rollups.

Essa fase deve ser pequena, testavel e reversivel. O dashboard pode continuar impreciso por alguns dias, mas o banco para de piorar.

### P0.2 - `audit_stats_hourly` nao deve ser reutilizada para noisy-client/auth denials

O schema proposto para `audit_stats_hourly` tem dimensoes:

```sql
tenant_id, bucket, event_category, action, count
```

Isso atende o bloco atual do dashboard, que agrega por categoria e action. Nao atende o item de noisy clients, que precisa responder perguntas por `apiKeyPrefix | ip`, endpoint e motivo (`missing scope goals:read`, `no credentials`, etc.).

Se esses dados forem comprimidos em `event_category='AUTH'` e `action='DENY'`, o dashboard so sabera que houve denies, nao quem corrigir. Se forem colocados em metadata, a tabela deixa de ter chave/indice adequado e volta a virar um mini audit log.

**Recomendacao:** criar um rollup separado:

```sql
auth_denial_stats_hourly (
  tenant_id,
  bucket,
  principal_kind,       -- API_KEY | IP | USER | UNKNOWN
  principal_fingerprint, -- hash/prefix nao sensivel
  endpoint_pattern,
  status_code,
  reason_code,
  count,
  last_seen_at,
  PRIMARY KEY (...)
)
```

O dashboard de alertas le esta tabela, nao `audit_stats_hourly`.

## 4. Achados P1 - alta prioridade

### P1.1 - O diagnostico de `ZodError` esta parcialmente incorreto no codigo atual

No checkout atual, `src/middleware/errorHandler.ts` ja tem um ramo `err instanceof ZodError` que responde HTTP 400 com `VALIDATION_ERROR`. O problema real e que o handler decide o log antes de classificar `ZodError`; como `ZodError` nao e `AppError`, ele entra no `console.error('Error:', err)` e imprime stack trace.

Isso ainda explica o log ruidoso de producao, mas nao confirma sozinho o HTTP 500 descrito no RFC. Pode haver drift entre producao e branch atual, ou o log observado pode ter vindo de uma versao anterior.

**Recomendacao:** ajustar o RFC para:

- confirmar o SHA/versao do container que produziu o log;
- mudar o requisito de "mapear ZodError para 400" para "mapear e logar ZodError como erro operacional, sem stack";
- adicionar teste que espiona `console.error` e garante que parse error nao emite stack.

### P1.2 - Remover `audit` de `GET /dashboard` e uma quebra evitavel

O RFC diz que `GET /api/v1/dashboard` mantera o shape "minus audit". Isso quebra qualquer consumidor que use o bloco `audit`, conhecido ou nao. Como o proprio RFC diz que o frontend sera atualizado no mesmo release, o risco parece baixo, mas e desnecessario.

**Recomendacao:** rollout compativel:

1. criar `GET /dashboard/audit`;
2. manter `audit` em `GET /dashboard` por uma release, servido do mesmo rollup/cache e com `staleAsOf`;
3. adicionar header de deprecacao ou campo `meta.deprecated.auditInline=true`;
4. remover o bloco so depois de confirmar consumidores.

Isso reduz risco sem manter a query lenta.

### P1.3 - A atomicidade do write-through nao esta definida

O RFC fala que `AuditLogRepository.create()` fara insert em `audit_logs` e upsert em `audit_stats_hourly`. Mas hoje os eventos via `logEvent` sao escritos no `res.on('finish')` e o writer e chamado de forma assincrona, com erro apenas logado. Ja `logAuditEvent()` e aguardado por alguns servicos.

Sem uma politica explicita, ficam perguntas importantes:

- se o insert de `audit_logs` passa e o upsert de rollup falha, o dashboard fica errado?
- se o upsert falha, a escrita de negocio deve falhar?
- o backfill sera a fonte de reconciliacao para rollups perdidos?
- `RULE_TRIGGERED` redirecionado precisa ser transacional com `incrementTriggerCount`?

**Recomendacao:** definir uma das politicas:

- **best-effort + reconciliador:** writes de negocio nunca falham por rollup; job diario reconcilia `audit_stats_hourly` a partir de `audit_logs`;
- **transacional para auditoria:** insert e upsert no mesmo `db.transaction`, falha visivel no audit writer, sem afetar resposta de negocio em `logEvent`;
- **outbox:** mais robusto, mas provavelmente pesado para este incidente.

Para v1, eu escolheria best-effort com reconciliador e metricas de falha.

### P1.4 - Retencao por batched delete pode piorar bloat se nao houver plano operacional

O RFC esta correto em nao colocar a limpeza de backlog numa migration. Mas deletar dezenas de milhoes de linhas com batches de 10.000 ainda pode gerar bloat, WAL alto, replicacao atrasada e vacuums longos.

**Recomendacao:** a secao de retencao precisa incluir:

- estimativa inicial por tenant e por mes antes de apagar;
- limite de tempo por janela noturna, nao apenas tamanho do batch;
- pausa por lock timeout / replication lag / CPU;
- `VACUUM (ANALYZE)` planejado ou estrategia de particionamento futuro;
- modo dry-run com contagens;
- rollback conceitual: export/backup antes de remover backlog;
- politica clara para linhas de nivel critico ou exigencias de compliance.

Tambem vale alinhar com `AuditLogRepository.deleteExpired(level, beforeDate)`, que hoje apaga por `auditLevel`; o RFC propoe retencao geral por idade.

### P1.5 - A tabela de aliases de templates precisa ser contrato, nao hotfix local

Mapear `email/alarm.opened` e `email/alarm.closed` para `EMAIL_ALARM` pode reparar o consumidor atual, mas tambem pode esconder uma diferenca de semantica. O proprio dominio ja tem tipos separados para Telegram aberto/fechado.

**Recomendacao:** antes de codar aliases:

- identificar o consumidor real e seu contrato versionado;
- decidir se email precisa de `EMAIL_ALARM_OPENED` e `EMAIL_ALARM_CLOSED`;
- documentar se alias e entrada aceita publicamente ou apenas compatibilidade temporaria;
- instrumentar contador de uso de alias para saber quando pode remover;
- garantir que resposta e storage sempre usem tipo canonico.

O RFC ja levanta isso como pergunta aberta, mas a ordem de rollout diz para shippar alias primeiro. Eu inverteria: confirmar a semantica antes do passo 1, ou shippar apenas 400 limpo como mitigacao inicial.

## 5. Achados P2 - importantes

### P2.1 - O cache precisa definir invalidacao e limite de memoria

TTL por tenant e suficiente para um unico processo, mas o RFC nao define:

- tamanho maximo do cache;
- comportamento com muitos tenants;
- invalidacao quando regras/devices mudam;
- efeito de `?fresh=true` sob concorrencia;
- singleflight para evitar varios cold misses simultaneos executando a mesma query.

**Recomendacao:** especificar uma interface pequena com `getOrLoad`, `maxEntries`, TTL jitter e singleflight por chave. Mutacoes de rules/devices podem invalidar o bloco barato; o bloco de audit pode aceitar TTL fixo.

### P2.2 - A query de rollup deve retornar todos os buckets com `0`

O contrato de `GET /dashboard/audit` mostra janelas sempre presentes. A query de rollup deve preencher categorias/actions ausentes como `{}` e janelas sem dados como total `0`, sem depender de linhas existentes.

**Recomendacao:** adicionar acceptance tests para tenant novo, tenant sem audit no mes e tenant com apenas uma categoria/action.

### P2.3 - O plano precisa separar endpoint de usuario e endpoint admin

`GET /dashboard` e home de usuario autenticado. "Noisy clients" e alertas operacionais parecem dados de admin/operacao, nao necessariamente de todo usuario do tenant.

**Recomendacao:** explicitar se os alertas entram no dashboard comum ou em `/admin/monitor`/painel operacional. Se ficarem em `/dashboard`, aplicar RBAC/role para nao expor IP, prefixo de chave ou nomes de integracoes a usuarios sem perfil operacional.

### P2.4 - OpenAPI e testes de contrato devem entrar como entregaveis

O RFC fala de endpoint novo e mudanca de shape, mas nao chama OpenAPI/testes como acceptance criteria.

**Recomendacao:** adicionar checklist minimo:

- OpenAPI para `/dashboard` e `/dashboard/audit`;
- teste unitario de `DashboardService` garantindo que `/dashboard` nao chama agregacoes cruas de `audit_logs`;
- teste de repositorio/SQL para rollups;
- teste de controller para `?fresh=true` autorizado e negado;
- teste de erro Zod sem `console.error`;
- teste de compatibilidade temporaria do campo `audit`, se a recomendacao P1.2 for aceita.

## 6. Pontos positivos

- O RFC esta ancorado em evidencia real de producao, com numeros suficientes para justificar prioridade.
- A conclusao "indice nao resolve agrupamento sobre milhoes de linhas" esta correta.
- Separar o dashboard em blocos independentes e impedir que loading vire `0` no frontend e uma correcao de produto importante.
- Tirar `RULE_TRIGGERED` do audit trail humano e manter apenas contador/last fired e a modelagem certa para esse volume.
- A preocupacao de nao rodar cleanup massivo dentro de migration esta alinhada com a governanca do projeto.
- A secao de alternativas e boa: descarta cache-only, materialized view e TimescaleDB pelos motivos certos.

## 7. Ordem recomendada revisada

1. **Fase 0:** suprimir/redirecionar `RULE_TRIGGERED` fora de `audit_logs` imediatamente; manter contadores atuais.
2. Corrigir log de `ZodError` e decidir contrato de template aliases.
3. Criar `audit_stats_hourly`, backfill dry-run/aplicado e reconciliador.
4. Trocar dashboard para rollup mantendo compatibilidade temporaria do campo `audit`.
5. Adicionar `/dashboard/audit`, cache com singleflight e frontend com skeletons.
6. Criar `rule_execution_stats_hourly` e mover estatisticas de regra para ele.
7. Implementar retencao nova para entradas futuras e depois limpar backlog com script supervisionado.
8. Criar `auth_denial_stats_hourly` e alertas operacionais com RBAC adequado.

## 8. Decisoes que o RFC ainda precisa fechar

| # | Decisao | Por que importa |
|---|--------|-----------------|
| DEC-1 | `RULE_TRIGGERED` sera suprimido ja na Fase 0 ou so quando `rule_execution_stats_hourly` existir? | Define se a producao para de piorar imediatamente. |
| DEC-2 | `GET /dashboard` mantem `audit` por uma release? | Evita quebra de consumidor desconhecido. |
| DEC-3 | Rollup e best-effort ou transacional? | Define consistencia e impacto em writes de negocio. |
| DEC-4 | Aliases de email sao definitivos, temporarios ou rejeitados com 400 limpo? | Evita codificar semantica errada de alarm opened/closed. |
| DEC-5 | Alertas de noisy client sao dados de admin ou dashboard comum? | Evita expor detalhe operacional a usuario sem necessidade. |
| DEC-6 | Retencao apaga tudo por idade ou preserva eventos criticos por mais tempo? | Afeta compliance e auditoria. |

## 9. Impressao final

O RFC e necessario e deve seguir. A melhor melhoria agora e transformar o plano de "hardening completo" em duas trilhas: mitigacao imediata de producao e solucao estrutural. Sem essa separacao, o time pode gastar energia em endpoint split, cache e docs enquanto a tabela continua recebendo o mesmo volume que causou o incidente.

Com a Fase 0, compatibilidade temporaria do contrato e separacao dos rollups por finalidade, o desenho fica robusto e pragmatico.
