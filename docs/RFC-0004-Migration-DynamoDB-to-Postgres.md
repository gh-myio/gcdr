# RFC-0004: Migration from DynamoDB to PostgreSQL

- Feature Name: `migration_dynamodb_to_postgres`
- Start Date: 2026-01-20
- RFC PR: N/A
- Status: Implemented

## Summary

This RFC proposes migrating GCDR persistence from DynamoDB to PostgreSQL to improve relational querying, transactional consistency, and analytical flexibility. The change includes a phased migration with dual-write, backfill, and cutover, plus new schema definitions and operational changes.

## Motivation

The current DynamoDB model works for single-entity access patterns but is increasingly limiting for:

- Complex relational queries (hierarchies, joins, reporting).
- Multi-entity transactions and consistency requirements.
- Data validation and referential integrity.
- Evolving query needs without re-modeling access patterns.

PostgreSQL offers relational modeling, rich indexing, and transactional guarantees better aligned with GCDR's domain growth (customers, assets, devices, partners, policies).

## Guide-level Explanation

### What Changes for Developers

- Repositories and data access will use PostgreSQL instead of DynamoDB.
- Environment variables will include Postgres connection details.
- Data models will be normalized with foreign keys and indexes.

### What Changes for Operations

- A PostgreSQL database (RDS or Aurora) will be provisioned.
- Migrations will be managed with a schema migration tool.
- Monitoring will include DB health, query performance, and storage.

### Migration Approach (High Level)

1. Provision PostgreSQL and apply schema migrations.
2. Implement dual-write (DynamoDB + PostgreSQL).
3. Backfill historical data from DynamoDB to PostgreSQL.
4. Validate parity and switch reads to PostgreSQL.
5. Disable DynamoDB writes and decommission tables.

## Reference-level Explanation

### Data Modeling

The DynamoDB single-table design will be replaced with normalized tables. Example mappings:

- Customers -> customers table (id PK, tenant_id, parent_customer_id FK, path, depth).
- Assets -> assets table (id PK, customer_id FK, parent_asset_id FK, path).
- Devices -> devices table (id PK, asset_id FK, serial_number unique).
- Partners -> partners table (id PK, tenant_id, status, metadata).
- Roles/Policies/Assignments -> roles, policies, role_assignments.

Key indexes will be added to preserve existing access patterns:

- customers(tenant_id, parent_customer_id)
- customers(tenant_id, path)
- assets(tenant_id, customer_id)
- assets(tenant_id, parent_asset_id)
- devices(tenant_id, asset_id)

### Transactions and Consistency

PostgreSQL transactions will be used for multi-entity updates (e.g., move customer with path updates). This replaces DynamoDB conditional writes and manual consistency handling.

### Repository Layer Changes

- Replace DynamoDB SDK client usage with a PostgreSQL client and query builder/ORM.
- Migrate data access methods to SQL queries.
- Keep service layer APIs stable to minimize handler changes.

### Migration Phases

**Phase 0 - Preparation**
- Define schema and migrations.
- Create read/write adapter interface.
- Add PostgreSQL connection and health checks.

**Phase 1 - Dual Write**
- Write to DynamoDB and PostgreSQL in parallel.
- Keep reads on DynamoDB.
- Track write failures and parity metrics.

**Phase 2 - Backfill**
- Export DynamoDB tables.
- Transform and load into PostgreSQL.
- Validate counts, checksums, and sample entity comparisons.

**Phase 3 - Read Cutover**
- Switch reads to PostgreSQL behind a feature flag.
- Monitor errors and performance.
- Rollback plan: switch reads back to DynamoDB.

**Phase 4 - Write Cutover and Decommission**
- Disable DynamoDB writes.
- Remove dual-write code paths.
- Decommission DynamoDB tables after validation.

### Configuration

New environment variables (example):

```env
PGHOST=gcdr-postgres.cluster-xxxx.sa-east-1.rds.amazonaws.com
PGPORT=5432
PGDATABASE=gcdr
PGUSER=gcdr_app
PGPASSWORD=***
PGSSL=true
```

### Operational Considerations

- Use connection pooling (RDS Proxy or pgBouncer).
- Apply migrations with a tool (Flyway, Prisma Migrate, or Knex).
- Add alarms for CPU, storage, connections, and slow queries.

## Drawbacks

- Increased operational complexity (RDS management).
- Migration risk and potential data inconsistency during cutover.
- Higher cost if not optimized (storage and compute).

## Rationale and Alternatives

### Why PostgreSQL

- Strong transactional semantics.
- Relational queries align with domain relationships.
- Mature tooling for migrations and monitoring.

### Alternatives Considered

- **Remain on DynamoDB**: requires continued single-table modeling and complex access patterns.
- **Aurora Serverless v2**: viable for cost optimization but adds latency and cold start considerations.
- **Hybrid approach**: keep DynamoDB for hot paths and Postgres for reporting; increases complexity.

## Prior Art

- AWS DynamoDB to RDS migration patterns (DMS and CDC).
- Stripe and Shopify reports on scaling Postgres for core systems.
- PostgreSQL official documentation on indexing and transactions.

## Unresolved Questions

- Which migration tool will be adopted (Flyway, Prisma, Knex)?
- Should we use Aurora PostgreSQL or RDS PostgreSQL?
- What is the acceptable downtime (if any) for final cutover?
- How will we handle audit log storage (Postgres or separate store)?

## Next Steps

- Confirm target PostgreSQL platform.
- Define initial schema and migrations.
- Implement dual-write adapter and backfill tooling.
- Set up staging environment for migration rehearsal.
