# RFC-0006: Database Seed Scripts for Testing

- Feature Name: `database_seed_scripts`
- Start Date: 2026-01-23
- RFC PR: N/A
- Status: Implemented

## Summary

Implementar um sistema de scripts SQL para popular o banco de dados PostgreSQL com dados mock de teste, incluindo um script de limpeza total e uma ferramenta CLI para execução, monitoramento e verificação dos dados persistidos.

## Motivation

Com a migração do DynamoDB para PostgreSQL (RFC-0004), surge a necessidade de:

- Dados de teste consistentes para desenvolvimento local
- Validação das constraints e relacionamentos do schema
- Ambiente reproduzível para testes de integração
- Facilidade para resetar o banco durante desenvolvimento
- Verificação de que os CHECK constraints funcionam corretamente

## Guide-level Explanation

### O que foi implementado

1. **Scripts SQL de Seed** - Um script por tabela com dados mock realistas
2. **Script de Limpeza** - Trunca todas as tabelas respeitando FKs
3. **Script de Verificação** - Valida contagens e estruturas hierárquicas
4. **CLI Interativo** - Ferramenta para executar e monitorar os scripts

### Como usar

```bash
# Executar todos os seeds
npm run db:seed

# Limpar todos os dados
npm run db:seed:clear

# Verificar dados persistidos
npm run db:seed:verify

# Listar scripts disponíveis
npm run db:seed:list

# Menu interativo
npm run db:seed:menu
```

### Estrutura dos Dados Mock

Os dados seguem uma hierarquia realista de uma empresa fictícia "ACME Holdings":

```
ACME Holdings (Holding)
├── ACME Tech (Company)
│   ├── ACME Tech - SP (Branch)
│   └── ACME Tech - RJ (Branch)
└── ACME Industrial (Company)
```

## Reference-level Explanation

### Arquivos Criados

```
scripts/db/
├── seed-runner.ts          # CLI tool
└── seeds/
    ├── 00-clear-all.sql    # Limpa todas as tabelas
    ├── 01-customers.sql    # 5 customers (hierárquico)
    ├── 02-partners.sql     # 3 partners
    ├── 03-users.sql        # 6 users
    ├── 04-policies.sql     # 6 policies (RBAC)
    ├── 05-roles.sql        # 5 roles
    ├── 06-role-assignments.sql  # 6 assignments
    ├── 07-assets.sql       # 6 assets (hierárquico)
    ├── 08-devices.sql      # 7 devices
    ├── 09-rules.sql        # 9 rules (testa CHECK constraints)
    ├── 10-centrals.sql     # 3 centrals
    ├── 11-groups.sql       # 4 groups
    ├── 12-look-and-feels.sql    # 3 themes
    ├── 13-customer-api-keys.sql # 5 API keys
    ├── 14-integrations.sql      # 3 packages + 3 subscriptions
    └── 99-verify-all.sql   # Queries de verificação
```

### Convenção de Nomenclatura

- `00-*.sql` - Scripts de setup/cleanup (executados manualmente)
- `01-14-*.sql` - Scripts de seed (executados em ordem)
- `99-*.sql` - Scripts de verificação (executados manualmente)

### Estrutura dos Scripts SQL

Cada script usa blocos `DO $$` com variáveis para referenciar IDs fixos:

```sql
DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
BEGIN
    INSERT INTO tabela (id, tenant_id, ...) VALUES (...);
    RAISE NOTICE 'Inserted N records';
END $$;
```

### IDs Fixos por Entidade

| Entidade | Prefixo UUID | Exemplo |
|----------|--------------|---------|
| Tenant | `11111111-...` | `11111111-1111-1111-1111-111111111111` |
| Customers | `22222222-...` a `55555555-...` | Holding, Companies, Branches |
| Partners | `aaaa1111-...` | `aaaa1111-1111-1111-1111-111111111111` |
| Users | `bbbb1111-...` | `bbbb1111-1111-1111-1111-111111111111` |
| Policies | `cccc0001-...` | `cccc0001-0001-0001-0001-000000000001` |
| Roles | `dddd0001-...` | `dddd0001-0001-0001-0001-000000000001` |
| Assets | `ffff1111-...` | `ffff1111-1111-1111-1111-111111111111` |
| Devices | `11110001-...` | `11110001-0001-0001-0001-000000000001` |
| Rules | `aaaa0001-...` | `aaaa0001-0001-0001-0001-000000000001` |
| Groups | `eee00001-...` | `eee00001-0001-0001-0001-000000000001` |
| Look & Feels | `faf00001-...` | `faf00001-0001-0001-0001-000000000001` |
| API Keys | `cee00001-...` | `cee00001-0001-0001-0001-000000000001` |
| Packages | `abc00001-...` | `abc00001-0001-0001-0001-000000000001` |
| Subscriptions | `ddd00001-...` | `ddd00001-0001-0001-0001-000000000001` |

### CLI Tool (seed-runner.ts)

```typescript
// Comandos disponíveis
seed        // Executa todos os scripts de seed
clear       // Limpa todos os dados (com confirmação)
verify      // Verifica dados persistidos
list        // Lista scripts disponíveis
run <file>  // Executa um script específico
interactive // Menu interativo

// Opções
--dry-run   // Mostra o que seria executado
--verbose   // Mostra output SQL detalhado
```

### Execução via Docker

Os scripts são executados via `docker exec`:

```bash
docker exec -i gcdr-postgres psql -U postgres -d db_gcdr -v ON_ERROR_STOP=1
```

### Validação de CHECK Constraints

O script `09-rules.sql` testa todos os CHECK constraints da tabela `rules`:

| Tipo | Config Obrigatório |
|------|-------------------|
| ALARM_THRESHOLD | `alarm_config` |
| SLA | `sla_config` |
| ESCALATION | `escalation_config` |
| MAINTENANCE_WINDOW | `maintenance_config` |

### Scripts NPM Adicionados

```json
{
  "db:seed": "tsx scripts/db/seed-runner.ts seed",
  "db:seed:clear": "tsx scripts/db/seed-runner.ts clear",
  "db:seed:verify": "tsx scripts/db/seed-runner.ts verify",
  "db:seed:list": "tsx scripts/db/seed-runner.ts list",
  "db:seed:menu": "tsx scripts/db/seed-runner.ts interactive"
}
```

## Dados Mock por Tabela

| Tabela | Quantidade | Observações |
|--------|------------|-------------|
| customers | 5 | Hierarquia: 1 holding, 2 companies, 2 branches |
| partners | 3 | 1 active, 1 pending, 1 suspended |
| users | 6 | Admin, operadores, técnico, service account |
| policies | 6 | Permissões RBAC granulares |
| roles | 5 | super-admin, customer-admin, ops-manager, technician, viewer |
| role_assignments | 6 | Vínculos user-role-customer |
| assets | 6 | Hierarquia: building > floors > rooms > equipment |
| devices | 7 | Sensores, medidores, câmeras, controladores |
| rules | 9 | 4 alarm, 2 SLA, 1 escalation, 2 maintenance |
| centrals | 3 | NodeHub, gateway, edge controller |
| groups | 4 | User, device, asset, mixed |
| look_and_feels | 3 | Light default, custom, dark |
| customer_api_keys | 5 | 3 active, 1 expired, 1 revoked |
| integration_packages | 3 | 2 published, 1 draft |
| package_subscriptions | 3 | 2 active, 1 suspended |

## Drawbacks

- IDs fixos podem causar conflitos se usados em produção
- Scripts dependem do Docker estar rodando
- Ordem de execução é crítica devido às foreign keys

## Rationale and Alternatives

### Por que SQL puro

- Controle total sobre os dados inseridos
- Fácil de auditar e versionar
- Não depende de ORM ou biblioteca específica
- Pode ser executado diretamente no banco

### Alternativas Consideradas

- **Drizzle Seed**: Não suportado nativamente ainda
- **Faker.js com TypeScript**: Mais complexo, menos previsível
- **SQL dumps**: Menos legível, difícil manutenção

## Prior Art

- Rails db:seed pattern
- Django fixtures
- Laravel seeders
- Prisma seed scripts

## Future Improvements

- [ ] Adicionar script para audit_logs
- [ ] Suporte a diferentes "perfis" de dados (minimal, full, stress-test)
- [ ] Geração de dados aleatórios com Faker para testes de carga
- [ ] Integração com CI/CD para setup automático de ambiente de teste
