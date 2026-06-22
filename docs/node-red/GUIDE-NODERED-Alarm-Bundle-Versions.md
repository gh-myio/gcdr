# Node-RED - Guia: Alarm Bundle Version History & Cache Invalidation

> **RFC:** [RFC-0015](./RFC-0015-Alarm-Bundle-Version-History.md)
> **Data:** 2026-02-19
> **Audiencia:** Equipe Node-RED / IoT

---

## O que mudou?

### Antes (problema)

- O bundle de alarmes ficava em cache por 5 minutos no backend
- Se alguem criava/editava/deletava uma regra, o Node-RED continuava recebendo o bundle **antigo** por ate 5 minutos
- Nao havia como saber se o bundle tinha mudado ou por que

### Agora (solucao)

- **Qualquer mudanca** em rules, devices, centrais, assets ou customers **invalida o cache imediatamente**
- Na proxima consulta, o Node-RED recebe o bundle **atualizado**
- Cada versao do bundle e registrada no banco com o motivo da mudanca

---

## 1. Impacto nos endpoints

### Nenhuma mudanca na API

Os endpoints continuam identicos:

```
GET /api/v1/customers/{customerId}/alarm-rules/bundle/simple
GET /api/v1/customers/{customerId}/alarm-rules/bundle
```

A autenticacao, headers e formato de resposta **nao mudaram**.

### O que muda na pratica

| Cenario | Antes | Agora |
|---------|-------|-------|
| Regra criada no painel | Bundle atualiza em ate 5 min | Bundle atualiza na **proxima request** |
| Device removido | Bundle atualiza em ate 5 min | Bundle atualiza na **proxima request** |
| Central editada | Bundle atualiza em ate 5 min | Bundle atualiza na **proxima request** |
| TTL expira sem mudancas | Bundle regenera | Bundle regenera (comportamento igual) |

---

## 2. Polling otimizado com ETag (recomendado)

O Node-RED ja pode usar ETag para evitar downloads desnecessarios. Agora isso e **ainda mais importante** porque o bundle e invalidado com mais frequencia.

### Fluxo com ETag

```
┌────────────┐                          ┌──────────┐
│  Node-RED  │  GET /bundle/simple      │   GCDR   │
│            │ ─────────────────────>   │          │
│            │                          │ 200 + bundle
│            │  <─────────────────────  │ ETag: "v1-abc123"
│            │                          │          │
│  (armazena │                          │          │
│   version) │                          │          │
│            │                          │          │
│  ... 30s depois ...                   │          │
│            │                          │          │
│            │  GET /bundle/simple      │          │
│            │  If-None-Match: "v1-abc" │          │
│            │ ─────────────────────>   │          │
│            │                          │ Cache valido
│            │  <─────────────────────  │ 304 Not Modified
│            │  (sem body, economiza)   │          │
│            │                          │          │
│  ... usuario cria regra ...           │          │
│            │                          │ Cache INVALIDADO
│            │  GET /bundle/simple      │          │
│            │  If-None-Match: "v1-abc" │          │
│            │ ─────────────────────>   │          │
│            │                          │ Gera novo bundle
│            │  <─────────────────────  │ 200 + novo bundle
│            │                          │ ETag: "v1-def456"
└────────────┘                          └──────────┘
```

### Implementacao no Node-RED (HTTP Request node)

```
Headers de envio:
  X-API-Key: gcdr_cust_78ce6aac...
  If-None-Match: {{flow.bundleVersion}}

Ao receber resposta:
  Se statusCode == 200:
    - Processar novo bundle
    - Salvar flow.bundleVersion = response.headers.etag
  Se statusCode == 304:
    - Manter bundle atual (nao mudou)
```

---

## 3. Intervalo de polling recomendado

| Cenario | Intervalo | Justificativa |
|---------|-----------|---------------|
| Producao (padrao) | **30 segundos** | Bom balanco entre latencia e carga |
| Producao (critico) | **10 segundos** | Para clientes que precisam de reacao rapida |
| Desenvolvimento | **5 segundos** | Para testar mudancas rapidamente |

Com ETag, o custo de polling frequente e minimo: quando o bundle nao mudou, a resposta e um 304 sem body.

---

## 4. Cenarios de invalidacao

O bundle e invalidado automaticamente quando:

| Entidade | Operacao | Reason registrado |
|----------|----------|-------------------|
| **Rule** | Criar | `rule_created` |
| **Rule** | Editar | `rule_updated` |
| **Rule** | Deletar | `rule_deleted` |
| **Rule** | Ativar/Desativar | `rule_toggled` |
| **Device** | Criar | `device_created` |
| **Device** | Editar | `device_updated` |
| **Device** | Deletar | `device_deleted` |
| **Central** | Criar | `central_created` |
| **Central** | Editar | `central_updated` |
| **Central** | Deletar | `central_deleted` |
| **Asset** | Criar | `asset_created` |
| **Asset** | Editar | `asset_updated` |
| **Asset** | Deletar | `asset_deleted` |
| **Customer** | Editar | `customer_updated` |
| **Customer** | Deletar | `customer_deleted` |

### Invalidacao por escopo

A invalidacao e **por customer**. Se um device do Customer A e editado, apenas o cache do Customer A e invalidado. O cache do Customer B permanece intacto.

---

## 5. Headers de resposta do bundle

| Header | Descricao | Exemplo |
|--------|-----------|---------|
| `ETag` | Hash da versao (usar em `If-None-Match`) | `"v1-a1b2c3d4e5f6"` |
| `X-Bundle-Version` | Versao do bundle (mesmo valor sem aspas) | `v1-a1b2c3d4e5f6` |
| `X-Bundle-Signature` | Assinatura HMAC-SHA256 | `8f3a2b...` |
| `Cache-Control` | Diretiva de cache | `private, max-age=300` |

---

## 6. Verificacao de integridade

O header `X-Bundle-Signature` contem um HMAC-SHA256 que garante que o bundle nao foi alterado em transito. O Node-RED pode verificar (opcional):

```javascript
const crypto = require('crypto');
const secret = process.env.BUNDLE_SIGNING_SECRET;

const contentToSign = JSON.stringify({
  meta: {
    version: bundle.meta.version,
    generatedAt: bundle.meta.generatedAt,
    customerId: bundle.meta.customerId,
    tenantId: bundle.meta.tenantId,
  },
  rulesCount: bundle.meta.rulesCount,
  devicesCount: bundle.meta.devicesCount,
});

const expectedSignature = crypto
  .createHmac('sha256', secret)
  .update(contentToSign)
  .digest('hex');

const isValid = expectedSignature === bundle.meta.signature;
```

---

## 7. Diagnostico e troubleshooting

### "O bundle nao atualizou apos criar uma regra"

1. Verifique se a regra foi criada com sucesso (POST retornou 201)
2. Faca um GET do bundle **sem** `If-None-Match` para forcar download completo
3. Confira que o `customerId` da regra corresponde ao customer do bundle

### "Recebo sempre 304"

1. O bundle nao mudou desde a ultima consulta -- isso e normal
2. Verifique se a regra foi criada para o **mesmo customer** do bundle
3. Para forcar um bundle novo, remova o header `If-None-Match`

### "Quero ver o historico de versoes"

Consulte a tabela diretamente no banco (ate que uma rota REST seja criada):

```sql
SELECT version, previous_version, bundle_type, reason, entity_type,
       rules_count, devices_count, created_at
FROM alarm_bundle_versions
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  AND customer_id = '77777777-7777-7777-7777-777777777777'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 8. Resumo

| Item | Status |
|------|--------|
| Endpoints | Sem mudanca (mesma URL, mesmos headers) |
| Formato do bundle | Sem mudanca |
| Cache invalidation | Automatica apos qualquer CRUD |
| Latencia de atualizacao | De ate 5 min para **proxima request** |
| Acao necessaria do Node-RED | **Nenhuma** (melhoria transparente) |
| Recomendacao | Usar ETag/If-None-Match para polling eficiente |
