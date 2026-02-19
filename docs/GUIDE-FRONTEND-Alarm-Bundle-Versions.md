# Frontend - Guia de Integração: Alarm Bundle Versions

> **RFC:** [RFC-0015](./RFC-0015-Alarm-Bundle-Version-History.md)
> **Data:** 2026-02-19
> **Audiencia:** Equipe Frontend

---

## O que mudou?

A partir desta versao, **toda mutacao** em regras, devices, centrais, assets e customers **invalida imediatamente** o cache do alarm bundle. Isso significa:

- O bundle reflete mudancas em tempo real (sem delay de ate 5 min)
- Cada nova versao do bundle e registrada no banco com o motivo da mudanca
- O frontend pode confiar que, apos salvar uma rule, o proximo GET do bundle ja retorna a versao atualizada

---

## 1. Impacto nas telas existentes

### Tela de Rules (CRUD)

**Nenhuma mudanca na API de Rules.** Os endpoints continuam iguais:

```
POST   /api/v1/rules                    -- criar regra
PUT    /api/v1/rules/:id                -- atualizar regra
DELETE /api/v1/rules/:id                -- deletar regra
PATCH  /api/v1/rules/:id/toggle         -- ativar/desativar regra
```

A diferenca e que agora, apos cada uma dessas operacoes, o backend automaticamente invalida o cache do bundle. **O frontend nao precisa fazer nada extra.**

### Tela de Devices / Centrais / Assets / Customers

Mesma situacao: os endpoints de CRUD continuam iguais. A invalidacao do cache e automatica no backend.

---

## 2. O que o frontend PODE fazer (opcional)

### 2a. Mostrar versao atual do bundle

Ao consumir o bundle simplificado, a resposta ja inclui a versao no `meta`:

```json
{
  "success": true,
  "data": {
    "meta": {
      "version": "v1-a1b2c3d4e5f6",
      "generatedAt": "2026-02-19T14:30:00.000Z",
      "rulesCount": 25,
      "devicesCount": 9,
      "ttlSeconds": 300
    },
    "deviceIndex": { ... },
    "rules": { ... }
  }
}
```

O campo `meta.version` pode ser exibido em um badge ou tooltip, por exemplo:

```
Bundle v1-a1b2c3d4e5f6 | 25 regras | 9 devices | Gerado em 19/02 14:30
```

### 2b. Feedback visual apos CRUD de rule

Apos criar/editar/deletar uma regra, o frontend pode exibir uma mensagem como:

> "Regra salva com sucesso. O bundle de alarmes sera atualizado automaticamente na proxima consulta."

Isso informa o usuario que o Node-RED vai receber a mudanca sem acao manual.

### 2c. Historico de versoes (futuro)

Existe um metodo no backend (`getVersionHistory`) que retorna o historico de versoes do bundle. Quando uma rota REST for exposta, o frontend podera exibir uma timeline:

```
v1-c3d4e5f6a7b8  |  device_updated  |  Device "Sensor Lab"  |  ha 30 min  |  por admin@myio.com
v1-b2c3d4e5f6a7  |  rule_created    |  Rule "Temp Alta"     |  ha 1 hora  |  por admin@myio.com
v1-a1b2c3d4e5f6  |  cache_expired   |  (sistema)            |  ha 2 horas |  --
```

**Estrutura de cada registro:**

| Campo | Tipo | Descricao |
|-------|------|-----------|
| `id` | UUID | ID do registro |
| `version` | string | Hash da versao (ex: `v1-a1b2c3d4e5f6`) |
| `previousVersion` | string? | Versao anterior (null na primeira) |
| `bundleType` | string | `"simple"` ou `"full"` |
| `reason` | string | Motivo da mudanca (ver tabela abaixo) |
| `entityType` | string | Tipo da entidade que mudou |
| `entityId` | UUID? | ID da entidade |
| `rulesCount` | number | Quantidade de regras no bundle |
| `devicesCount` | number | Quantidade de devices no bundle |
| `createdAt` | ISO string | Data/hora da geracao |
| `createdBy` | UUID? | Usuario que causou a mudanca |

### Valores possíveis de `reason`

| Reason | Descricao |
|--------|-----------|
| `cache_expired` | Bundle regenerado apos expiracao do TTL |
| `rule_created` | Nova regra criada |
| `rule_updated` | Regra editada |
| `rule_deleted` | Regra removida |
| `rule_toggled` | Regra ativada/desativada |
| `device_created` | Novo device adicionado |
| `device_updated` | Device editado |
| `device_deleted` | Device removido |
| `central_created` | Nova central adicionada |
| `central_updated` | Central editada |
| `central_deleted` | Central removida |
| `asset_created` | Novo asset adicionado |
| `asset_updated` | Asset editado |
| `asset_deleted` | Asset removido |
| `customer_updated` | Customer editado |
| `customer_deleted` | Customer removido |

---

## 3. Caching no frontend

### ETag / If-None-Match

O bundle suporta caching via ETag. O frontend pode (e deve) enviar o header `If-None-Match` com a versao atual:

```http
GET /api/v1/customers/33333333-.../alarm-rules/bundle/simple
If-None-Match: "v1-a1b2c3d4e5f6"
```

Se o bundle nao mudou, o backend retorna **304 Not Modified** (sem body), economizando bandwidth.

Se o bundle mudou, retorna **200** com o novo bundle e novo ETag.

### Fluxo recomendado

```
1. Frontend faz GET /bundle/simple
2. Salva meta.version localmente
3. Ao fazer novo GET, envia If-None-Match: "v1-..."
4. Se 304 -> usa bundle em cache
5. Se 200 -> atualiza bundle e version local
```

---

## 4. Resumo de impacto

| Area | Impacto | Acao necessaria |
|------|---------|-----------------|
| CRUD de Rules | Nenhum | Nenhuma |
| CRUD de Devices | Nenhum | Nenhuma |
| CRUD de Assets/Centrais/Customers | Nenhum | Nenhuma |
| Consumo do bundle | Dados mais frescos | Nenhuma (melhoria automatica) |
| Exibir versao do bundle | Opcional | Ler `meta.version` da resposta |
| Historico de versoes | Futuro | Aguardar rota REST ser exposta |
| Caching com ETag | Recomendado | Enviar `If-None-Match` header |
