import { CreateRuleSchema } from '../../../src/dto/request/RuleDTO';

// RFC-0055 — NO_CONSUMPTION rule type validation.
const baseRule = {
  customerId: 'cust-1',
  name: 'No-consumption energy (1h)',
  type: 'NO_CONSUMPTION' as const,
  scope: { type: 'CUSTOMER' as const, entityId: '11111111-1111-1111-1111-111111111111' },
};

const validConfig = {
  metric: 'energy_consumption' as const,
  timezone: 'America/Sao_Paulo',
};

describe('RuleDTO — NO_CONSUMPTION (RFC-0055)', () => {
  it('accepts a valid NO_CONSUMPTION rule and applies config defaults', () => {
    const parsed = CreateRuleSchema.parse({ ...baseRule, noConsumptionConfig: validConfig });
    expect(parsed.type).toBe('NO_CONSUMPTION');
    expect(parsed.noConsumptionConfig).toMatchObject({
      metric: 'energy_consumption',
      windowMinutes: 60,
      minSamplesPerWindow: 1,
      graceWindows: 1,
      timezone: 'America/Sao_Paulo',
    });
  });

  it('rejects NO_CONSUMPTION without noConsumptionConfig (config must match type)', () => {
    expect(() => CreateRuleSchema.parse({ ...baseRule })).toThrow();
  });

  it('rejects an unknown metric', () => {
    expect(() =>
      CreateRuleSchema.parse({
        ...baseRule,
        noConsumptionConfig: { ...validConfig, metric: 'temperature' },
      })
    ).toThrow();
  });

  it('requires timezone', () => {
    expect(() =>
      CreateRuleSchema.parse({
        ...baseRule,
        noConsumptionConfig: { metric: 'energy_consumption' },
      })
    ).toThrow();
  });

  it('rejects windowMinutes other than 60 (v1)', () => {
    expect(() =>
      CreateRuleSchema.parse({
        ...baseRule,
        noConsumptionConfig: { ...validConfig, windowMinutes: 30 },
      })
    ).toThrow();
  });

  it('accepts an explicit activeHours window', () => {
    const parsed = CreateRuleSchema.parse({
      ...baseRule,
      noConsumptionConfig: { ...validConfig, activeHours: { start: '06:00', end: '22:00' } },
    });
    expect(parsed.noConsumptionConfig?.activeHours).toEqual({ start: '06:00', end: '22:00' });
  });
});
