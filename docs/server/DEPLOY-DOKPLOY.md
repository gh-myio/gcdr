# Deploy GCDR API no Dokploy

Guia passo a passo para configurar e fazer deploy da GCDR API no Dokploy.

## Sumário

1. [Pré-requisitos](#pré-requisitos)
2. [Infraestrutura Atual](#infraestrutura-atual)
3. [Configurar a API](#configurar-a-api)
4. [Variáveis de Ambiente](#variáveis-de-ambiente)
5. [Deploy](#deploy)
6. [Migrations e Seeds](#migrations-e-seeds)
7. [Configurar Domínio e SSL](#configurar-domínio-e-ssl)
8. [Verificação](#verificação)
9. [Troubleshooting](#troubleshooting)

---

## Pré-requisitos

- Acesso ao painel Dokploy
- Repositório Git configurado (GitHub)
- Banco de dados PostgreSQL já criado no Dokploy

---

## Infraestrutura Atual

### Servidor Dokploy

| Item | Valor |
|------|-------|
| IP | `13.218.248.206` |
| Painel | `http://13.218.248.206:3000` |
| Projeto | `myio-gcdr` |

### PostgreSQL (Produção)

O banco de dados PostgreSQL já está configurado no Dokploy:

#### Credenciais Internas (para a API)

| Campo | Valor |
|-------|-------|
| User | `postgres` |
| Database | `db_gcdr_prod` |
| Password | `iZ4_4XTcMZEcoXthvHXJ` |
| Host Interno | `myio-gcdr-gcdrprod-ixsmh2` |
| Porta Interna | `5432` |
| **Connection URL** | `postgresql://postgres:iZ4_4XTcMZEcoXthvHXJ@myio-gcdr-gcdrprod-ixsmh2:5432/db_gcdr_prod` |

#### Credenciais Externas (para acesso remoto/debug)

| Campo | Valor |
|-------|-------|
| Host Externo | `13.218.248.206` |
| Porta Externa | `5455` |
| **Connection URL** | `postgresql://postgres:iZ4_4XTcMZEcoXthvHXJ@13.218.248.206:5455/db_gcdr_prod` |

> **Nota**: Use a URL **interna** para a API (comunicação container-to-container). Use a URL **externa** apenas para debug/administração remota.

---

## Configurar a API

### 1. Criar Application Service

1. Dentro do projeto `myio-gcdr`, clique em **"+ Create Service"**
2. Selecione **"Application"**

### 2. Configurar Source

| Campo | Valor |
|-------|-------|
| Name | `gcdr-api` |
| Source | **Git** |
| Repository | `https://github.com/gh-myio/gcdr.git` |
| Branch | `migration-postgres` |
| Build Type | **Dockerfile** |
| Dockerfile Path | `Dockerfile` |

### 3. Configurar Build

Em **"Build"**:

| Campo | Valor |
|-------|-------|
| Build Target | `production` |
| Context | `.` |

### 4. Configurar Network

Em **"Network"**, certifique-se de que a API está na mesma rede que o PostgreSQL para comunicação interna.

---

## Variáveis de Ambiente

Em **"Environment Variables"**, adicione:

```env
# Application
NODE_ENV=production
PORT=3015
HOST=0.0.0.0
LOG_LEVEL=info

# Database (usar hostname INTERNO do Dokploy)
DATABASE_URL=postgresql://postgres:iZ4_4XTcMZEcoXthvHXJ@myio-gcdr-gcdrprod-ixsmh2:5432/db_gcdr_prod

# JWT (IMPORTANTE: gerar chave segura!)
JWT_SECRET=<GERAR_COM_OPENSSL>
JWT_ISSUER=gcdr
JWT_AUDIENCE=gcdr-api
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# CORS (ajustar para seu domínio em produção)
CORS_ORIGIN=https://gcdr.myio.com.br,https://app.myio.com.br

# Admin UI (opcional - para acesso ao /admin/db em produção)
DB_ADMIN_PASSWORD=<SENHA_SEGURA>
```

### Gerar JWT_SECRET

Execute no terminal:
```bash
openssl rand -base64 64
```

Exemplo de resultado (use o seu próprio!):
```
K7xY9z2Qw4rT8uI0pA3sD6fG1hJ5kL8mN2bV4cX7zQ9wE1rT3yU6iO0pA2sD5fG8h=
```

---

## Deploy

### 1. Configurar Port

Em **"Ports"**, exponha:

| Container Port | Protocol |
|----------------|----------|
| 3015 | HTTP |

### 2. Health Check

Em **"Health Check"**:

| Campo | Valor |
|-------|-------|
| Path | `/health` |
| Port | `3015` |
| Interval | `30s` |
| Timeout | `5s` |

### 3. Executar Deploy

1. Clique em **"Deploy"**
2. Acompanhe os logs de build
3. Aguarde o status **"Running"**

---

## Migrations e Seeds

### IMPORTANTE: Pós-Deploy Manual

Após cada deploy/rebuild no Dokploy, é necessário executar alguns passos manuais:

#### 1. Copiar Scripts de Seed para o Container

O Dockerfile copia os scripts, mas se o build context não estiver correto, pode ser necessário copiar manualmente:

```bash
# Conectar ao servidor
ssh root@13.218.248.206

# Verificar nome do container da API
sudo docker ps | grep gcdr-app

# Clonar repo (se não existir)
cd /tmp && sudo git clone --depth 1 https://github.com/gh-myio/gcdr.git

# Ou atualizar se já existir
cd /tmp/gcdr && sudo git pull

# Criar pasta e copiar scripts
sudo docker exec --user root <CONTAINER_ID> mkdir -p /app/scripts/db/seeds
sudo docker cp /tmp/gcdr/scripts/db/seeds/. <CONTAINER_ID>:/app/scripts/db/seeds/
sudo docker exec --user root <CONTAINER_ID> chown -R gcdr:nodejs /app/scripts

# Verificar
sudo docker exec <CONTAINER_ID> ls -la /app/scripts/db/seeds/
```

#### 2. Acessar Admin/DB

Acesse `https://gcdr-server.apps.myio-bas.com/admin/db` com senha `myio2026` (ou valor de `DB_ADMIN_PASSWORD`).

#### 3. Rodar Seeds via Admin/DB

1. Clique em **"Run All Seeds"** para popular o banco com dados de teste
2. Ou rode seeds individuais conforme necessário

**Nota:** O "Run All Seeds" executa os scripts 01-14, pulando 00-clear-all e 99-verify.

---

### Migrations via PostgreSQL Container

A imagem de produção não inclui `drizzle-kit` (é uma devDependency). Para rodar migrations, use uma das opções abaixo:

### Opção 1: Via PostgreSQL Container Terminal (Recomendado)

1. No Dokploy, vá para o serviço **PostgreSQL** (não a API)
2. Abra **"Terminal"** ou **"Console"**
3. Conecte ao banco:
```sh
psql -U postgres -d db_gcdr_prod
```

4. Execute o SQL combinado disponível em `drizzle/migrations/combined-production.sql`:
   - Copie todo o conteúdo do arquivo e cole no terminal psql
   - Ou, se tiver acesso ao arquivo no container:
   ```sh
   psql -U postgres -d db_gcdr_prod -f /path/to/combined-production.sql
   ```

### Opção 2: Via SSH no Servidor

```bash
# Conectar ao servidor
ssh root@13.218.248.206

# Encontrar o container PostgreSQL
docker ps | grep postgres

# Executar psql dentro do container PostgreSQL
docker exec -it <postgres_container_id> psql -U postgres -d db_gcdr_prod

# Dentro do psql, cole o conteúdo de combined-production.sql
# ou execute cada statement do arquivo de migração
```

### Verificar se migrations foram executadas

```sql
-- No psql, verificar tabelas criadas:
\dt

-- Verificar histórico de migrations:
SELECT * FROM __drizzle_migrations;
```

### Executar Seeds

Após as migrations, execute os seeds via API container:

```bash
# Via SSH no servidor
ssh root@13.218.248.206

# Encontrar o container da API
docker ps | grep gcdr-api

# Executar seeds (use sh, não bash - Alpine Linux)
docker exec -it <api_container_id> sh -c "npm run db:seed"
```

**Nota:** O container usa Alpine Linux que não tem `bash`, use `sh`.

### Alternativa: Conectar diretamente ao banco (debug)

```bash
# Via psql local (requer porta 5455 acessível externamente)
psql "postgresql://postgres:iZ4_4XTcMZEcoXthvHXJ@13.218.248.206:5455/db_gcdr_prod"

# Ou via Docker no servidor
docker exec -it <postgres_container> psql -U postgres -d db_gcdr_prod
```

---

## Configurar Domínio e SSL

### 1. Configurar Domínio

Em **"Domains"**:

1. Clique em **"+ Add Domain"**
2. Digite seu domínio: `api.gcdr.myio.com.br`
3. Selecione **"HTTPS"**
4. Habilite **"Generate SSL Certificate"** (Let's Encrypt)

### 2. Configurar DNS

No seu provedor de DNS, adicione:

| Tipo | Nome | Valor |
|------|------|-------|
| A | api.gcdr | `13.218.248.206` |

### 3. Aguardar Propagação

Aguarde 5-10 minutos para propagação do DNS e geração do certificado SSL.

---

## Verificação

### 1. Health Check

```bash
curl https://api.gcdr.myio.com.br/health
```

Resposta esperada:
```json
{
  "status": "ok"
}
```

### 2. Testar Login

```bash
curl -X POST https://api.gcdr.myio.com.br/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -d '{"email": "admin@gcdr.io", "password": "Test123!"}'
```

### 3. Acessar Admin UI (apenas em desenvolvimento)

```
https://api.gcdr.myio.com.br/admin/db
```

> **Nota**: O Admin UI só está disponível em `NODE_ENV=development`. Em produção, use conexão direta ao banco.

---

## Troubleshooting

### Container não inicia

**Verificar logs no Dokploy:**
1. Clique no serviço
2. Vá em **"Logs"**

**Ou via SSH:**
```bash
ssh root@13.218.248.206
docker logs <container_id>
```

**Causas comuns:**
- `DATABASE_URL` incorreta (verificar hostname interno)
- PostgreSQL não está rodando
- `JWT_SECRET` não definido

### Erro de conexão com banco

**Verificar se estão na mesma rede Docker:**
```bash
docker network ls
docker network inspect dokploy-network
```

**Testar conexão do container da API:**
```bash
docker exec -it <api_container> sh
# Dentro do container:
wget -qO- myio-gcdr-gcdrprod-ixsmh2:5432 || echo "Porta respondendo"
```

### Migrations falham

**Verificar se o banco existe:**
```bash
psql "postgresql://postgres:iZ4_4XTcMZEcoXthvHXJ@13.218.248.206:5455/db_gcdr_prod" -c "\l"
```

**Verificar tabelas existentes:**
```bash
psql "postgresql://postgres:iZ4_4XTcMZEcoXthvHXJ@13.218.248.206:5455/db_gcdr_prod" -c "\dt"
```

### SSL não funciona

1. Verificar se DNS está propagado: `nslookup api.gcdr.myio.com.br`
2. Verificar se porta 80/443 estão abertas no firewall
3. Regenerar certificado no Dokploy

---

## Comandos Úteis

### Ver logs em tempo real
```bash
ssh root@13.218.248.206
docker logs -f <container_id>
```

### Reiniciar serviço
```bash
docker restart <container_id>
```

### Backup do banco
```bash
pg_dump "postgresql://postgres:iZ4_4XTcMZEcoXthvHXJ@13.218.248.206:5455/db_gcdr_prod" > backup_$(date +%Y%m%d).sql
```

### Restore do banco
```bash
psql "postgresql://postgres:iZ4_4XTcMZEcoXthvHXJ@13.218.248.206:5455/db_gcdr_prod" < backup.sql
```

---

## Checklist de Deploy

- [x] Dokploy instalado e acessível
- [x] Projeto criado (`myio-gcdr`)
- [x] PostgreSQL deployado e rodando
- [x] API deployada e rodando
- [x] Variáveis de ambiente configuradas
- [x] Migrations executadas
- [x] Seeds executados
- [x] Domínio configurado (`gcdr-server.apps.myio-bas.com`)
- [x] SSL ativo
- [x] Health check passando
- [x] Login funcionando
- [x] Admin/DB acessível (`/admin/db` com senha `myio2026`)

---

## Credenciais de Teste (Seeds)

Após executar os seeds, os seguintes usuários estarão disponíveis:

| Email | Senha | Tipo |
|-------|-------|------|
| `admin@gcdr.io` | `Test123!` | INTERNAL |
| `joao.silva@acmetech.com` | `Test123!` | CUSTOMER |
| `maria.santos@acmetech.com` | `Test123!` | CUSTOMER |

**Tenant ID para testes:** `11111111-1111-1111-1111-111111111111`

> **IMPORTANTE**: Altere as senhas padrão após o primeiro deploy em produção!

---

## Próximos Passos

Após deploy bem-sucedido:

1. **Alterar senhas padrão** dos usuários de seed
2. **Configurar backup automático** do PostgreSQL no Dokploy
3. **Configurar CI/CD** para deploy automático via GitHub Actions
4. **Remover/desabilitar Admin UI** em produção

---

## Suporte

Em caso de problemas:
1. Verificar logs do container no Dokploy
2. Verificar status dos serviços
3. Consultar documentação do Dokploy: https://docs.dokploy.com
