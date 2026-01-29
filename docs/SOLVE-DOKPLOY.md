# Problemas de Deploy no Dokploy - GCDR

## Data: 2026-01-29

---

## Problema 1: Migration Loop

### Sintoma
Container entra em loop infinito de restart porque a migration falha.

### Causa
A tabela `drizzle.__drizzle_migrations` estava vazia ou desatualizada, fazendo o Drizzle tentar executar migrations que já foram aplicadas no banco.

### Erro
```
PostgresError: type "actor_type" already exists
```

### Solução
Inserir manualmente os registros das migrations já aplicadas:

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES
  ('0000_third_tempest', EXTRACT(EPOCH FROM NOW()) * 1000),
  ('0001_fuzzy_mojo', EXTRACT(EPOCH FROM NOW()) * 1000),
  ('0002_misty_unicorn', EXTRACT(EPOCH FROM NOW()) * 1000);
```

---

## Problema 2: Swagger UI não carrega

### Sintoma
A página `/docs` carrega mas mostra apenas spec mínimo com `http://localhost:3015`.

### Causa
O arquivo `docs/openapi.yaml` tinha uma **chave YAML duplicada** (`/auth/password/forgot` definido duas vezes), causando erro de parsing.

### Erro
```
duplicated mapping key (3768:3)
```

### Solução
Remover a seção duplicada "Legacy endpoints (deprecated)" do `openapi.yaml`.

Commit: `6bc3ac7`

---

## Problema 3: CSP bloqueando Swagger UI

### Sintoma
Swagger UI não carrega scripts externos.

### Causa
A rota `/docs` estava **depois** do middleware Helmet, que aplica Content-Security-Policy restritivo.

### Solução
Mover a rota `/docs` para **antes** do `app.use(helmet())` em `src/app.ts`.

Commit: `d78cc5e`

---

## Problema 4: Dockerfile complexo causando instabilidade

### Sintoma
Build ou startup do container falha, Dokploy fica instável.

### Causa
Dockerfile multi-stage com migration script no CMD pode falhar se:
- DATABASE_URL não está disponível no momento do build
- Migration falha e `exit 1` reinicia o container

### Solução Temporária
Usar Dockerfile simplificado (single-stage, sem migrations automáticas):

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache wget
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
COPY docs/openapi.yaml ./docs/
RUN npm prune --production
ENV NODE_ENV=production PORT=3015 HOST=0.0.0.0
EXPOSE 3015
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3015/health || exit 1
CMD ["node", "dist/app.js"]
```

### Solução Definitiva (TODO)
1. Rodar migrations em job separado antes do deploy
2. Ou usar `db:push` apenas em desenvolvimento
3. Ou criar script de migration resiliente que não falha se já aplicada

---

## Comandos Úteis no Dokploy (via SSH)

```bash
# Ver containers
docker ps | grep gcdr

# Ver logs do container
docker logs <container_id> --tail 100

# Forçar update do service (Swarm)
docker service update --force myio-gcdr-app-container-prod-4jycfh

# Rebuild manual
cd /etc/dokploy/applications/myio-gcdr-app-container-prod-*
git pull
docker compose build --no-cache
docker compose up -d

# Limpar cache Docker
docker builder prune -f
docker system prune -f
```

---

## Arquivos de Backup

- `Dockerfile.backup` - Dockerfile original multi-stage com migrations

---

## Status Atual

- [x] Migration loop resolvido (journal corrigido no banco)
- [x] Swagger UI carregando localmente
- [ ] Swagger UI em produção (aguardando redeploy com Dockerfile simplificado)
- [ ] Restaurar Dockerfile otimizado após estabilizar
