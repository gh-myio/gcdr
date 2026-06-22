# Feature: Override de Valor por Device em Rules

> **Para:** Equipe de Frontend
> **RFC:** [RFC-0018](../rfcs/RFC-0018-Per-Device-Rule-Value-Overrides.md)
> **Status:** Disponível

---

## O que é?

Uma rule do tipo `ALARM_THRESHOLD` com múltiplos devices em `scope.entityIds` agora aceita o campo **`scopeEntityOverrides`** — um mapa de `deviceId → { value, valueHigh }` que sobrescreve o threshold base para devices específicos.

Devices **sem** entrada no mapa continuam usando o `value` definido em `alarmConfig`.

---

## Campo novo

```ts
scopeEntityOverrides?: Record<string, {
  value?: number;
  valueHigh?: number;
}>
```

- A chave é o UUID do device
- O device **deve** estar presente em `scope.entityIds`
- Somente `value` e `valueHigh` são sobrescrevíveis — os demais campos (`metric`, `operator`, `duration`, `daysOfWeek`, etc.) são sempre os da rule

---

## Criar rule com override — `POST /customers/:customerId/rules`

```json
{
  "customerId": "e04046d4-baa4-44e9-a378-4dfebe4140f1",
  "name": "Elevador energizado e não usado",
  "type": "ALARM_THRESHOLD",
  "priority": "HIGH",
  "scope": {
    "type": "DEVICE",
    "entityId": "uuid-elev-L2-1",
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

**Resultado:**
- `uuid-elev-L2-1` e `uuid-elev-L2-2` → alarme se energy < **205**
- `uuid-elev-L3-1` → alarme se energy < **220**

---

## Atualizar override em rule existente — `PUT /rules/:ruleId`

Para adicionar ou alterar overrides numa rule já existente, envie apenas `scopeEntityOverrides`:

```json
{
  "scopeEntityOverrides": {
    "uuid-elev-L3-1": { "value": 230 },
    "uuid-elev-L2-2": { "value": 195 }
  }
}
```

Para **remover todos os overrides** da rule:

```json
{
  "scopeEntityOverrides": {}
}
```

---

## Operador BETWEEN — sobrescrevendo `valueHigh`

Para rules com `operator: "BETWEEN"`, ambos os campos podem ser sobrescritos:

```json
"scopeEntityOverrides": {
  "uuid-device-especial": {
    "value": 18,
    "valueHigh": 28
  }
}
```

---

## O bundle não muda

O orquestrador (Node-RED) **não precisa de nenhuma alteração**. O GCDR resolve os overrides internamente ao gerar o bundle — cada device recebe o `value` já corrigido, transparente para o consumidor do bundle.

---

## Validações

| Regra | Comportamento |
|---|---|
| Device não está em `scope.entityIds` | Ignorado silenciosamente no bundle |
| Override sem `value` nem `valueHigh` | Entrada ignorada (usa valor base) |
| Rule sem `scopeEntityOverrides` | Comportamento atual preservado |
| `scopeEntityOverrides` só em `ALARM_THRESHOLD` | Outros tipos de rule ignoram o campo |
