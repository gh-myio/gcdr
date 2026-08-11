import {
  CustomerConfigSchema,
  CustomerConfigPatchSchema,
  SecretsWriteSchema,
  FeatureButtonsSchema,
  FeatureButtonsPatchSchema,
  refineTemperature,
  MASKED_SECRET,
  FREE_SECTION_MAX_BYTES,
  TOTAL_DOC_MAX_BYTES,
} from '../../../src/dto/request/CustomerConfigDTO';
import { z } from 'zod';

const FULL_MATRIX = {
  demandPeak: { entrada: true, areacomum: true, lojas: false },
  instantTelemetry: { entrada: true, areacomum: false, lojas: true },
};

describe('FeatureButtonsSchema (full, PUT)', () => {
  it('accepts the complete 2×3 matrix', () => {
    expect(FeatureButtonsSchema.parse(FULL_MATRIX)).toEqual(FULL_MATRIX);
  });

  it('rejects a missing group key (must be all three)', () => {
    const r = FeatureButtonsSchema.safeParse({
      demandPeak: { entrada: true, areacomum: true },
      instantTelemetry: { entrada: true, areacomum: true, lojas: false },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown group key with a path', () => {
    const r = FeatureButtonsSchema.safeParse({
      demandPeak: { entrada: true, areacomum: true, lojas: false, terraco: true },
      instantTelemetry: { entrada: true, areacomum: true, lojas: false },
    });
    expect(r.success).toBe(false);
    const issue = r.success ? undefined : r.error.issues[0];
    expect(issue?.path).toEqual(['demandPeak']);
    expect(issue?.code).toBe('unrecognized_keys');
    expect((issue as (z.ZodIssue & { keys: string[] }) | undefined)?.keys).toContain('terraco');
  });

  it('rejects an unknown feature key', () => {
    const r = FeatureButtonsSchema.safeParse({ ...FULL_MATRIX, other: {} });
    expect(r.success).toBe(false);
  });
});

describe('FeatureButtonsPatchSchema (partial, PATCH)', () => {
  it('accepts a single toggle', () => {
    const r = FeatureButtonsPatchSchema.parse({ demandPeak: { lojas: true } });
    expect(r).toEqual({ demandPeak: { lojas: true } });
  });

  it('accepts an empty object', () => {
    expect(FeatureButtonsPatchSchema.parse({})).toEqual({});
  });

  it('rejects an unknown group inside a feature', () => {
    const r = FeatureButtonsPatchSchema.safeParse({ demandPeak: { bogus: true } });
    expect(r.success).toBe(false);
  });
});

describe('refineTemperature invariants', () => {
  function run(t: Record<string, number>) {
    const issues: z.ZodIssue[] = [];
    const ctx = { addIssue: (i: z.ZodIssue) => issues.push(i) } as unknown as z.RefinementCtx;
    refineTemperature(t, ctx);
    return issues;
  }

  it('accepts a valid ordering', () => {
    expect(run({ min: 18, max: 27, clampMin: 15, clampMax: 40 })).toHaveLength(0);
  });

  it('rejects min > max', () => {
    const issues = run({ min: 30, max: 27 });
    expect(issues.some((i) => i.path[0] === 'min')).toBe(true);
  });

  it('rejects clampMin > min', () => {
    const issues = run({ clampMin: 20, min: 18 });
    expect(issues.some((i) => i.path[0] === 'clampMin')).toBe(true);
  });

  it('rejects max > clampMax', () => {
    const issues = run({ max: 45, clampMax: 40 });
    expect(issues.some((i) => i.path[0] === 'clampMax')).toBe(true);
  });

  it('skips comparisons when an operand is absent (sparse PATCH)', () => {
    expect(run({ min: 18 })).toHaveLength(0);
  });
});

describe('CustomerConfigSchema (PUT)', () => {
  it('accepts a valid full document', () => {
    const doc = {
      featureButtons: FULL_MATRIX,
      alarms: { notificationsEnabled: false },
      tickets: { enabled: true, onlyToMyio: false },
      temperature: { min: 18, max: 27, clampMin: 15, clampMax: 40 },
      display: { measurementDisplaySettings: { unit: 'kWh' }, mapInstantaneousPower: null },
      defaultDashboard: { id: 'dash-1', cfg: { a: 1 } },
      classificationProfile: { profile: 'x' },
      ingestion: { clientId: 'client-123' },
      metadata: { obs: 'hello' },
    };
    expect(CustomerConfigSchema.parse(doc)).toBeDefined();
  });

  it('accepts an empty document (all sections omitted)', () => {
    expect(CustomerConfigSchema.parse({})).toEqual({});
  });

  it('rejects an unknown top-level section', () => {
    const r = CustomerConfigSchema.safeParse({ bogusSection: {} });
    expect(r.success).toBe(false);
  });

  it('rejects the bundle section (never writable via /config)', () => {
    const r = CustomerConfigSchema.safeParse({ bundle: { checkVersion: false } });
    expect(r.success).toBe(false);
  });

  it('rejects a secret field on the general write path (ingestion.clientSecret)', () => {
    const r = CustomerConfigSchema.safeParse({ ingestion: { clientId: 'c', clientSecret: 'leak' } });
    expect(r.success).toBe(false);
  });

  it('rejects a security section (secrets endpoint only)', () => {
    const r = CustomerConfigSchema.safeParse({ security: { masterAdminPassword: 'leak' } });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown key inside a governed section (alarms strict)', () => {
    const r = CustomerConfigSchema.safeParse({ alarms: { notificationsEnabled: true, wat: 1 } });
    expect(r.success).toBe(false);
  });

  it('enforces temperature invariants at parse time', () => {
    const r = CustomerConfigSchema.safeParse({ temperature: { min: 30, max: 10 } });
    expect(r.success).toBe(false);
  });

  it('rejects a temperature with more than 1 decimal', () => {
    const r = CustomerConfigSchema.safeParse({ temperature: { min: 18.25 } });
    expect(r.success).toBe(false);
  });

  it('rejects a free section that exceeds its byte cap', () => {
    const big = 'x'.repeat(FREE_SECTION_MAX_BYTES + 10);
    const r = CustomerConfigSchema.safeParse({ classificationProfile: big });
    expect(r.success).toBe(false);
  });

  it('rejects a document that exceeds the total byte cap', () => {
    // Two free sections each just under the per-section cap → over the total cap.
    const half = 'y'.repeat(FREE_SECTION_MAX_BYTES - 100);
    const r = CustomerConfigSchema.safeParse({
      classificationProfile: half,
      display: { measurementDisplaySettings: half, mapInstantaneousPower: half },
    });
    expect(r.success).toBe(false);
    expect(TOTAL_DOC_MAX_BYTES).toBeGreaterThan(FREE_SECTION_MAX_BYTES);
  });
});

describe('CustomerConfigPatchSchema (PATCH)', () => {
  it('accepts a single feature toggle', () => {
    const r = CustomerConfigPatchSchema.parse({ featureButtons: { demandPeak: { lojas: true } } });
    expect(r.featureButtons).toEqual({ demandPeak: { lojas: true } });
  });

  it('accepts an empty object (no-op)', () => {
    expect(CustomerConfigPatchSchema.parse({})).toEqual({});
  });

  it('rejects an unknown group in a partial matrix', () => {
    const r = CustomerConfigPatchSchema.safeParse({ featureButtons: { demandPeak: { nope: true } } });
    expect(r.success).toBe(false);
  });

  it('rejects a secret field', () => {
    const r = CustomerConfigPatchSchema.safeParse({ ingestion: { clientSecret: 'x' } });
    expect(r.success).toBe(false);
  });
});

describe('SecretsWriteSchema', () => {
  it('accepts a string secret', () => {
    const r = SecretsWriteSchema.parse({ ingestion: { clientSecret: 'real-secret' } });
    expect(r.ingestion?.clientSecret).toBe('real-secret');
  });

  it('accepts null (clear)', () => {
    const r = SecretsWriteSchema.parse({ security: { masterAdminPassword: null } });
    expect(r.security?.masterAdminPassword).toBeNull();
  });

  it('rejects the masked sentinel "***"', () => {
    const r = SecretsWriteSchema.safeParse({ ingestion: { clientSecret: MASKED_SECRET } });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown secret field', () => {
    const r = SecretsWriteSchema.safeParse({ ingestion: { clientId: 'x' } });
    expect(r.success).toBe(false);
  });

  it('accepts an empty body', () => {
    expect(SecretsWriteSchema.parse({})).toEqual({});
  });
});
