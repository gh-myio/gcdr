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
4. **Emite Eventos** para sincronização com outros sistemas

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
| **Development** | `https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev` | Desenvolvimento e testes |
| **Staging** | `https://api.gcdr.io/staging` | Homologação (em breve) |
| **Production** | `https://api.gcdr.io` | Produção (em breve) |

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
- **Swagger UI (online)**: [`/docs`](https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/docs)
- **OpenAPI JSON**: [`/docs/openapi.json`](https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/docs/openapi.json)
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
| **Devices** | 9 | Dispositivos IoT com conectividade |
| **Rules** | 10 | Regras de negócio (ALARM, SLA, ESCALATION, MAINTENANCE) |
| **Integrations** | 12 | Marketplace de integrações |
| **Centrals** | 10 | Centrais IoT (NODEHUB, GATEWAY, EDGE_CONTROLLER) |
| **Themes** | 10 | Look and Feel (cores, logos, CSS customizado) |
| **Users** | 18 | Usuários, gerenciamento, MFA |
| **Groups** | 12 | Grupos de usuários, dispositivos e assets com hierarquia |

### Exemplos de Requisições

#### Health Check
```bash
curl https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/health
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
curl https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/customers \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>"
```

#### Criar Customer
```bash
curl -X POST https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/customers \
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
curl https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/customers/{id}/tree \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>"
```

#### Listar Assets de um Customer
```bash
curl https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/customers/{id}/assets \
  -H "x-tenant-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <token>"
```

#### Obter Tema Efetivo (com herança)
```bash
curl https://9gc49yiru7.execute-api.sa-east-1.amazonaws.com/dev/customers/{id}/theme/effective \
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
  "data": [ ... ],
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-21T00:00:00.000Z",
    "pagination": {
      "limit": 20,
      "cursor": "eyJpZCI6Ijk5OSJ9",
      "hasMore": true
    }
  }
}
```

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
  "roles": ["admin", "operator"],
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
| `roles` | Array de roles atribuídas |
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
- `rules:read` - Leitura de regras
- `assets:read` - Leitura de assets
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
| **Forgot Password** | Implementado | `POST /auth/password/forgot` |
| **Reset Password** | Implementado | `POST /auth/password/reset` |

### Endpoints de Autenticacao

```
POST /auth/login              -> Autentica usuario e emite JWT
POST /auth/refresh            -> Renova token expirado
POST /auth/logout             -> Invalida token
POST /auth/mfa/verify         -> Verifica codigo MFA
POST /auth/password/forgot    -> Solicita reset de senha
POST /auth/password/reset     -> Reseta senha com token
```

### Exemplos de Uso

#### Login Simples
```bash
curl -X POST https://api.gcdr.io/dev/auth/login \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-uuid" \
  -d '{
    "email": "usuario@empresa.com",
    "password": "senha123"
  }'
```

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
    "roles": ["admin"]
  }
}
```

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
| **AWS Lambda** | Execução serverless |
| **AWS DynamoDB** | Banco de dados NoSQL |
| **AWS EventBridge** | Eventos entre sistemas |
| **Serverless Framework** | Deploy e IaC |
| **Zod** | Validação de schemas |
| **Jest** | Framework de testes |
| **npm** | Gerenciador de pacotes |

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

# 3. Verifique se tudo está funcionando
npm test
```

### Configuração do AWS CLI (para deploy)

```bash
# Configurar credenciais AWS
aws configure
# AWS Access Key ID: [sua-key]
# AWS Secret Access Key: [sua-secret]
# Default region name: sa-east-1
# Default output format: json
```

### Verificação da Instalação

```bash
# Compilar TypeScript
npm run build

# Iniciar o servidor local (Serverless Offline)
npm run offline

# Em outro terminal, teste a API
curl http://localhost:3000/dev/health
# Deve retornar: {"status":"healthy",...}
```

---

## 4. Arquitetura do Sistema

### Diagrama de Alto Nível

```
                    ┌─────────────────────────────────────────────────────────────────┐
                    │                         GCDR API                                 │
                    │                    (AWS Lambda + API Gateway)                    │
                    │                                                                  │
                    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
                    │  │   Customers  │  │   Partners   │  │Authorization │           │
                    │  │   Handlers   │  │   Handlers   │  │   Handlers   │           │
                    │  │              │  │              │  │              │           │
                    │  │ - create     │  │ - register   │  │ - check      │           │
                    │  │ - get        │  │ - approve    │  │ - assignRole │           │
                    │  │ - update     │  │ - reject     │  │ - listRoles  │           │
                    │  │ - delete     │  │ - list       │  │ - getUserRoles│          │
                    │  │ - list       │  │ - get        │  │              │           │
                    │  │ - getChildren│  │              │  │              │           │
                    │  │ - getTree    │  │              │  │              │           │
                    │  │ - move       │  │              │  │              │           │
                    │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
                    │         │                 │                 │                    │
                    │         └─────────────────┼─────────────────┘                    │
                    │                           │                                      │
                    │                    ┌──────▼───────┐                              │
                    │                    │   Services   │                              │
                    │                    │              │                              │
                    │                    │ Customer     │                              │
                    │                    │ Partner      │                              │
                    │                    └──────┬───────┘                              │
                    │                           │                                      │
                    │                    ┌──────▼───────┐                              │
                    │                    │ Repositories │                              │
                    │                    │              │                              │
                    │                    │ Customer     │                              │
                    │                    │ Partner      │                              │
                    │                    └──────┬───────┘                              │
                    │                           │                                      │
                    └───────────────────────────┼──────────────────────────────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
           ┌────────▼────────┐        ┌────────▼────────┐        ┌────────▼────────┐
           │    DynamoDB     │        │   EventBridge   │        │   External      │
           │                 │        │                 │        │   Systems       │
           │ - Customers     │        │ - gcdr-events   │        │                 │
           │ - Partners      │        │                 │        │ - ThingsBoard   │
           │ - Roles         │        │ Events:         │        │ - NodeHub       │
           │ - Policies      │        │ - customer.*    │        │ - OS            │
           │ - RoleAssign.   │        │ - partner.*     │        │ - Alarmes       │
           │                 │        │ - authz.*       │        │                 │
           └─────────────────┘        └─────────────────┘        └─────────────────┘
```

### Componentes Principais

| Componente | Responsabilidade |
|------------|------------------|
| **Handlers** | Recebem requests HTTP, validam input, chamam services |
| **Services** | Lógica de negócio, orquestração entre repositories |
| **Repositories** | Acesso a dados no DynamoDB |
| **DTOs** | Validação de entrada/saída com Zod |
| **Middleware** | Error handling, request context, response formatting |
| **Events** | Publicação no EventBridge para outros sistemas |

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
├── handlers/             # Lambda handlers (entry points)
│   ├── health.ts         # Health check
│   ├── customers/        # CRUD + hierarquia de customers
│   │   ├── create.ts
│   │   ├── get.ts
│   │   ├── update.ts
│   │   ├── delete.ts
│   │   ├── list.ts
│   │   ├── getChildren.ts
│   │   ├── getDescendants.ts
│   │   ├── getTree.ts
│   │   └── move.ts
│   ├── partners/         # Workflow de parceiros
│   │   ├── register.ts
│   │   ├── approve.ts
│   │   ├── reject.ts
│   │   ├── get.ts
│   │   └── list.ts
│   ├── authorization/    # Controle de acesso
│   │   ├── check.ts
│   │   ├── assignRole.ts
│   │   ├── listRoles.ts
│   │   └── getUserRoles.ts
│   └── middleware/       # Middlewares compartilhados
│       ├── errorHandler.ts
│       ├── requestContext.ts
│       └── response.ts
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
├── infrastructure/       # Infraestrutura técnica
│   ├── database/
│   │   └── dynamoClient.ts
│   └── events/
│       └── EventService.ts
│
└── shared/               # Código compartilhado
    ├── config/
    │   └── Config.ts
    ├── errors/
    │   └── AppError.ts
    ├── events/
    │   └── eventTypes.ts
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

#### `handlers/` - Entry Points

Cada handler é uma Lambda function:

```typescript
export const handler: APIGatewayProxyHandler = async (event) => {
  // 1. Parse e valida input
  // 2. Chama service
  // 3. Retorna response formatada
};
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

Encapsula operações no DynamoDB:

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
   └─> Monta item DynamoDB
   └─> PutItem na tabela gcdr-customers-{stage}

5. EVENTOS (EventService.ts)
   └─> Publica evento "customer.created" no EventBridge
   └─> Outros sistemas recebem e sincronizam

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

4. EVENTOS
   └─> Publica "partner.approved" no EventBridge

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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { z } from 'zod';

// 2. Imports internos
import { Customer } from '../domain/entities/Customer';
import type { ICustomerRepository } from './interfaces/ICustomerRepository';

// 3. Tipos/Interfaces locais
interface ServiceConfig {
  tableName: string;
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
npm run offline              # Inicia API local (Serverless Offline)
npm run build                # Compila TypeScript

# Deploy
npm run deploy               # Deploy para dev
npm run deploy:prod          # Deploy para produção
npm run remove               # Remove stack do AWS

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
# Inicie o servidor
npm run offline

# Health check
curl http://localhost:3000/dev/health

# Listar customers
curl http://localhost:3000/dev/customers \
  -H "x-tenant-id: tenant-123"

# Criar customer
curl -X POST http://localhost:3000/dev/customers \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-123" \
  -d '{
    "name": "Empresa ABC",
    "type": "COMPANY"
  }'

# Buscar filhos de um customer
curl http://localhost:3000/dev/customers/customer-123/children \
  -H "x-tenant-id: tenant-123"

# Buscar árvore completa
curl http://localhost:3000/dev/customers/customer-123/tree \
  -H "x-tenant-id: tenant-123"
```

### Debug com VS Code

Crie `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Serverless Offline",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "offline"],
      "console": "integratedTerminal",
      "env": {
        "SLS_DEBUG": "*"
      }
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["test", "--", "--runInBand", "${relativeFile}"],
      "console": "integratedTerminal"
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

1. **Crie o handler** em `src/handlers/{domain}/{action}.ts`:

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { success, error } from '../middleware/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Sua lógica aqui
    return success({ data: result });
  } catch (err) {
    return error(err);
  }
};
```

2. **Registre no serverless.yml**:

```yaml
functions:
  myNewEndpoint:
    handler: src/handlers/domain/myAction.handler
    events:
      - http:
          path: /my-path
          method: post
          cors: true
```

3. **Crie testes** em `tests/unit/handlers/`

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
    // implementação DynamoDB
  }
}
```

4. **Crie o service** em `src/services/`

5. **Adicione a tabela** no `serverless.yml`:

```yaml
resources:
  Resources:
    MyEntityTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: gcdr-my-entity-${self:provider.stage}
        # ...schema
```

### Adicionar Evento

1. **Defina o tipo** em `src/shared/events/eventTypes.ts`:

```typescript
export interface MyEntityCreatedEvent {
  source: 'gcdr';
  detailType: 'myentity.created';
  detail: {
    id: string;
    tenantId: string;
    // ...
  };
}
```

2. **Emita no service**:

```typescript
await this.eventService.publish({
  source: 'gcdr',
  detailType: 'myentity.created',
  detail: { id: entity.id, tenantId: entity.tenantId },
});
```

---

## 11. Troubleshooting

### Erro: "Cannot find module"

**Causa**: Módulo não compilado ou path errado.

**Solução**:
```bash
npm run build
# ou verifique os paths no tsconfig.json
```

### Erro: "Validation error" no DynamoDB

**Causa**: Item não tem todas as chaves necessárias.

**Solução**: Verifique se `tenantId` e `id` estão presentes no item.

### Serverless Offline não inicia

**Causa**: Porta já em uso ou configuração inválida.

**Solução**:
```bash
# Matar processo na porta 3000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# Linux/Mac:
lsof -i :3000
kill -9 <pid>
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

### Documentação Externa

| Recurso | Link |
|---------|------|
| TypeScript | https://www.typescriptlang.org/docs/ |
| Serverless Framework | https://www.serverless.com/framework/docs |
| AWS SDK v3 | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/ |
| DynamoDB | https://docs.aws.amazon.com/dynamodb/ |
| EventBridge | https://docs.aws.amazon.com/eventbridge/ |
| Zod | https://zod.dev/ |
| Jest | https://jestjs.io/docs/getting-started |

### Ferramentas Recomendadas

**VS Code Extensions**:
- ESLint
- Prettier
- Error Lens
- GitLens
- Thunder Client (para testar API)
- AWS Toolkit

**CLI Tools**:
- [AWS CLI](https://aws.amazon.com/cli/)
- [NoSQL Workbench](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/workbench.html) - GUI para DynamoDB

### Contatos

Se tiver dúvidas, procure:
- **Tech Lead**: Rodrigo Lago - rodrigo@myio.com.br
- **Dev Team**: #dev (Slack)

---

## Checklist de Onboarding

Use este checklist para acompanhar seu progresso:

- [ ] Ambiente configurado e rodando (`npm run offline`)
- [ ] Executou `npm test` com sucesso
- [ ] Testou API local com curl ou Thunder Client
- [ ] Entendeu a arquitetura de alto nível
- [ ] Explorou a estrutura de diretórios
- [ ] Leu sobre Customer Hierarchy (RFC-0001)
- [ ] Leu sobre Authorization Model (RFC-0002)
- [ ] Entendeu o fluxo de dados
- [ ] Fez uma alteração simples e testou
- [ ] Criou um teste unitário
- [ ] Abriu um PR (mesmo que pequeno)

**Bem-vindo ao time!**
