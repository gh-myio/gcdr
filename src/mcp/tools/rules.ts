// RFC-0042/0043 — alarm-rules tools. List a customer's alarm rules, inspect a
// rule (Condition / Behavior / Schedule / Scope) with its devices, and compare
// rule sets between two customers. Read-only.
import { z } from 'zod';
import { McpContext, ToolResponse } from '../context';
import { resolveCustomer, CustomerRef } from './customers';
import { fuzzyMatch, normalize } from '../utils/fuzzyMatch';
import { DeviceRepository } from '../../repositories/DeviceRepository';
import { Rule } from '../../domain/entities/Rule';

const RULE_TYPE = ['ALARM_THRESHOLD', 'SLA', 'ESCALATION', 'MAINTENANCE_WINDOW', 'DEVICE_OFFLINE'] as const;

function customerNotFound(query: string): ToolResponse {
  return {
    success: false,
    message: `No customer matches "${query}"`,
    data: null,
    summary: `No customer matched "${query}". Use find_customer to resolve it.`,
  };
}

/** Device UUIDs a rule scopes (single entityId and/or the entityIds array). */
function ruleDeviceIds(rule: Rule): string[] {
  const ids = new Set<string>();
  if (rule.scope?.entityId) ids.add(rule.scope.entityId);
  if (rule.scope?.entityIds) for (const id of rule.scope.entityIds) ids.add(id);
  return [...ids];
}

// ── facet extractors (the 4 comparison dimensions) ────────────────────────────
function conditionFacet(rule: Rule): Record<string, unknown> {
  if (rule.type === 'ALARM_THRESHOLD' && rule.alarmConfig) {
    const a = rule.alarmConfig;
    return {
      metric: a.metric,
      operator: a.operator,
      value: a.value,
      valueHigh: a.valueHigh ?? null,
      unit: a.unit ?? null,
      duration: a.duration ?? null,
      aggregation: a.aggregation ?? null,
      aggregationWindow: a.aggregationWindow ?? null,
    };
  }
  if (rule.type === 'SLA' && rule.slaConfig) {
    const s = rule.slaConfig;
    return { metric: s.metric, target: s.target, unit: s.unit, period: s.period, method: s.calculationMethod };
  }
  return {};
}

function guardFlag(g?: { enabled: boolean }): boolean {
  return Boolean(g?.enabled);
}

function behaviorFacet(rule: Rule): Record<string, unknown> {
  const a = rule.alarmConfig;
  return {
    priority: rule.priority,
    guards: {
      dedup: guardFlag(a?.dedup),
      cooldown: guardFlag(a?.cooldown),
      hysteresisGuard: guardFlag(a?.hysteresisGuard),
      digest: guardFlag(a?.digest),
    },
    escalationLevels: rule.escalationConfig?.levels?.length ?? 0,
    channels: (rule.notificationChannels ?? [])
      .filter((c) => c.enabled)
      .map((c) => c.type)
      .sort(),
  };
}

function scheduleFacet(rule: Rule): Record<string, unknown> {
  if (rule.type === 'MAINTENANCE_WINDOW' && rule.maintenanceConfig) {
    const m = rule.maintenanceConfig;
    return {
      recurrence: m.recurrence ?? null,
      recurrenceDays: (m.recurrenceDays ?? []).slice().sort((x, y) => x - y),
      timezone: m.timezone,
    };
  }
  const a = rule.alarmConfig;
  return {
    startAt: a?.startAt ?? null,
    endAt: a?.endAt ?? null,
    daysOfWeek: (a?.daysOfWeek ?? []).slice().sort((x, y) => x - y),
  };
}

function scopeFacet(rule: Rule): Record<string, unknown> {
  return {
    type: rule.scope?.type ?? null,
    deviceCount: ruleDeviceIds(rule).length,
    profiles: (rule.scopeProfiles ?? []).slice().sort(),
  };
}

/** Stable JSON for value equality (sorted keys). */
function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce((acc, k) => {
            acc[k] = (v as Record<string, unknown>)[k];
            return acc;
          }, {} as Record<string, unknown>)
      : v,
  );
}

function ruleBrief(rule: Rule) {
  return {
    name: rule.name,
    type: rule.type,
    priority: rule.priority,
    enabled: rule.enabled,
    scopeType: rule.scope?.type ?? null,
    deviceCount: ruleDeviceIds(rule).length,
  };
}

async function resolveRule(ctx: McpContext, customerId: string, query: string): Promise<Rule | null> {
  const rules = await ctx.rules.getByCustomerId(ctx.tenantId, customerId);
  return fuzzyMatch(query, rules, [(r) => r.name, (r) => r.id]);
}

// ── list_alarm_rules ──────────────────────────────────────────────────────────
export const listAlarmRulesSchema = z.object({
  customer: z.string().describe('Customer name or code (fuzzy)'),
  type: z.enum(RULE_TYPE).optional(),
  enabled: z.boolean().optional(),
});

export async function listAlarmRules(
  ctx: McpContext,
  p: z.infer<typeof listAlarmRulesSchema>,
): Promise<ToolResponse> {
  const c = await resolveCustomer(ctx, p.customer);
  if (!c) return customerNotFound(p.customer);

  let rules = await ctx.rules.getByCustomerId(ctx.tenantId, c.id);
  if (p.type) rules = rules.filter((r) => r.type === p.type);
  if (p.enabled !== undefined) rules = rules.filter((r) => r.enabled === p.enabled);

  const items = rules.map(ruleBrief);
  const enabled = items.filter((r) => r.enabled).length;
  return {
    success: true,
    message: `${items.length} alarm rule(s) for ${c.name}`,
    data: { customer: c, rules: items },
    summary: `${c.name} has ${items.length} alarm rule(s) (${enabled} enabled).`,
  };
}

// ── get_alarm_rule ────────────────────────────────────────────────────────────
export const getAlarmRuleSchema = z.object({
  customer: z.string().describe('Customer name or code (fuzzy)'),
  rule: z.string().describe('Rule name (fuzzy)'),
});

export async function getAlarmRule(
  ctx: McpContext,
  p: z.infer<typeof getAlarmRuleSchema>,
): Promise<ToolResponse> {
  const c = await resolveCustomer(ctx, p.customer);
  if (!c) return customerNotFound(p.customer);
  const rule = await resolveRule(ctx, c.id, p.rule);
  if (!rule) {
    const rules = await ctx.rules.getByCustomerId(ctx.tenantId, c.id);
    return {
      success: false,
      message: `No rule matches "${p.rule}" for ${c.name}`,
      data: { available: rules.slice(0, 20).map((r) => r.name) },
      summary: `No rule matched "${p.rule}" for ${c.name}.`,
    };
  }

  const ids = ruleDeviceIds(rule);
  let devices: { id: string; name: string; serialNumber: string | null }[] = [];
  if (ids.length) {
    const repo = new DeviceRepository();
    const recs = await repo.listByIds(ctx.tenantId, ids);
    devices = recs.map((d) => ({
      id: d.id,
      name: d.displayName || d.name,
      serialNumber: d.serialNumber ?? null,
    }));
  }

  return {
    success: true,
    message: `Rule ${rule.name}`,
    data: {
      customer: c,
      name: rule.name,
      type: rule.type,
      enabled: rule.enabled,
      condition: conditionFacet(rule),
      behavior: behaviorFacet(rule),
      schedule: scheduleFacet(rule),
      scope: { ...scopeFacet(rule), devices },
    },
    summary: `${rule.name} (${rule.type}, ${rule.enabled ? 'enabled' : 'disabled'}) scopes ${
      devices.length
    } device(s) on ${c.name}.`,
  };
}

// ── get_rule_devices ──────────────────────────────────────────────────────────
export const getRuleDevicesSchema = z.object({
  customer: z.string().describe('Customer name or code (fuzzy)'),
  rule: z.string().describe('Rule name (fuzzy)'),
});

export async function getRuleDevices(
  ctx: McpContext,
  p: z.infer<typeof getRuleDevicesSchema>,
): Promise<ToolResponse> {
  const c = await resolveCustomer(ctx, p.customer);
  if (!c) return customerNotFound(p.customer);
  const rule = await resolveRule(ctx, c.id, p.rule);
  if (!rule) {
    return {
      success: false,
      message: `No rule matches "${p.rule}" for ${c.name}`,
      data: null,
      summary: `No rule matched "${p.rule}" for ${c.name}.`,
    };
  }

  const ids = ruleDeviceIds(rule);
  const repo = new DeviceRepository();
  const recs = ids.length ? await repo.listByIds(ctx.tenantId, ids) : [];
  const devices = recs.map((d) => ({
    name: d.displayName || d.name,
    serialNumber: d.serialNumber ?? null,
    code: d.code ?? null,
  }));

  return {
    success: true,
    message: `${devices.length} device(s) in rule ${rule.name}`,
    data: { rule: rule.name, scopeType: rule.scope?.type ?? null, devices },
    summary: `Rule "${rule.name}" (${c.name}) applies to ${devices.length} device(s)${
      rule.scopeProfiles?.length ? `, profiles: ${rule.scopeProfiles.join(', ')}` : ''
    }.`,
  };
}

// ── compare_alarm_rules ───────────────────────────────────────────────────────
export const compareAlarmRulesSchema = z.object({
  customerA: z.string().describe('First customer name or code (fuzzy)'),
  customerB: z.string().describe('Second customer name or code (fuzzy)'),
});

const FACETS = ['condition', 'behavior', 'schedule', 'scope'] as const;
function facetsOf(rule: Rule) {
  return {
    condition: conditionFacet(rule),
    behavior: behaviorFacet(rule),
    schedule: scheduleFacet(rule),
    scope: scopeFacet(rule),
  };
}

export async function compareAlarmRules(
  ctx: McpContext,
  p: z.infer<typeof compareAlarmRulesSchema>,
): Promise<ToolResponse> {
  const [a, b] = await Promise.all([
    resolveCustomer(ctx, p.customerA),
    resolveCustomer(ctx, p.customerB),
  ]);
  if (!a) return customerNotFound(p.customerA);
  if (!b) return customerNotFound(p.customerB);

  const [rulesA, rulesB] = await Promise.all([
    ctx.rules.getByCustomerId(ctx.tenantId, a.id),
    ctx.rules.getByCustomerId(ctx.tenantId, b.id),
  ]);

  // Match rules across customers by normalized name.
  const indexB = new Map(rulesB.map((r) => [normalize(r.name), r]));
  const matchedNamesB = new Set<string>();
  const matched: Array<Record<string, unknown>> = [];

  for (const ra of rulesA) {
    const rb = indexB.get(normalize(ra.name));
    if (!rb) continue;
    matchedNamesB.add(normalize(rb.name));
    const fa = facetsOf(ra);
    const fb = facetsOf(rb);
    const diffs = FACETS.filter((f) => canon(fa[f]) !== canon(fb[f]));
    matched.push({
      name: ra.name,
      identical: diffs.length === 0,
      differs: diffs,
      a: diffs.length ? Object.fromEntries(diffs.map((f) => [f, fa[f]])) : undefined,
      b: diffs.length ? Object.fromEntries(diffs.map((f) => [f, fb[f]])) : undefined,
    });
  }

  const onlyInA = rulesA
    .filter((r) => !indexB.has(normalize(r.name)))
    .map((r) => r.name);
  const onlyInB = rulesB
    .filter((r) => !matchedNamesB.has(normalize(r.name)))
    .map((r) => r.name);

  const identical = matched.filter((m) => m.identical).length;
  return {
    success: true,
    message: `Compared ${a.name} vs ${b.name}`,
    data: {
      customerA: a.name,
      customerB: b.name,
      counts: { a: rulesA.length, b: rulesB.length, matched: matched.length, identical },
      matched,
      onlyInA,
      onlyInB,
    },
    summary: `${a.name} (${rulesA.length}) vs ${b.name} (${rulesB.length}): ${matched.length} same-named rule(s), ${identical} identical across condition/behavior/schedule/scope; ${onlyInA.length} only in ${a.name}, ${onlyInB.length} only in ${b.name}.`,
  };
}
