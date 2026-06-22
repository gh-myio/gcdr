# API de Customers

Documentação dos endpoints para gerenciamento de Customers no GCDR.

## Visão Geral

Customers representam a hierarquia organizacional no GCDR: Holdings, Empresas, Filiais e Franquias.

## Autenticação

Todos os endpoints requerem autenticação via JWT Bearer Token.

### Headers Obrigatórios

| Header | Valor | Descrição |
|--------|-------|-----------|
| `Authorization` | `Bearer {token}` | Token JWT obtido via `/auth/login` |
| `X-Tenant-Id` | `uuid` | Identificador do tenant |
| `Content-Type` | `application/json` | Para requisições com body |

## Hierarquia de Customers

```
HOLDING (Grupo Empresarial)
  └── COMPANY (Empresa)
       ├── BRANCH (Filial)
       └── FRANCHISE (Franquia)
```

---

## Endpoints

### Criar Customer

```
POST /customers
```

#### Body

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `name` | string | Sim | Nome do customer (1-255 chars) |
| `displayName` | string | Não | Nome de exibição |
| `code` | string | Não | Código interno (1-50 chars) |
| `type` | enum | Sim | `HOLDING`, `COMPANY`, `BRANCH`, `FRANCHISE` |
| `parentCustomerId` | uuid \| null | Não | ID do customer pai |
| `email` | string | Não | Email de contato |
| `phone` | string | Não | Telefone |
| `address` | object | Não | Endereço completo |
| `settings` | object | Não | Configurações |
| `metadata` | object | Não | Dados customizados |

#### Objeto `address`

```json
{
  "street": "Rua das Flores, 123",
  "city": "São Paulo",
  "state": "SP",
  "country": "Brasil",
  "postalCode": "01234-567",
  "coordinates": {
    "lat": -23.5505,
    "lng": -46.6333
  }
}
```

#### Objeto `settings`

```json
{
  "timezone": "America/Sao_Paulo",
  "locale": "pt-BR",
  "currency": "BRL",
  "inheritFromParent": true
}
```

#### Exemplo - Requisição Mínima

```bash
curl -X POST "http://localhost:3015/customers" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -d '{
    "name": "Nova Empresa",
    "type": "COMPANY",
    "parentCustomerId": "22222222-2222-2222-2222-222222222222"
  }'
```

#### Exemplo - Requisição Completa

```bash
curl -X POST "http://localhost:3015/customers" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -d '{
    "name": "Empresa XYZ Ltda",
    "displayName": "XYZ",
    "code": "XYZ-001",
    "type": "COMPANY",
    "parentCustomerId": "22222222-2222-2222-2222-222222222222",
    "email": "contato@xyz.com.br",
    "phone": "+55 11 99999-0000",
    "address": {
      "street": "Rua das Flores, 123",
      "city": "São Paulo",
      "state": "SP",
      "country": "Brasil",
      "postalCode": "01234-567",
      "coordinates": {
        "lat": -23.5505,
        "lng": -46.6333
      }
    },
    "settings": {
      "timezone": "America/Sao_Paulo",
      "locale": "pt-BR",
      "currency": "BRL",
      "inheritFromParent": true
    },
    "metadata": {
      "cnpj": "12.345.678/0001-90",
      "segmento": "Tecnologia"
    }
  }'
```

#### Resposta (201 Created)

```json
{
  "success": true,
  "data": {
    "id": "uuid-do-novo-customer",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "name": "Empresa XYZ Ltda",
    "displayName": "XYZ",
    "code": "XYZ-001",
    "type": "COMPANY",
    "status": "ACTIVE",
    "parentCustomerId": "22222222-2222-2222-2222-222222222222",
    "path": "/22222222.../uuid-do-novo-customer",
    "depth": 1,
    "email": "contato@xyz.com.br",
    "phone": "+55 11 99999-0000",
    "address": { ... },
    "settings": { ... },
    "metadata": { ... },
    "createdAt": "2026-01-26T21:30:00.000Z",
    "updatedAt": "2026-01-26T21:30:00.000Z",
    "version": 1
  }
}
```

---

### Listar Customers

```
GET /customers
```

#### Query Parameters

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `limit` | number | Máximo de resultados (default: 20) |
| `cursor` | string | Cursor para paginação |
| `type` | enum | Filtrar por tipo |
| `status` | enum | `ACTIVE` ou `INACTIVE` |
| `parentCustomerId` | uuid \| null | Filtrar por pai (use `null` para raiz) |

#### Exemplo

```bash
curl -X GET "http://localhost:3015/customers?type=COMPANY&status=ACTIVE&limit=10" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111"
```

#### Resposta (200 OK)

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "hasMore": true,
    "nextCursor": "eyJpZCI6Ii..."
  }
}
```

---

### Obter Customer por ID

```
GET /customers/:id
```

#### Exemplo

```bash
curl -X GET "http://localhost:3015/customers/33333333-3333-3333-3333-333333333333" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111"
```

---

### Atualizar Customer

```
PUT /customers/:id
```

#### Body

Todos os campos são opcionais. Apenas os campos enviados serão atualizados.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `name` | string | Nome do customer |
| `displayName` | string | Nome de exibição |
| `code` | string | Código interno |
| `type` | enum | Tipo do customer |
| `email` | string \| null | Email de contato |
| `phone` | string \| null | Telefone |
| `address` | object \| null | Endereço |
| `settings` | object | Configurações |
| `theme` | object \| null | Tema visual |
| `metadata` | object | Dados customizados |
| `status` | enum | `ACTIVE` ou `INACTIVE` |

#### Objeto `theme`

```json
{
  "primaryColor": "#1976D2",
  "secondaryColor": "#424242",
  "logoUrl": "https://example.com/logo.png",
  "faviconUrl": "https://example.com/favicon.ico"
}
```

#### Exemplo

```bash
curl -X PUT "http://localhost:3015/customers/33333333-3333-3333-3333-333333333333" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -d '{
    "displayName": "ACME Tech Solutions",
    "email": "novo-email@acmetech.com",
    "metadata": {
      "cnpj": "12.345.678/0001-90",
      "atualizado": true
    }
  }'
```

---

### Deletar Customer

```
DELETE /customers/:id
```

#### Exemplo

```bash
curl -X DELETE "http://localhost:3015/customers/uuid-do-customer" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111"
```

#### Resposta (204 No Content)

Sem body na resposta.

---

### Obter Filhos Diretos

```
GET /customers/:id/children
```

Retorna apenas os filhos diretos (1 nível abaixo).

#### Exemplo

```bash
curl -X GET "http://localhost:3015/customers/22222222-2222-2222-2222-222222222222/children" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111"
```

#### Resposta

```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "...", "name": "ACME Tech", "type": "COMPANY", ... },
      { "id": "...", "name": "Beta Corp", "type": "COMPANY", ... }
    ],
    "count": 2
  }
}
```

---

### Obter Todos os Descendentes

```
GET /customers/:id/descendants
```

Retorna todos os descendentes (todos os níveis).

#### Query Parameters

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `maxDepth` | number | Profundidade máxima (opcional) |

#### Exemplo

```bash
curl -X GET "http://localhost:3015/customers/22222222-2222-2222-2222-222222222222/descendants?maxDepth=3" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111"
```

---

### Obter Árvore Hierárquica

```
GET /customers/:id/tree
```

Retorna a estrutura em árvore a partir do customer.

#### Exemplo

```bash
curl -X GET "http://localhost:3015/customers/22222222-2222-2222-2222-222222222222/tree" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111"
```

#### Resposta

```json
{
  "success": true,
  "data": {
    "tree": {
      "id": "22222222-2222-2222-2222-222222222222",
      "name": "MYIO Holding",
      "type": "HOLDING",
      "children": [
        {
          "id": "33333333-...",
          "name": "ACME Tech",
          "type": "COMPANY",
          "children": [
            { "id": "...", "name": "Filial SP", "type": "BRANCH", "children": [] }
          ]
        }
      ]
    }
  }
}
```

---

### Mover Customer

```
POST /customers/:id/move
```

Move o customer para um novo pai na hierarquia.

#### Body

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `newParentCustomerId` | uuid \| null | Sim | Novo pai (null = raiz) |

#### Exemplo

```bash
curl -X POST "http://localhost:3015/customers/33333333-3333-3333-3333-333333333333/move" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -d '{
    "newParentCustomerId": "44444444-4444-4444-4444-444444444444"
  }'
```

---

## Códigos de Erro

| Código | Descrição |
|--------|-----------|
| `400` | Bad Request - Dados inválidos |
| `401` | Unauthorized - Token inválido ou expirado |
| `404` | Not Found - Customer não encontrado |
| `409` | Conflict - Violação de constraint (ex: ciclo na hierarquia) |
| `500` | Internal Error - Erro interno |

---

## Dados de Teste (Ambiente Dev)

### Tenant

```
11111111-1111-1111-1111-111111111111
```

### Customers Pré-cadastrados

| ID | Nome | Tipo |
|----|------|------|
| `22222222-2222-2222-2222-222222222222` | MYIO Holding | HOLDING |
| `33333333-3333-3333-3333-333333333333` | ACME Tech | COMPANY |

### Credenciais de Login

```
Email: admin@gcdr.io
Password: Test123!
```

### Obter Token

```bash
curl -X POST "http://localhost:3015/auth/login" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" \
  -d '{"email": "admin@gcdr.io", "password": "Test123!"}'
```

---

**Última atualização**: 2026-01-26
