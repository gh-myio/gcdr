# RFC-0046 — Consumption Goals · Drizzle schema snippet

This is the data-model artifact for **RFC-0046 — Customer Consumption Goals**
(`docs/rfcs/RFC-0046-Customer-Consumption-Goals.md`, §"Data model"). It defines the
four tables exactly as the RFC closes them:

| Table | Role |
| --- | --- |
| `consumption_goals` | parent per `(tenant, customer, domain, year)`, holds the optimistic `version` |
| `consumption_goal_hours` | the canonical hourly grain (≤ 8 760 rows/goal) |
| `consumption_goal_domains` | fixed aggregation config (`aggregation_method` + `unit`) per `(tenant, domain)` |
| `consumption_goal_history` | append-only audit, **one row per operation** (source + input level + bucket count + details sample) |

Companion migrations:
- `drizzle/migrations/0047_consumption_goals.sql` — the four tables + domain seed.
- `drizzle/migrations/0048_consumption_goals_history_ops.sql` — additive `ALTER` adding the operation-level audit columns (`source`, `bucket_count`, `details`) + the `source` CHECK to `consumption_goal_history`. The Drizzle snippet below already includes these columns (the live `schema.ts` reflects post-0048).

---

## How to integrate into `src/infrastructure/database/drizzle/schema.ts`

Append the block below to the **end** of `schema.ts` (after the work-orders /
annotations section). It reuses the imports already present at the top of the
file (`pgTable, uuid, text, smallint, integer, boolean, numeric, timestamp,
index, uniqueIndex, check, primaryKey`) plus `sql` from `drizzle-orm`.

> **One new import is required.** `numeric` is not yet imported in `schema.ts` —
> add it to the existing `from 'drizzle-orm/pg-core'` import list:
>
> ```ts
> import {
>   pgTable,
>   // …existing imports…
>   numeric,   // ← add for RFC-0046 consumption_goal_hours.value / history values
> } from 'drizzle-orm/pg-core';
> ```

### Drizzle snippet

```ts
// =============================================================================
// CONSUMPTION GOALS (RFC-0046)
// =============================================================================
// Per-customer targets for ENERGY | WATER | TEMPERATURE, scoped by domain and
// year, persisted at a single canonical grain — the hour. The parent row holds
// the optimistic `version`; hours are derived-on-write / aggregated-on-read.

// 1) Parent — one per (tenant, customer, domain, year); carries the version.
export const consumptionGoals = pgTable('consumption_goals', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  domain:     text('domain').notNull(),                 // ENERGY | WATER | TEMPERATURE
  year:       smallint('year').notNull(),
  unit:       text('unit').notNull(),                    // kWh | m3 | C (from domain config)
  version:    integer('version').notNull().default(1),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid('created_by'),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:  uuid('updated_by'),
}, (table) => ({
  uq:          uniqueIndex('consumption_goals_uq').on(table.tenantId, table.customerId, table.domain, table.year),
  customerIdx: index('consumption_goals_customer_idx').on(table.tenantId, table.customerId),
  domainCheck: check(
    'consumption_goals_domain_check',
    sql`${table.domain} IN ('ENERGY','WATER','TEMPERATURE')`
  ),
}));

// 2) Canonical hourly grain. One row per (goal, month, day, hour).
export const consumptionGoalHours = pgTable('consumption_goal_hours', {
  goalId:      uuid('goal_id').notNull().references(() => consumptionGoals.id, { onDelete: 'cascade' }),
  month:       smallint('month').notNull(),              // 1..12
  day:         smallint('day').notNull(),                // 1..31 (valid for the month/year)
  hour:        smallint('hour').notNull(),               // 0..23
  value:       numeric('value').notNull(),
  sourceLevel: text('source_level').notNull(),           // YEAR | MONTH | DAY | HOUR — level the user set
  derived:     boolean('derived').notNull(),             // true = system-distributed
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:   uuid('updated_by'),
}, (table) => ({
  uq: uniqueIndex('consumption_goal_hours_uq').on(table.goalId, table.month, table.day, table.hour),
  monthRange:  check('consumption_goal_hours_month_check', sql`${table.month} BETWEEN 1 AND 12`),
  dayRange:    check('consumption_goal_hours_day_check',   sql`${table.day} BETWEEN 1 AND 31`),
  hourRange:   check('consumption_goal_hours_hour_check',  sql`${table.hour} BETWEEN 0 AND 23`),
  sourceLevelCheck: check(
    'consumption_goal_hours_source_level_check',
    sql`${table.sourceLevel} IN ('YEAR','MONTH','DAY','HOUR')`
  ),
}));

// 3) Fixed aggregation config per (tenant, domain). Seeded; operator-immutable.
export const consumptionGoalDomains = pgTable('consumption_goal_domains', {
  tenantId:          uuid('tenant_id').notNull(),
  domain:            text('domain').notNull(),           // ENERGY | WATER | TEMPERATURE
  aggregationMethod: text('aggregation_method').notNull(), // SUM | AVERAGE
  unit:              text('unit').notNull(),             // kWh | m3 | C
}, (table) => ({
  pk: primaryKey({ columns: [table.tenantId, table.domain] }),
  aggregationMethodCheck: check(
    'consumption_goal_domains_agg_method_check',
    sql`${table.aggregationMethod} IN ('SUM','AVERAGE')`
  ),
  domainCheck: check(
    'consumption_goal_domains_domain_check',
    sql`${table.domain} IN ('ENERGY','WATER','TEMPERATURE')`
  ),
}));

// 4) Append-only history. ONE row per operation (DEC-4): records the operation
//    source, the coarsest level touched, the bucket count, and a details sample.
export const consumptionGoalHistory = pgTable('consumption_goal_history', {
  id:            uuid('id').primaryKey().defaultRandom(),
  goalId:        uuid('goal_id').notNull(),
  actor:         uuid('actor'),                          // who changed it
  source:        text('source').notNull().default('EDIT'), // IMPORT | REPLACE | MERGE | DELETE | EDIT
  actionLevel:   text('action_level').notNull(),         // YEAR | MONTH | DAY | HOUR — coarsest level touched
  bucketRef:     text('bucket_ref').notNull(),           // representative ref for the operation
  oldValue:      numeric('old_value'),                   // at the input level (NULL on create / multi-bucket)
  newValue:      numeric('new_value'),                   // single-bucket value, else NULL
  bucketCount:   integer('bucket_count').notNull().default(1), // operator buckets this operation carried
  details:       jsonb('details').notNull().default([]), // compact [{ ref, value }] sample (capped at 50)
  distributed:   boolean('distributed').notNull(),       // true = system spread to hours
  hoursAffected: integer('hours_affected').notNull(),    // total hour rows written by this operation
  version:       integer('version').notNull(),           // the version this operation produced
  changedAt:     timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  goalChronoIdx: index('consumption_goal_history_idx').on(table.goalId, table.changedAt.desc()),
  actionLevelCheck: check(
    'consumption_goal_history_action_level_check',
    sql`${table.actionLevel} IN ('YEAR','MONTH','DAY','HOUR')`
  ),
  sourceCheck: check(
    'consumption_goal_history_source_check',
    sql`${table.source} IN ('IMPORT','REPLACE','MERGE','DELETE','EDIT')`
  ),
}));
```

> **`jsonb` import.** `consumption_goal_history.details` needs `jsonb` from
> `drizzle-orm/pg-core` (already imported in `schema.ts`).

---

## Notes on conventions matched

- **Table style** mirrors `workOrders` / `workOrdersLifecycleRules`: `pgTable`
  with a column object and a second `(table) => ({ … })` callback for indexes,
  unique indexes and `check` constraints.
- **`uniqueIndex`** is used for the RFC's `UNIQUE(...)` constraints (the repo's
  established pattern, e.g. `work_orders_tenant_code_unique`) rather than an
  inline column `.unique()`.
- **`numeric('value')`** maps the RFC's bare `numeric` (unbounded precision):
  temperature may be negative, energy/water are `>= 0` — that domain rule is
  enforced in the service/DTO layer (Zod), not as a column `CHECK`, because the
  sign rule depends on the row's `domain` which lives on the parent.
- **`changedAt.desc()`** inside `index(...)` produces the `(goal_id,
  changed_at DESC)` ordering the RFC specifies for the history read path.
- **Domain / level CHECKs** are added defensively to match the
  `work_orders_type_check` precedent; they are a strict superset of what the RFC
  lists in column comments and do not change the shape.
- `consumption_goals` deliberately has **no `deletedAt`** — DELETE removes the
  year (RFC §API · "Delete"); there is no soft-delete in this version.
