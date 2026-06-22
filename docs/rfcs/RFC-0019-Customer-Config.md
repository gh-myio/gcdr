# RFC-0019 — Customer Config: Per-Customer Feature Flags

**Status**: Implemented
**Date**: 2026-02-28
**Author**: GCDR Core Team

---

## Motivation

Cada customer pode precisar de comportamentos ligeiramente diferentes em endpoints do GCDR sem exigir parâmetros extras por request. Um exemplo concreto: clientes em fase de integração precisam desabilitar o check de versão do alarm bundle para que o orquestrador sempre receba o payload completo, mesmo que o `X-Version-Id` não tenha mudado — facilitando debug e onboarding.

A solução é uma coluna `config` jsonb na tabela `customers`, funcionando como um mapa de feature flags e configurações per-customer extensível sem novas migrações.

---

## Design

### Coluna

```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS config jsonb;
```

### Estrutura do JSON

```json
{
  "bundle": {
    "checkVersion": false
  }
}
```

O objeto é **parcial e extensível** — qualquer chave ausente assume o comportamento padrão. Novos feature flags são adicionados ao objeto sem migração.

### Default

`NULL` (sem configuração) = comportamento padrão em todos os features.

---

## Feature: `bundle.checkVersion`

| Valor | Comportamento |
|-------|--------------|
| `true` (default) | Comportamento atual: retorna `{ versionId, message: 'Not Modified' }` se `X-Version-Id` não mudou |
| `false` | Sempre retorna o bundle completo (`200` com payload), ignora `X-Version-Id` do request |

### Quando usar `checkVersion: false`

- Customer em fase de onboarding/debug
- Orquestrador com bug no controle de cache que precisa de bypass temporário
- Testes de integração que precisam sempre do payload completo

### Como ativar

```sql
UPDATE customers
SET config = '{"bundle": {"checkVersion": false}}'::jsonb
WHERE id = '<customer-id>';
```

### Como desativar (volta ao padrão)

```sql
UPDATE customers
SET config = config - 'bundle'   -- remove só a chave bundle
-- ou
SET config = NULL                -- limpa tudo
WHERE id = '<customer-id>';
```

---

## Implementação

### Fluxo

```
GET /customers/:customerId/alarm-rules/bundle/simple
  ↓
AlarmBundleService.generateSimplifiedBundle()
  → carrega customer (já existente)
  → lê customer.config?.bundle?.checkVersion
  → adiciona meta.skipVersionCheck = true/false
  ↓
Controller
  → se meta.skipVersionCheck → pula comparação de X-Version-Id
  → retorna bundle completo sempre
```

### Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `drizzle/migrations/0012_customer_config.sql` | ADD COLUMN config jsonb |
| `src/infrastructure/database/drizzle/schema.ts` | campo `config` no customers table |
| `src/domain/entities/Customer.ts` | interface `CustomerConfig` + campo `config` |
| `src/domain/entities/AlarmBundle.ts` | campo `skipVersionCheck` em `SimpleBundleMeta` |
| `src/repositories/CustomerRepository.ts` | `config` em `mapToEntity` |
| `src/services/AlarmBundleService.ts` | lê config, seta `meta.skipVersionCheck` |
| `src/controllers/rules.controller.ts` | skip version checks se `skipVersionCheck` |

---

## Extensibilidade futura

O objeto `config` pode receber qualquer nova flag sem migration:

```json
{
  "bundle": {
    "checkVersion": false,
    "ttlSeconds": 60
  },
  "alerts": {
    "emailEnabled": false
  },
  "sync": {
    "readonly": true
  }
}
```
