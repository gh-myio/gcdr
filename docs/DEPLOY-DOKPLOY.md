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

### 1. Acessar Terminal do Container

No Dokploy, acesse o terminal do container `gcdr-api`:

1. Clique no serviço `gcdr-api`
2. Vá em **"Terminal"** ou **"Console"**

### 2. Executar Migrations

```bash
cd /app
npm run db:migrate
```

### 3. Executar Seeds (apenas primeira vez)

```bash
npm run db:seed
```

### Alternativa: Via SSH no Servidor

```bash
# Conectar ao servidor
ssh root@13.218.248.206

# Encontrar o container
docker ps | grep gcdr-api

# Executar migrations
docker exec -it <container_id> npm run db:migrate

# Executar seeds
docker exec -it <container_id> npm run db:seed
```

### Alternativa: Conectar diretamente ao banco (debug)

```bash
# Via psql local
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
- [ ] API deployada e rodando
- [ ] Variáveis de ambiente configuradas
- [ ] Migrations executadas
- [ ] Seeds executados
- [ ] Domínio configurado
- [ ] SSL ativo
- [ ] Health check passando
- [ ] Login funcionando

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
