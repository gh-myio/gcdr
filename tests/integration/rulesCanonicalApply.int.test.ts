/**
 * RFC-0062 Monitor D — real-PostgreSQL integration for the canonical apply.
 *
 * GATED: only runs when INTEGRATION_DATABASE_URL is set (the local
 * docker-compose DB on :5544). Without it the suite is skipped, so CI without a
 * DB stays green.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/db_gcdr \
 *     npx jest tests/integration/rulesCanonicalApply.int.test.ts
 *
 * Proves what the pure-logic unit tests CANNOT: the actual writes against the
 * real schema. It is the regression guard for the class of bug the unit tests
 * missed — rules.updated_by is a uuid column, so a non-UUID actor makes every
 * MUTE/RESTORE UPDATE throw and roll back (muted:0, errors:1). Here that would
 * fail loudly instead of silently never muting.
 */
process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY ?? 'a'.repeat(64);

import * as crypto from 'crypto';
import postgres from 'postgres';
import { applyRuleMutes, applyRuleRestores } from '../../src/workers/orchestrator-devices/rulesCanonicalApply';
import { resolveDailyBucketCap } from '../../src/workers/orchestrator-devices/rulesCap';
import type { RuleProposalGroup } from '../../src/workers/orchestrator-devices/rulesMonitor';

const HAS_DB = !!process.env.INTEGRATION_DATABASE_URL;
const describeDb = HAS_DB ? describe : describe.skip;

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '84e0370e-636a-4741-9874-504b5e0b3577';
const TZ = 'America/Sao_Paulo';
const noopLog = () => {};

function localDay(tz: string, nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}

describeDb('rulesCanonicalApply on real PG (RFC-0062 Monitor D)', () => {
  let seed: ReturnType<typeof postgres>;
  const ruleId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();

  beforeAll(() => {
    seed = postgres(process.env.INTEGRATION_DATABASE_URL as string, { max: 1 });
  });
  afterAll(async () => {
    await seed`DELETE FROM orchestrator_rule_mutes WHERE rule_id = ${ruleId}`;
    await seed`DELETE FROM rules WHERE id = ${ruleId}`;
    await seed.end({ timeout: 5 });
  });

  async function seedRule(scope: string[]): Promise<void> {
    // replica role bypasses the customer_id FK so we need not seed a customer.
    await seed`SET session_replication_role = 'replica'`;
    await seed`DELETE FROM orchestrator_rule_mutes WHERE rule_id = ${ruleId}`;
    await seed`DELETE FROM rules WHERE id = ${ruleId}`;
    await seed`
      INSERT INTO rules (id, tenant_id, customer_id, name, type, scope_type,
                         scope_entity_ids, status, enabled, version, no_consumption_config)
      VALUES (${ruleId}, ${TENANT}, ${CUSTOMER}, 'itest NC', 'NO_CONSUMPTION', 'DEVICE',
              ${seed.array(scope)}::uuid[], 'ACTIVE', true, 1,
              ${seed.json({ metric: 'energy_consumption', windowMinutes: 60, minSamplesPerWindow: 1, graceWindows: 1, timezone: TZ, maxDailyBucketsPerDay: 3 })})`;
  }

  function muteGroup(today: string): RuleProposalGroup {
    const cap = resolveDailyBucketCap({ maxDailyBucketsPerDay: 3 });
    return {
      ruleId, tenantId: TENANT, customerId: CUSTOMER, timezone: TZ, today, cap,
      scopeCount: 1, countsChecked: 1,
      actions: [{ ruleId, deviceId, action: 'MUTE', todayCount: 3, cap: 3, reason: 'DAILY_CAP' }],
    };
  }

  it('MUTE: removes the device from scope AND writes the canonical ledger row (uuid actor)', async () => {
    const today = localDay(TZ, Date.now());
    await seedRule([deviceId]); // scope starts with exactly this one device

    const res = await applyRuleMutes([muteGroup(today)], Date.now(), noopLog);

    // The uuid-actor bug would surface here as errors:1 / muted:0.
    expect(res.errors).toBe(0);
    expect(res.muted).toBe(1);

    const [rule] = await seed`SELECT scope_entity_ids, updated_by, version FROM rules WHERE id = ${ruleId}`;
    expect(rule.scope_entity_ids).toEqual([]); // empty-scope case: last device removed
    expect(rule.version).toBe(2); // version-bumped
    expect(rule.updated_by).toMatch(/^[0-9a-f-]{36}$/); // a real uuid, not 'orchestrator-devices'

    const mutes = await seed`SELECT device_id, reason, mode, timezone, restored_at, today_count, max_daily FROM orchestrator_rule_mutes WHERE rule_id = ${ruleId} AND restored_at IS NULL`;
    expect(mutes.length).toBe(1);
    expect(mutes[0].device_id).toBe(deviceId);
    expect(mutes[0].reason).toBe('DAILY_CAP');
    expect(mutes[0].mode).toBe('canonical');
    expect(mutes[0].timezone).toBe(TZ);
    expect(mutes[0].today_count).toBe(3);
    expect(mutes[0].max_daily).toBe(3);
  });

  it('RESTORE: at day rollover, re-adds the device once and closes the ledger row', async () => {
    // Backdate the still-active mute to a previous local day so it is due.
    await seed`UPDATE orchestrator_rule_mutes SET local_day = '2000-01-01' WHERE rule_id = ${ruleId} AND restored_at IS NULL`;

    const res = await applyRuleRestores(Date.now(), noopLog);
    expect(res.errors).toBe(0);
    expect(res.restored).toBeGreaterThanOrEqual(1);

    const [rule] = await seed`SELECT scope_entity_ids FROM rules WHERE id = ${ruleId}`;
    expect(rule.scope_entity_ids).toContain(deviceId); // device is back in scope

    const [mute] = await seed`SELECT reason, restored_at FROM orchestrator_rule_mutes WHERE rule_id = ${ruleId} AND device_id = ${deviceId} ORDER BY muted_at DESC LIMIT 1`;
    expect(mute.reason).toBe('DAY_ROLLOVER');
    expect(mute.restored_at).not.toBeNull(); // closed, kept as history

    // Idempotent: a second restore pass finds nothing pending.
    const again = await applyRuleRestores(Date.now(), noopLog);
    expect(again.restored).toBe(0);
  });
});
