# Deploy GCDR API no Dokploy

Guia passo a passo para configurar e fazer deploy da GCDR API no Dokploy.

## Sumário

1. [Pré-requisitos](#pré-requisitos)
2. [Instalação do Dokploy](#instalação-do-dokploy)
3. [Criar Projeto](#criar-projeto)
4. [Configurar PostgreSQL](#configurar-postgresql)
5. [Configurar a API](#configurar-a-api)
6. [Variáveis de Ambiente](#variáveis-de-ambiente)
7. [Deploy](#deploy)
8. [Migrations e Seeds](#migrations-e-seeds)
9. [Configurar Domínio e SSL](#configurar-domínio-e-ssl)
10. [Verificação](#verificação)
11. [Troubleshooting](#troubleshooting)

---

## Pré-requisitos

- VPS com Ubuntu 22.04+ (mínimo 2GB RAM, 2 vCPU)
- Domínio apontando para o IP do servidor
- Acesso SSH ao servidor
- Repositório Git (GitHub/GitLab/Bitbucket)

---

## Instalação do Dokploy

### 1. Conectar via SSH

```bash
ssh root@seu-servidor-ip
```

### 2. Instalar Dokploy

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

### 3. Acessar o Painel

Após instalação, acesse:
```
http://seu-servidor-ip:3000
```

### 4. Criar conta admin

Na primeira execução, crie sua conta de administrador.

---

## Criar Projeto

### 1. Novo Projeto

1. No painel do Dokploy, clique em **"Projects"**
2. Clique em **"+ Create Project"**
3. Nome: `gcdr-api`
4. Descrição: `GCDR - Gestão de Regras de Alarme`

### 2. Adicionar Serviços

Vamos criar 2 serviços:
- **PostgreSQL** (Database)
- **GCDR API** (Application)

---

## Configurar PostgreSQL

### 1. Criar Database Service

1. Dentro do projeto `gcdr-api`, clique em **"+ Create Service"**
2. Selecione **"Database"**
3. Selecione **"PostgreSQL"**

### 2. Configurações do PostgreSQL

| Campo | Valor |
|-------|-------|
| Name | `gcdr-postgres` |
| Image | `postgres:16-alpine` |
| Database Name | `db_gcdr` |
| Username | `postgres` |
| Password | *(gerar senha segura)* |

### 3. Configurações Avançadas

Em **"Advanced"** → **"Environment Variables"**, adicione:

```env
POSTGRES_INITDB_ARGS=--encoding=UTF-8 --lc-collate=C --lc-ctype=C
```

### 4. Volume (Persistência)

Em **"Volumes"**, verifique se o volume está configurado:
```
/var/lib/postgresql/data
```

### 5. Deploy do PostgreSQL

Clique em **"Deploy"** e aguarde o status ficar **"Running"**.

### 6. Anotar Connection String

Após deploy, anote a connection string interna:
```
postgresql://postgres:SUA_SENHA@gcdr-postgres:5432/db_gcdr
```

---

## Configurar a API

### 1. Criar Application Service

1. Dentro do projeto `gcdr-api`, clique em **"+ Create Service"**
2. Selecione **"Application"**

### 2. Configurar Source

| Campo | Valor |
|-------|-------|
| Name | `gcdr-api` |
| Source | **Git** |
| Repository | `https://github.com/seu-org/gcdr.git` |
| Branch | `main` ou `migration-postgres` |
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

### Obrigatórias

```env
# Application
NODE_ENV=production
PORT=3015
HOST=0.0.0.0
LOG_LEVEL=info

# Database (usar hostname interno do Dokploy)
DATABASE_URL=postgresql://postgres:SUA_SENHA@gcdr-postgres:5432/db_gcdr

# JWT (IMPORTANTE: gerar chave segura!)
JWT_SECRET=sua-chave-secreta-com-pelo-menos-64-caracteres-gerada-com-openssl
JWT_ISSUER=gcdr
JWT_AUDIENCE=gcdr-api
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# CORS (ajustar para seu domínio em produção)
CORS_ORIGIN=https://seu-dominio.com
```

### Gerar JWT_SECRET

Execute no terminal:
```bash
openssl rand -base64 64
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
# Encontrar o container
docker ps | grep gcdr-api

# Executar migrations
docker exec -it <container_id> npm run db:migrate

# Executar seeds
docker exec -it <container_id> npm run db:seed
```

---

## Configurar Domínio e SSL

### 1. Configurar Domínio

Em **"Domains"**:

1. Clique em **"+ Add Domain"**
2. Digite seu domínio: `api.gcdr.seudominio.com`
3. Selecione **"HTTPS"**
4. Habilite **"Generate SSL Certificate"** (Let's Encrypt)

### 2. Configurar DNS

No seu provedor de DNS, adicione:

| Tipo | Nome | Valor |
|------|------|-------|
| A | api.gcdr | IP_DO_SERVIDOR |

### 3. Aguardar Propagação

Aguarde 5-10 minutos para propagação do DNS e geração do certificado SSL.

---

## Verificação

### 1. Health Check

```bash
curl https://api.gcdr.seudominio.com/health
```

Resposta esperada:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-01-27T00:00:00.000Z"
}
```

### 2. Testar Login

```bash
curl -X POST https://api.gcdr.seudominio.com/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -d '{"email": "admin@gcdr.io", "password": "Test123!"}'
```

### 3. Acessar Admin UI

```
https://api.gcdr.seudominio.com/admin/db
```

---

## Troubleshooting

### Container não inicia

**Verificar logs:**
```bash
docker logs <container_id>
```

**Causas comuns:**
- `DATABASE_URL` incorreta
- PostgreSQL não está rodando
- `JWT_SECRET` não definido

### Erro de conexão com banco

**Verificar se estão na mesma rede:**
```bash
docker network ls
docker network inspect <network_name>
```

**Testar conexão:**
```bash
docker exec -it <api_container> sh
# Dentro do container:
wget -qO- gcdr-postgres:5432 || echo "Conectou"
```

### Migrations falham

**Verificar se o banco existe:**
```bash
docker exec -it <postgres_container> psql -U postgres -c "\l"
```

**Recriar banco se necessário:**
```bash
docker exec -it <postgres_container> psql -U postgres -c "DROP DATABASE IF EXISTS db_gcdr; CREATE DATABASE db_gcdr;"
```

### SSL não funciona

1. Verificar se DNS está propagado: `nslookup api.gcdr.seudominio.com`
2. Verificar se porta 80/443 estão abertas no firewall
3. Regenerar certificado no Dokploy

---

## Comandos Úteis

### Ver logs em tempo real
```bash
docker logs -f <container_id>
```

### Reiniciar serviço
```bash
docker restart <container_id>
```

### Backup do banco
```bash
docker exec <postgres_container> pg_dump -U postgres db_gcdr > backup_$(date +%Y%m%d).sql
```

### Restore do banco
```bash
docker exec -i <postgres_container> psql -U postgres db_gcdr < backup.sql
```

---

## Checklist de Deploy

- [ ] Dokploy instalado e acessível
- [ ] Projeto criado
- [ ] PostgreSQL deployado e rodando
- [ ] API deployada e rodando
- [ ] Variáveis de ambiente configuradas
- [ ] Migrations executadas
- [ ] Seeds executados (se necessário)
- [ ] Domínio configurado
- [ ] SSL ativo
- [ ] Health check passando
- [ ] Login funcionando
- [ ] Admin UI acessível

---

## Próximos Passos

Após deploy bem-sucedido:

1. **Alterar senhas padrão** dos usuários de seed
2. **Configurar backup automático** do PostgreSQL
3. **Configurar monitoramento** (opcional: Prometheus/Grafana)
4. **Configurar CI/CD** para deploy automático via GitHub Actions

---

## Suporte

Em caso de problemas:
1. Verificar logs do container
2. Verificar status dos serviços no Dokploy
3. Consultar documentação do Dokploy: https://docs.dokploy.com
