import { z } from 'zod';
import type {
  FeatureButtons,
  CustomerTemperatureConfig,
} from '../../domain/entities/Customer';

// =============================================================================
// RFC-0057 — Customer Config Document (DTOs, DEC-10 / DEC-13)
//
// Three schemas + a read-model type:
//   - CustomerConfigSchema       — full replace (PUT). Governed sections are
//                                  `.strict()`; `featureButtons`, when present,
//                                  is the complete 2×3 matrix.
//   - CustomerConfigPatchSchema  — deep-partial (PATCH). `featureButtons` may
//                                  be a partial subset (per-group merge).
//   - CustomerConfigReadModel    — normalized read model (all keys present,
//                                  secrets masked) returned by GET.
//   - SecretsWriteSchema         — dedicated secrets write body (DEC-7).
//
// Top-level and every governed section are `.strict()` so unknown keys 400 —
// this is also how secret fields (`ingestion.clientSecret`, any `security`
// section) are rejected on the general write path (DEC-7 / acceptance #4-5).
// Free sections (`display.*`, `classificationProfile`, `defaultDashboard.cfg`,
// `metadata`) hold `z.unknown()` but are size-capped (DEC-13).
// =============================================================================

/** Masked-secret sentinel returned by GET and never persisted as a real value. */
export const MASKED_SECRET = '***';

// Size caps (DEC-13). Bytes measured on the JSON serialisation.
export const FREE_SECTION_MAX_BYTES = 16 * 1024; // per free section
export const TOTAL_DOC_MAX_BYTES = 64 * 1024;    // whole writable document

function byteLength(value: unknown): number {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}

/** superRefine helper: reject a free section whose serialisation exceeds the cap. */
function capFreeSection(path: string, max = FREE_SECTION_MAX_BYTES) {
  return (value: unknown, ctx: z.RefinementCtx): void => {
    if (byteLength(value) > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${path} exceeds the ${max}-byte size cap`,
        path: [path],
      });
    }
  };
}

// -----------------------------------------------------------------------------
// featureButtons — 2×3 matrix (DEC-3)
// -----------------------------------------------------------------------------

const FeatureGroupFlagsSchema = z
  .object({
    entrada: z.boolean(),
    areacomum: z.boolean(),
    lojas: z.boolean(),
  })
  .strict();

const FeatureGroupFlagsPatchSchema = FeatureGroupFlagsSchema.partial().strict();

/** Full matrix — both features, each with exactly three keys (PUT). */
export const FeatureButtonsSchema = z
  .object({
    demandPeak: FeatureGroupFlagsSchema,
    instantTelemetry: FeatureGroupFlagsSchema,
  })
  .strict();

/** Partial matrix — any subset of features/groups (PATCH, per-group merge). */
export const FeatureButtonsPatchSchema = z
  .object({
    demandPeak: FeatureGroupFlagsPatchSchema,
    instantTelemetry: FeatureGroupFlagsPatchSchema,
  })
  .partial()
  .strict();

// -----------------------------------------------------------------------------
// Governed scalar sections (strict)
// -----------------------------------------------------------------------------

const AlarmsSchema = z
  .object({
    notificationsEnabled: z.boolean().optional(),
    showOffline: z.boolean().optional(),
    showInternalSupport: z.boolean().optional(),
  })
  .strict();

const TicketsSchema = z
  .object({
    enabled: z.boolean().optional(),
    onlyToMyio: z.boolean().optional(),
  })
  .strict();

// Bounded temperature value with ≤ 1 decimal place (DEC-13).
const TemperatureValue = z
  .number()
  .min(-50, 'temperature must be ≥ -50')
  .max(100, 'temperature must be ≤ 100')
  .refine((n) => Math.round(n * 10) === n * 10, 'temperature allows at most 1 decimal place');

/**
 * Temperature invariants (DEC-13): `min ≤ max`, `clampMin ≤ min`,
 * `max ≤ clampMax`. Each comparison applies only when BOTH operands are
 * present, so it works for full (PUT) and sparse (PATCH) inputs alike.
 */
export function refineTemperature(
  t: CustomerTemperatureConfig,
  ctx: z.RefinementCtx,
): void {
  const { min, max, clampMin, clampMax } = t;
  if (min !== undefined && max !== undefined && min > max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'temperature.min must be ≤ temperature.max', path: ['min'] });
  }
  if (clampMin !== undefined && min !== undefined && clampMin > min) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'temperature.clampMin must be ≤ temperature.min', path: ['clampMin'] });
  }
  if (max !== undefined && clampMax !== undefined && max > clampMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'temperature.max must be ≤ temperature.clampMax', path: ['clampMax'] });
  }
}

const TemperatureSchema = z
  .object({
    min: TemperatureValue.optional(),
    max: TemperatureValue.optional(),
    clampMin: TemperatureValue.optional(),
    clampMax: TemperatureValue.optional(),
  })
  .strict()
  .superRefine(refineTemperature);

// -----------------------------------------------------------------------------
// Free sections (strict on known keys, values free but size-capped)
// -----------------------------------------------------------------------------

const DisplaySchema = z
  .object({
    measurementDisplaySettings: z.unknown().optional(),
    mapInstantaneousPower: z.unknown().optional(),
  })
  .strict()
  .superRefine(capFreeSection('display'));

const DefaultDashboardSchema = z
  .object({
    id: z.string().max(255).nullable().optional(),
    cfg: z.unknown().optional(),
  })
  .strict()
  .superRefine((v, ctx) => capFreeSection('defaultDashboard.cfg')(v.cfg, ctx));

const ClassificationProfileSchema = z
  .unknown()
  .superRefine(capFreeSection('classificationProfile'));

const MetadataSchema = z
  .record(z.unknown())
  .superRefine(capFreeSection('metadata'));

// `ingestion` write path — ONLY `clientId`. `clientSecret` is rejected here
// (strict) and can only be set through the secrets endpoint (DEC-7).
const IngestionWriteSchema = z
  .object({
    clientId: z.string().max(512).optional(),
  })
  .strict();

// -----------------------------------------------------------------------------
// PUT — full replace of writable sections (DEC-9 / DEC-10)
// -----------------------------------------------------------------------------

export const CustomerConfigSchema = z
  .object({
    featureButtons: FeatureButtonsSchema.optional(),
    alarms: AlarmsSchema.optional(),
    tickets: TicketsSchema.optional(),
    temperature: TemperatureSchema.optional(),
    display: DisplaySchema.optional(),
    defaultDashboard: DefaultDashboardSchema.optional(),
    classificationProfile: ClassificationProfileSchema.optional(),
    ingestion: IngestionWriteSchema.optional(),
    metadata: MetadataSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (byteLength(v) > TOTAL_DOC_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `config document exceeds the ${TOTAL_DOC_MAX_BYTES}-byte total cap`,
        path: [],
      });
    }
  });

export type CustomerConfigWriteDTO = z.infer<typeof CustomerConfigSchema>;

// -----------------------------------------------------------------------------
// PATCH — deep-partial (DEC-9 / DEC-10)
// -----------------------------------------------------------------------------

export const CustomerConfigPatchSchema = z
  .object({
    featureButtons: FeatureButtonsPatchSchema.optional(),
    alarms: AlarmsSchema.optional(),
    tickets: TicketsSchema.optional(),
    temperature: TemperatureSchema.optional(),
    display: DisplaySchema.optional(),
    defaultDashboard: DefaultDashboardSchema.optional(),
    classificationProfile: ClassificationProfileSchema.optional(),
    ingestion: IngestionWriteSchema.optional(),
    metadata: MetadataSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (byteLength(v) > TOTAL_DOC_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `config document exceeds the ${TOTAL_DOC_MAX_BYTES}-byte total cap`,
        path: [],
      });
    }
  });

export type CustomerConfigPatchDTO = z.infer<typeof CustomerConfigPatchSchema>;

// -----------------------------------------------------------------------------
// Secrets write body (DEC-7). A value of `null` clears; a string sets. The
// masked sentinel `"***"` is rejected here (never round-trips into storage).
// -----------------------------------------------------------------------------

const SecretValue = z
  .union([z.string().min(1).max(4096), z.null()])
  .refine((v) => v !== MASKED_SECRET, `the masked value "${MASKED_SECRET}" cannot be persisted as a secret`);

export const SecretsWriteSchema = z
  .object({
    ingestion: z
      .object({ clientSecret: SecretValue.optional() })
      .strict()
      .optional(),
    security: z
      .object({ masterAdminPassword: SecretValue.optional() })
      .strict()
      .optional(),
  })
  .strict();

export type SecretsWriteDTO = z.infer<typeof SecretsWriteSchema>;

// -----------------------------------------------------------------------------
// Read model (DEC-5) — normalized, all keys present, secrets masked.
// -----------------------------------------------------------------------------

export interface CustomerConfigReadModel {
  version: number;
  featureButtons: FeatureButtons;
  alarms: { notificationsEnabled: boolean; showOffline: boolean; showInternalSupport: boolean };
  tickets: { enabled: boolean; onlyToMyio: boolean };
  temperature: { min: number; max: number; clampMin: number; clampMax: number };
  display: { measurementDisplaySettings: unknown; mapInstantaneousPower: unknown };
  defaultDashboard: { id: string | null; cfg: unknown };
  classificationProfile: unknown;
  locale: { timezone: string; locale: string; currency: string };
  theme: { primaryColor: string | null; secondaryColor: string | null };
  ingestion: { clientId: string | null; clientSecret: string };
  security: { masterAdminPassword: string };
  metadata: Record<string, unknown>;
}

/** Real (decrypted) secret values returned only by the audited reveal endpoint. */
export interface CustomerConfigSecretsRevealed {
  ingestion: { clientSecret: string | null };
  security: { masterAdminPassword: string | null };
}
