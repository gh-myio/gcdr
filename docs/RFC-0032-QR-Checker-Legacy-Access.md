# RFC-0032 — QR Checker Legacy: Production Access & Query Runbook

> **Escopo deste doc:** instruções operacionais para acessar a aplicação **QR Checker legada** em produção (SSH no host EC2, Dokploy, container Docker, SQLite) e rodar queries diretamente. Também documenta a query equivalente no **GCDR Postgres** (destino da migração — ver `RFC-0032-QR-Checker-Migration-to-GCDR.md`).
>
> **Status:** runbook interno. Não compartilhar fora do time.

> 🚨 **ALERTA DE PRODUÇÃO (2026-04-30):** existem **dois services do qrcodechecker** ativos no Dokploy compartilhando o **mesmo volume Docker `Database`** no host. Detalhes e mitigação na **Seção 7**. Antes de qualquer manutenção, ler.

---

## 1. Topologia em produção

| Camada | Valor |
|---|---|
| Host EC2 | `18.207.96.123` |
| DNS público (AWS) | `ec2-18-207-96-123.compute-1.amazonaws.com` |
| Route 53 (wildcard) | `*.apps.myio-bas.com` → A → `18.207.96.123` (TTL 300, simple routing) |
| Painel Dokploy | https://dokploy.apps.myio-bas.com/ |
| App QR Checker (público) | https://qrcode.apps.myio-bas.com/ |
| Acesso SSH | `admin@dokploy.apps.myio-bas.com:22` (chave pública `rodrigo@myio.com.br`) |
| Hostname interno do host | `ip-172-31-22-45` (Debian 13, kernel 6.12.63, x86_64) |

### 1.1 Services do qrcodechecker (Docker Swarm via Dokploy)

| Service | Criado em | Recebe tráfego? | Volume montado |
|---|---|---|---|
| `ingestion-qrcodechecker-zfxfoc` | 2025-11-27 | ✅ **Sim** — Traefik roteia `qrcode.apps.myio-bas.com` para ele | `Database → /app/data` |
| `ingestion-qrcodechecker-cqx7ae` | 2026-02-25 | ❓ A confirmar (sem labels Traefik conhecidas) | `Database → /app/data` (**MESMO volume físico — ver §7**) |

Detalhes técnicos do `zfxfoc` (instância produtiva):

| Item | Valor |
|---|---|
| Nome lógico no Dokploy | `QRCodeChecker` |
| Slug interno | `ingestion-qrcodechecker-zfxfoc` |
| Build | Dockerfile (context `.`) |
| Domínio | `qrcode.apps.myio-bas.com`, path `/`, porta `3000`, HTTPS via Let's Encrypt |
| Service Traefik | `ingestion-qrcodechecker-zfxfoc-service-48` → `http://ingestion-qrcodechecker-zfxfoc:3000` |
| Routers Traefik | `ingestion-qrcodechecker-zfxfoc-router-48` (web → redirect-to-https), `…-router-websecure-48` (websecure, certResolver letsencrypt) |
| Task Swarm (exemplo) | `ingestion-qrcodechecker-zfxfoc.1.om1ven9ardyg5y9tw7peimszt` (container `b22328a33895`) |

> O ID/nome do container muda a cada redeploy — sempre descobrir dinamicamente (§3.2).

---

## 2. Conectar ao host

```bash
# A partir da sua máquina (Mac / Windows com OpenSSH ou PuTTY)
ssh -i ~/.ssh/rodrigo@myio.com.br admin@dokploy.apps.myio-bas.com
# (no PuTTY: Host=admin@dokploy.apps.myio-bas.com, Port=22, key=rodrigo@myio.com.br)
```

Após login, você cai como `admin@ip-172-31-22-45`.

> ⚠️ **Permissão Docker:** o usuário `admin` **não está** no grupo `docker` por padrão neste host. Todos os comandos `docker …` precisam ser prefixados com `sudo`. Alternativa permanente (avaliar antes — equivale a dar root): `sudo usermod -aG docker admin && exit` e reconectar.

---

## 3. Acessar o container do QR Checker

A app roda como **service do Docker Swarm** (gerenciado pelo Dokploy). Todos os comandos abaixo assumem `sudo` (ver aviso na §2).

### 3.1 Listar serviços

```bash
sudo docker service ls | grep qrcodechecker
```

Saída esperada (em 2026-04-30):

```
ogrh6qi4e51j   ingestion-qrcodechecker-cqx7ae   replicated   1/1
c160b46x6y0n   ingestion-qrcodechecker-zfxfoc   replicated   1/1
```

### 3.2 Descobrir o container ativo

```bash
# zfxfoc (produção):
sudo docker ps --filter "name=ingestion-qrcodechecker-zfxfoc" --format "{{.ID}} {{.Names}}"

# cqx7ae (segundo service — ver §7 antes de mexer):
sudo docker ps --filter "name=ingestion-qrcodechecker-cqx7ae" --format "{{.ID}} {{.Names}}"
```

Exemplo de saída (`zfxfoc`):

```
b22328a33895 ingestion-qrcodechecker-zfxfoc.1.om1ven9ardyg5y9tw7peimszt
```

Guarde o ID curto — vamos usar nos próximos passos.

### 3.3 Logs em tempo real

```bash
sudo docker service logs -f --tail 200 ingestion-qrcodechecker-zfxfoc
# ou pelo container específico:
sudo docker logs -f --tail 200 b22328a33895
```

### 3.4 Shell dentro do container

```bash
sudo docker exec -it b22328a33895 sh
```

Dentro do container:

- App em `/app` (Next.js standalone)
- Banco SQLite em `/app/data/qr-checker.db` (definido por `DATA_DIR=/app/data`, ver `Dockerfile:101`)
- Imagens das instalações em `/app/data/installation-images/`

---

## 4. Rodar queries no SQLite legado (qrcode-check)

> **Schema correto deste banco**: tabelas `malls`, `devices`, `installations`, `installation_images`, `installation_audit`, `maintenance_tasks`, `users`, `user_malls`, `sessions`, `mall_observations`, `visitas_tecnicas`, `visita_ambientes`, etc. Ver `src/lib/db.ts` no repo `qrcode-check.git`.
>
> **Não existem** as tabelas `qrc_customer_settings` nem `customers` — essas são do GCDR Postgres (§6).

### 4.1 ✅ Padrão recomendado — `better-sqlite3` via Node (sem instalar nada)

O CLI `sqlite3` **não está disponível** dentro do container Alpine de produção (`apk add sqlite` falha — provavelmente sem internet/registry de saída). Em compensação, o app já tem `better-sqlite3` instalado, então rode queries via `node -e`:

```bash
sudo docker exec b22328a33895 node -e "const db = require('better-sqlite3')('/app/data/qr-checker.db', {readonly: true}); const rows = db.prepare(\"SELECT id, slug AS customer_code, name AS customer_name, central_id, CASE WHEN viewer_password_hash IS NOT NULL THEN 'YES' ELSE 'NO' END AS qr_enabled, created_at FROM malls WHERE viewer_password_hash IS NOT NULL ORDER BY created_at DESC\").all(); console.table(rows);"
```

**Boas práticas:**

- Sempre abrir com `{readonly: true}` para queries — evita lock contention com o app que está em produção.
- Use `console.table(rows)` para saídas tabulares; `console.log(JSON.stringify(rows, null, 2))` quando quiser exportar.
- Para queries longas, escreva o JS em `/tmp/q.js` no host e monte via volume, ou use `sudo docker cp q.js <container>:/tmp/q.js && sudo docker exec <container> node /tmp/q.js`.

### 4.2 Dados observados em produção (baseline para sanity check)

Em **2026-04-30**, o banco do `zfxfoc` (= `cqx7ae`, mesmo volume — ver §7) tinha:

| Métrica | Valor |
|---|---|
| Tamanho do `.db` | ~3.6 MB |
| Total de malls | 9 |
| Total de devices | 2.188 |
| Total de installations | 2.136 |
| Cliente principal (3 primeiros malls) | `sa-cavancante-shopping-da-ilha`, `sa-cavalcante-rio-poty`, `sa-cavalcante-shopping-metropole` |

> Use estes números como referência. Se em diagnósticos futuros você ver contagens muito menores ou zeradas, suspeite de banco errado / volume errado / instância nova sem seed.

### 4.3 Queries equivalentes à intenção da query original (Postgres → SQLite)

A query original (Postgres / GCDR — ver §6) busca **customers com `qrc_metadata` populado**. No SQLite legado, o conceito mais próximo é **"malls com `viewer_password_hash` definido"** (que é o que marca um mall como QR-enabled no legado):

```sql
-- Listar malls QR-enabled (têm viewer_password_hash configurado)
SELECT
  id,
  slug             AS customer_code,
  name             AS customer_name,
  central_id,
  CASE WHEN viewer_password_hash IS NOT NULL THEN 1 ELSE 0 END AS qr_enabled,
  created_at
FROM malls
WHERE viewer_password_hash IS NOT NULL
ORDER BY created_at DESC;

-- Contagem de devices e instalações por mall
SELECT
  m.slug,
  m.name,
  COUNT(DISTINCT d.id)       AS total_devices,
  COUNT(DISTINCT i.id)       AS total_installations
FROM malls m
LEFT JOIN devices d        ON d.mall_id = m.id
LEFT JOIN installations i  ON i.device_id = d.id
GROUP BY m.id
ORDER BY total_installations DESC;
```

### 4.4 Backup do banco para análise local

```bash
# 1. No host EC2: copia o .db do container para o host
sudo docker cp b22328a33895:/app/data/qr-checker.db /tmp/qr-checker-$(date +%Y%m%d-%H%M%S).db
sudo chown admin:admin /tmp/qr-checker-*.db   # para conseguir o scp depois

# 2. Da sua máquina (Mac/Windows): baixa via scp
scp admin@dokploy.apps.myio-bas.com:/tmp/qr-checker-*.db ./
```

Para snapshot **consistente** (recomendado em produção, principalmente dado o WAL):

```bash
# Usa a API .backup do SQLite para um snapshot atômico mesmo com app gravando
sudo docker exec b22328a33895 node -e "const db = require('better-sqlite3')('/app/data/qr-checker.db', {readonly: true}); db.backup('/app/data/snapshot-' + Date.now() + '.db').then(() => console.log('snapshot done'));"
sudo docker cp b22328a33895:/app/data/snapshot-*.db /tmp/
```

---

## 5. Múltiplas malls / batch queries

Como cada mall tem ~240 devices/installations em média, queries por mall são rápidas. Exemplo: top 3 malls por instalações concluídas:

```bash
sudo docker exec b22328a33895 node -e "const db = require('better-sqlite3')('/app/data/qr-checker.db', {readonly: true}); console.table(db.prepare('SELECT m.slug, m.name, COUNT(i.id) as installs FROM malls m LEFT JOIN devices d ON d.mall_id=m.id LEFT JOIN installations i ON i.device_id=d.id GROUP BY m.id ORDER BY installs DESC LIMIT 3').all());"
```

---

## 6. Rodar a query original no GCDR Postgres

A query que você quer rodar é **PostgreSQL** e referencia o schema GCDR (destino da migração — ver `RFC-0032-QR-Checker-Migration-to-GCDR.md` linha 381+):

```sql
SELECT
  cs.customer_id,
  c.code        AS customer_code,
  c.name        AS customer_name,
  cs.qrc_metadata,
  cs.created_at,
  cs.updated_at
FROM   qrc_customer_settings cs
JOIN   customers c ON c.id = cs.customer_id
WHERE  cs.qrc_metadata IS NOT NULL
  AND  cs.qrc_metadata != '{}'::jsonb
ORDER  BY cs.updated_at DESC;
```

### 6.1 ⚠️ O Postgres do GCDR NÃO está neste EC2

Em 2026-04-30 inspecionamos os volumes do host e **não há volume `gcdr-postgres` ou similar**. O `docker volume ls` mostrou apenas:

```
local     Database                                         ← qrcheck legado (compartilhado, ver §7)
local     dokploy-postgres-database                        ← Postgres interno do Dokploy (não é o GCDR)
local     ingestion-goalsdatabasestaging-1iropw-data       ← staging do goalsdatabase (outra app)
```

**Conclusão:** o Postgres do GCDR está em **outro lugar** — provavelmente RDS, outro EC2, ou outro host Dokploy. Para descobrir:

```bash
# Listar candidatos a backend GCDR
sudo docker service ls | grep -iE 'gcdr|backend|api'

# Para cada candidato, extrair env vars de conexão
sudo docker service inspect <service-name> --format '{{json .Spec.TaskTemplate.ContainerSpec.Env}}' \
  | tr ',' '\n' | grep -iE 'database|postgres|db_|host|url'
```

Procure variáveis tipo `DATABASE_URL=postgres://user:pass@HOST:5432/db`, `PGHOST`, `POSTGRES_HOST`, etc.

### 6.2 Conectar via `psql` (uma vez identificado)

```bash
# Se o Postgres está em container neste host:
sudo docker exec -it <postgres-container-id> psql -U <user> -d <dbname>

# Se está externo (RDS / outro host) e a porta está acessível a partir do EC2:
psql "postgres://user:pass@host:5432/dbname"
```

### 6.3 Equivalente para SQLite (caso queira mesmo rodar no legado)

Use as queries da §4.3. A query Postgres **não traduz diretamente** porque o schema legado **não tem coluna JSON de metadata**.

---

## 7. ⚠️ ALERTA — `zfxfoc` e `cqx7ae` compartilham o mesmo volume `Database`

### 7.1 O que foi observado (2026-04-30)

```bash
# Inspeção das mounts:
sudo docker inspect <container-zfxfoc> --format '{{range .Mounts}}{{.Source}}{{end}}'
# → /var/lib/docker/volumes/Database/_data

sudo docker inspect <container-cqx7ae> --format '{{range .Mounts}}{{.Source}}{{end}}'
# → /var/lib/docker/volumes/Database/_data       ← MESMO PATH

# docker volume ls confirma: existe UM único volume "Database" no host
sudo docker volume ls | grep -i database
# → local     Database
```

Validação prática (queries rodadas nos dois containers retornaram **dados idênticos**, byte a byte):

| Métrica | zfxfoc | cqx7ae |
|---|---|---|
| malls | 9 | 9 |
| devices | 2188 | 2188 |
| installations | 2136 | 2136 |
| Tamanho `.db` | 3.6M | 3.6M |
| `mtime` | `Apr 30 13:16` | `Apr 30 13:16` |

### 7.2 Por que isso é problema

- **SQLite WAL + dois processos de containers diferentes gravando = corrupção em potencial.** O próprio manual do SQLite documenta: "Do not use WAL with concurrent writers across processes when the OS-level locking guarantees are unclear" — Docker isola containers, mas o filesystem é compartilhado.
- Atualmente o risco real é **baixo** porque só o `zfxfoc` tem rota Traefik (`qrcode.apps.myio-bas.com`). Mas qualquer um dos seguintes acende o alerta:
  - O `cqx7ae` recebe tráfego por outra rota (verificar labels Traefik / outros routers).
  - Job/cron interno do `cqx7ae` toca no banco.
  - Migration do `runMigrations()` roda no startup de cada container — dois containers reiniciando juntos podem brigar pelo lock.
- **Backups inconsistentes:** snapshot tirado por um container pode ser interrompido por gravação do outro.

### 7.3 Diagnóstico do `cqx7ae` antes de qualquer ação

```bash
# Algum router Traefik aponta pra ele?
sudo docker service inspect ingestion-qrcodechecker-cqx7ae --format '{{json .Spec.Labels}}'

# Histórico de tasks (quando foi último deploy, se está crashando, etc.)
sudo docker service ps ingestion-qrcodechecker-cqx7ae --no-trunc

# Confirmar no painel do Dokploy: https://dokploy.apps.myio-bas.com/
# → procurar a aplicação cqx7ae, ver domínio configurado, último deploy, logs
```

### 7.4 Mitigações (em ordem)

1. **Backup obrigatório antes de qualquer mudança** (§4.4).
2. **Identificar o que `cqx7ae` é** (cliente paralelo? staging? abandonado?).
3. **Decidir destino:**
   - Abandonado/duplicata → `sudo docker service rm ingestion-qrcodechecker-cqx7ae` (com backup feito).
   - Necessário (ambiente diferente) → renomear o volume na config do stack `cqx7ae` no Dokploy para algo único (ex.: `Database_cqx7ae`), redeployar, e popular o novo volume com cópia do banco atual ou seed inicial.
   - Migração em curso → falar com quem está migrando antes de mexer.

> **Não execute** o `service rm` sem o passo 1 e 2. Documentar a decisão em PR / issue antes de aplicar.

---

## 8. Checklist de segurança operacional

- [ ] Sempre abrir conexões SQLite com `{readonly: true}` para queries (§4.1).
- [ ] Não rodar `UPDATE` / `DELETE` em produção sem `BEGIN; … ROLLBACK/COMMIT;`.
- [ ] Sempre fazer backup (§4.4) antes de qualquer alteração.
- [ ] Antes de mexer no `cqx7ae`, ler §7 inteiro.
- [ ] Sair do `docker exec` (`exit`) e fechar o SSH ao terminar.
- [ ] Não comitar arquivos `.db` baixados no git — adicionar a `.gitignore` se precisar manter local.
- [ ] Logs do container podem conter PII de instalações — tratar com cuidado.

---

## 9. Referências cruzadas

- `RFC-0032-QR-Checker-Migration-to-GCDR.md` — RFC mestre da migração legacy → GCDR (define `qrc_customer_settings`, schema completo)
- `RFC-0032-QR-Checker-Migration-to-GCDR-DATABASE-Structure-QRCODE-CHECKER.md` — mapeamento de schemas legado ↔ GCDR
- `RFC-0032-QR-Checker-Migration-to-GCDR-Phase-5.md` — fase de migração de dados
- `FRONTEND-RFC-0032-QR-Checker.md` — front-end consumindo o novo schema
- `DEPLOY-DOKPLOY.md`, `SOLVE-DOKPLOY.md`, `FEEDBACK-DOKPLOY.md` — runbooks gerais do Dokploy
- Repo do legado: `C:\Projetos\GitHub\myio\qrcode-check.git\` (ver `CLAUDE.md` e `Dockerfile`)


---


 ---
  Dúvidas que sobraram (12 novas)

  Sobre WO

  A. WO predecessors — bloqueio ou informativo?
  Você escreveu "WO 10 pode ter relação com WO 8 (com status )" — texto cortado. O que essa dependência significa?
  - (a) Soft / informativo: só mostra "esta WO espera a WO #8 fechar", mas não bloqueia eventos
  - (b) Hard / bloqueante: WO #10 não aceita events até WO #8 estar closed/approved
  - (c) Configurável por dependência: cada linha de work_order_dependencies tem um campo "block_until_status_id" que diz qual status da predecessora libera

  B. Sequence per tenant — implementação
  - (a) tenant_sequences (tenant_id, sequence_name, next_value) com SELECT ... FOR UPDATE
  - (b) Postgres CREATE SEQUENCE wo_<tenantId> (uma por tenant — feio)
  - (c) nextval('global_wo_seq') global + UNIQUE(tenant_id, code) (mas o número não fica sequencial por tenant)

  C. WO status — usa a tabela work_order_statuses?
  Mesma pattern de customer_statuses. Seeds iniciais:
  - pending ("Aguardando início")
  - in_progress ("Em atendimento")
  - paused_myio_impediment ("Paralisada — impedimento MYIO")
  - paused_customer_impediment ("Paralisada — impedimento cliente")
  - pending_approval ("Aguardando aprovação")
  - approved ("Aprovada")
  - cancelled ("Cancelada")
  - closed ("Fechada")

  Faltou alguma? E a transição entre estados é livre ou tem máquina de regras?

  D. Soft delete em work_orders
  - (a) Não tem deleted_at — usa status cancelled
  - (b) Tem deleted_at (consistência com outras tabelas)
  - Recomendo (a), mais limpo dado a state machine

  Sobre Events

  E. Event type — tabela ou enum?
  Você decidiu lookup table pra customer status. Aplico o mesmo pra event type? Seeds iniciais:
  - comment
  - attach_file
  - status_change (gerado quando WO muda de status)
  - device_added / device_removed
  - installation_started / installation_completed
  - maintenance_started / maintenance_completed
  - technical_visit_started / technical_visit_completed
  - technical_visit_picture_attached
  - product_swap (com metadata: oldProductId, newProductId)

  Confirma o pattern?

  F. Event visibility — tabela ou enum?
  Você descreveu 3 níveis: privado-do-técnico / interno-MYIO / público-cliente. Tabela event_visibilities com seed:
  - private ("Privado — só o autor")
  - internal_myio ("Interno — equipe MYIO")
  - public ("Público — visível ao cliente")

  Confirma?

  G. Adicionar/remover device da WO — gera event?
  Quando alguém faz POST /work-orders/:id/devices, gera automaticamente um event type=device_added? Ou só altera work_order_devices direto?
  - Recomendo gerar event (preserva auditoria sem precisar olhar log externo)

  H. Status change — gera event automaticamente?
  PATCH no status da WO → cria event type=status_change com metadata: {from: 'in_progress', to: 'closed'}. Confirma?

  Sobre Files

  I. event.file_id — 1 file por event?
  Se um event attach_file tem múltiplas fotos, é:
  - (a) 1 event = 1 file (vários events com mesma description)
  - (b) 1 event = N files via junction work_order_event_files
  - Recomendo (a) — eventos são leves, cada upload é seu próprio audit row

  Sobre auth

  J. Drop das colunas PIN agora
  Confirma drop imediato de users.qrc_field_pin_lookup + qrc_field_pin_hash na migration de redesign? Quando o auth novo for definido, criamos colunas novas (code + pin_hash) sem o legado pendurado.

  Sobre Customer Status (lookup table)

  K. Customer status — escopo da tabela
  Os registros são globais (compartilhados entre tenants) ou por tenant?
  - (a) Global: customer_statuses(id, name, label, ...). MYIO controla a lista; todos os tenants veem os mesmos estados.
  - (b) Por tenant: customer_statuses(id, tenant_id, name, label, ...). Cada tenant pode criar estados próprios.
  - Recomendo (a) — estados de cliente são padrão MYIO, não customizáveis por tenant.

  L. Seed inicial de customer_statuses
  Confirmando: active, blocked_for_payment. Adicionar suspended, pending_setup, closed? Ou só os 2 mesmo no seed?

  ---
  Resumo: estamos com 12 novas dúvidas. Responde as que conseguir e adiantamos. Sem commit ainda — só desenho.
