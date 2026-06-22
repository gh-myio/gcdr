# RFC-0032 — Fase 5: Script de Migração de Dados (SQLite → GCDR/Postgres)

- **Status:** Pendente (Fases 1–4 ✅ concluídas)
- **Documento pai:** [RFC-0032 — QR Checker Migration to GCDR](./RFC-0032-QR-Checker-Migration-to-GCDR.md)
- **Idioma:** PT-BR (foco operacional para quem vai executar a migração)
- **Estimativa:** 2 dias de trabalho de backend
- **Entregável principal:** `scripts/migrate-qrchecker.ts` + comando `npm run migrate:qrchecker`

---

## 1. O que é a Fase 5

A Fase 5 transporta **todo o estado persistido do app standalone QR Checker** (SQLite + diretório local de imagens) para dentro do GCDR (Postgres + S3 via FileAssets), reusando os repositórios e serviços já entregues nas Fases 1–4.

Não é só um `INSERT INTO ... SELECT`: o script:

- Faz **UPSERT por chave natural** (idempotente — pode rodar quantas vezes precisar).
- Reescreve **FKs legadas (int) → UUIDs do GCDR** via mapas em memória.
- **Re-hashea credenciais inseguras** do legado: PINs em texto puro viram bcrypt; senhas Base64 ("hashed") viram bcrypt real.
- **Sobe imagens para o S3** via `FileAssetService.upload()` (em vez de copiar arquivo bruto), gravando a join row `qrc_installation_images`.
- Emite **audit logs** automaticamente (porque escreve via service layer, não SQL cru).

Tudo o que esta fase faz é mecânico — a modelagem de dados já foi resolvida nas Fases 1 (schema) e 3 (services).

---

## 2. Pré-requisitos

Antes de rodar a Fase 5, garantir:

| Item | Comando de verificação |
|------|------------------------|
| Migrations 0024 + 0025 aplicadas | `psql $DATABASE_URL -c "\dt qrc_*"` lista 12 tabelas |
| Service layer QRC funcional | `GET /api/v1/qrc/customers` responde 200 |
| FileAssetService configurado com S3 | `POST /api/v1/file-assets` aceita upload de teste |
| `QRC_PIN_PEPPER` definido | `printenv QRC_PIN_PEPPER` retorna valor |
| Backup do `qr-checker.db` feito | cópia datada em local seguro |
| Tarball do diretório de imagens | `tar czf installation-images-YYYYMMDD.tgz ./installation-images` |

Sem o backup **não execute** — o script é idempotente, mas o legado pode ter inconsistências que só aparecem em produção.

---

## 3. Interface do comando

```bash
npm run migrate:qrchecker -- \
  --source ./qr-checker.db \
  --tenant 11111111-1111-1111-1111-111111111111 \
  --images-dir ./installation-images \
  [--dry-run]   # padrão: só projeta contagens, não escreve
  [--commit]    # explicitamente persiste (par com ausência de --dry-run)
```

**Flags importantes:**

- `--dry-run` → abre SQLite em readonly, calcula tudo, **não chama** repos com `commit=true`. Saída esperada: tabela de "PROJECTED" (ver §7).
- `--commit` → habilita escrita em todos os branches `if (opts.commit)`. **Sem essa flag, nada é persistido**, mesmo sem `--dry-run` (failsafe).
- `--source` → caminho do arquivo SQLite legado (cópia, não o arquivo vivo).
- `--tenant` → UUID do tenant alvo no GCDR. Em prod hoje é `11111111-1111-1111-1111-111111111111`.
- `--images-dir` → diretório local com `installation-images/*.jpg` do legado.

---

## 4. Algoritmo — sub-fases dentro do script

O script é dividido em **7 passos sequenciais** (não confundir com as 8 fases macro do RFC). Cada passo lê do SQLite, mapeia FKs, escreve no Postgres.

### 4.1 Mapas de ID — para que servem

O SQLite legado usa **PKs `INTEGER AUTOINCREMENT`**; o GCDR usa **UUIDs**. As FKs entre tabelas no SQLite (`installations.device_id`, `installation_images.installation_id`, `visita_ambientes.visita_id`, etc.) são inteiros que **não existem no Postgres alvo**.

Cada mapa guarda, em memória durante a execução do script, a tradução `legacyIntegerId → newUuid` para uma entidade. Quando o passo seguinte precisa escrever uma FK, ele consulta o mapa do parent.

Exemplo concreto: ao migrar `installations`, lemos `i.device_id = 42` (int legado). Olhamos `idMap.devices.get(42)` → `"a3f1...uuid"` → escrevemos esse UUID em `qrc_installations.device_id`.

Sem os mapas, FKs ficariam órfãs ou apontariam para o ID errado.

Nomenclatura **em inglês** (alinhada ao GCDR e ao schema Postgres alvo) — apesar de algumas tabelas SQLite estarem em PT (`visitas_tecnicas`, `visita_ambientes`):

```typescript
const idMap = {
  customers:     new Map<number, string>(),  // SQLite malls.id                      → customers.id
  devices:       new Map<number, string>(),  // SQLite devices.id                    → devices.id
  installations: new Map<number, string>(),  // SQLite installations.id              → qrc_installations.id
  users:         new Map<number, string>(),  // SQLite users.id                      → users.id
  visits:        new Map<number, string>(),  // SQLite visitas_tecnicas.id           → qrc_visitas.id
  environments:  new Map<number, string>(),  // SQLite visita_ambientes.id           → qrc_visita_ambientes.id
  products:      new Map<number, string>(),  // SQLite visita_ambiente_products.id   → qrc_visita_products.id
};
```

> **Por que os nomes das tabelas Postgres mantêm `qrc_visitas` / `qrc_visita_ambientes`** — a Fase 1 (migration 0024) já criou as tabelas com esses nomes para preservar o vocabulário do domínio. O idMap em inglês é apenas convenção interna do script; não muda nada do schema.

### 4.2 Passo 1 — `malls` → `customers` + `qrc_customer_settings`

- Lê `SELECT * FROM malls`.
- Tenta `customerRepo.getByCode(tenant, mall.slug)`. Se já existir, **reusa** (caso de cliente que já está no GCDR via cadastro manual).
- Se não existir, cria um `Customer` com `type='COMPANY'`, `code=mall.slug`, `metadata.cnpj=mall.cnpj`, `metadata.qrcLegacyMallId=mall.id`.
- **Sempre** faz upsert em `qrc_customer_settings` para preservar `viewer_password_hash` e `default_central_id`.

**Idempotência:** chave natural = `(tenant_id, code)`. Re-run não duplica.

### 4.3 Passo 2 — `users`

- Para cada user legado:
  - Email: `u.email` se existir; senão `pin-${u.pin}@qrchecker.myio-bas.com` (sintético, único por PIN).
  - PIN: `bcrypt.hash(u.pin, 10)` (legado guardava em texto puro).
  - Senha: faz `Buffer.from(u.password_hash, 'base64').toString()` para destrincar o "hash" Base64 e re-hashea com bcrypt.
  - `type`: `'INTERNAL'` se admin, `'CUSTOMER'` se field operator.
- **Atenção:** o lookup HMAC `qrc_field_pin_lookup` precisa ser computado também (peppered HMAC do PIN), senão login operator-pin quebra.

**Idempotência:** chave natural = `(tenant_id, email)`. PINs duplicados levantam violação do unique index parcial — esperado, indica dado sujo no legado que precisa ser resolvido manualmente.

### 4.4 Passo 3 — `user_malls` → `role_assignments`

- O legado tinha tabela junction `user_malls(user_id, mall_id)`.
- No GCDR, isso vira **role assignment escopado por customer**:
  ```typescript
  roleAssignmentRepo.create({
    tenantId,
    userId: idMap.users.get(um.user_id),
    roleKey: 'role:field-operator',
    scope: `customer:${idMap.customers.get(um.mall_id)}`,
    grantedBy: opts.systemUserId,
  });
  ```
- **Por que isso importa:** a Fase 4 já assume que field operators têm acesso via RBAC. Se este passo falhar, eles logam mas não veem nenhum customer.

### 4.5 Passo 4 — `devices` (UPSERT, não criação cega)

- Devices podem **já existir no GCDR** via sync com ThingsBoard (campo `external_id` casa com `device_id` legado).
- Lógica:
  1. `deviceRepo.getByExternalId(tenant, d.device_id)`.
  2. Se existir → **UPDATE** apenas dos campos QRC (`qrc_addr_low`, `qrc_addr_high`, `qrc_identifier`).
  3. Se não existir → cria device novo com todos os campos.
- Migration 0025 adicionou as colunas `qrc_addr_*` em `devices`.

### 4.6 Passo 5 — `installations`

- Cria UUID novo para cada installation legada.
- Mapeia `device_id` legado → `deviceId` GCDR via `idMap.devices`.
- Resolve `customerId` indiretamente: `device.customerId` (já populado no passo 4).
- Mapeia `installed_by` (string legacy) → UUID via `idMap.users`.
- Status: `i.impedimento_text || mapLegacyImpedimento(i.impedimento)` — converte enum legado.

### 4.7 Passo 6 — `installation_images` (S3 upload)

Este é o passo **mais lento e mais arriscado**. Para cada imagem:

1. Resolve path local: `path.join(opts.imagesDir, img.image_path)`.
2. Se arquivo **não existir** em disco → loga warning e continua (não falha).
3. `fs.readFileSync` → buffer.
4. `fileAssetService.upload({ ownerType: 'qrc_installation', ownerId, ... })`:
   - Calcula sha256, deduplica no S3 (idempotente por content hash).
   - Sobe via signed PUT.
   - Retorna `asset.id`.
5. Cria join row em `qrc_installation_images` com `file_asset_id`, `image_order`, `caption`.

**Volume típico esperado** (extrapolado de stats QR Checker prod): ~4.000 imagens, ~2 GB total. Tempo estimado: 30–60 min em conexão decente. Considere rodar com `--commit` em horário de baixo tráfego.

### 4.8 Passo 7-N — sobras

- `mall_observations` → `qrc_customer_observations`
- `installation_audit` → `qrc_installation_audit`
- `tasks` → `qrc_maintenance_tasks`
- `visitas`, `visita_ambientes`, `visita_products` → tabelas QRC homônimas

Mesmo padrão: ler SQLite, mapear FKs via `idMap`, gravar via repo.

---

## 5. Idempotência — detalhamento

| Tabela alvo | Chave natural usada |
|-------------|---------------------|
| `customers` | `(tenant_id, code)` |
| `qrc_customer_settings` | `customer_id` (1:1) |
| `users` | `(tenant_id, email)` |
| `role_assignments` | `(user_id, role_key, scope)` |
| `devices` | `(tenant_id, external_id)` |
| `qrc_installations` | gera UUID novo, **mas** valida via `(tenant_id, device_id, position)` antes de inserir |
| `file_assets` | sha256 + tenant (FileAssetService já dedup) |
| `qrc_installation_images` | `(installation_id, file_asset_id)` |

**Teste de idempotência (obrigatório antes do cutover):**

```bash
# Run 1
npm run migrate:qrchecker -- --source ./qr-checker.db --tenant <T> --images-dir ./img --commit
# anota contagens

# Run 2 (sem mudar nada no SQLite)
npm run migrate:qrchecker -- --source ./qr-checker.db --tenant <T> --images-dir ./img --commit
# contagens devem ser idênticas; logs devem ter SKIP em todas as linhas
```

---

## 6. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| PIN duplicado entre tenants no legado | Validar `qrc_field_pin_lookup` antes do hash; abortar com lista de conflitos |
| Imagem fisicamente ausente do disco | Warning (não fail) + log estruturado para revisão pós-migração |
| `mall.slug` colide com `customer.code` já existente que **não é** o mesmo cliente | Pré-flight: query `SELECT slug FROM malls` cruzada com `SELECT code FROM customers WHERE tenant_id=...`; resolver manualmente antes |
| `device_id` legado não bate com `external_id` no GCDR (sync TB defasado) | Permitir flag `--allow-orphan-devices` que cria devices novos; default é falhar |
| Senha Base64 não decodifica (caractere inválido) | Try/catch, gera senha aleatória, força reset no próximo login, loga lista para o admin |
| Migração interrompida no meio | Idempotência cobre — basta rerun com `--commit` |
| Auditoria do legado (`installation_audit`) tem timestamps fora de ordem | Preservar `created_at` original; não usar `now()` |

---

## 7. Verificação

### 7.1 Dry-run

```bash
npm run migrate:qrchecker -- \
  --source ./qr-checker.db \
  --tenant 11111111-1111-1111-1111-111111111111 \
  --images-dir ./installation-images \
  --dry-run
```

Saída esperada (exemplo):

```
PROJECTED:
  5 malls → upsert into customers (3 new, 2 already-existing matched by code)
  47 users (45 new, 2 already-existing matched by email)
  1023 devices → upsert into devices (write qrc_addr_*)
  814 installations
  4070 images (~2.1 GB upload to S3)
  219 audit rows
  56 visitas
  ...

WARNINGS:
  - 12 imagens ausentes em disco (lista em /tmp/missing-images-YYYYMMDD.txt)
  - 2 users com PIN duplicado: [...]
```

### 7.2 Full run

```bash
npm run migrate:qrchecker -- \
  --source ./qr-checker.db \
  --tenant 11111111-1111-1111-1111-111111111111 \
  --images-dir ./installation-images \
  --commit
```

### 7.3 Diff de contagens (Postgres vs. SQLite)

```sql
SELECT
  (SELECT count(*) FROM qrc_customer_settings)            AS qrc_customers,
  (SELECT count(*) FROM qrc_installations)                AS installations,
  (SELECT count(*) FROM file_assets
     WHERE owner_type='qrc_installation')                 AS images,
  (SELECT count(*) FROM role_assignments
     WHERE scope LIKE 'customer:%'
       AND role_key='role:field-operator')                AS field_op_grants;
```

Comparar com:

```bash
sqlite3 qr-checker.db "
  SELECT
    (SELECT count(*) FROM malls),
    (SELECT count(*) FROM installations),
    (SELECT count(*) FROM installation_images),
    (SELECT count(*) FROM user_malls);
"
```

**Critério de aceite:** contagens batem (admite imagens ausentes documentadas no warning).

### 7.4 Spot-check end-to-end

```bash
curl http://localhost:3015/api/v1/qrc/installations/<id_qualquer> \
  -H "Authorization: Bearer <admin_jwt>" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" | jq
```

Deve retornar: installation completa + audit history + N image references com URLs assinadas válidas.

---

## 8. Done when (critério de fechamento da fase)

- [ ] `scripts/migrate-qrchecker.ts` commitado.
- [ ] `npm run migrate:qrchecker` adicionado ao `package.json`.
- [ ] Dry-run em SQLite de homolog produz contagens projetadas corretas.
- [ ] Full run em homolog persiste todas as linhas; queries de §7.3 batem.
- [ ] Re-run em homolog é no-op (todas as linhas em SKIP).
- [ ] Spot-check curl retorna installation completa com imagens visualizáveis.
- [ ] Lista de "WARNINGS" gerada está revisada e documentada.
- [ ] Documentação interna atualizada (este doc + nota no `BACKLOG-RFCS.md`).

---

## 9. O que **não** é Fase 5

Para evitar escopo inflado:

- ❌ **Cutover de produção** — isso é Fase 8 (freeze, run, switchover, soak).
- ❌ **Rewriting do MCP server** — Fases 6 + 7.
- ❌ **Frontend re-pointing** — já desbloqueado pela Fase 4.
- ❌ **Decomissionar `qrcode-check.git`** — só após Fase 8 concluir + 1 semana de soak.

A Fase 5 entrega **a ferramenta**. Quem aperta o gatilho em prod é a Fase 8.

---

## 10. Próximos passos imediatos

1. Confirmar disponibilidade de uma cópia recente do `qr-checker.db` de produção.
2. Provisionar bucket S3 de homolog se ainda não existir (FileAssets já configurado no GCDR de homolog).
3. Esboçar `scripts/migrate-qrchecker.ts` na ordem dos passos §4.1 → §4.8.
4. Adicionar testes de unidade para `mapLegacyImpedimento()` e a função de re-hash de senha Base64.
5. Pedir OK explícito antes de commit (regra do projeto).
