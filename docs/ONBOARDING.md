# Manual de Onboarding - GCDR (Global Central Data Registry)

Bem-vindo ao time! Este manual vai te ajudar a entender e começar a contribuir com o projeto GCDR.

## Sumário

1. [Visão Geral do Projeto](#1-visão-geral-do-projeto)
2. [Acesso para Frontend](#2-acesso-para-frontend)
3. [Configuração do Ambiente](#3-configuração-do-ambiente)
4. [Arquitetura do Sistema](#4-arquitetura-do-sistema)
5. [Estrutura do Código](#5-estrutura-do-código)
6. [Fluxo de Dados](#6-fluxo-de-dados)
7. [Padrões e Convenções](#7-padrões-e-convenções)
8. [Desenvolvimento Local](#8-desenvolvimento-local)
9. [Testes](#9-testes)
10. [Tarefas Comuns](#10-tarefas-comuns)
11. [Troubleshooting](#11-troubleshooting)
12. [Recursos Úteis](#12-recursos-úteis)

---

## 1. Visão Geral do Projeto

### O que é o GCDR?

O **GCDR (Global Central Data Registry)** é o **Single Source of Truth** para todos os dados mestres do ecossistema MYIO. Pense nele como um "cadastro central" que:

1. **Gerencia Clientes** com hierarquia (Holding → Empresa → Filial → Franquia)
2. **Registra Parceiros** que integram via API
3. **Controla Autorizações** com roles, policies e scopes
4. **Registra Audit Logs** para compliance e rastreabilidade (RFC-0009)

### Por que ele existe?

Sem o GCDR, cada sistema (ThingsBoard, NodeHub, OS, etc.) mantinha sua própria versão dos dados, causando:

- **Divergência de dados**: Nomes, contatos e regras diferentes em cada sistema
- **Sincronização manual**: Atualizar um cliente em 5 lugares
- **Falta de governança**: Sem auditoria de quem mudou o quê
- **Permissões inconsistentes**: Cada sistema com suas regras

O GCDR resolve isso centralizando tudo em um único lugar autoritativo.

---

## 2. Acesso para Frontend

Esta seção contém todas as informações necessárias para a equipe de frontend consumir a API GCDR.

### Ambientes Disponíveis

| Ambiente | URL Base | Uso |
|----------|----------|-----|
| **Production** | `https://gcdr-server.apps.myio-bas.com` | Produção (Dokploy) |
| **Local** | `http://localhost:3015` | Desenvolvimento local (Docker) |

### Headers Obrigatórios

Toda requisição deve incluir:

```http
Content-Type: application/json
x-tenant-id: <uuid-do-tenant>
Authorization: Bearer <jwt-token>
```

Para endpoints de parceiros, use API Key:
```http
X-API-Key: <api-key-do-partner>
```

### Documentação OpenAPI

A especificação completa da API está disponível em:
- **Swagger UI (online)**: [`/docs`](http://localhost:3015/docs)
- **OpenAPI JSON**: [`/docs/openapi.json`](http://localhost:3015/docs/openapi.json)
- **Arquivo local**: [`docs/openapi.yaml`](./openapi.yaml) (5,850+ linhas)
- **140+ endpoints** documentados com schemas de request/response

Você também pode importar o `openapi.yaml` em ferramentas como:
- [Postman](https://www.postman.com/)
- [Insomnia](https://insomnia.rest/)

### Módulos da API

| Módulo | Endpoints | Descrição |
|--------|-----------|-----------|
| **Health** | 1 | Health check da API |
| **Authentication** | 6 | Login, logout, refresh token, MFA, password reset |
| **Customers** | 9 | Hierarquia de clientes (ROOT → RESELLER → ENTERPRISE → BUSINESS → INDIVIDUAL) |
| **Partners** | 15 | Parceiros, API Keys, OAuth Clients, Webhooks |
| **Authorization** | 18 | RBAC completo (Roles, Policies, Assignments) |
| **Assets** | 11 | Ativos com hierarquia (SITE → BUILDING → FLOOR → AREA → EQUIPMENT) |
| **Devices** | 9 | Dispositivos IoT com conectividade (filtros por `centralId`, `slaveId`) |
| **Rules** | 10 | Regras de negócio (ALARM_THRESHOLD, SLA, ESCALATION, MAINTENANCE_WINDOW) com guard configs para Decision Engine |
| **Alarm Bundles** | 3 | Bundle de regras para integração Node-RED (M2M) com versionamento |
| **Alarm Simulator** | 6 | Simulador premium de alarmes ([Manual](./SIMULATOR-MANUAL.md)) |
| **Customer API Keys** | 4 | Gerenciamento de API Keys por customer |
| **Audit Logs** | 2 | Logs de auditoria para compliance (RFC-0009) |
| **Registration** | 6 | Auto-cadastro de usuários com aprovação (RFC-0011) |
| **Admin Users** | 4 | Aprovação, rejeição e desbloqueio de usuários (RFC-0011) |
| **Integrations** | 12 | Marketplace de integrações |
| **Centrals** | 10 | Centrais IoT (NODEHUB, GATEWAY, EDGE_CONTROLLER) |
| **Themes** | 10 | Look and Feel (cores, logos, CSS customizado) |
| **Users** | 18 | Usuários, gerenciamento, MFA |
| **Groups** | 12 | Grupos de usuários, dispositivos e assets com hierarquia |

### Exemplos de Requisições

#### Health Check
```bash
curl http://localhost:3015/health
```

Resposta:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "gcdr-api",
    "version": "1.0.0",
    "stage": "dev"
  }
}
```

#### Listar Customers
```bash
curl http://localhost:3015/customers \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>"
```

#### Criar Customer
```bash
curl -X POST http://localhost:3015/customers \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Empresa ABC",
    "type": "ENTERPRISE",
    "document": "12.345.678/0001-90",
    "email": "contato@empresaabc.com"
  }'
```

#### Buscar Árvore de Customers
```bash
curl http://localhost:3015/customers/{id}/tree \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>"
```

#### Listar Assets de um Customer
```bash
curl http://localhost:3015/customers/{id}/assets \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>"
```

#### Obter Tema Efetivo (com herança)
```bash
curl http://localhost:3015/customers/{id}/theme/effective \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>"
```

#### Obter Bundle de Alarmes (para Node-RED)
```bash
# Bundle simplificado (com centralId e slaveId) - RECOMENDADO
curl http://localhost:3015/customers/33333333-3333-3333-3333-333333333333/alarm-rules/bundle/simple \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026"
```

**API Key de Teste (seed):** `gcdr_cust_test_bundle_key_myio2026`

**Formato do Bundle Simplificado:**
```json
{
  "versionId": "v1-20260127-214530",
  "deviceIndex": {
    "device-uuid": {
      "deviceName": "Temperature Sensor",
      "centralId": "central-uuid",
      "slaveId": 1,
      "ruleIds": ["rule-uuid-1", "rule-uuid-2"]
    }
  },
  "rules": {
    "rule-uuid-1": {
      "id": "rule-uuid-1",
      "name": "High Temperature Alert",
      "value": 28,
      "startAt": "08:00",
      "endAt": "18:00",
      "daysOfWeek": {
        "0": false,
        "1": true,
        "2": true,
        "3": true,
        "4": true,
        "5": true,
        "6": false
      }
    }
  }
}
```

**Notas:**
- `versionId`: Formato amigável `v1-YYYYMMDD-HHmmss`
- `daysOfWeek`: Objeto com chaves 0-6 (0=Domingo), valores boolean

#### Buscar Device por Central + Slave ID (para alarms-backend)
```bash
# Resolver device Modbus pelo centralId + slaveId
curl "http://localhost:3015/api/v1/devices?centralId=9308af89-94b2-45e6-9e47-ae78f881afd2&slaveId=4" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -H "Authorization: Bearer <token>"
```

Resposta:
```json
{
  "success": true,
  "data": {
    "items": [{
      "id": "22220001-0001-0001-0001-000000000001",
      "name": "Energy Laboratório",
      "displayName": "Medidor Energia Lab",
      "slaveId": 4,
      "centralId": "9308af89-...",
      "assetId": "ffff8888-..."
    }],
    "pagination": { "total": 1, "totalPages": 1, "hasMore": false }
  }
}
```

> **Uso**: O alarms-backend usa este endpoint para enriquecer alarmes com `deviceName` (`displayName ?? name`) e resolver o UUID do device a partir do Modbus `localId`.

#### Criar API Key para Customer
```bash
curl -X POST http://localhost:3015/customers/{customerId}/api-keys \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Node-RED Integration",
    "scopes": ["bundles:read", "rules:read"],
    "expiresAt": "2027-01-01T00:00:00Z"
  }'
```

#### Consultar Audit Logs
```bash
curl "http://localhost:3015/audit-logs?userId={userId}&action=UPDATE" \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>"
```

### Padrão de Resposta

Todas as respostas seguem o formato:

**Sucesso:**
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-21T00:00:00.000Z"
  }
}
```

**Erro:**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Customer not found",
    "details": { ... }
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-21T00:00:00.000Z"
  }
}
```

**Lista com paginação:**
```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "pagination": {
      "total": 47,
      "totalPages": 3,
      "hasMore": true,
      "nextCursor": "20"
    }
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-21T00:00:00.000Z"
  }
}
```

> **Nota**: Todos os endpoints paginados retornam `total` (contagem total de registros) e `totalPages` (total de páginas baseado no `limit`).

### Códigos de Erro HTTP

| Código | Significado |
|--------|-------------|
| 200 | OK - Sucesso |
| 201 | Created - Recurso criado |
| 400 | Bad Request - Erro de validação |
| 401 | Unauthorized - Token inválido ou ausente |
| 403 | Forbidden - Sem permissão |
| 404 | Not Found - Recurso não encontrado |
| 409 | Conflict - Conflito (ex: duplicado) |
| 422 | Unprocessable Entity - Regra de negócio violada |
| 429 | Too Many Requests - Rate limit excedido |
| 500 | Internal Server Error - Erro interno |

### Autenticação

A API suporta dois métodos de autenticação:

#### 1. JWT Bearer Token (para aplicações frontend/mobile)

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Estrutura do JWT emitido:**
```json
{
  "sub": "user-uuid",
  "tenant_id": "tenant-uuid",
  "email": "usuario@empresa.com",
  "roles": ["role:super-admin", "role:operator"],
  "type": "CUSTOMER",
  "iat": 1737463200,
  "exp": 1737466800,
  "iss": "gcdr",
  "aud": ["gcdr-api", "alarm-orchestrator"]
}
```

| Campo | Descrição |
|-------|-----------|
| `sub` | ID único do usuário |
| `tenant_id` | ID do tenant (multi-tenancy) |
| `email` | Email do usuário |
| `roles` | Array de role keys (ex: `role:super-admin`) - carregadas do AuthorizationService |
| `type` | Tipo do usuário (CUSTOMER, PARTNER, SERVICE, INTERNAL) |
| `iat` | Timestamp de emissão |
| `exp` | Timestamp de expiração |
| `iss` | Emissor do token |
| `aud` | Audiência(s) - pode ser string ou array de strings (RFC 7519) |

#### 2. API Key (para integrações de parceiros)

```http
X-API-Key: gcdr_pk_live_xxxxxxxxxxxx
```

#### 3. OAuth2 Client Credentials (para integrações M2M)

```bash
# Obter access token
curl -X POST https://api.gcdr.io/partners/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "partner-client-id",
    "client_secret": "partner-client-secret",
    "scope": "customers:read devices:read"
  }'
```

Resposta:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "customers:read devices:read"
}
```

#### 4. Customer API Key (para M2M como Node-RED)

Para integrações M2M de clientes (ex: Node-RED baixando bundles de alarme):

```http
X-API-Key: gcdr_cust_xxxxxxxxxxxx
```

**Criar API Key (requer JWT de admin):**
```bash
curl -X POST https://api.gcdr.io/dev/customers/{customerId}/api-keys \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-uuid" \
  -H "Authorization: Bearer <jwt-admin-token>" \
  -d '{
    "name": "Node-RED Production",
    "scopes": ["bundles:read"]
  }'
```

**Scopes disponiveis:**
- `bundles:read` - Bundles de alarme
- `devices:read` - Leitura de devices
- `devices:write` - Leitura/escrita de devices (usado pelo hybridAuth em `GET /devices`)
- `rules:read` - Leitura de regras
- `assets:read` - Leitura de assets
- `assets:write` - Leitura/escrita de assets (usado pelo hybridAuth em `GET /assets`)
- `customers:write` - Leitura/escrita de customers (usado pelo hybridAuth)
- `groups:read` - Leitura de grupos
- `*:read` - Leitura de todos os recursos

Veja detalhes completos em: [ONBOARDING-NODERED-ALARM-BUNDLE.md](./ONBOARDING-NODERED-ALARM-BUNDLE.md)

### Estado Atual da Autenticacao

| Funcionalidade | Status | Endpoint |
|----------------|--------|----------|
| **Partner Token (OAuth2)** | Implementado | `POST /partners/token` |
| **Partner API Key Validation** | Implementado | Middleware |
| **Customer API Key (M2M)** | Implementado | `POST /customers/{id}/api-keys` |
| **Login de Usuarios** | Implementado | `POST /auth/login` |
| **Refresh Token** | Implementado | `POST /auth/refresh` |
| **MFA Verification** | Implementado | `POST /auth/mfa/verify` |
| **Logout** | Implementado | `POST /auth/logout` |
| **Forgot Password** | Implementado | `POST /auth/forgot-password` |
| **Reset Password** | Implementado | `POST /auth/reset-password` |
| **Self Registration (RFC-0011)** | Implementado | `POST /auth/register` |
| **Email Verification (RFC-0011)** | Implementado | `POST /auth/verify-email` |
| **Resend Verification (RFC-0011)** | Implementado | `POST /auth/resend-verification` |

### Estados do Usuário (RFC-0011)

| Status | Descrição | Transições |
|--------|-----------|------------|
| `UNVERIFIED` | Novo cadastro, email não verificado | → PENDING_APPROVAL (após verificar email) |
| `PENDING_APPROVAL` | Email verificado, aguardando aprovação do admin | → ACTIVE (aprovado) ou INACTIVE (rejeitado) |
| `ACTIVE` | Usuário ativo e aprovado | → INACTIVE (desativado) ou LOCKED (6 falhas de login) |
| `INACTIVE` | Desativado pelo admin ou rejeitado | → ACTIVE (reativado) |
| `LOCKED` | Bloqueado por tentativas de login | → ACTIVE (admin desbloqueia ou reset de senha) |

### Endpoints de Autenticacao

```
POST /auth/login              -> Autentica usuario e emite JWT
POST /auth/refresh            -> Renova token expirado
POST /auth/logout             -> Invalida token
POST /auth/mfa/verify         -> Verifica codigo MFA
POST /auth/forgot-password    -> Solicita reset de senha (envia código de 6 dígitos)
POST /auth/reset-password     -> Reseta senha com código de 6 dígitos

# RFC-0011: Self-Registration
POST /auth/register           -> Auto-cadastro de novo usuário
POST /auth/verify-email       -> Verifica email com código de 6 dígitos
POST /auth/resend-verification-> Reenvia código de verificação

# RFC-0011: Admin User Management
GET  /admin/users/pending-approval -> Lista usuários aguardando aprovação
POST /admin/users/:id/approve      -> Aprova cadastro de usuário
POST /admin/users/:id/reject       -> Rejeita cadastro de usuário
POST /admin/users/:id/unlock       -> Desbloqueia usuário bloqueado
GET  /admin/users/locked           -> Lista usuários bloqueados
```

### Exemplos de Uso

#### Login Simples

> **IMPORTANTE**: O header `X-Tenant-Id` é obrigatório para login. Use o tenant default: `11111111-1111-1111-1111-111111111111`

```bash
curl -X POST http://localhost:3015/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -d '{
    "email": "admin@gcdr.io",
    "password": "Test123!"
  }'
```

**Usuários de Teste (seed):**

| Email | Senha | Role | Status |
|-------|-------|------|--------|
| admin@gcdr.io | Test123! | Admin | ACTIVE |
| joao.silva@acmetech.com | Test123! | User | ACTIVE |
| maria.santos@acmetech.com | Test123! | User | ACTIVE |
| dev@techpartner.com | Test123! | Partner | ACTIVE |
| service@gcdr.io | Test123! | Service | ACTIVE |

Resposta:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "refreshExpiresIn": 604800,
  "user": {
    "id": "user-uuid",
    "email": "usuario@empresa.com",
    "displayName": "Joao Silva",
    "type": "CUSTOMER",
    "roles": ["role:super-admin", "role:viewer"]
  }
}
```

> **Nota sobre Roles**: As roles são carregadas dinamicamente do `AuthorizationService` a cada login, MFA verification e token refresh. Os role keys (ex: `role:super-admin`) são incluídos tanto na resposta de login quanto no JWT token, permitindo que frontends e outros serviços validem permissões.

#### Login com MFA Habilitado
Se o usuario tiver MFA habilitado, a resposta inicial sera:
```json
{
  "mfaRequired": true,
  "mfaToken": "eyJhbGciOiJIUzI1NiIs...",
  "mfaMethod": "totp",
  "expiresIn": 300
}
```

Complete a autenticacao com:
```bash
curl -X POST https://api.gcdr.io/dev/auth/mfa/verify \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-uuid" \
  -d '{
    "mfaToken": "eyJhbGciOiJIUzI1NiIs...",
    "code": "123456"
  }'
```

#### Renovar Token
```bash
curl -X POST https://api.gcdr.io/dev/auth/refresh \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-uuid" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  }'
```

### Integracao com Outros Sistemas

O JWT emitido pelo GCDR e aceito por outros sistemas do ecossistema MYIO usando **Multiple Audience** (RFC 7519 Section 4.1.3):

```
+------------+     JWT      +------------------+
|   GCDR     |  -------->   | alarm-orchestrator|
| (emissor)  |              | (validador)       |
+------------+              +------------------+
      |                             |
      |  aud: ["gcdr-api",          |
      |        "alarm-orchestrator"]|
      |                             |
      └─────────────────────────────┘
                    |
            Valida: sub, tenant_id,
            email, roles, exp, iss, aud
```

**Como funciona:**
1. GCDR emite tokens com multiplas audiences: `aud: ["gcdr-api", "alarm-orchestrator"]`
2. Cada servico valida se sua audience esta presente no array
3. Mesmo token funciona em todos os servicos do ecossistema

**Configuracao no GCDR (Identity Provider):**
```bash
JWT_SECRET=<chave-secreta-compartilhada>
JWT_ISSUER=gcdr
JWT_AUDIENCE=gcdr-api,alarm-orchestrator   # Comma-separated
```

**Configuracao no alarm-orchestrator (Resource Server):**
```bash
JWT_SECRET=<mesma-chave-do-gcdr>
JWT_ISSUER=gcdr
JWT_AUDIENCE=alarm-orchestrator
```

> **Nota**: Veja [RFC-0003-Refactoring-Multiple-Audience.md](./RFC-0003-Refactoring-Multiple-Audience.md) para detalhes da implementacao.

### Rate Limiting

| Tipo | Limite |
|------|--------|
| Por IP | 1000 req/min |
| Por API Key | Conforme plano do partner |
| Por User | 100 req/min |

---

## 3. Configuração do Ambiente

### Tecnologias Principais

| Tecnologia | Para quê usamos |
|------------|-----------------|
| **Node.js 20** | Runtime JavaScript |
| **TypeScript 5** | Tipagem estática |
| **Express.js** | Framework HTTP |
| **PostgreSQL 16** | Banco de dados relacional |
| **Docker** | Containerização |
| **Docker Compose** | Orquestração local |
| **Dokploy** | Deploy em containers |
| **Zod** | Validação de schemas |
| **Jest** | Framework de testes |
| **npm** | Gerenciador de pacotes |

> **Nota**: O projeto foi migrado de AWS Lambda/DynamoDB para containers Docker com PostgreSQL.
> Veja [RFC-0005](./RFC-0005-Container-Deployment-Migration.md) para detalhes.

### Pré-requisitos

Certifique-se de ter instalado:

```bash
# Node.js 20 LTS
node --version  # deve ser v20.x.x

# npm 9+
npm --version  # deve ser 9.x.x ou superior

# Git
git --version

# AWS CLI (para deploy)
aws --version
```

### Instalação do Node.js (se necessário)

Recomendamos usar o [nvm](https://github.com/nvm-sh/nvm) (Linux/Mac) ou [nvm-windows](https://github.com/coreybutler/nvm-windows):

```bash
# Instalar Node.js 20
nvm install 20
nvm use 20
```

### Clone e Setup

```bash
# 1. Clone o repositório
git clone https://github.com/gh-myio/gcdr.git
cd gcdr

# 2. Instale as dependências
npm install

# 3. Configure o ambiente
cp .env.example .env
# Edite o .env se necessário

# 4. Verifique se tudo está funcionando
npm test
```

### Pré-requisitos Adicionais

```bash
# Docker e Docker Compose (para desenvolvimento local)
docker --version   # Docker 20+
docker compose version  # Docker Compose v2+
```

### Verificação da Instalação

#### Opção 1: Com Docker (Recomendado)

```bash
# Iniciar todos os serviços (API + PostgreSQL)
docker compose up -d

# Verificar se os containers estão rodando
docker compose ps

# Testar a API
curl http://localhost:3015/health
# Deve retornar: {"status":"ok"}

curl http://localhost:3015/health/ready
# Deve retornar: {"status":"ready"}

# Ver logs
docker compose logs -f api
```

#### Opção 2: Desenvolvimento Local (sem Docker)

```bash
# Requer PostgreSQL rodando localmente ou em container separado
# Configure DATABASE_URL no .env

# Compilar TypeScript
npm run build

# Iniciar o servidor com hot reload
npm run dev

# Em outro terminal, teste a API
curl http://localhost:3015/health
# Deve retornar: {"status":"ok"}
```

---

## 4. Arquitetura do Sistema

### Diagrama de Alto Nível

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Dokploy Platform                                    │
│                                                                                  │
│  ┌─────────────┐     ┌────────────────────────────────────────────────────┐     │
│  │   Traefik   │     │                  GCDR API Container                 │     │
│  │   (proxy)   │────>│                   (Express.js)                      │     │
│  │   :443/80   │     │                                                     │     │
│  └─────────────┘     │  ┌────────────┐ ┌────────────┐ ┌────────────┐      │     │
│                      │  │ Controllers│ │ Controllers│ │ Controllers│      │     │
│                      │  │            │ │            │ │            │      │     │
│                      │  │ customers  │ │  devices   │ │   rules    │      │     │
│                      │  │ users      │ │  assets    │ │ authz      │      │     │
│                      │  │ auth       │ │ integr.    │ │ policies   │      │     │
│                      │  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘      │     │
│                      │        │              │              │             │     │
│                      │        └──────────────┼──────────────┘             │     │
│                      │                       │                            │     │
│                      │                ┌──────▼───────┐                    │     │
│                      │                │   Services   │                    │     │
│                      │                │              │                    │     │
│                      │                │ Business     │                    │     │
│                      │                │ Logic Layer  │                    │     │
│                      │                └──────┬───────┘                    │     │
│                      │                       │                            │     │
│                      │                ┌──────▼───────┐                    │     │
│                      │                │ Repositories │                    │     │
│                      │                │              │                    │     │
│                      │                │ Data Access  │                    │     │
│                      │                │ Layer        │                    │     │
│                      │                └──────┬───────┘                    │     │
│                      │                       │                            │     │
│                      └───────────────────────┼────────────────────────────┘     │
│                                              │                                   │
│                      ┌───────────────────────┼───────────────────────┐          │
│                      │                       │                       │          │
│             ┌────────▼────────┐     ┌────────▼────────┐     ┌───────▼────────┐ │
│             │   PostgreSQL    │     │     Redis       │     │   External     │ │
│             │   Container     │     │   (optional)    │     │   Systems      │ │
│             │                 │     │                 │     │                │ │
│             │ - customers     │     │ - cache         │     │ - ThingsBoard  │ │
│             │ - devices       │     │ - sessions      │     │ - NodeHub      │ │
│             │ - users         │     │ - queues        │     │ - Alarmes      │ │
│             │ - rules         │     │                 │     │                │ │
│             │ - policies      │     │                 │     │                │ │
│             └─────────────────┘     └─────────────────┘     └────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Serviços Docker

| Serviço | Container | Porta | Descrição |
|---------|-----------|-------|-----------|
| API | gcdr-api | 3015 | Aplicação Express.js |
| Database | gcdr-postgres | 5433 | PostgreSQL 16 |

### Componentes Principais

| Componente | Responsabilidade |
|------------|------------------|
| **Controllers** | Recebem requests HTTP, validam input, chamam services |
| **Services** | Lógica de negócio, orquestração entre repositories |
| **Repositories** | Acesso a dados no PostgreSQL (Drizzle ORM) |
| **DTOs** | Validação de entrada/saída com Zod |
| **Middleware** | Error handling, request context, response formatting |
| **Audit Logs** | Registro local de eventos para compliance (RFC-0009) |

### Domínios do GCDR

| Domínio | Descrição |
|---------|-----------|
| **Customers** | Hierarquia de clientes (Holding → Empresa → Filial) |
| **Partners** | Parceiros que integram via API |
| **Authorization** | Roles, Policies e permissões |

---

## 5. Estrutura do Código

### Visão Geral dos Diretórios

```
src/
├── domain/               # Entidades de domínio
│   └── entities/
│       ├── Customer.ts   # Entidade Customer
│       ├── Partner.ts    # Entidade Partner
│       ├── Role.ts       # Entidade Role
│       ├── Policy.ts     # Entidade Policy
│       └── RoleAssignment.ts
│
├── dto/                  # Data Transfer Objects
│   ├── request/          # DTOs de entrada (validação com Zod)
│   │   ├── CustomerDTO.ts
│   │   ├── PartnerDTO.ts
│   │   └── AuthorizationDTO.ts
│   └── response/         # DTOs de saída
│       ├── CustomerResponseDTO.ts
│       └── AuthorizationResponseDTO.ts
│
├── controllers/          # HTTP route controllers (Express)
│   ├── health.controller.ts      # Health check endpoints
│   ├── auth.controller.ts        # Authentication endpoints
│   ├── customers.controller.ts   # CRUD + hierarquia de customers
│   ├── partners.controller.ts    # Workflow de parceiros
│   ├── authorization.controller.ts # Controle de acesso
│   ├── devices.controller.ts     # Device management
│   ├── users.controller.ts       # User management
│   ├── rules.controller.ts       # Rules engine
│   └── admin/
│       └── db-admin.controller.ts # Database Admin UI
│
├── middleware/           # Express middlewares
│   ├── auth.ts           # JWT authentication
│   ├── context.ts        # Request context extraction
│   ├── errorHandler.ts   # Global error handling
│   └── response.ts       # Standardized responses
│
├── services/             # Lógica de negócio
│   ├── CustomerService.ts
│   └── PartnerService.ts
│
├── repositories/         # Acesso a dados
│   ├── CustomerRepository.ts
│   ├── PartnerRepository.ts
│   └── interfaces/       # Contratos (ports)
│       ├── ICustomerRepository.ts
│       ├── IPartnerRepository.ts
│       └── IRepository.ts
│
├── infrastructure/       # Infraestrutura tecnica
│   └── database/
│       └── drizzle/
│           ├── schema.ts     # Drizzle schema definitions
│           ├── client.ts     # PostgreSQL connection
│           └── migrations/   # SQL migrations
│
└── shared/               # Código compartilhado
    ├── config/
    │   └── Config.ts
    ├── errors/
    │   └── AppError.ts
    ├── types/
    │   └── index.ts
    └── utils/
        ├── dateUtils.ts
        └── idGenerator.ts

tests/
├── unit/
│   └── services/
│       └── CustomerService.test.ts
├── integration/
└── helpers/
    └── setup.ts
```

### Entendendo Cada Camada

#### `domain/entities/` - Entidades de Domínio

Define as estruturas de dados principais usando interfaces TypeScript:

```typescript
// Customer com hierarquia
interface Customer {
  id: string;
  tenantId: string;
  parentCustomerId: string | null;  // null = root customer
  path: string;                     // /tenant/parent/child
  depth: number;                    // Nível na hierarquia
  name: string;
  type: 'HOLDING' | 'COMPANY' | 'BRANCH' | 'FRANCHISE';
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  // ...
}
```

#### `dto/` - Data Transfer Objects

Validação de entrada com Zod:

```typescript
// Validação na criação de customer
const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['HOLDING', 'COMPANY', 'BRANCH', 'FRANCHISE']),
  parentCustomerId: z.string().uuid().optional(),
  // ...
});
```

#### `controllers/` - Entry Points

Cada controller e um modulo Express com rotas HTTP:

```typescript
import { Router } from 'express';

const router = Router();

router.get('/:id', async (req, res) => {
  // 1. Parse e valida input (Zod)
  // 2. Chama service
  // 3. Retorna response formatada
});

export default router;
```

#### `services/` - Lógica de Negócio

Coordena operações entre repositories e eventos:

```typescript
class CustomerService {
  async createCustomer(data: CreateCustomerDTO): Promise<Customer> {
    // 1. Valida regras de negócio
    // 2. Calcula path hierárquico
    // 3. Persiste no repository
    // 4. Emite evento
  }
}
```

#### `repositories/` - Acesso a Dados

Encapsula operacoes no PostgreSQL usando Drizzle ORM:

```typescript
class CustomerRepository implements ICustomerRepository {
  async findById(tenantId: string, id: string): Promise<Customer | null>;
  async findChildren(tenantId: string, parentId: string): Promise<Customer[]>;
  async findDescendants(tenantId: string, path: string): Promise<Customer[]>;
}
```

---

## 6. Fluxo de Dados

### Fluxo: Criar Customer

```
1. REQUEST
   └─> POST /customers
       {
         "name": "Filial São Paulo",
         "type": "BRANCH",
         "parentCustomerId": "customer-holding-123"
       }

2. HANDLER (create.ts)
   └─> Valida body com Zod
   └─> Extrai tenantId do contexto
   └─> Chama CustomerService.createCustomer()

3. SERVICE (CustomerService.ts)
   └─> Valida se parent existe
   └─> Calcula path: "/tenant/holding-123/sao-paulo"
   └─> Calcula depth: 2
   └─> Gera ID único (UUID)
   └─> Chama Repository.create()

4. REPOSITORY (CustomerRepository.ts)
   └─> Monta entidade com Drizzle ORM
   └─> INSERT na tabela customers (PostgreSQL)

5. AUDIT LOG (AuditLogService)
   └─> Registra ação "customer.created" no PostgreSQL
   └─> Armazena: userId, action, resourceType, resourceId, changes

6. RESPONSE
   └─> 201 Created
       {
         "id": "customer-sao-paulo-456",
         "name": "Filial São Paulo",
         "path": "/tenant/holding-123/sao-paulo",
         "depth": 2,
         ...
       }
```

### Fluxo: Aprovar Partner

```
1. REQUEST
   └─> POST /partners/{id}/approve
       { "approvedBy": "admin@myio.com" }

2. HANDLER (approve.ts)
   └─> Valida partnerId
   └─> Chama PartnerService.approve()

3. SERVICE (PartnerService.ts)
   └─> Busca partner
   └─> Valida status == 'PENDING'
   └─> Atualiza status para 'APPROVED'
   └─> Gera API keys
   └─> Salva no repository

4. AUDIT LOG
   └─> Registra "partner.approved" no PostgreSQL

5. RESPONSE
   └─> 200 OK
       {
         "id": "partner-123",
         "status": "APPROVED",
         "apiKeys": [...]
       }
```

### Fluxo: Check de Permissão

```
1. REQUEST
   └─> POST /authorization/check
       {
         "userId": "user-joao",
         "permission": "energy.settings.read",
         "resourceScope": "customer:customer-loja-123"
       }

2. HANDLER (check.ts)
   └─> Busca role assignments do usuário
   └─> Resolve policies de cada role
   └─> Avalia deny rules primeiro (explicit deny wins)
   └─> Avalia allow rules
   └─> Verifica conditions (MFA, business hours, etc.)

3. RESPONSE
   └─> 200 OK
       {
         "allowed": true,
         "reason": "granted_by_policy_tech_v1",
         "scopeMatched": "customer:customer-campinas"
       }
```

---

## 7. Padrões e Convenções

### Nomenclatura

| Tipo | Padrão | Exemplo |
|------|--------|---------|
| Arquivos | camelCase | `CustomerService.ts` |
| Classes | PascalCase | `CustomerService` |
| Interfaces | PascalCase com I | `ICustomerRepository` |
| Funções | camelCase | `findByTenantId()` |
| Constantes | SCREAMING_SNAKE | `DEFAULT_PAGE_SIZE` |
| Tipos/Enums | PascalCase | `CustomerType` |

### Estrutura de Arquivo

```typescript
// 1. Imports externos
import { db } from '../infrastructure/database/drizzle/db';
import { customers } from '../infrastructure/database/drizzle/schema';
import { z } from 'zod';

// 2. Imports internos
import { Customer } from '../domain/entities/Customer';
import type { ICustomerRepository } from './interfaces/ICustomerRepository';

// 3. Tipos/Interfaces locais
interface ServiceConfig {
  connectionString: string;
}

// 4. Constantes
const DEFAULT_PAGE_SIZE = 50;

// 5. Classe/Função principal
export class CustomerService {
  // ...
}

// 6. Factory functions (opcional)
export function createCustomerService(): CustomerService {
  return new CustomerService();
}
```

### Error Handling

```typescript
// Use classes de erro customizadas
import { AppError, NotFoundError, ValidationError } from '../shared/errors';

// Em vez de throw new Error()
throw new NotFoundError('Customer', customerId);
throw new ValidationError('Parent customer not found');
throw new AppError('FORBIDDEN', 403, 'Insufficient permissions');
```

### Validação com Zod

```typescript
// Sempre valide input nos handlers
const schema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
});

const result = schema.safeParse(body);
if (!result.success) {
  throw new ValidationError(result.error.message);
}
```

---

## 8. Desenvolvimento Local

### Comandos Úteis

```bash
# Desenvolvimento
npm run dev                  # Inicia servidor com hot reload (tsx watch)
npm run build                # Compila TypeScript
npm start                    # Executa código compilado

# Docker
docker compose up -d         # Inicia todos os serviços em background
docker compose down          # Para todos os serviços
docker compose logs -f       # Visualiza logs em tempo real
docker compose logs -f api   # Logs apenas da API
docker compose ps            # Status dos containers
docker compose restart api   # Reinicia apenas a API

# Build Docker
npm run docker:build         # Constrói imagem Docker
npm run docker:up            # docker compose up -d

# Database (Seeds e Admin)
npm run db:seed              # Popula banco com dados de teste
npm run db:seed:clear        # Limpa todos os dados
npm run db:seed:verify       # Verifica dados persistidos
npm run db:seed:list         # Lista scripts disponíveis
npm run db:seed:menu         # Menu interativo

# Qualidade
npm run lint                 # Verifica código com ESLint
npm run lint:fix             # Corrige problemas automaticamente
npm run typecheck            # Verifica tipos TypeScript
npm run quality              # Lint + testes com cobertura

# Testes
npm test                     # Roda todos os testes
npm run test:watch           # Modo watch
npm run test:coverage        # Com cobertura
npm run test:unit            # Apenas testes unitários
npm run test:integration     # Apenas testes de integração
```

### Workflow de Desenvolvimento

```bash
# 1. Crie uma branch
git checkout -b feature/minha-feature

# 2. Faça suas alterações
# ...

# 3. Verifique qualidade
npm run lint
npm run typecheck
npm test

# 4. Commit
git add .
git commit -m "feat: descrição da feature"

# 5. Push e PR
git push origin feature/minha-feature
```

### Testando a API Localmente

```bash
# Inicie os serviços com Docker
docker compose up -d

# Ou inicie apenas a API localmente (requer PostgreSQL)
npm run dev

# Health check
curl http://localhost:3015/health
# Resposta: {"status":"ok"}

# Health check com banco de dados
curl http://localhost:3015/health/ready
# Resposta: {"status":"ready"}

# Listar customers (requer autenticação)
curl http://localhost:3015/customers \
  -H "x-tenant-id: tenant-123" \
  -H "Authorization: Bearer <seu-jwt-token>"

# Criar customer (requer autenticação)
curl -X POST http://localhost:3015/customers \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-123" \
  -H "Authorization: Bearer <seu-jwt-token>" \
  -d '{
    "name": "Empresa ABC",
    "type": "COMPANY"
  }'

# Buscar filhos de um customer
curl http://localhost:3015/customers/customer-123/children \
  -H "x-tenant-id: tenant-123" \
  -H "Authorization: Bearer <seu-jwt-token>"

# Buscar árvore completa
curl http://localhost:3015/customers/customer-123/tree \
  -H "x-tenant-id: tenant-123" \
  -H "Authorization: Bearer <seu-jwt-token>"
```

> **Nota**: As URLs não possuem mais o prefixo `/dev/` como na arquitetura serverless anterior.

### Database Admin UI

Uma interface web está disponível para gerenciar o banco de dados:

```
http://localhost:3015/admin/db
```

**Autenticação:** Requer senha de admin (modal na primeira vez).

| Variável | Default | Descrição |
|----------|---------|-----------|
| `DB_ADMIN_PASSWORD` | `myio2026` | Senha para acesso ao Admin DB |

**Funcionalidades:**

| Aba | Descrição |
|-----|-----------|
| **Dashboard** | Estatísticas do banco (table counts, users by status, customers by type, devices by status) |
| **Scripts** | Executa seed scripts individualmente ou todos de uma vez |
| **Logs** | Visualiza histórico de execuções com filtros |
| **Query Console** | Executa queries SQL ad-hoc com exemplos prontos |

**Ações rápidas:**
- **Run All Seeds**: Executa todos os scripts de seed em ordem
- **Clear All**: Limpa todos os dados (com confirmação)
- **Quick Reset**: Clear + Seed em um clique
- **Verify**: Valida contagem de registros
- **Refresh Stats**: Atualiza estatísticas do Dashboard (auto-refresh após operações)

### Alarm Simulator (Premium)

Uma interface completa para testar regras de alarme sem afetar produção:

```
http://localhost:3015/admin/simulator
```

**Quick Start:** Clique no botão **🚀 DEMO** para criar automaticamente um ambiente de teste completo com tenant, customer, devices e regras de alarme.

Para documentação completa, veja: [SIMULATOR-MANUAL.md](./SIMULATOR-MANUAL.md)

Para mais detalhes, veja: [RFC-0006-Database-Seed-Scripts.md](./RFC-0006-Database-Seed-Scripts.md) e [RFC-0007-Database-Admin-UI.md](./RFC-0007-Database-Admin-UI.md)

### Debug com VS Code

Crie `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API (Express)",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "console": "integratedTerminal",
      "envFile": "${workspaceFolder}/.env"
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["test", "--", "--runInBand", "${relativeFile}"],
      "console": "integratedTerminal"
    },
    {
      "name": "Attach to Docker",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "restart": true,
      "localRoot": "${workspaceFolder}",
      "remoteRoot": "/app"
    }
  ]
}
```

---

## 9. Testes

### Estrutura de Testes

```
tests/
├── unit/                    # Testes unitários
│   └── services/
│       └── CustomerService.test.ts
│
├── integration/             # Testes de integração
│   └── api/
│       └── customers.test.ts
│
└── helpers/
    └── setup.ts             # Setup global de testes
```

### Escrevendo Testes Unitários

```typescript
// tests/unit/services/CustomerService.test.ts
import { CustomerService } from '../../../src/services/CustomerService';

describe('CustomerService', () => {
  let service: CustomerService;
  let mockRepository: jest.Mocked<ICustomerRepository>;

  beforeEach(() => {
    mockRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      findChildren: jest.fn(),
    };
    service = new CustomerService(mockRepository);
  });

  describe('createCustomer', () => {
    it('should create root customer when no parent', async () => {
      mockRepository.create.mockResolvedValue(mockCustomer);

      const result = await service.createCustomer({
        tenantId: 'tenant-1',
        name: 'Root Customer',
        type: 'HOLDING',
      });

      expect(result.depth).toBe(0);
      expect(result.path).toContain('/tenant-1/');
    });

    it('should throw when parent not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(
        service.createCustomer({
          tenantId: 'tenant-1',
          name: 'Child',
          type: 'BRANCH',
          parentCustomerId: 'invalid-id',
        })
      ).rejects.toThrow('Parent customer not found');
    });
  });
});
```

### Rodando Testes Específicos

```bash
# Arquivo específico
npm test -- tests/unit/services/CustomerService.test.ts

# Por nome
npm test -- -t "CustomerService"

# Watch mode para um arquivo
npm run test:watch -- tests/unit/services/CustomerService.test.ts

# Com cobertura
npm run test:coverage
```

---

## 10. Tarefas Comuns

### Adicionar Novo Endpoint

1. **Crie ou edite o controller** em `src/controllers/{domain}.controller.ts`:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess, sendCreated } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

// GET /domain
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    // Sua lógica aqui
    const result = await myService.list(tenantId);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /domain
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = MySchema.parse(req.body);
    const result = await myService.create(tenantId, data, userId);
    sendCreated(res, result, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
```

2. **Registre no app.ts**:

```typescript
import myController from './controllers/my.controller';

// Rotas protegidas (requerem autenticação)
app.use('/my-domain', authMiddleware, myController);
```

3. **Exporte no index** em `src/controllers/index.ts`:

```typescript
export { default as myController } from './my.controller';
```

4. **Crie testes** em `tests/unit/controllers/`

### Adicionar Nova Entidade

1. **Defina a entidade** em `src/domain/entities/`:

```typescript
export interface MyEntity {
  id: string;
  tenantId: string;
  // ...campos
}
```

2. **Crie os DTOs** em `src/dto/request/` e `src/dto/response/`

3. **Crie o repository** em `src/repositories/`:

```typescript
export class MyEntityRepository implements IMyEntityRepository {
  async findById(tenantId: string, id: string): Promise<MyEntity | null> {
    const result = await db.select()
      .from(myEntities)
      .where(and(
        eq(myEntities.tenantId, tenantId),
        eq(myEntities.id, id)
      ))
      .limit(1);
    return result[0] ?? null;
  }
}
```

4. **Crie o service** em `src/services/`

5. **Adicione a tabela** no schema Drizzle (`src/infrastructure/database/drizzle/schema.ts`):

```typescript
export const myEntities = pgTable('my_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantIdx: index('my_entities_tenant_idx').on(table.tenantId),
}));
```

### Adicionar Audit Log

Para registrar ações em uma nova entidade para compliance (RFC-0009):

1. **Importe o AuditLogService** no seu service:

```typescript
import { auditLogService } from './AuditLogService';
```

2. **Registre a ação após operação bem-sucedida**:

```typescript
// Após criar/atualizar/deletar a entidade
await auditLogService.log({
  tenantId,
  userId,
  action: 'CREATE', // ou 'UPDATE', 'DELETE'
  resourceType: 'my_entity',
  resourceId: entity.id,
  changes: { /* campos alterados */ },
  ip: requestIp,
});
```

> **Nota**: O sistema de eventos externo (AWS EventBridge) foi removido. O GCDR agora usa apenas audit logs locais no PostgreSQL para rastreabilidade e compliance.

---

## 11. Troubleshooting

### Erro: "Cannot find module"

**Causa**: Módulo não compilado ou path errado.

**Solução**:
```bash
npm run build
# ou verifique os paths no tsconfig.json
```

### Erro: "Validation error" no PostgreSQL

**Causa**: Dados nao passaram na validacao do schema (Zod ou constraints do banco).

**Solucao**: Verifique se `tenantId` e `id` estao presentes e se os campos obrigatorios foram preenchidos.

### Container não inicia / Porta em uso

**Causa**: Porta já em uso por outro processo ou container.

**Solução**:
```bash
# Verificar o que está usando a porta
# Windows:
netstat -ano | findstr :3015
taskkill /PID <pid> /F

# Linux/Mac:
lsof -i :3015
kill -9 <pid>

# Ou verificar containers Docker
docker ps -a
docker stop <container-id>

# Reiniciar os containers
docker compose down
docker compose up -d
```

### Erro de conexão com PostgreSQL

**Causa**: Container do PostgreSQL não iniciou ou porta incorreta.

**Solução**:
```bash
# Verificar se o container está rodando
docker compose ps

# Ver logs do PostgreSQL
docker compose logs postgres

# Verificar se a porta está correta no .env
# POSTGRES_PORT=5433

# Testar conexão
docker compose exec postgres psql -U postgres -d db_gcdr -c "SELECT 1"
```

### API não conecta ao banco dentro do Docker

**Causa**: URL de conexão incorreta.

**Solução**:
```bash
# Dentro do Docker, use o nome do serviço (postgres), não localhost
# DATABASE_URL=postgresql://postgres:password@postgres:5432/db_gcdr

# Fora do Docker (desenvolvimento local), use localhost com a porta exposta
# DATABASE_URL=postgresql://postgres:password@localhost:5433/db_gcdr
```

### Testes falhando com timeout

**Causa**: Mock não configurado corretamente.

**Solução**: Verifique se todos os métodos do repository estão mockados:
```typescript
mockRepository.findById = jest.fn().mockResolvedValue(null);
```

### Deploy falha com permissão

**Causa**: Credenciais AWS inválidas ou sem permissão.

**Solução**:
```bash
# Verificar credenciais
aws sts get-caller-identity

# Reconfigurar se necessário
aws configure
```

### TypeScript não reconhece tipos

```bash
# Limpar e rebuildar
rm -rf dist/
npm run build

# Reiniciar TS Server no VS Code
Cmd/Ctrl + Shift + P → "TypeScript: Restart TS Server"
```

---

## 12. Recursos Úteis

### Documentação Interna

- [RFC-0001: GCDR Core & Marketplace](./RFC-0001-GCDR-MYIO-Integration-Marketplace.md) - Especificação completa
- [RFC-0002: Authorization Model](./RFC-0002-GCDR-Authorization-Model.md) - Modelo de autorização
- [RFC-0003: JWT Multiple Audience](./RFC-0003-Refactoring-Multiple-Audience.md) - Autenticação entre serviços
- [RFC-0004: Migration DynamoDB to PostgreSQL](./RFC-0004-Migration-DynamoDB-to-Postgres.md) - Migração de banco de dados
- [RFC-0005: Container Deployment](./RFC-0005-Container-Deployment-Migration.md) - Migração para containers Docker
- [RFC-0009: Events Audit Logs](./RFC-0009-Events-Audit-Logs.md) - Sistema de auditoria e logs de eventos
- [RFC-0010: Premium Alarm Simulator](./RFC-0010-Premium-Alarm-Simulator.md) - Especificação do simulador
- [RFC-0011: User Registration Workflow](./RFC-0011-User-Registration-Approval-Workflow.md) - Auto-cadastro e aprovação de usuários
- [RULE-ENTITY: Rules Engine](./RULE-ENTITY.md) - Documentação do motor de regras
- [RFC-0015: Alarm Bundle Version History](./RFC-0015-Alarm-Bundle-Version-History.md) - Versionamento de bundles
- [RFC-0016: ThingsBoard Entity Mapping](./RFC-0016-ThingsBoard-Entity-Mapping.md) - Mapeamento de entidades ThingsBoard
- [SIMULATOR-MANUAL: Manual do Simulador](./SIMULATOR-MANUAL.md) - Guia de uso do simulador de alarmes
- [NODE-RED Alarm Bundle Integration](./NODE-RED-Alarm-Bundle-Integration.md) - Integração Node-RED com bundles

### Documentação Externa

| Recurso | Link |
|---------|------|
| TypeScript | https://www.typescriptlang.org/docs/ |
| Express.js | https://expressjs.com/ |
| Docker | https://docs.docker.com/ |
| Docker Compose | https://docs.docker.com/compose/ |
| PostgreSQL | https://www.postgresql.org/docs/ |
| Zod | https://zod.dev/ |
| Jest | https://jestjs.io/docs/getting-started |
| Dokploy | https://dokploy.com/docs |

### Ferramentas Recomendadas

**VS Code Extensions**:
- ESLint
- Prettier
- Error Lens
- GitLens
- Thunder Client (para testar API)
- Docker
- PostgreSQL (cweijan.vscode-postgresql-client2)

**CLI Tools**:
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [DBeaver](https://dbeaver.io/) - GUI para PostgreSQL
- [pgAdmin](https://www.pgadmin.org/) - Alternativa para PostgreSQL

### Contatos

Se tiver dúvidas, procure:
- **Tech Lead**: Rodrigo Lago - rodrigo@myio.com.br
- **Dev Team**: #dev (Slack)

---

## Checklist de Onboarding

Use este checklist para acompanhar seu progresso:

- [ ] Docker instalado e funcionando (`docker --version`)
- [ ] Ambiente configurado e rodando (`docker compose up -d`)
- [ ] Health check funcionando (`curl http://localhost:3015/health`)
- [ ] Executou `npm test` com sucesso
- [ ] Testou API local com curl ou Thunder Client
- [ ] Entendeu a arquitetura de alto nível (containers + Express)
- [ ] Explorou a estrutura de diretórios (`src/controllers/`, `src/middleware/`)
- [ ] Leu sobre Customer Hierarchy (RFC-0001)
- [ ] Leu sobre Authorization Model (RFC-0002)
- [ ] Leu sobre Container Deployment (RFC-0005)
- [ ] Entendeu o fluxo de dados
- [ ] Fez uma alteração simples e testou
- [ ] Criou um teste unitário
- [ ] Abriu um PR (mesmo que pequeno)

**Bem-vindo ao time!**

---

## Changelog

### 2026-02-22

**ExternalId lookup endpoints (ThingsBoard integration)**
- `GET /customers/external/:externalId` — busca customer por TB UUID com enrichment opcional
  - `?deep=1` inclui assets e devices (assets sem devices são filtrados automaticamente)
  - `?allRules=1` anexa `ruleIds` a cada device e retorna dict `rules` com meta (DEVICE+ASSET+CUSTOMER scope)
  - `?filterOnlyDevicesWithRules=1` exclui devices sem rules aplicáveis
- `GET /devices/external/:externalId` — busca device por TB UUID com asset, customer e rules DEVICE-scoped
- `GET /customers/:customerId/devices` — lista devices de um customer
- Coluna `external_id` adicionada à tabela `customers` (migration `0006_melodic_satana.sql`)
- RFC-0017 criado documentando os endpoints

**Rules: suporte a múltiplos devices por rule (`scope_entity_ids`)**
- Nova coluna `scope_entity_ids uuid[]` na tabela `rules` (migration `0007_graceful_firelord.sql`)
- `RuleScope.entityIds?: string[]` adicionado à entidade TypeScript
- `RuleRepository.getByScope` agora faz match em `scope_entity_id = X OR scope_entity_ids @> ARRAY[X]`
- Check constraint `valid_scope_entity` atualizado para aceitar `scope_entity_ids` como alternativa
- Permite mapear uma única rule a N devices sem replicar o registro

**Scripts operacionais (scripts/db/ops/)**
- `moxuara-asset-central-setup.sql` — cria asset `Central_Asset_Moxuara`
- `moxuara-central-insert.sql` — insere central `SCMXGATEWAY01` (GATEWAY) para Moxuara
- `moxuara-elevator-rules.sql` — referência para mapear devices elevador via `scope_entity_ids`

**OpenAPI / Swagger**
- Novos endpoints: `/customers/external/{externalId}`, `/devices/external/{externalId}`, `/customers/{customerId}/devices`
- `RuleScope` atualizado com campo `entityIds` (array de UUIDs)

### 2026-02-20

**Decision Engine Guard Configs**
- Adicionados guard configs ao `AlarmThresholdConfig`: `dedup`, `cooldown`, `hysteresisGuard`, `digest`
- Interfaces TypeScript e schemas Zod sincronizados
- Todas as seed rules Dimension atualizadas com guard defaults por prioridade
- Campos sincronizados no Zod: `offset`, `startAt`, `endAt`, `daysOfWeek`, `channelId`, `keyMulti`

**Device Lookup por centralId + slaveId**
- `GET /devices` agora aceita filtros `centralId` e `slaveId` na query string
- Permite ao alarms-backend resolver o device UUID e `deviceName` a partir do Modbus address
- Repository e controller atualizados

**Paginação com total e totalPages**
- Todos os 27 endpoints paginados agora retornam `total` e `totalPages` no objeto `pagination`
- Helper `countWhere()` criado para queries de contagem reutilizáveis

**OpenAPI Spec atualizada**
- Schemas de Rule completamente reescritos (antes: `config` genérico, `priority` integer)
- Agora: 4 configs tipados, priority enum, guard configs, UpdateRule, ToggleRule
- Novos query params documentados: `centralId`, `slaveId` em `GET /devices`

**Error Handler melhorado**
- Erros operacionais (4xx) agora logam apenas `[401] UNAUTHORIZED: mensagem` em vez de stack trace completo
- Erros inesperados (5xx) mantêm stack trace para debugging
- Reduz ruído nos logs do DokPloy

### 2026-02-11

**Remoção do EventService (AWS EventBridge)**
- O sistema de eventos externo (AWS EventBridge) foi completamente removido
- O GCDR não envia mais eventos para sistemas externos via EventBridge
- Audit logs locais (RFC-0009) continuam funcionando no PostgreSQL
- Arquivos removidos: `src/infrastructure/events/EventService.ts`, `src/infrastructure/events/index.ts`
- 14 services foram atualizados para remover referências ao EventService

**Roles incluídas no Login**
- O login agora retorna corretamente as roles do usuário
- Roles são carregadas dinamicamente do `AuthorizationService.getUserRoleKeys()`
- Roles são incluídas tanto na resposta de login quanto no JWT token
- Formato das roles: `role:super-admin`, `role:viewer`, etc.
- Afeta: login, MFA verification, e token refresh
