# RFC-0018: Per-Device Rule Value Overrides (`scope_entity_overrides`)

- **Feature Name:** `per-device-rule-value-overrides`
- **Start Date:** 2026-02-27
- **RFC PR:** (pendente)
- **Tracking Issue:** (pendente)
- **Status:** Draft
- **Authors:** MYIO Platform Team
- **Related RFCs:** [RFC-0015](./RFC-0015-Alarm-Bundle-Version-History.md) (Bundle Versioning), [RFC-0008](./RFC-0008-Device-Attributes-Extension.md) (Device Attributes)
- **Stakeholders:** Backend, Node-RED / Orquestrador de Alarmes

---

## Summary

Adicionar uma coluna `scope_entity_overrides jsonb` na tabela `rules` para permitir que devices mapeados via `scope_entity_ids` tenham valores de threshold individuais, sobrescrevendo o valor base da rule para casos excepcionais.

O GCDR resolve os overrides internamente ao gerar o bundle — o orquestrador recebe o payload exatamente igual ao formato atual, com o `value` já corrigido. **Zero mudança de contrato com o orquestrador.**

---

## Motivation

### Problema

Hoje uma rule define um único `value` (threshold) aplicado igualmente a todos os devices em `scope_entity_ids`. Em cenários reais, devices diferentes do mesmo grupo podem precisar de limiares distintos — por exemplo, elevadores de andares diferentes com consumo de referência diferente.

**Exemplo concreto:**

- Rule: *"Elevador energizado e não usado"* → `value: 205` (Wh)
- Elevadores L2: threshold padrão de `205`
- Elevadores L3-L4: threshold de referência diferente (`220`)

Atualmente é necessário criar uma rule separada por grupo de threshold, duplicando configurações de horário, métrica, operador, etc.

### Objetivo

Permitir exceções de `value` (e outros campos sobrescrevíveis) por device dentro de uma mesma rule, sem duplicar rules e sem alterar o contrato do bundle com o orquestrador.

---

## Design

### 1. Coluna no banco — `scope_entity_overrides`

Nova coluna JSONB na tabela `rules`, ao lado de `scope_entity_ids`:

```sql
ALTER TABLE rules
ADD COLUMN scope_entity_overrides jsonb;
```

**Estrutura do JSONB:**

```json
{
  "<device-uuid>": {
    "value": 220
  }
}
```

- A chave é o UUID do device (deve estar presente em `scope_entity_ids`)
- Somente os campos que diferem do base precisam ser informados
- Campos sobrescrevíveis na V1: `value`, `valueHigh`
- Se ausente ou `null`, o device herda o valor base da rule

**Exemplo:**

```json
// scope_entity_ids: ["uuid-elev-L2-1", "uuid-elev-L2-2", "uuid-elev-L3-1"]
// scope_entity_overrides:
{
  "uuid-elev-L3-1": { "value": 220 }
}
// uuid-elev-L2-1 e uuid-elev-L2-2 → value: 205 (base)
// uuid-elev-L3-1 → value: 220 (override aplicado pelo GCDR)
```

---

### 2. Resolução interna no GCDR — sem mudança no bundle

Ao gerar o bundle, o `AlarmBundleService` verifica `scope_entity_overrides` para cada device. Quando há override, o GCDR cria uma **entrada variante** no catálogo `rules` com o value já resolvido, e o `ruleIds` do device aponta para essa variante.

**Bundle resultante:**

```json
{
  "rules": {
    "rule-id": { "value": 205, "metric": "energy", ... },
    "rule-id_uuid-elev-L3-1": { "value": 220, "metric": "energy", ... }
  },
  "deviceIndex": {
    "uuid-elev-L2-1": {
      "deviceName": "Elevador 1 L2",
      "slaveId": 182,
      "offset": { "energy": 0 },
      "ruleIds": ["rule-id"]
    },
    "uuid-elev-L2-2": {
      "deviceName": "Elevador 2 L2",
      "slaveId": 183,
      "offset": { "energy": 0 },
      "ruleIds": ["rule-id"]
    },
    "uuid-elev-L3-1": {
      "deviceName": "Elevador 1 L3",
      "slaveId": 190,
      "offset": { "energy": 0 },
      "ruleIds": ["rule-id_uuid-elev-L3-1"]
    }
  }
}
```

O orquestrador não sabe que existem overrides — processa o bundle exatamente igual ao formato atual.

**Chave da variante:** `{ruleId}_{deviceId}` (sem separador ambíguo, descartável pelo orquestrador como opaque string).

---

### 3. Campos sobrescrevíveis (V1)

| Campo       | Tipo     | Descrição                           |
|-------------|----------|-------------------------------------|
| `value`     | `number` | Threshold inferior / único          |
| `valueHigh` | `number` | Threshold superior (BETWEEN/OUTSIDE)|

Campos como `metric`, `operator`, `aggregation`, `duration`, `daysOfWeek` são globais à rule e não sobrescrevíveis por device — criar uma nova rule nesses casos.

---

## Impacto de Implementação

### GCDR (Backend)

| Artefato | Mudança |
|---|---|
| `schema.ts` | Adicionar `scopeEntityOverrides: jsonb('scope_entity_overrides')` na tabela `rules` |
| Migration | `0010_rules_scope_entity_overrides.sql` |
| `Rule.ts` (entity) | Adicionar `scopeEntityOverrides?: Record<string, RuleValueOverride>` |
| `RuleDTO.ts` | Validação Zod para `scopeEntityOverrides` no create/update |
| `AlarmBundleService.ts` | Ao construir `rulesCatalog` e `deviceIndex`, gerar variantes resolvidas quando houver override |
| `AlarmBundle.ts` | Nenhuma mudança de interface (bundle format inalterado) |
| `RuleRepository.ts` | Mapear coluna no select/insert/update |

### Orquestrador de Alarmes

**Nenhuma mudança.** Recebe bundle no mesmo formato de sempre.

---

## Compatibilidade

- **Retrocompatível**: `scope_entity_overrides` ausente → comportamento atual preservado
- **Bundle version hash**: alterado quando `scope_entity_overrides` muda → aciona revalidação via `X-Version-Id`
- **`scope_entity_ids`**: sem alteração de tipo ou semântica

---

## Exemplo de Uso via API

### Criação de rule com override

```json
POST /customers/:id/rules
{
  "name": "Elevador energizado e não usado",
  "type": "ALARM_THRESHOLD",
  "scope": {
    "type": "DEVICE",
    "entityIds": [
      "uuid-elev-L2-1",
      "uuid-elev-L2-2",
      "uuid-elev-L3-1"
    ]
  },
  "scopeEntityOverrides": {
    "uuid-elev-L3-1": { "value": 220 }
  },
  "alarmConfig": {
    "metric": "energy",
    "operator": "LT",
    "value": 205,
    "duration": 1200000,
    "aggregation": "MAX",
    "startAt": "10:00",
    "endAt": "22:00",
    "daysOfWeek": [1, 2, 3, 4, 5, 6]
  }
}
```
