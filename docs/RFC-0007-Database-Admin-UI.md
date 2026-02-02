# RFC-0007: Database Admin UI for Development

- Feature Name: `database_admin_ui`
- Start Date: 2026-01-23
- RFC PR: N/A
- Status: Implemented

## Summary

Criar uma interface web simples para administração do banco de dados em ambiente de desenvolvimento, permitindo execução de seed scripts, visualização de logs e execução de queries SQL nativas com exemplos de uso.

## Motivation

A CLI atual (seed-runner.ts) funciona bem, mas apresenta limitações:

- Requer acesso ao terminal
- Logs são efêmeros (perdidos ao fechar terminal)
- Não permite queries ad-hoc sem conhecer psql
- Curva de aprendizado para novos desenvolvedores

Uma interface web simples resolve esses problemas e acelera o onboarding de desenvolvedores.

## Guide-level Explanation

### Funcionalidades Principais

1. **Dashboard (default tab)**
   - Estatísticas de todas as tabelas do banco
   - Breakdown de usuários por status (ACTIVE, PENDING, LOCKED, etc.)
   - Breakdown de customers por tipo (HOLDING, COMPANY, BRANCH)
   - Breakdown de devices por status
   - Quick actions para seed/clear/reset/verify
   - Auto-refresh após operações

2. **Painel de Seed Scripts**
   - Lista todos os scripts disponíveis
   - Botões para executar individual ou todos
   - Indicador de status (pending, running, success, error)
   - Botão de "Quick Reset" (clear + seed)

3. **Visualizador de Logs**
   - Log em tempo real da execução
   - Histórico de execuções anteriores
   - Filtro por tipo (info, success, error)
   - Exportar logs

4. **Query Console**
   - Editor SQL com syntax highlighting
   - Execução de queries SELECT (read-only por padrão)
   - Resultados em tabela formatada
   - Mini help com queries de exemplo

### Acesso

```
http://localhost:3015/admin/db
```

> **IMPORTANTE**: Esta interface é apenas para desenvolvimento local. Não deve ser exposta em produção.

## Reference-level Explanation

### Arquitetura

```
src/
├── routes/
│   └── admin/
│       └── db-admin.routes.ts    # Rotas da UI
├── services/
│   └── admin/
│       └── db-admin.service.ts   # Lógica de execução
└── views/
    └── admin/
        ├── db-admin.html         # Página principal
        ├── db-admin.css          # Estilos
        └── db-admin.js           # JavaScript client-side
```

### Rotas API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/admin/db` | Página principal da UI |
| GET | `/admin/db/api/stats` | Estatísticas do banco (table counts, breakdowns) |
| GET | `/admin/db/api/scripts` | Lista scripts disponíveis |
| POST | `/admin/db/api/scripts/:name/run` | Executa um script |
| POST | `/admin/db/api/seed-all` | Executa todos os seeds |
| POST | `/admin/db/api/clear` | Limpa todos os dados |
| POST | `/admin/db/api/verify` | Verifica dados |
| GET | `/admin/db/api/logs` | Histórico de logs |
| DELETE | `/admin/db/api/logs` | Limpar logs |
| POST | `/admin/db/api/query` | Executa query SQL |
| GET | `/admin/db/api/query/examples` | Queries de exemplo |

> **Nota**: Todas as rotas `/api/*` requerem header `X-Admin-Password` para autenticação.

### Interface Visual

```
┌─────────────────────────────────────────────────────────────────┐
│  GCDR Database Admin                         [ADMIN] [🌙/☀]    │
├─────────────────────────────────────────────────────────────────┤
│  [Dashboard] [Scripts] [Logs] [Query Console]                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ Seed Scripts ─────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  [▶ Run All]  [🗑 Clear All]  [🔄 Quick Reset]  [✓ Verify] │ │
│  │                                                             │ │
│  │  ┌────────────────────────────────────────────┬──────────┐ │ │
│  │  │ Script                                     │ Action   │ │ │
│  │  ├────────────────────────────────────────────┼──────────┤ │ │
│  │  │ 01-customers.sql (5.1 KB)                  │ [▶ Run]  │ │ │
│  │  │ 02-partners.sql (3.1 KB)                   │ [▶ Run]  │ │ │
│  │  │ 03-users.sql (5.2 KB)                      │ [▶ Run]  │ │ │
│  │  │ ...                                        │          │ │ │
│  │  └────────────────────────────────────────────┴──────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Execution Log ────────────────────────────────────────────┐ │
│  │ [2026-01-23 10:30:15] ✓ 01-customers.sql - Done (287ms)    │ │
│  │ [2026-01-23 10:30:15] ✓ 02-partners.sql - Done (210ms)     │ │
│  │ [2026-01-23 10:30:16] ✓ 03-users.sql - Done (267ms)        │ │
│  │ [2026-01-23 10:30:16] ℹ Inserted 6 users                   │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Query Console

```
┌─────────────────────────────────────────────────────────────────┐
│  Query Console                                    [? Examples]  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ SELECT * FROM customers ORDER BY path LIMIT 10;             ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│  [▶ Execute]  [🧹 Clear]                    ⚠ Read-only mode   │
├─────────────────────────────────────────────────────────────────┤
│  Results (5 rows, 12ms):                                        │
│  ┌──────────┬─────────────┬─────────┬───────┐                  │
│  │ id       │ name        │ type    │ depth │                  │
│  ├──────────┼─────────────┼─────────┼───────┤                  │
│  │ 222...   │ ACME Hold.. │ HOLDING │ 0     │                  │
│  │ 333...   │ ACME Tech   │ COMPANY │ 1     │                  │
│  │ ...      │ ...         │ ...     │ ...   │                  │
│  └──────────┴─────────────┴─────────┴───────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

### Queries de Exemplo

```sql
-- 1. Listar hierarquia de customers
SELECT
    REPEAT('  ', depth) || name as hierarchy,
    code, type, status
FROM customers
ORDER BY path;

-- 2. Devices por asset com status
SELECT
    a.name as asset,
    d.name as device,
    d.type,
    d.status,
    d.last_seen_at
FROM devices d
JOIN assets a ON d.asset_id = a.id
ORDER BY a.name, d.name;

-- 3. Regras ativas por tipo
SELECT
    type,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE enabled) as enabled
FROM rules
GROUP BY type
ORDER BY type;

-- 4. Usuários e seus roles
SELECT
    u.name as user_name,
    u.email,
    r.name as role,
    c.name as customer
FROM users u
JOIN role_assignments ra ON u.id = ra.user_id
JOIN roles r ON ra.role_id = r.id
JOIN customers c ON ra.customer_id = c.id
WHERE ra.status = 'active'
ORDER BY u.name;

-- 5. Resumo de dados por tabela
SELECT
    'customers' as table_name, COUNT(*) as count FROM customers
UNION ALL SELECT 'partners', COUNT(*) FROM partners
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'assets', COUNT(*) FROM assets
UNION ALL SELECT 'devices', COUNT(*) FROM devices
UNION ALL SELECT 'rules', COUNT(*) FROM rules
ORDER BY table_name;
```

### Segurança

1. **Ambiente**: Só habilitado quando `NODE_ENV !== 'production'`
2. **Queries**: Por padrão apenas SELECT (read-only)
3. **Rate Limit**: Máximo de 10 queries por minuto
4. **Timeout**: Queries limitadas a 5 segundos
5. **Logging**: Todas as queries são logadas

```typescript
// Middleware de proteção
const devOnlyMiddleware = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  next();
};
```

### Tecnologias

- **Backend**: Express routes existentes
- **Frontend**: HTML/CSS/JS vanilla (sem framework)
- **Estilo**: CSS simples inline ou arquivo único
- **Editor SQL**: textarea com highlight básico ou CodeMirror (opcional)

### Dependências

Nenhuma nova dependência necessária. Usa apenas:
- Express (já instalado)
- postgres.js (já instalado)

## Implementation Plan

### Fase 1 - Backend API ✅
- [x] Criar rotas em `/admin/db`
- [x] Implementar service de execução de scripts
- [x] Implementar service de query (read-only)
- [x] Adicionar logging persistente em memória

### Fase 2 - Frontend Básico ✅
- [x] Página HTML com lista de scripts
- [x] Botões de execução
- [x] Área de log com auto-scroll
- [x] Estilização básica (dark theme)

### Fase 3 - Query Console ✅
- [x] Editor de SQL
- [x] Exibição de resultados em tabela
- [x] Painel de exemplos
- [x] Validação read-only

### Fase 4 - Melhorias ✅
- [x] Syntax highlighting (CodeMirror via CDN)
- [x] Exportar resultados CSV
- [x] Histórico de queries (localStorage, últimas 20)
- [x] Temas (light/dark toggle com persistência)

### Fase 5 - Dashboard (Inspired by alarms-backend) ✅
- [x] Dashboard tab como default view
- [x] Endpoint `/api/stats` com contagem de tabelas
- [x] Breakdown de usuários por status
- [x] Breakdown de customers por tipo
- [x] Breakdown de devices por status
- [x] Auto-refresh stats após operações (seed, clear, verify)
- [x] Query safety: bloqueio de GRANT/REVOKE

## Drawbacks

- Adiciona código que só serve para desenvolvimento
- Potencial risco de segurança se exposto acidentalmente
- Manutenção adicional da UI

## Rationale and Alternatives

### Por que interface própria

- Controle total sobre funcionalidades
- Integração nativa com seed scripts existentes
- Sem dependências externas
- Customizada para o workflow do GCDR

### Alternativas Consideradas

| Alternativa | Prós | Contras |
|-------------|------|---------|
| pgAdmin | Completo, robusto | Pesado, setup separado |
| Drizzle Studio | Integrado com ORM | Limitado, beta |
| DBeaver | Profissional | Desktop, não web |
| Adminer | Leve, PHP | Requer PHP |

## Prior Art

- Rails ActiveAdmin
- Django Admin
- Laravel Telescope
- Prisma Studio

## Future Improvements

- [ ] WebSocket para logs em tempo real
- [ ] Salvar queries favoritas
- [ ] Visualização de schema (ERD)
- [ ] Diff de dados entre execuções
- [ ] Backup/restore de snapshots
