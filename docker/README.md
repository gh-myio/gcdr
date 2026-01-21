# Docker - PostgreSQL para GCDR

## Requisitos

- Docker
- Docker Compose

## Configuracao

1. Copie o arquivo de exemplo e configure suas credenciais:

```bash
cp .env.example .env
```

2. Edite o arquivo `.env` com suas configuracoes:

```env
POSTGRES_DB=db_gcdr_prod
POSTGRES_USER=postgres
POSTGRES_PASSWORD=sua_senha_segura
POSTGRES_PORT=5432
```

## Comandos

### Iniciar o banco

```bash
cd docker
docker-compose up -d
```

### Verificar status

```bash
docker-compose ps
docker-compose logs -f postgres
```

### Parar o banco

```bash
docker-compose down
```

### Parar e remover volumes (CUIDADO: apaga os dados!)

```bash
docker-compose down -v
```

## Conexao

- **Host**: localhost (ou IP do servidor)
- **Port**: 5432 (ou conforme POSTGRES_PORT)
- **Database**: db_gcdr_prod (ou conforme POSTGRES_DB)
- **User**: postgres (ou conforme POSTGRES_USER)
- **Password**: conforme POSTGRES_PASSWORD

### String de conexao

```
postgresql://postgres:sua_senha@localhost:5432/db_gcdr_prod
```

## Scripts de Inicializacao

Coloque arquivos `.sql` ou `.sh` no diretorio `init/` para serem executados automaticamente na primeira vez que o container subir.

Exemplo: `init/01-create-extensions.sql`

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

## Healthcheck

O container inclui healthcheck automatico. Verifique com:

```bash
docker inspect gcdr-postgres --format='{{.State.Health.Status}}'
```
