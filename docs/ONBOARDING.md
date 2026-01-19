# Manual de Onboarding - GCDR (Global Central Data Registry)

Bem-vindo ao time! Este manual vai te ajudar a entender e começar a contribuir com o projeto GCDR.

## Sumário

1. [Visão Geral do Projeto](#1-visão-geral-do-projeto)
2. [Configuração do Ambiente](#2-configuração-do-ambiente)
3. [Arquitetura do Sistema](#3-arquitetura-do-sistema)
4. [Estrutura do Código](#4-estrutura-do-código)
5. [Fluxo de Dados](#5-fluxo-de-dados)
6. [Padrões e Convenções](#6-padrões-e-convenções)
7. [Desenvolvimento Local](#7-desenvolvimento-local)
8. [Testes](#8-testes)
9. [Tarefas Comuns](#9-tarefas-comuns)
10. [Troubleshooting](#10-troubleshooting)
11. [Recursos Úteis](#11-recursos-úteis)

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

---

## 2. Configuração do Ambiente

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

## 3. Arquitetura do Sistema

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

## 4. Estrutura do Código

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

## 5. Fluxo de Dados

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

## 6. Padrões e Convenções

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

## 7. Desenvolvimento Local

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

## 8. Testes

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

## 9. Tarefas Comuns

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

## 10. Troubleshooting

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

## 11. Recursos Úteis

### Documentação Interna

- [RFC-0001: GCDR Core & Marketplace](./RFC-0001-GCDR-MYIO-Integration-Marketplace.md) - Especificação completa
- [RFC-0002: Authorization Model](./RFC-0002-GCDR-Authorization-Model.md) - Modelo de autorização

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
