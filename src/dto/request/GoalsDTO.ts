import { z } from 'zod';

// =============================================================================
// RFC-0046: Customer Consumption Goals — request contracts (Zod + types)
//
// Per-customer consumption goals scoped by domain (ENERGY | WATER | TEMPERATURE)
// and year. The operator submits a target at any granularity (year, month, day,
// hour); GCDR distributes it to the canonical hourly grain on write and rolls it
// up on read. This file defines ONLY the request-side wire contracts — the
// endpoint shapes, query discriminators and write bodies — not business logic.
//
// Validation rules (authoritative, per RFC §API "Validation"):
//   - month: 1..12
//   - day:   valid for the (month, year), leap-year aware
//   - hour:  0..23
//   - value: finite; >= 0 for ENERGY/WATER; TEMPERATURE may be negative.
// =============================================================================

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

/** Goal domain. Aggregation method is a fixed property of the domain. */
export const GoalDomainSchema = z.enum(['ENERGY', 'WATER', 'TEMPERATURE']);
export type GoalDomain = z.infer<typeof GoalDomainSchema>;

/**
 * Read granularity (the requested view derived from hours) AND the operator's
 * input mode on write. Lower-case on the wire to match the query-param style.
 */
export const GoalGranularitySchema = z.enum(['year', 'month', 'day', 'hour']);
export type GoalGranularity = z.infer<typeof GoalGranularitySchema>;

/**
 * The level the operator actually set, recorded per stored hour (`source_level`)
 * and per history row (`action_level`). Upper-case to match the stored column
 * values in `consumption_goal_hours.source_level` / `consumption_goal_history`.
 */
export const GoalSourceLevelSchema = z.enum(['YEAR', 'MONTH', 'DAY', 'HOUR']);
export type GoalSourceLevel = z.infer<typeof GoalSourceLevelSchema>;

/** Fixed aggregation method per domain (ENERGY/WATER → SUM, TEMPERATURE → AVERAGE). */
export const GoalAggregationMethodSchema = z.enum(['SUM', 'AVERAGE']);
export type GoalAggregationMethod = z.infer<typeof GoalAggregationMethodSchema>;

// -----------------------------------------------------------------------------
// Calendar helpers (leap-year aware day validation)
// -----------------------------------------------------------------------------

/** Gregorian leap-year test. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in a given month (1..12) of a given year. */
export function daysInMonth(year: number, month: number): number {
  // month is 1-based; new Date(year, month, 0) gives the last day of `month`.
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Reasonable year window: covers historical edits and near-future targets.
const MIN_GOAL_YEAR = 2000;
const MAX_GOAL_YEAR = 2100;

const YearSchema = z
  .number()
  .int()
  .min(MIN_GOAL_YEAR, `year must be >= ${MIN_GOAL_YEAR}`)
  .max(MAX_GOAL_YEAR, `year must be <= ${MAX_GOAL_YEAR}`);

const MonthSchema = z
  .number()
  .int()
  .min(1, 'month must be between 1 and 12')
  .max(12, 'month must be between 1 and 12');

const HourSchema = z
  .number()
  .int()
  .min(0, 'hour must be between 0 and 23')
  .max(23, 'hour must be between 0 and 23');

// -----------------------------------------------------------------------------
// Value validation
//
// A bare value is finite (and not NaN/Infinity). Sign validation is
// domain-dependent and therefore applied after the domain is known via
// `refineGoalValuesForDomain` below.
// -----------------------------------------------------------------------------

/** Finite numeric value; per-domain sign constraints applied separately. */
export const GoalValueSchema = z.number().finite('value must be a finite number');

/**
 * Returns true when `value` satisfies the per-domain sign constraint:
 *   - ENERGY / WATER: value must be >= 0
 *   - TEMPERATURE: any finite value (may be negative)
 */
export function isValidValueForDomain(domain: GoalDomain, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (domain === 'TEMPERATURE') return true;
  return value >= 0;
}

// -----------------------------------------------------------------------------
// Query-param schemas
//
// Query strings arrive as strings; `z.coerce` mirrors the project style
// (see ListCustomerApiKeysQuerySchema). `fetchHistory` accepts the canonical
// "true"/"false" pair like other boolean query flags in the codebase.
// -----------------------------------------------------------------------------

/** Optional "true"/"false" query flag with a default applied before transform. */
function booleanQueryFlag(defaultValue: 'true' | 'false') {
  return z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((v) => v === 'true');
}

/**
 * GET /customers/:id/goals?domain=&year=&granularity=&fetchHistory=
 * `granularity` defaults to `month`; `fetchHistory=true` adds ≤100 history entries.
 */
export const GetGoalsQuerySchema = z.object({
  domain: GoalDomainSchema,
  year: z.coerce.number().pipe(YearSchema),
  granularity: GoalGranularitySchema.default('month'),
  fetchHistory: booleanQueryFlag('false'),
});
export type GetGoalsQueryDTO = z.infer<typeof GetGoalsQuerySchema>;

/**
 * Discriminator-only query for PUT / PATCH / POST import / DELETE.
 * `domain` and `year` identify the `(customer, domain, year)` tree.
 */
export const GoalsTargetQuerySchema = z.object({
  domain: GoalDomainSchema,
  year: z.coerce.number().pipe(YearSchema),
});
export type GoalsTargetQueryDTO = z.infer<typeof GoalsTargetQuerySchema>;

// -----------------------------------------------------------------------------
// Bucket leaves (shared by PUT and PATCH bodies)
//
// A bucket carries the target `value` and an optional `sourceLevel` declaring
// the level the operator acted on. When omitted, `sourceLevel` is inferred from
// the position of the bucket in the tree (annual → YEAR, monthly → MONTH, etc.).
// -----------------------------------------------------------------------------

/** A single goal target leaf: the value plus an optional explicit source level. */
export const GoalBucketSchema = z.object({
  value: GoalValueSchema,
  sourceLevel: GoalSourceLevelSchema.optional(),
});
export type GoalBucketDTO = z.infer<typeof GoalBucketSchema>;

// Keys are zero-padded strings on the wire to match the GoalsPanel contract:
//   month "01".."12", day "01".."31", hour "00".."23".
const MonthKeySchema = z
  .string()
  .regex(/^(0[1-9]|1[0-2])$/, 'month key must be "01".."12"');

const DayKeySchema = z
  .string()
  .regex(/^(0[1-9]|[12]\d|3[01])$/, 'day key must be "01".."31"');

const HourKeySchema = z
  .string()
  .regex(/^([01]\d|2[0-3])$/, 'hour key must be "00".."23"');

// -----------------------------------------------------------------------------
// PUT replace body — a full year tree at any granularity
//
// REPLACE semantics (DEC-5): the payload IS the whole year for this domain.
// Buckets absent from the payload's scope are removed; the system distributes
// to hours. The operator picks ONE granularity for the submission; the tree is
// nested only down to that granularity.
//
// Shape mirrors the read tree:
//   annual  → { value, sourceLevel? }
//   monthly → { "01": <month node>, ... }
//   each month node carries its own value/sourceLevel and optional finer nesting.
// -----------------------------------------------------------------------------

/** Hour node: leaf only (the canonical grain). */
const ReplaceHourNodeSchema = GoalBucketSchema;

/** Day node: a value, plus an optional map of hour buckets. */
const ReplaceDayNodeSchema: z.ZodType<{
  value: number;
  sourceLevel?: GoalSourceLevel;
  hourly?: Record<string, GoalBucketDTO>;
}> = GoalBucketSchema.extend({
  hourly: z.record(HourKeySchema, ReplaceHourNodeSchema).optional(),
});

/** Month node: a value, plus an optional map of day nodes. */
const ReplaceMonthNodeSchema = GoalBucketSchema.extend({
  daily: z.record(DayKeySchema, ReplaceDayNodeSchema).optional(),
});

/**
 * Full-year replace body. At least one of `annual` / `monthly` must be present;
 * the operator may go as deep as the hour. Day-of-month validity against the
 * (month, year) is enforced by `validateGoalTreeCalendar` once `year` is known
 * (the static schema cannot see the year-from-query).
 */
export const ReplaceGoalsBodySchema = z
  .object({
    annual: GoalBucketSchema.optional(),
    monthly: z.record(MonthKeySchema, ReplaceMonthNodeSchema).optional(),
    /** Optimistic concurrency: expected current version (omit on first write). */
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine(
    (b) => b.annual !== undefined || (b.monthly !== undefined && Object.keys(b.monthly).length > 0),
    { message: 'replace body must define at least an annual value or one month' },
  );
export type ReplaceGoalsBodyDTO = z.infer<typeof ReplaceGoalsBodySchema>;

// -----------------------------------------------------------------------------
// PATCH merge body — sparse buckets
//
// MERGE semantics (DEC-5): only the sent buckets are (re)distributed; all other
// buckets are preserved. Each entry names its bucket explicitly via `level` +
// `ref`, which is unambiguous and matches the history `bucket_ref` format:
//   YEAR  → "2026"
//   MONTH → "2026-03"
//   DAY   → "2026-03-15"
//   HOUR  → "2026-03-15T08"
// -----------------------------------------------------------------------------

const BUCKET_REF_PATTERNS: Record<GoalSourceLevel, RegExp> = {
  YEAR: /^\d{4}$/,
  MONTH: /^\d{4}-(0[1-9]|1[0-2])$/,
  DAY: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  HOUR: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3])$/,
};

/** A single sparse bucket to merge: the level, its reference and the new value. */
export const MergeGoalBucketSchema = z
  .object({
    level: GoalSourceLevelSchema,
    ref: z.string().min(4).max(13),
    value: GoalValueSchema,
  })
  .refine((b) => BUCKET_REF_PATTERNS[b.level].test(b.ref), {
    message: 'ref does not match the format required for its level',
    path: ['ref'],
  });
export type MergeGoalBucketDTO = z.infer<typeof MergeGoalBucketSchema>;

/** PATCH body: a non-empty list of sparse buckets, plus optional optimistic version. */
export const MergeGoalsBodySchema = z.object({
  buckets: z.array(MergeGoalBucketSchema).min(1, 'at least one bucket is required').max(8760),
  expectedVersion: z.number().int().positive().optional(),
});
export type MergeGoalsBodyDTO = z.infer<typeof MergeGoalsBodySchema>;

// -----------------------------------------------------------------------------
// Delete body (optional sub-bucket scope)
//
// DELETE /customers/:id/goals?domain=&year= removes the whole year by default;
// an optional `bucket` narrows the deletion to a sub-bucket (logged + versioned).
// -----------------------------------------------------------------------------

export const DeleteGoalsBodySchema = z
  .object({
    bucket: z
      .object({
        level: GoalSourceLevelSchema,
        ref: z.string().min(4).max(13),
      })
      .refine((b) => BUCKET_REF_PATTERNS[b.level].test(b.ref), {
        message: 'ref does not match the format required for its level',
        path: ['ref'],
      })
      .optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .optional();
export type DeleteGoalsBodyDTO = z.infer<typeof DeleteGoalsBodySchema>;

// -----------------------------------------------------------------------------
// CSV import query (dry-run by default)
//
// POST /customers/:id/goals/import?domain=&year=&dryRun=
// Defaults to a dry-run preview; `dryRun=false` confirms and persists.
// -----------------------------------------------------------------------------

export const ImportGoalsQuerySchema = z.object({
  domain: GoalDomainSchema,
  year: z.coerce.number().pipe(YearSchema),
  dryRun: booleanQueryFlag('true'),
});
export type ImportGoalsQueryDTO = z.infer<typeof ImportGoalsQuerySchema>;

// -----------------------------------------------------------------------------
// RFC-0052 — Goal margin ("Margem da meta")
//
// PUT /customers/:id/goals/margin?domain=&year=
// One signed percentage per (customer, domain, year): -100..+100, at most two
// decimal places. `multipleOf` is avoided on purpose (float remainder noise);
// the two-decimal cap is checked against the value scaled to cents.
// -----------------------------------------------------------------------------

export const SetGoalMarginBodySchema = z.object({
  goalMarginPct: z
    .number()
    .finite()
    .min(-100, 'goalMarginPct must be >= -100')
    .max(100, 'goalMarginPct must be <= 100')
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
      message: 'goalMarginPct supports at most 2 decimal places',
    }),
  /** Optimistic concurrency: expected current version (omit to force-write). */
  expectedVersion: z.number().int().positive().optional(),
});
export type SetGoalMarginBodyDTO = z.infer<typeof SetGoalMarginBodySchema>;

/** DELETE margin body — optional optimistic guard only. */
export const ClearGoalMarginBodySchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
  })
  .optional();
export type ClearGoalMarginBodyDTO = z.infer<typeof ClearGoalMarginBodySchema>;

// -----------------------------------------------------------------------------
// Cross-field validators (need `domain` and `year` from the query, which the
// static Zod schemas cannot see). Call these in the service/controller after the
// body and query have both parsed.
// -----------------------------------------------------------------------------

export interface GoalValidationIssue {
  path: string;
  message: string;
}

/**
 * Validates that every value in a replace tree satisfies the per-domain sign
 * constraint. Returns an empty array when valid.
 */
export function validateReplaceTreeForDomain(
  body: ReplaceGoalsBodyDTO,
  domain: GoalDomain,
): GoalValidationIssue[] {
  const issues: GoalValidationIssue[] = [];

  const check = (value: number, path: string) => {
    if (!isValidValueForDomain(domain, value)) {
      issues.push({
        path,
        message:
          domain === 'TEMPERATURE'
            ? 'value must be a finite number'
            : 'value must be a finite number >= 0 for energy/water domains',
      });
    }
  };

  if (body.annual) check(body.annual.value, 'annual.value');

  for (const [monthKey, month] of Object.entries(body.monthly ?? {})) {
    check(month.value, `monthly.${monthKey}.value`);
    for (const [dayKey, day] of Object.entries(month.daily ?? {})) {
      check(day.value, `monthly.${monthKey}.daily.${dayKey}.value`);
      for (const [hourKey, hour] of Object.entries(day.hourly ?? {})) {
        check(hour.value, `monthly.${monthKey}.daily.${dayKey}.hourly.${hourKey}.value`);
      }
    }
  }

  return issues;
}

/**
 * Validates day-of-month validity (leap-year aware) for every day bucket in a
 * replace tree, given the `year` from the query. Returns an empty array when
 * valid.
 */
export function validateReplaceTreeCalendar(
  body: ReplaceGoalsBodyDTO,
  year: number,
): GoalValidationIssue[] {
  const issues: GoalValidationIssue[] = [];

  for (const [monthKey, month] of Object.entries(body.monthly ?? {})) {
    const monthNum = Number(monthKey);
    const maxDay = daysInMonth(year, monthNum);
    for (const dayKey of Object.keys(month.daily ?? {})) {
      const dayNum = Number(dayKey);
      if (dayNum < 1 || dayNum > maxDay) {
        issues.push({
          path: `monthly.${monthKey}.daily.${dayKey}`,
          message: `day ${dayKey} is invalid for ${year}-${monthKey} (max ${maxDay})`,
        });
      }
    }
  }

  return issues;
}

/**
 * Validates merge buckets against the per-domain sign constraint, the target
 * year, and day-of-month validity (leap-year aware). Returns an empty array
 * when valid.
 */
export function validateMergeBucketsForDomain(
  body: MergeGoalsBodyDTO,
  domain: GoalDomain,
  year: number,
): GoalValidationIssue[] {
  const issues: GoalValidationIssue[] = [];

  body.buckets.forEach((bucket, i) => {
    if (!isValidValueForDomain(domain, bucket.value)) {
      issues.push({
        path: `buckets.${i}.value`,
        message:
          domain === 'TEMPERATURE'
            ? 'value must be a finite number'
            : 'value must be a finite number >= 0 for energy/water domains',
      });
    }

    // ref's year must match the query year, and DAY/HOUR days must be valid.
    const refYear = Number(bucket.ref.slice(0, 4));
    if (refYear !== year) {
      issues.push({
        path: `buckets.${i}.ref`,
        message: `ref year ${refYear} does not match the target year ${year}`,
      });
    }

    if (bucket.level === 'DAY' || bucket.level === 'HOUR') {
      const monthNum = Number(bucket.ref.slice(5, 7));
      const dayNum = Number(bucket.ref.slice(8, 10));
      const maxDay = daysInMonth(refYear, monthNum);
      if (dayNum < 1 || dayNum > maxDay) {
        issues.push({
          path: `buckets.${i}.ref`,
          message: `day ${dayNum} is invalid for ${refYear}-${bucket.ref.slice(5, 7)} (max ${maxDay})`,
        });
      }
    }
  });

  return issues;
}

// Re-exported leaf schemas for unit tests / reuse.
export {
  YearSchema,
  MonthSchema,
  HourSchema,
  MonthKeySchema,
  DayKeySchema,
  HourKeySchema,
  BUCKET_REF_PATTERNS,
};
