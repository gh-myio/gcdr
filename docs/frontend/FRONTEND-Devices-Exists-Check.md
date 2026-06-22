# Device Name Existence Check — Frontend Integration Guide

- **Status:** Backend live (`GET /api/v1/devices/exists`).
- **Last updated:** 2026-05-05
- **Audience:** Frontend / mobile developers que precisam validar se um nome de device já está em uso **antes** de submeter um form de criação/edição.
- **Companion docs:**
  - [GCDR-USER.md](../GCDR-USER.md) — auth (JWT + API Key), tenant header.
  - [FRONTEND-Devices-Search.md](./FRONTEND-Devices-Search.md) — busca fuzzy (`?search=`), complementar a este endpoint.
  - **OpenAPI:** Swagger UI em `/docs` (local + prod).

---

## Goal

Responder em < 50ms à pergunta:

> *"O nome `Sensor-01` já existe em algum device deste tenant?"*

A unique constraint do banco é `(tenant_id, customer_id, name)` — o mesmo nome **pode** repetir em customers diferentes. Este endpoint **ignora customer** e checa o tenant inteiro, idealmente para evitar nomes ambíguos no ecossistema.

---

## Endpoint contract

### Request

```
GET /api/v1/devices/exists?name=<value>[&caseSensitive=true|false]
X-Tenant-Id: <tenant-uuid>          # optional; default tenant if omitted
```

**Auth — duas opções (escolha uma):**

| Modo | Header | Quando usar |
| --- | --- | --- |
| **JWT** (usuário logado) | `Authorization: Bearer <jwt>` | App interno autenticado (mesma sessão do user). |
| **API Key** (M2M / FE leve) | `X-API-Key: gcdr_pk_<…>` | Form público, widget embutido, ferramenta interna sem login. A key precisa de scope `devices:read`. |

> O endpoint está montado sob `hybridAuthByMethod('devices:read', ...)` — qualquer um dos dois headers funciona. Não é necessário enviar ambos.

#### Query params

| Param | Type | Required | Default | Notas |
| --- | --- | --- | --- | --- |
| `name` | string | ✅ | — | Trimmed no backend, max 255 chars. Comparação **exata** (não substring). |
| `caseSensitive` | `'true' \| 'false' \| '0'` | ❌ | `true` | `false` ou `0` desligam. Qualquer outra coisa (incluindo ausência) mantém `true`. |

### Response 200 OK

```json
{
  "data": {
    "exists": true,
    "count": 2,
    "caseSensitive": true
  },
  "meta": { "requestId": "..." }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `exists` | boolean | `true` se `count > 0`. |
| `count` | number | Quantos devices no tenant têm esse nome. Pode ser > 1 porque a unicidade é por customer. |
| `caseSensitive` | boolean | Eco do modo usado — útil pra UI mostrar qual checagem rodou. |

### Errors

| Status | Code / shape | Quando ocorre | UX recomendada |
| --- | --- | --- | --- |
| `400` | `ValidationError` (`Query param "name" is required`) | `name` ausente ou só espaços. | Não dispare a checagem se o input do form está vazio. |
| `400` | `ValidationError` (`> 255 chars`) | Nome excede 255 chars. | Bloquear no FE antes de submeter. |
| `401` | `Unauthorized` | JWT/API Key ausente ou inválida. | Redirect login (JWT) ou exibir banner "API Key inválida — fale com o suporte". |
| `403` | `Forbidden` | API Key não tem scope `devices:read`. | Mesmo banner do 401. |
| `5xx` | `InternalError` | Erro inesperado. | Não bloquear o form — só esconder o hint e logar. |

---

## Comportamento de busca

Banco com:

```
customer A → "Sensor-01"
customer B → "sensor-01"
customer C → "SENSOR-01"
```

| Request | Result |
| --- | --- |
| `?name=Sensor-01` | `{ exists: true, count: 1, caseSensitive: true }` |
| `?name=sensor-01` | `{ exists: true, count: 1, caseSensitive: true }` |
| `?name=Sensor-01&caseSensitive=false` | `{ exists: true, count: 3, caseSensitive: false }` |
| `?name=foo&caseSensitive=false` | `{ exists: false, count: 0, caseSensitive: false }` |

> **Por que dois modos?** O banco é case-sensitive (matches a unique constraint). Mas em UX você quer evitar que o user crie `Sensor-01` quando já existe `sensor-01` — disso vem o `caseSensitive=false`.

---

## Padrão de uso recomendado (FE)

### 1. Soft warning durante digitação (UX-friendly)

Use `caseSensitive=false` enquanto o user digita, com debounce. Não bloqueia, só avisa.

```ts
import { useDebounce } from 'your-debounce-hook';

function useDeviceNameAvailability(name: string) {
  const debounced = useDebounce(name, 350);
  const [hint, setHint]  = useState<string | null>(null);
  const [busy, setBusy]  = useState(false);

  useEffect(() => {
    if (!debounced || debounced.length < 2) { setHint(null); return; }

    const ctrl = new AbortController();
    setBusy(true);
    fetch(
      `${API}/devices/exists?name=${encodeURIComponent(debounced)}&caseSensitive=false`,
      {
        signal:  ctrl.signal,
        headers: {
          'X-API-Key':   API_KEY,           // ou Authorization: Bearer <jwt>
          'X-Tenant-Id': TENANT_ID,
        },
      },
    )
      .then((r) => r.json())
      .then(({ data }) => {
        if (data.exists) {
          setHint(`⚠ Já existe ${data.count} device com nome similar (case-insensitive).`);
        } else {
          setHint(null);
        }
      })
      .catch(() => { /* abort or network error → ignore */ })
      .finally(() => setBusy(false));

    return () => ctrl.abort();
  }, [debounced]);

  return { hint, busy };
}
```

### 2. Hard block antes de submeter (matches DB constraint)

Use `caseSensitive=true` (default). Se `exists`, **não submete** — a UI mostra erro inline porque o `POST /devices` ia retornar `409` mesmo.

```ts
async function onSubmit(values: FormValues) {
  const r = await fetch(
    `${API}/devices/exists?name=${encodeURIComponent(values.name)}`,
    { headers: authHeaders() },
  );
  const { data } = await r.json();
  if (data.exists) {
    setFieldError('name', 'Esse nome já está em uso. Escolha outro.');
    return;
  }
  await createDevice(values);
}
```

### 3. Fallback: optimistic + 409

Se quiser pular a pré-checagem (latência menor), mande direto e trate `409`:

```ts
const res = await fetch(`${API}/devices`, { method: 'POST', body, headers });
if (res.status === 409) {
  const { error } = await res.json();
  setFieldError('name', error?.message ?? 'Nome já existe neste customer.');
}
```

> A unique constraint real é `(tenant_id, customer_id, name)`, então o 409 do `POST` só dispara para colisões no **mesmo customer**. Se você quer hard-block global, use o `/exists` antes.

---

## Como conseguir a API Key (para o caso M2M)

A key é criada por um admin via SQL ops. Você (frontend) **não gera nem manuseia o secret** — recebe o plaintext pronto e armazena em `.env` / cofre da sua aplicação.

### Para quem está pedindo a key (operação de admin)

Rodar:

```bash
# 1) Gere o plaintext localmente (nada vai pro git)
PLAINTEXT="gcdr_pk_devices_check_$(openssl rand -hex 16)"
echo "$PLAINTEXT" > .gcdr-devices-exists-key.txt    # gitignored

# 2) Crie a key (tenant-wide, scope devices:read, 365 dias)
psql "$DATABASE_URL" \
  -v plaintext_key="'$PLAINTEXT'" \
  -v customer_id="'33333333-3333-3333-3333-333333333333'" \
  -v key_name="'Devices Exists Check Key'" \
  -f scripts/db/ops/create-api-key-devices-exists.sql

# 3) Entregue o conteúdo de .gcdr-devices-exists-key.txt para o frontend
#    (cofre / variável de ambiente — NUNCA hardcoded no repo)
```

### Para o frontend

```env
# .env.local (gitignored)
NEXT_PUBLIC_GCDR_BASE_URL=https://gcdr-api.a.myio-bas.com/api/v1
GCDR_DEVICES_API_KEY=gcdr_pk_devices_check_xxxxxxxxxxxxxxxx
GCDR_TENANT_ID=11111111-1111-1111-1111-111111111111
```

> ⚠️ **Se a key for usada em código client-side** (browser), assuma que ela é descobrível por qualquer usuário curioso com DevTools. Use só pra escopos read-only (como esse) e nunca pra escrita. Se a app for puramente client-side, considere fazer o relay via um BFF/API route que guarda a key server-side.

---

## Verificações pré-prod

- [ ] Headers corretos (`X-API-Key` **ou** `Authorization`, mais `X-Tenant-Id`).
- [ ] Debounce de 300-400ms no input — evita spam durante digitação.
- [ ] AbortController cancelando requests obsoletos quando o user continua digitando.
- [ ] Soft warning (case-insensitive) durante digitação.
- [ ] Hard block (case-sensitive) no submit, **antes** de chamar `POST /devices`.
- [ ] `400`/`401`/`403` tratados sem quebrar o form.
- [ ] Network/abort errors **não** bloqueiam submit — só removem o hint.
- [ ] Mobile: feedback visual (badge/spinner) compacto, sem toast intrusivo.
- [ ] Acessibilidade: `aria-live="polite"` na região do hint pra screen readers.

---

## Próximos passos (backend, opcional)

Não estão implementados — abrir RFC se a UI quiser:

- **Retornar amostras dos matches:** `firstMatches: [{ id, customerId, name }]` (até 5) pra o user saber em quais customers o nome aparece.
- **Sugestão de slug:** se `exists`, sugerir `name-2`, `name-3` no response.
- **Bulk check:** `POST /devices/exists/bulk { names: [...] }` para validar várias entradas (ex: import CSV).
- **Endpoint sibling para outros escopos:** `assets/exists`, `centrals/exists` seguindo o mesmo contrato.
