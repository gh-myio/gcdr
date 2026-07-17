import { z } from 'zod';
import {
  daysInMonth,
  YearSchema,
  BUCKET_REF_PATTERNS,
  type GoalSourceLevel,
} from './GoalsDTO';

// =============================================================================
// RFC-0054 (APPROVED rev. 3) — Customer Tariffs: request contracts (Zod + types)
//
// A tariff is (customer, domain, category, year) distributed to an HOURLY
// canonical grain — a sibling of a goal. The bucket API mirrors GoalsDTO but
// the leaf value is a PRICE (R$/unit) instead of a quantity. `year` is a
// REQUIRED discriminator on every verb (the identity carries it); PATCH/DELETE
// refs must match the query year (validated in the service).
//
// Prices are decimal strings on the wire (never floats); this module accepts a
// number OR a numeric string, validates > 0 and ≤ 6 decimals, and normalizes to
// a canonical 6-decimal string for numeric(14,6) storage.
// =============================================================================

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

/** Priced (SUM) domains only — TEMPERATURE has no price. */
export const TariffDomainSchema = z.enum(['ENERGY', 'WATER']);
export type TariffDomain = z.infer<typeof TariffDomainSchema>;

/** The device-level tariff category (DEC-2). */
export const TariffCategorySchema = z.enum(['COMMON_AREA', 'SPECIFIC']);
export type TariffCategory = z.infer<typeof TariffCategorySchema>;

/** Read granularity AND the operator's input level. Shared shape with goals. */
export const TariffGranularitySchema = z.enum(['year', 'month', 'day', 'hour']);
export type TariffGranularity = z.infer<typeof TariffGranularitySchema>;

/** The level the operator set — recorded per stored hour and per history row. */
export const TariffLevelSchema = z.enum(['YEAR', 'MONTH', 'DAY', 'HOUR']);
export type TariffLevel = z.infer<typeof TariffLevelSchema>;

/** unit derived from domain (RFC-0054): ENERGY→kWh, WATER→m3. */
export function unitForDomain(domain: TariffDomain): 'kWh' | 'm3' {
  return domain === 'ENERGY' ? 'kWh' : 'm3';
}

// -----------------------------------------------------------------------------
// Price — decimal string, > 0, ≤ 6 decimals, canonicalized to 6 places
// -----------------------------------------------------------------------------

const PRICE_STRING = /^\d+(\.\d{1,6})?$/;

/**
 * Accepts a positive number or a numeric string with ≤ 6 decimals; emits a
 * canonical fixed-6-decimal string (matching numeric(14,6) round-trips). Values
 * ≤ 0, non-finite, or with > 6 decimals are rejected.
 */
export const PriceSchema = z
  .union([z.number(), z.string()])
  .superRefine((v, ctx) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || v <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'price must be a finite number > 0' });
        return;
      }
      // At most 6 decimals for a number input.
      if (Math.round(v * 1e6) !== v * 1e6) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'price supports at most 6 decimal places' });
      }
      return;
    }
    const s = v.trim();
    if (!PRICE_STRING.test(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'price must be a decimal string with ≤ 6 decimals' });
      return;
    }
    if (Number(s) <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'price must be > 0' });
    }
  })
  .transform((v) => {
    const n = typeof v === 'number' ? v : Number(v.trim());
    return n.toFixed(6); // canonical 6-decimal string
  });

// -----------------------------------------------------------------------------
// Query-param schemas
// -----------------------------------------------------------------------------

function booleanQueryFlag(defaultValue: 'true' | 'false') {
  return z.enum(['true', 'false']).default(defaultValue).transform((v) => v === 'true');
}

/**
 * GET /customers/:id/tariffs?domain=&category=&year=&granularity=&fetchHistory=
 * All of domain, category, year are REQUIRED discriminators (DEC-7).
 */
export const GetTariffQuerySchema = z.object({
  domain: TariffDomainSchema,
  category: TariffCategorySchema,
  year: z.coerce.number().pipe(YearSchema),
  granularity: TariffGranularitySchema.default('day'),
  fetchHistory: booleanQueryFlag('false'),
});
export type GetTariffQueryDTO = z.infer<typeof GetTariffQuerySchema>;

/** Discriminator-only query for PUT / PATCH / DELETE. */
export const TariffTargetQuerySchema = z.object({
  domain: TariffDomainSchema,
  category: TariffCategorySchema,
  year: z.coerce.number().pipe(YearSchema),
});
export type TariffTargetQueryDTO = z.infer<typeof TariffTargetQuerySchema>;

// -----------------------------------------------------------------------------
// Zero-padded keys (mirror the goals wire contract)
// -----------------------------------------------------------------------------

const MonthKeySchema = z.string().regex(/^(0[1-9]|1[0-2])$/, 'month key must be "01".."12"');
const DayKeySchema = z.string().regex(/^(0[1-9]|[12]\d|3[01])$/, 'day key must be "01".."31"');
const HourKeySchema = z.string().regex(/^([01]\d|2[0-3])$/, 'hour key must be "00".."23"');

// -----------------------------------------------------------------------------
// PUT replace body — a full year price tree at any granularity
// -----------------------------------------------------------------------------

const TariffLeafSchema = z.object({
  price: PriceSchema,
  sourceLevel: TariffLevelSchema.optional(),
});

const ReplaceDayNodeSchema = TariffLeafSchema.extend({
  hourly: z.record(HourKeySchema, TariffLeafSchema).optional(),
});

const ReplaceMonthNodeSchema = TariffLeafSchema.extend({
  daily: z.record(DayKeySchema, ReplaceDayNodeSchema).optional(),
});

/** PUT body — at least an `annual` price or one month. */
export const ReplaceTariffBodySchema = z
  .object({
    annual: TariffLeafSchema.optional(),
    monthly: z.record(MonthKeySchema, ReplaceMonthNodeSchema).optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine(
    (b) => b.annual !== undefined || (b.monthly !== undefined && Object.keys(b.monthly).length > 0),
    { message: 'replace body must define at least an annual price or one month' },
  );
export type ReplaceTariffBodyDTO = z.infer<typeof ReplaceTariffBodySchema>;

// -----------------------------------------------------------------------------
// PATCH merge body — sparse price buckets by level + ref
// -----------------------------------------------------------------------------

export const MergeTariffBucketSchema = z
  .object({
    level: TariffLevelSchema,
    ref: z.string().min(4).max(13),
    price: PriceSchema,
  })
  .refine((b) => BUCKET_REF_PATTERNS[b.level as GoalSourceLevel].test(b.ref), {
    message: 'ref does not match the format required for its level',
    path: ['ref'],
  });
export type MergeTariffBucketDTO = z.infer<typeof MergeTariffBucketSchema>;

export const MergeTariffBodySchema = z.object({
  buckets: z.array(MergeTariffBucketSchema).min(1, 'at least one bucket is required').max(8784),
  expectedVersion: z.number().int().positive().optional(),
});
export type MergeTariffBodyDTO = z.infer<typeof MergeTariffBodySchema>;

// -----------------------------------------------------------------------------
// DELETE body — whole year, or a sub-bucket
// -----------------------------------------------------------------------------

export const DeleteTariffBodySchema = z
  .object({
    bucket: z
      .object({
        level: TariffLevelSchema,
        ref: z.string().min(4).max(13),
      })
      .refine((b) => BUCKET_REF_PATTERNS[b.level as GoalSourceLevel].test(b.ref), {
        message: 'ref does not match the format required for its level',
        path: ['ref'],
      })
      .optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .optional();
export type DeleteTariffBodyDTO = z.infer<typeof DeleteTariffBodySchema>;

// -----------------------------------------------------------------------------
// Cross-field validators (need `year` from the query)
// -----------------------------------------------------------------------------

export interface TariffValidationIssue {
  path: string;
  message: string;
}

/** Day-of-month validity for a replace tree, given the query year (leap-aware). */
export function validateReplaceTariffCalendar(body: ReplaceTariffBodyDTO, year: number): TariffValidationIssue[] {
  const issues: TariffValidationIssue[] = [];
  for (const [monthKey, month] of Object.entries(body.monthly ?? {})) {
    const maxDay = daysInMonth(year, Number(monthKey));
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

/** Merge/DELETE ref must match the query year, and DAY/HOUR days must be valid. */
export function validateTariffBucketsYear(
  buckets: Array<{ level: TariffLevel; ref: string }>,
  year: number,
): TariffValidationIssue[] {
  const issues: TariffValidationIssue[] = [];
  buckets.forEach((bucket, i) => {
    const refYear = Number(bucket.ref.slice(0, 4));
    if (refYear !== year) {
      issues.push({ path: `buckets.${i}.ref`, message: `ref year ${refYear} does not match the target year ${year}` });
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
