# Alarm Backend — Dispatch Config: Review de Arquitetura

**Data**: 2026-03-13
**Contexto**: RFC-0020 do alarm backend implementou `dispatch_configs` como tabela local. Este documento descreve os problemas encontrados e a abordagem correta.

---

## Problema Central

O alarm backend criou sua **própria tabela `dispatch_configs`** em vez de consumir GCDR como fonte da verdade.

---

## O que está duplicado

GCDR (RFC-0024 + RFC-0025) já modela completamente a configuração de dispatch:

| Tabela GCDR | Responsabilidade |
|---|---|
| `customer_channels` | Credenciais por canal (SMTP, Bot Token etc.) + kill switch por tenant |
| `group_dispatch_configs` | Matriz canal × AlarmAction por grupo |
| `user_contacts` | Endereços de contato por canal por usuário |

O alarm backend adicionou `dispatch_configs` ao seu próprio schema — overlap direto com o que já existe no GCDR. Com dois sistemas donos da mesma configuração, não há fonte da verdade única: o dado pode divergir silenciosamente.

---

## Problemas Identificados

### 1. Rotas de escrita no backend errado

O alarm backend expõe:

```
PUT    /dispatch-configs
PUT    /dispatch-configs/bulk
DELETE /dispatch-configs/:id
```

Isso significa que o **frontend precisaria chamar dois backends** para gerenciar configuração de dispatch — GCDR para regras, devices, usuários e o alarm-api para dispatch config. Consequências:

- GCDR não tem visibilidade das configurações aplicadas
- Sem audit trail centralizado
- Sem consistência entre o que o GCDR exibe e o que o orquestrador executa

### 2. `isActive()` verificando dado local

```
enqueueNotificationRelay gateado por dispatchConfigRepo.isActive()
```

Se `dispatch_configs` é uma tabela local do alarm backend, quem a popula e quando? Sem mecanismo de sync descrito, o dado pode estar desatualizado indefinidamente. Uma mudança feita no GCDR não se reflete automaticamente no alarm backend.

### 3. `CachedDispatchConfigRepository` cacheando dado local

Caching faz sentido para reduzir latência em chamadas externas (ex: calls ao GCDR). Caching de uma tabela que o próprio serviço escreve não adiciona valor e adiciona complexidade.

---

## Como Deveria Funcionar

O alarm orchestrator já tem um padrão estabelecido para consumir configuração do GCDR: o **alarm bundle**.

```
GET /customers/:customerId/alarm-rules/bundle/simple
```

### Opção A — Incluir dispatch config no bundle (recomendada)

Estender o bundle response para incluir as configurações de dispatch:

```json
{
  "rules": [...],
  "dispatch": {
    "customer_channels": [
      { "channel": "TELEGRAM", "active": true, "config": { "botToken": "..." } }
    ],
    "group_dispatch": [
      { "groupId": "...", "channel": "TELEGRAM", "action": "OPEN", "active": true }
    ]
  }
}
```

O orquestrador já versiona o bundle (`X-Version-Id` + 304). Dispatch config segue o mesmo ciclo de cache e invalidação.

### Opção B — Calls diretas ao GCDR no momento de dispatch

O orquestrador consulta GCDR em tempo de execução (com cache TTL curto):

```
GET /customers/:customerId/channels          → credenciais + kill switch
GET /groups/:groupId/dispatch               → matriz canal × action
GET /users/:userId/contacts                 → contatos por canal
```

Esta opção é mais simples de implementar agora, antes de incluir dispatch no bundle.

---

## O que Manter do RFC-0020

A **lógica de filtragem** está correta conceitualmente:

- `filterChannelsByConfig()` no DecisionEngine — certo, só precisa ser alimentado com dados vindos do GCDR
- `isActive()` como gate antes de enfileirar — certo, mas a fonte deve ser GCDR
- `handleOpen`, `handleEscalation`, `handleResolvedEvent` filtrando canais — correto

O problema não é onde a lógica está, é de onde vêm os dados.

---

## Resumo

| Problema | Impacto |
|---|---|
| `dispatch_configs` table no alarm backend | Config duplicada, fonte da verdade ambígua |
| Rotas PUT/DELETE no alarm backend | Frontend chama 2 backends; GCDR não sabe o que foi configurado |
| `isActive()` com dado local | Stale data sem mecanismo de sync; sem audit trail no GCDR |
| `CachedDispatchConfigRepository` cacheando dado local | Cache de dado que já é stale por definição |

**Ação recomendada**: remover `dispatch_configs` do alarm backend e consumir `customer_channels` + `group_dispatch_configs` via GCDR API (Opção B imediata) ou via bundle (Opção A a prazo).
