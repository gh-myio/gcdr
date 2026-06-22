# RFC-0032 — Estrutura do Banco de Dados de Origem (QR Checker / SQLite)

- **Documento pai:** [RFC-0032 — QR Checker Migration to GCDR](./RFC-0032-QR-Checker-Migration-to-GCDR.md)
- **Companion:** [Phase 5 — Data Migration Script](./RFC-0032-QR-Checker-Migration-to-GCDR-Phase-5.md)
- **Origem do schema:** `C:\Projetos\GitHub\myio\qrcode-check.git\src\lib\db.ts`
- **Engine:** SQLite (better-sqlite3, WAL mode)
- **Idioma:** PT-BR (descrições e notas)

> Este documento é o **mapa do território legado**. A Fase 5 do RFC-0032 lê
> exatamente essas tabelas e as traduz para o schema GCDR. Mantenha-o
> sincronizado caso o `qrcode-check.git` evolua antes do cutover.

---

## Visão geral

O QR Checker usa **um único arquivo SQLite** (`{DATA_DIR}/qr-checker.db`) com **19 tabelas** organizadas em 4 domínios:

| Domínio | Tabelas |
|---------|---------|
| **Tenants & Auth** | `malls`, `users`, `user_malls`, `sessions` |
| **Workflow de Instalação** | `devices`, `installations`, `installation_images`, `installation_audit`, `maintenance_tasks` |
| **Observações de Site** | `mall_observations` |
| **Visitas Técnicas (módulo separado)** | `visitas_tecnicas`, `visita_ambientes`, `visita_ambiente_entries`, `visita_ambiente_images`, `user_visitas`, `visita_audit`, `visita_ambiente_products`, `visita_product_images`, `visita_observations` |

Características:

- **Sem multi-tenancy real**: o conceito de "mall" funciona como um pseudo-tenant; queries não usam `tenant_id`.
- **Sem soft-delete**: `ON DELETE CASCADE` em quase tudo.
- **PKs `INTEGER AUTOINCREMENT`** em toda parte (exceto `sessions.id` que é `TEXT`/UUID).
- **Timestamps** em `TEXT` (ISO-8601 via `datetime('now')`).
- **Imagens** ficam no **filesystem local** (`{DATA_DIR}/installation-images/<filename>`); o banco guarda apenas o `image_path` (string).
- **Migrações ad-hoc**: novas colunas adicionadas via `try { ALTER TABLE ... } catch {}` no `runMigrations()` — não há tabela de versionamento de schema.

---

## Diagrama de relacionamentos (alto nível)

```
                     ┌──────────────┐
                     │    malls     │ (pseudo-tenant)
                     └──────┬───────┘
                  ┌─────────┼──────────────┐
                  │         │              │
                  ▼         ▼              ▼
          ┌────────────┐ ┌──────────────┐ ┌────────────────────┐
          │  devices   │ │ user_malls   │ │ mall_observations  │
          └─────┬──────┘ └──────┬───────┘ └────────────────────┘
                │               │
                ▼               ▼
        ┌──────────────┐   ┌─────────┐
        │installations │   │  users  │──┐
        └─────┬────────┘   └────┬────┘  │
   ┌──────────┼──────────┐       │       │
   ▼          ▼          ▼       ▼       │
┌──────┐ ┌────────┐ ┌──────────┐ ┌─────────┐
│images│ │ audit  │ │ tasks    │ │sessions │
└──────┘ └────────┘ └──────────┘ └─────────┘

────── domínio Visitas Técnicas (independente) ──────

   ┌────────────────┐
   │visitas_tecnicas│──────┐
   └────────┬───────┘      │
            │              ▼
            │       ┌───────────────┐
            │       │ user_visitas  │
            │       └───────────────┘
            ▼
    ┌─────────────────┐
    │visita_ambientes │
    └────────┬────────┘
   ┌─────────┼──────────────────┬──────────────────┐
   ▼         ▼                  ▼                  ▼
┌────────┐ ┌────────┐ ┌──────────────────┐ ┌──────────┐
│entries │ │ images │ │      products    │ │   audit  │
└────────┘ └────────┘ └────────┬─────────┘ └──────────┘
                                ▼
                       ┌──────────────────┐
                       │ product_images   │
                       └──────────────────┘
```

---

## 1. Domínio: Tenants & Auth

### 1.1 `malls` — pseudo-tenant (cliente)

Cada "mall" representa um shopping (ou qualquer site MYIO). É a entidade-raiz a que tudo se liga.

| Coluna                  | Tipo                            | Notas |
|-------------------------|---------------------------------|-------|
| `id`                    | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `name`                  | `TEXT NOT NULL`                  | nome de exibição |
| `slug`                  | `TEXT UNIQUE NOT NULL`           | usado em URLs `/malls/[slug]/*` |
| `cnpj`                  | `TEXT`                           | nullable |
| `central_id`            | `TEXT`                           | id da central de hardware no ecossistema MYIO |
| `viewer_password_hash`  | `TEXT`                           | senha bcrypt para login viewer (read-only) |
| `created_at`            | `TEXT NOT NULL DEFAULT (datetime('now'))` | |

**Mapeia no GCDR para:** `customers` (UPSERT por `code = slug`).
- `cnpj` → `customers.metadata.cnpj` (jsonb existente do core)
- `central_id` → **descontinuado** (sem consumidor real; se voltar a fazer sentido, vira flag em `devices`)
- `viewer_password_hash` → **descontinuado** (shared secret substituído por user real com `role:wo-viewer` escopado)
- WO-enabled flag → `customers.config.wo.enabled = true` (jsonb da migration 0012)

> Decisão pós-0024: `wo_customer_settings` (1:1 que envolveria essas 3 colunas) **foi removida** do design — ver §6 e migration 0027.

---

### 1.2 `users`

Conta unificada para admin (email+senha) e técnico de campo (PIN de 4 dígitos).

| Coluna          | Tipo                            | Notas |
|-----------------|---------------------------------|-------|
| `id`            | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `email`         | `TEXT UNIQUE NOT NULL`           | |
| `password_hash` | `TEXT NOT NULL`                  | **Base64 (NÃO bcrypt)** — vulnerabilidade conhecida |
| `pin`           | `TEXT`                           | 4 dígitos, **plaintext**, único entre users não-null |
| `is_admin`      | `INTEGER NOT NULL DEFAULT 0`     | bool: 0=field operator, 1=admin |
| `name`          | `TEXT NOT NULL`                  | |
| `created_at`    | `TEXT NOT NULL DEFAULT (...)`    | |
| `updated_at`    | `TEXT NOT NULL DEFAULT (...)`    | |

**Índice único parcial:** `idx_users_pin_unique ON users(pin) WHERE pin IS NOT NULL`.

**Riscos para a migração:**
- Senhas em Base64 — não são hash. Fase 5 precisa decodificar e re-hashar com bcrypt.
- PINs em plaintext — Fase 5 precisa hashar (bcrypt) + computar `qrc_field_pin_lookup` (HMAC peppered).
- PINs duplicados nem sempre são bloqueados (índice parcial; existe lógica de "nullify duplicates" no init).

**Mapeia no GCDR para:** `users` (com `qrc_field_pin_hash` + `qrc_field_pin_lookup` adicionais).

---

### 1.3 `user_malls` — junction (operador ↔ shopping)

| Coluna       | Tipo                                  |
|--------------|---------------------------------------|
| `id`         | `INTEGER PRIMARY KEY AUTOINCREMENT`   |
| `user_id`    | `INTEGER NOT NULL` → `users(id)` ON DELETE CASCADE |
| `mall_id`    | `INTEGER NOT NULL` → `malls(id)` ON DELETE CASCADE |
| `created_at` | `TEXT NOT NULL DEFAULT (...)`         |
| `UNIQUE(user_id, mall_id)`                            |

**Mapeia no GCDR para:** `role_assignments` com `role_key='role:field-operator'` e `scope='customer:<uuid>'`.

---

### 1.4 `sessions`

Sessões cookie-based stateful.

| Coluna       | Tipo                          | Notas |
|--------------|-------------------------------|-------|
| `id`         | `TEXT PRIMARY KEY`            | UUID, vai no cookie HTTP-only |
| `user_id`    | `INTEGER NOT NULL` → `users(id)` ON DELETE CASCADE | |
| `expires_at` | `TEXT NOT NULL`               | admin: 7d / técnico: 1d |
| `created_at` | `TEXT NOT NULL DEFAULT (...)` | |

**Mapeia no GCDR para:** **descartar** — GCDR usa JWT stateless, não tabela de sessões. Sessões ativas serão invalidadas no cutover (usuários relogam).

---

## 2. Domínio: Workflow de Instalação

### 2.1 `devices`

Dispositivos físicos (medidores) que recebem QR codes.

| Coluna        | Tipo                            | Notas |
|---------------|---------------------------------|-------|
| `id`          | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `mall_id`     | `INTEGER NOT NULL` → `malls(id)` ON DELETE CASCADE | |
| `device_id`   | `TEXT NOT NULL`                  | id externo (vindo do ThingsBoard / sistema MYIO) |
| `name`        | `TEXT NOT NULL`                  | |
| `type`        | `TEXT NOT NULL`                  | tipo do medidor |
| `identifier`  | `TEXT`                           | identificador opcional do QR |
| `path`        | `TEXT`                           | hierarquia legível: `"Bloco A > Piso 2 > Sala 201"` |
| `addr_low`    | `INTEGER`                        | endereço Modbus (low byte) |
| `addr_high`   | `INTEGER`                        | endereço Modbus (high byte) |
| `created_at`  | `TEXT NOT NULL DEFAULT (...)`    | |
| `UNIQUE(mall_id, device_id)`                     | |

**Mapeia no GCDR para:** `devices` (UPSERT por `external_id = device_id`) + colunas QRC adicionais (`qrc_addr_low`, `qrc_addr_high`, `qrc_identifier`) via migration 0025.

---

### 2.2 `installations`

A entidade central — uma instalação física registrada por um técnico.

| Coluna                | Tipo                                | Notas |
|-----------------------|-------------------------------------|-------|
| `id`                  | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `device_id`           | `INTEGER NOT NULL` → `devices(id)` ON DELETE CASCADE | |
| `position`            | `TEXT NOT NULL`                     | localização confirmada (texto livre) |
| `tc_type`             | `TEXT`                              | `'50A' / '100A' / '400A' / '1000A' / '2000A'` |
| `installed_at`        | `TEXT NOT NULL DEFAULT (...)`       | |
| `installed_by`        | `TEXT`                              | nome ou email do técnico (string, não FK) |
| `updated_at`          | `TEXT NOT NULL DEFAULT (...)`       | |
| `impedimento`         | `INTEGER DEFAULT 0`                 | **legado:** 0=instalado, 1=impedimento, 2=removido |
| `impedimento_text`    | `TEXT`                              | **novo:** `'instalado' / 'impedimento' / 'removido' / 'defeito'` |
| `obs`                 | `TEXT`                              | observação livre |
| `current_multiplier`  | `REAL`                              | multiplicador de corrente |
| `voltage_multiplier`  | `REAL`                              | multiplicador de tensão |

**⚠️ Notas críticas para Fase 5:**
- `installed_by` é **string solta** (não FK para `users`) — Fase 5 precisa fazer match por nome/email para resolver UUID do user (ou aceitar como audit string e gravar como `installed_by_label`).
- Coexistência `impedimento` (int) vs `impedimento_text` (string) — Fase 5 prefere `impedimento_text` quando disponível, senão converte do int via `mapLegacyImpedimento()`.

**Mapeia no GCDR para:** `qrc_installations`.

---

### 2.3 `installation_images`

Fotos da instalação (filesystem local, banco só guarda o path).

| Coluna             | Tipo                                | Notas |
|--------------------|-------------------------------------|-------|
| `id`               | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `installation_id`  | `INTEGER NOT NULL` → `installations(id)` ON DELETE CASCADE | |
| `image_path`       | `TEXT NOT NULL`                     | nome do arquivo em `{DATA_DIR}/installation-images/` |
| `image_order`      | `INTEGER NOT NULL DEFAULT 0`        | ordem de exibição |
| `caption`          | `TEXT`                              | legenda opcional |
| `created_at`       | `TEXT NOT NULL DEFAULT (...)`       | |

**Limite no app:** 20 imagens por installation.

**Mapeia no GCDR para:** `file_assets` (S3, owner_type=`qrc_installation`) + join row em `qrc_installation_images`.

---

### 2.4 `installation_audit`

Histórico de mudanças por installation (revision-based).

| Coluna                | Tipo                                | Notas |
|-----------------------|-------------------------------------|-------|
| `id`                  | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `installation_id`     | `INTEGER NOT NULL` → `installations(id)` ON DELETE CASCADE | |
| `revision`            | `INTEGER NOT NULL`                  | seq incremental por installation |
| `position`            | `TEXT NOT NULL`                     | snapshot |
| `tc_type`             | `TEXT`                              | snapshot |
| `installed_by`        | `TEXT`                              | snapshot |
| `changed_by`          | `TEXT NOT NULL`                     | quem mudou |
| `changed_at`          | `TEXT NOT NULL DEFAULT (...)`       | |
| `change_type`         | `TEXT NOT NULL`                     | `'created' / 'updated' / 'deleted' / 'image_added'` |
| `change_description`  | `TEXT`                              | descrição humana |
| `old_value`           | `TEXT`                              | JSON serializado |
| `new_value`           | `TEXT`                              | JSON serializado |
| `images_added`        | `INTEGER DEFAULT 0`                 | |

**Mapeia no GCDR para:** `qrc_installation_audit` (preservando `changed_at` original — não usar `now()`).

---

### 2.5 `maintenance_tasks`

Tarefas de manutenção criadas por admin, executadas por técnico.

| Coluna             | Tipo                                | Notas |
|--------------------|-------------------------------------|-------|
| `id`               | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `installation_id`  | `INTEGER NOT NULL` → `installations(id)` ON DELETE CASCADE | |
| `description`      | `TEXT NOT NULL`                     | |
| `status`           | `TEXT NOT NULL DEFAULT 'pending'`   | `'pending' / 'completed' / 'reviewed'` |
| `created_by`       | `TEXT NOT NULL`                     | string, não FK |
| `created_at`       | `TEXT NOT NULL DEFAULT (...)`       | |
| `completed_by`     | `TEXT`                              | |
| `completed_at`     | `TEXT`                              | |
| `completed_notes`  | `TEXT`                              | |
| `reviewed_by`      | `TEXT`                              | |
| `reviewed_at`      | `TEXT`                              | |

**Mapeia no GCDR para:** `qrc_maintenance_tasks`.

---

## 3. Domínio: Observações de Site

### 3.1 `mall_observations`

Notas avulsas anexadas a um shopping (não a um device específico).

| Coluna       | Tipo                                | Notas |
|--------------|-------------------------------------|-------|
| `id`         | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `mall_id`    | `INTEGER NOT NULL` → `malls(id)` ON DELETE CASCADE | |
| `created_by` | `TEXT NOT NULL`                     | string, não FK |
| `observation`| `TEXT NOT NULL`                     | |
| `image_path` | `TEXT`                              | foto opcional (mesmo padrão filesystem) |
| `created_at` | `TEXT NOT NULL DEFAULT (...)`       | |

**Mapeia no GCDR para:** `qrc_customer_observations` (+ upload do `image_path` para FileAssets se existir).

---

## 4. Domínio: Visitas Técnicas (módulo separado)

Módulo independente do workflow de instalação. Modela uma "visita técnica" com múltiplos ambientes, cada um podendo ter entradas, fotos e produtos.

### 4.1 `visitas_tecnicas`

| Coluna       | Tipo                                | Notas |
|--------------|-------------------------------------|-------|
| `id`         | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `name`       | `TEXT NOT NULL`                     | |
| `observation`| `TEXT`                              | |
| `status`     | `TEXT NOT NULL DEFAULT 'pending'`   | `'pending' / 'in_progress' / 'done'` |
| `created_by` | `INTEGER NOT NULL` → `users(id)`    | **FK real** (diferente do resto) |
| `created_at` | `TEXT NOT NULL DEFAULT (...)`       | |
| `updated_at` | `TEXT NOT NULL DEFAULT (...)`       | |

**⚠️ Não tem `mall_id`** — visita técnica não está atrelada a um shopping no schema atual.

**Mapeia no GCDR para:** `qrc_visitas` (precisará decidir se associa a um customer; provável: FK opcional).

---

### 4.2 `visita_ambientes`

Salas/áreas dentro de uma visita.

| Coluna       | Tipo                                | Notas |
|--------------|-------------------------------------|-------|
| `id`         | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `visita_id`  | `INTEGER NOT NULL` → `visitas_tecnicas(id)` ON DELETE CASCADE | |
| `name`       | `TEXT NOT NULL`                     | |
| `created_by` | `INTEGER NOT NULL` → `users(id)`    | |
| `created_at` | `TEXT NOT NULL DEFAULT (...)`       | |

**Mapeia no GCDR para:** `qrc_visita_ambientes`.

---

### 4.3 `visita_ambiente_entries`

Entradas/registros dentro de um ambiente (medições, ar-condicionado, contagens).

| Coluna             | Tipo                                | Notas |
|--------------------|-------------------------------------|-------|
| `id`               | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `ambiente_id`      | `INTEGER NOT NULL` → `visita_ambientes(id)` ON DELETE CASCADE | |
| `observation`      | `TEXT`                              | |
| `ac_quantity`      | `INTEGER`                           | qtd ar-condicionado |
| `product_quantity` | `INTEGER`                           | qtd produto genérico |
| `product_type`     | `TEXT`                              | |
| `created_by`       | `INTEGER NOT NULL` → `users(id)`    | |
| `created_at`       | `TEXT NOT NULL DEFAULT (...)`       | |
| `updated_at`       | `TEXT NOT NULL DEFAULT (...)`       | |

**Mapeia no GCDR para:** `qrc_visita_ambiente_entries`.

---

### 4.4 `visita_ambiente_images`

Fotos de um ambiente (limite no app: 50 por ambiente).

| Coluna        | Tipo                                | Notas |
|---------------|-------------------------------------|-------|
| `id`          | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `ambiente_id` | `INTEGER NOT NULL` → `visita_ambientes(id)` ON DELETE CASCADE | |
| `image_path`  | `TEXT NOT NULL`                     | filesystem local |
| `caption`     | `TEXT`                              | |
| `image_order` | `INTEGER NOT NULL DEFAULT 0`        | |
| `created_by`  | `INTEGER NOT NULL` → `users(id)`    | |
| `created_at`  | `TEXT NOT NULL DEFAULT (...)`       | |

**Mapeia no GCDR para:** `file_assets` (owner_type=`qrc_visita_ambiente`) + join.

---

### 4.5 `visita_ambiente_products`

Produtos catalogados em um ambiente.

| Coluna         | Tipo                                | Notas |
|----------------|-------------------------------------|-------|
| `id`           | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `ambiente_id`  | `INTEGER NOT NULL` → `visita_ambientes(id)` ON DELETE CASCADE | |
| `product_type` | `TEXT NOT NULL`                     | |
| `description`  | `TEXT`                              | |
| `quantity`     | `INTEGER NOT NULL DEFAULT 1`        | |
| `image_path`   | `TEXT`                              | **legado** — uma foto inline |
| `created_by`   | `INTEGER NOT NULL` → `users(id)`    | |
| `created_at`   | `TEXT NOT NULL DEFAULT (...)`       | |

**Nota de evolução:** `image_path` foi mantido por compatibilidade, mas existe migração in-line (`db.ts:1928–1937`) que copia esse path para `visita_product_images`. Fase 5 deve preferir `visita_product_images` (1:N).

**Mapeia no GCDR para:** `qrc_visita_products`.

---

### 4.6 `visita_product_images`

Fotos de produtos (limite no app: 5 por produto).

| Coluna        | Tipo                                | Notas |
|---------------|-------------------------------------|-------|
| `id`          | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `product_id`  | `INTEGER NOT NULL` → `visita_ambiente_products(id)` ON DELETE CASCADE | |
| `image_path`  | `TEXT NOT NULL`                     | |
| `image_order` | `INTEGER NOT NULL DEFAULT 0`        | |
| `created_at`  | `TEXT NOT NULL DEFAULT (...)`       | |

**Mapeia no GCDR para:** `file_assets` (owner_type=`qrc_visita_product`) + join.

---

### 4.7 `user_visitas`

Junction técnico ↔ visita.

| Coluna       | Tipo                                |
|--------------|-------------------------------------|
| `id`         | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `user_id`    | `INTEGER NOT NULL` → `users(id)` ON DELETE CASCADE |
| `visita_id`  | `INTEGER NOT NULL` → `visitas_tecnicas(id)` ON DELETE CASCADE |
| `created_at` | `TEXT NOT NULL DEFAULT (...)`       |
| `UNIQUE(user_id, visita_id)`                       |

**Mapeia no GCDR para:** `role_assignments` com `scope='visita:<uuid>'` (ou similar — decisão da Fase 1 do RFC).

---

### 4.8 `visita_audit`

| Coluna                | Tipo                                | Notas |
|-----------------------|-------------------------------------|-------|
| `id`                  | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `visita_id`           | `INTEGER NOT NULL` → `visitas_tecnicas(id)` ON DELETE CASCADE | |
| `ambiente_id`         | `INTEGER`                           | nullable: pode ser audit de ambiente específico |
| `revision`            | `INTEGER NOT NULL`                  | |
| `changed_by`          | `TEXT NOT NULL`                     | string, não FK |
| `changed_at`          | `TEXT NOT NULL DEFAULT (...)`       | |
| `change_type`         | `TEXT NOT NULL`                     | |
| `change_description`  | `TEXT`                              | |
| `old_value`           | `TEXT`                              | JSON |
| `new_value`           | `TEXT`                              | JSON |

**Mapeia no GCDR para:** `qrc_visita_audit`.

---

### 4.9 `visita_observations`

Notas avulsas anexadas a uma visita.

| Coluna       | Tipo                                | Notas |
|--------------|-------------------------------------|-------|
| `id`         | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `visita_id`  | `INTEGER NOT NULL` → `visitas_tecnicas(id)` ON DELETE CASCADE | |
| `created_by` | `TEXT NOT NULL`                     | string, não FK |
| `observation`| `TEXT NOT NULL`                     | |
| `image_path` | `TEXT`                              | foto opcional |
| `created_at` | `TEXT NOT NULL DEFAULT (...)`       | |

**Mapeia no GCDR para:** `qrc_visita_observations` + FileAssets se imagem existir.

---

## 5. Resumo: tabela de mapeamento legado → GCDR

> **Nota:** Os nomes na coluna "Postgres GCDR (destino)" refletem o estado **pós-migrations 0026 (rename `qrc_*` → `wo_*`) + 0027 (drop `wo_customer_settings`)**. Em homolog/dev rodando 0024+0025 ainda existe a tabela `qrc_customer_settings`.

| SQLite (origem)               | Postgres GCDR (destino)               | Estratégia |
|-------------------------------|---------------------------------------|------------|
| `malls.name/slug/cnpj`        | `customers` (`name`, `code`, `metadata.cnpj`) | UPSERT por `code = slug` |
| `malls.viewer_password_hash`  | — (descontinuado)                     | Substituído por user real com `role:wo-viewer` escopado em `customer:<uuid>` |
| `malls.central_id`            | — (descontinuado)                     | Sem consumidor; se necessário, flag em `devices` |
| WO opt-in flag                | `customers.config.wo.enabled = true`  | Set por `POST /qrc/customers/:id/enable` |
| `users`                       | `users`                               | UPSERT por `email`; re-hash PIN + senha |
| `user_malls`                  | `role_assignments`                    | Cria role assignment escopado |
| `sessions`                    | — (descartado)                        | JWT substitui |
| `devices`                     | `devices`                             | UPSERT por `external_id = device_id` |
| `installations`               | `wo_installations`                    | INSERT (UUID novo, mapa por natural key) |
| `installation_images`         | `file_assets` + `wo_installation_images` | upload S3 + join |
| `installation_audit`          | `wo_installation_audit`               | INSERT preservando `changed_at` |
| `maintenance_tasks`           | `wo_maintenance_tasks`                | INSERT |
| `mall_observations`           | `wo_customer_observations`            | INSERT (+upload img) |
| `visitas_tecnicas`            | `wo_visitas_tecnicas`                 | INSERT |
| `visita_ambientes`            | `wo_visita_ambientes`                 | INSERT |
| `visita_ambiente_entries`     | `wo_visita_ambientes` (campos consolidados: observation, ac_quantity, product_quantity, product_type) | INSERT |
| `visita_ambiente_images`      | `file_assets` + `wo_visita_ambiente_images` | upload S3 + join |
| `visita_ambiente_products`    | `wo_visita_products`                  | INSERT |
| `visita_product_images`       | `file_assets` + `wo_visita_product_images` | upload S3 + join |
| `user_visitas`                | `role_assignments`                    | scope=`visita:<uuid>` |
| `visita_audit`                | `wo_visita_audit`                     | INSERT |
| `visita_observations`         | `wo_visita_observations`              | INSERT (+upload img) |

---

## 6. Modelagem GCDR — Work Orders (paralelo do schema novo)

> Esta seção é o **espelho da §1–§4 mas para o GCDR**. Mostra a forma final
> dos dados depois que **0026** (rename `qrc_*` → `wo_*`) e **0027**
> (drop `wo_customer_settings`) forem aplicadas, mais o rename de código.
> Referências:
> [0024](../../drizzle/migrations/0024_qrchecker_schema.sql) +
> [0025](../../drizzle/migrations/0025_devices_metering_columns.sql) +
> [0026](../../drizzle/migrations/0026_rename_qrc_to_wo.sql) +
> 0027 (a criar — drop table + migrar opt-in para `customer.config.wo`).

### 6.1 Visão geral

O domínio **Work Orders** no GCDR é uma **extensão opt-in** sobre as tabelas
de domínio que já existem (`customers`, `users`, `devices`, `file_assets`,
`role_assignments`). Não há tabela `wo_malls`, não há `wo_users`, não há
`wo_devices` — o módulo apenas:

- **Marca o customer como WO-enabled** via `customers.config.wo.enabled`
  (jsonb que já existia, da migration 0012). Nenhuma tabela `wo_settings`
  separada — ver §6.6 para histórico desta decisão.
- **Adiciona credencial PIN** em `users` via colunas `wo_field_pin_lookup`
  + `wo_field_pin_hash`
- **Adiciona endereçamento Modbus** em `devices` via `wo_addr_low`/`high`
  + `wo_identifier`
- **Cria 12 tabelas próprias** — agrupadas em 2 sub-domínios:
  - **Instalação (5):** `wo_installations`, `wo_installation_images`,
    `wo_installation_audit`, `wo_maintenance_tasks`,
    `wo_customer_observations`
  - **Visitas técnicas (7):** `wo_visitas_tecnicas`, `wo_visita_ambientes`,
    `wo_visita_ambiente_images`, `wo_visita_products`,
    `wo_visita_product_images`, `wo_visita_observations`, `wo_visita_audit`
  - Detalhamento por tabela em §6.3 abaixo.
- **Reusa `file_assets`** para todas as imagens (S3, sha256-deduplicado)
- **Reusa `role_assignments`** com scopes `customer:<uuid>` e `visita:<uuid>`
  no lugar das junction tables `user_malls` / `user_visitas` do legado.
  Inclui o caso "viewer read-only" via `role:wo-viewer` (substitui o
  `viewer_password_hash` legado).

Tudo é **multi-tenant nativo**: cada linha das `wo_*` carrega `tenant_id`,
todos os filtros e índices úteis começam por ele.

---

### 6.2 Diagrama de relacionamentos (alto nível)

```
                         CORE GCDR (já existente)
   ┌──────────┐    ┌─────────┐    ┌──────────┐    ┌────────────────┐
   │customers │    │  users  │    │ devices  │    │  file_assets   │
   │ +config  │    │ +PIN cols    │ +addr cols   │ (S3, sha256)    │
   │  .wo.    │    │              │              │                 │
   │ enabled  │    │              │              │                 │
   └────┬─────┘    └────┬────┘    └────┬─────┘    └────────┬───────┘
        │               │              │                    │
        │       ┌───────┴───────┐      │                    │
        │       │role_assignmts │      │                    │
        │       │ scope=customer│      │                    │
        │       │ (field-oper., │      │                    │
        │       │  wo-viewer,   │      │                    │
        │       │  wo-admin)    │      │                    │
        │       └───────────────┘      │                    │
        │                              │                    │
        ▼                              ▼                    │
  ┌──────────────────────────────────────────┐              │
  │              wo_installations            │              │
  │  PK uuid, tenant_id, customer_id, device_id              │
  │  position, tc_type, impedimento_text     │              │
  │  installed_by (FK users)                 │              │
  │  deleted_at (soft delete)                │              │
  └──┬───────────────┬──────────────┬────────┘              │
     │               │              │                       │
     ▼               ▼              ▼                       │
┌──────────┐  ┌──────────────┐  ┌──────────────────┐        │
│wo_inst_  │  │wo_inst_      │  │wo_maintenance_   │        │
│  audit   │  │  images      │──┼──→ file_asset_id ┼───────►│
│(rev log) │  │(max 20)      │  │  tasks           │        │
└──────────┘  └──────────────┘  └──────────────────┘        │
                                                            │
   ┌──────────────────────────┐                             │
   │ wo_customer_observations │ ──→ file_asset_id ─────────►│
   └──────────────────────────┘                             │
                                                            │
                  DOMÍNIO VISITAS (independente)            │
                                                            │
   ┌────────────────────┐                                   │
   │ wo_visitas_tecnicas│ (FK opcional → customer)          │
   │  + role_assignmts  │                                   │
   │   scope=visita:<id>│                                   │
   └─────┬──────────────┘                                   │
         │ 1:N                                              │
         ▼                                                  │
   ┌─────────────────────┐                                  │
   │ wo_visita_ambientes │  (campos consolidados:           │
   │                     │   ac_quantity, product_quantity, │
   │                     │   observation, etc.)             │
   └──┬───────────────┬──┘                                  │
      │ 1:N           │ 1:N                                 │
      ▼               ▼                                     │
┌───────────────┐  ┌─────────────────────┐                  │
│ wo_visita_    │  │ wo_visita_ambiente_ │ → file_asset_id ►│
│   products    │  │   images (max 50)   │                  │
└──────┬────────┘  └─────────────────────┘                  │
       │ 1:N                                                │
       ▼                                                    │
┌─────────────────────┐                                     │
│ wo_visita_product_  │ → file_asset_id ───────────────────►│
│   images (max 5)    │                                     │
└─────────────────────┘                                     │

  + wo_visita_observations  (1:N visita, opcional file_asset)
  + wo_visita_audit          (revision log JSON old/new)
```

---

### 6.3 Tabelas `wo_*` (12 tabelas + 5 colunas em tabelas core + 1 chave em `customers.config`)

Resumo do que cada tabela carrega. Schemas completos: ver
[0024](../../drizzle/migrations/0024_qrchecker_schema.sql) (todas com prefixo
`qrc_*` lá, renomeadas em 0026; `qrc_customer_settings` removida em 0027).

#### Domínio Instalação (5)

| Tabela | Cardinalidade | Notas-chave |
|--------|---------------|-------------|
| `wo_installations` | 1:1 com `device` (por tenant) | Status: `instalado / impedimento / removido / defeito`. `tc_type`: `50A/100A/400A/1000A/2000A`. UNIQUE `(tenant_id, device_id)`. **Soft-delete** via `deleted_at`. |
| `wo_installation_images` | 1:N de installation | Limite 20 (CHECK `image_order < 20`). FK forte para `file_assets.id`. UNIQUE `(installation_id, file_asset_id)`. |
| `wo_installation_audit` | 1:N de installation | Log imutável. `change_type`: `created/updated/deleted/image_added/image_removed/task_created/task_completed`. UNIQUE `(installation_id, revision)`. JSONB `old_value`/`new_value`. |
| `wo_maintenance_tasks` | 1:N de installation | Status: `pending / pending_review / resolved / removido`. Index parcial em status `!= 'resolved'` para dashboard. |
| `wo_customer_observations` | 1:N de customer | Notas + foto opcional (`file_asset_id` nullable). |

#### Domínio Visitas Técnicas (7)

| Tabela | Cardinalidade | Notas-chave |
|--------|---------------|-------------|
| `wo_visitas_tecnicas` | independente | Status: `pending / in_progress / done`. FK opcional para `customer`. **Soft-delete** via `deleted_at`. |
| `wo_visita_ambientes` | 1:N de visita | Consolida `visita_ambientes` + `visita_ambiente_entries` do legado em uma só (campos `ac_quantity`, `product_quantity`, `product_type`, `observation` ficam diretos aqui). |
| `wo_visita_ambiente_images` | 1:N de ambiente | Limite 50 (no app). FK para `file_assets`. |
| `wo_visita_products` | 1:N de ambiente | `product_type`, `quantity > 0` (CHECK). |
| `wo_visita_product_images` | 1:N de product | Limite 5 (no app). FK para `file_assets`. |
| `wo_visita_observations` | 1:N de visita | Nota + foto opcional. |
| `wo_visita_audit` | 1:N de visita | Revision log; `ambiente_id` opcional pra auditar mudança de filho. |

#### Extensões em tabelas core

| Tabela | Coluna(s) | Propósito |
|--------|-----------|-----------|
| `users` | `wo_field_pin_lookup` (CHAR(64)) + `wo_field_pin_hash` (text) | HMAC-SHA256(pepper, tenantId+pin) para lookup O(1) + bcrypt(pin) cost=10 para verificação. UNIQUE parcial `(tenant_id, wo_field_pin_lookup)`. |
| `devices` | `wo_addr_low` (smallint) + `wo_addr_high` (smallint) + `wo_identifier` (text) | Endereçamento Modbus extraído do payload do QR. Index parcial `(tenant_id, wo_addr_low, wo_addr_high)` pra resolução rápida no `/install`. |
| `file_assets` | `owner_type` (CHECK) | Aceita 5 valores `wo_*`: `wo_installation`, `wo_customer_observation`, `wo_visita_ambiente`, `wo_visita_product`, `wo_visita_observation`. |

---

### 6.4 Mudanças arquiteturais — legado vs GCDR

| Dimensão | Legado (SQLite) | GCDR (`wo_*`) |
|----------|-----------------|---------------|
| **Multi-tenancy** | ❌ Implícita via `mall_id` | ✅ `tenant_id` explícito em toda `wo_*`, indexado |
| **PK** | `INTEGER AUTOINCREMENT` | `uuid` v4 (`gen_random_uuid()`) |
| **Soft-delete** | ❌ `ON DELETE CASCADE` em tudo | ✅ `deleted_at` em `wo_installations` + `wo_visitas_tecnicas` |
| **Senhas** | Base64 (NÃO hash) | bcrypt(cost=10) |
| **PINs** | plaintext + uniqueness app-level | bcrypt + HMAC peppered + UNIQUE parcial por tenant |
| **Sessões** | tabela `sessions` stateful | JWT stateless (tabela descartada) |
| **Imagens** | filesystem local + path | S3 via FileAssets (sha256-deduplicado, signed URLs) |
| **`installed_by`** | TEXT solto (string) | UUID FK para `users` |
| **Audit** | misturado em poucas tabelas | `wo_installation_audit` + `wo_visita_audit` dedicados; `old_value`/`new_value` em JSONB |
| **Junction tables** | `user_malls`, `user_visitas` | `role_assignments` com `scope=customer:<uuid>` / `scope=visita:<uuid>` |
| **Tipos numéricos** | `REAL` (float) | `numeric` (precisão exata) |
| **Migrations** | schema-on-startup ad-hoc | Drizzle versionado (`0024_qrchecker_schema`, `0025_devices_metering_columns`, `0026_rename_qrc_to_wo`) |
| **Constraints** | sem CHECK | CHECK em status, tc_type, image_order, quantity, change_type |
| **Concorrência** | sem optimistic-lock | `updated_at` + 409 CONFLICT para PATCH |
| **Re-uso de domínio** | tabela `malls` própria com colunas QR-específicas | tabela `customers` global + flag `customers.config.wo.enabled` (jsonb) |
| **Viewer read-only** | shared password por mall (`viewer_password_hash`) | user real com `role:wo-viewer` escopado em `customer:<uuid>` (auditável, revogável) |

---

### 6.5 Pontos de integração com o GCDR core

O domínio Work Orders **não é uma ilha**. Ele se conecta com:

| Sistema GCDR | Como | Onde checar |
|--------------|------|-------------|
| **Customers (RBAC root)** | Toda WO referencia `customer_id`. Opt-in via `customers.config.wo.enabled = true` (jsonb). | `src/domain/entities/Customer.ts` |
| **Users** | PIN colunas em `users`; `installed_by`/`created_by`/`changed_by` apontam para `users.id`. | `src/domain/entities/User.ts` |
| **Devices** | `wo_installations.device_id` FK; `devices.wo_addr_*` para resolução por QR. | `src/domain/entities/Device.ts` |
| **FileAssets** | Toda imagem WO escreve em `file_assets` com `owner_type=wo_*`; signed URLs servidos pela API genérica `/api/v1/files/:id/url`. | `docs/frontend/FILE-ASSETS-FRONTEND.md` |
| **Role assignments** | Roles `role:field-operator`, `role:wo-viewer`, `role:wo-admin`; scopes `customer:<uuid>`, `visita:<uuid>`, `tenant`. | `docs/GCDR-USER.md` (RBAC) |
| **Audit logs (RFC-0009)** | Os `wo_*_audit` são **complementares** (forma específica do domínio). Eventos high-level também emitem em `audit_logs` global. | `docs/rfcs/RFC-0009-Events-Audit-Logs.md` |
| **Centrals** | Sem coluna dedicada. Se um QR scan precisar resolver central sem `centralId` explícito, a regra é: usar a única central do customer; se houver várias, retornar 400 com lista pra usuário escolher. (Decisão pendente — ver §7) | `src/domain/entities/Central.ts` |

---

### 6.6 O que **não** existe no GCDR (descartado do legado e do design 0024)

#### Descartado do legado

- ❌ `wo_malls` — substituído por `customers` (core) + flag `customers.config.wo.enabled`
- ❌ `wo_user_malls` — substituído por `role_assignments` com scope `customer:<uuid>`
- ❌ `wo_user_visitas` — idem com scope `visita:<uuid>`
- ❌ `wo_sessions` — JWT stateless cobre
- ❌ `wo_visita_ambiente_entries` — colunas absorvidas em `wo_visita_ambientes`
- ❌ `device_path` legado (`"Bloco A > Piso 2 > Sala 201"`) — GCDR usa `assets` hierárquicos (`SITE→BUILDING→FLOOR→AREA→EQUIPMENT`) quando faz sentido; senão fica no `metadata` jsonb

#### Removido do design GCDR (criado em 0024, descartado em 0027)

- ❌ `wo_customer_settings` — tabela 1:1 que envolveria 3 colunas:
  - `viewer_password_hash` → shared secret per-customer; substituído por
    user real com `role:wo-viewer` (auditável, revogável individualmente,
    rotaciona com o user)
  - `default_central_id` → sem consumidor real no código (nenhum service
    fazia `WHERE default_central_id = ...`); se voltar a fazer falta,
    flag em `devices` ou regra "única central do customer"
  - `qrc_metadata` / `wo_metadata` → jsonb especulativo, nunca populado
    em prod; o único uso planejado (`legacyMallId` em Phase 5) está
    stand-by
  - Flag "WO-enabled" → migrada para `customers.config.wo.enabled` (jsonb
    do core, padrão já estabelecido por outras configs)

---

## 7. Riscos e decisões pendentes

### 7.1 Riscos do schema legado (impactam Phase 5 se reativada)

1. **Senhas em Base64** (`users.password_hash`) — não são hash; precisa re-hash em bcrypt.
2. **PINs em plaintext** (`users.pin`) — idem; + computar lookup HMAC peppered.
3. **`installed_by` como string solta** em `installations`, `installation_audit`, `mall_observations`, `maintenance_tasks`, `visita_audit`, `visita_observations` — não há FK para `users`. Match por nome/email pode falhar.
4. **Sem `tenant_id`** em lugar nenhum — o conceito de mall faz duplo papel. Toda escrita no GCDR precisa injetar `tenant_id` explícito.
5. **Visitas técnicas sem vínculo a mall** — decisão de produto pendente sobre como ligar `wo_visitas_tecnicas` a `customers`.
6. **`current_multiplier` / `voltage_multiplier` como `REAL`** — possível imprecisão de ponto flutuante; convertidos para `numeric` no GCDR.
7. **`image_path` sempre relativo a `{DATA_DIR}`** — script de migração precisa do `--images-dir` correto e tolerar arquivos ausentes.
8. **Schema-on-startup** sem versionamento — uma nova coluna pode aparecer no `qrcode-check.git` a qualquer momento. Re-validar este doc antes de qualquer migração.
9. **PINs duplicados** — o init faz "nullify duplicates"; pode haver users sem PIN no dump migrado, perdendo capacidade de login.
10. **`viewer_password_hash` shared secret** — não tem auditoria de quem viu o quê, não rotaciona, não revoga individualmente. Substituído pelo padrão "user real + `role:wo-viewer` escopado".

### 7.2 Decisões pendentes no design GCDR

| Tópico | Status | Quando decidir |
|--------|--------|----------------|
| Resolução de QR sem `centralId` para customer com múltiplas centrais | aberto (era `default_central_id` em `wo_customer_settings`, removido) | Quando o primeiro caso real de ambiguidade aparecer em produção |
| Vinculação obrigatória `wo_visitas_tecnicas → customer_id` | hoje opcional (FK NULL OK) | Quando produto definir se visita pode existir solta |
| Migração de dados do legado (Phase 5 + 8) | stand-by | Após validação greenfield |

---

## 8. Como atualizar este documento

Quando o schema do `qrcode-check.git` mudar (lado legado):

1. Diff `src/lib/db.ts` no repo de origem.
2. Atualizar a seção §1–§4 do domínio impactado.
3. Atualizar a tabela §5 (mapeamento) se houver entidade nova.
4. Avaliar impacto na Fase 5 (`scripts/migrate-qrchecker.ts`) e atualizar tanto o doc da Fase 5 quanto o código.

Quando o schema GCDR mudar (lado novo):

1. Diff dos arquivos em `drizzle/migrations/`.
2. Atualizar §6 (modelagem GCDR) — diagrama, tabelas, integrações.
3. Atualizar `src/infrastructure/database/drizzle/schema.ts` se ainda não foi (Drizzle).
4. Garantir que `docs/openapi.yaml` reflete schemas afetados.

Última verificação contra `qrcode-check.git`: **2026-04-30**.
Última verificação contra GCDR (post-0026): **2026-04-30**.
