// =============================================================================
// RFC-0053 — One-Store Dash: aggregation service
//
// Composes the single-store operational snapshot from what GCDR already owns:
//   - devices (grouped energy/water/temperature/tanks by profile/type, with
//     per-customer overrides in customer.settings.singleDashboard);
//   - consumption goals with the RFC-0052 margin overlay (raw + adjusted);
//   - connectivity-derived health score (explainable breakdown, §4.3);
//   - live telemetry through IngestionTelemetryClient (§4.2) — currently the
//     Null stub (RFC-0053 Q1), so groups degrade to registry-only cards.
//
// Insights (§4.5) are heuristics over the telemetry window; with the Null
// telemetry client none of them can fire, so the evaluator returns an empty
// list with the contract in place for the real client.
// =============================================================================

import { Device } from '../domain/entities/Device';
import { deviceService } from './DeviceService';
import { customerService } from './CustomerService';
import { ruleService } from './RuleService';
import { annotationService } from './AnnotationService';
import { consumptionGoalService, GoalGetResult } from './ConsumptionGoalService';
import {
  IngestionTelemetryClient,
  ingestionTelemetryClient,
  GroupTelemetryResult,
  TelemetryRange,
} from './IngestionTelemetryClient';
import type { GoalDomain } from '../dto/request/GoalsDTO';

// -----------------------------------------------------------------------------
// Response shapes (mirrored 1:1 by the frontend types)
// -----------------------------------------------------------------------------

export type SingleDashGroupKey = 'energy' | 'water' | 'temperature' | 'tanks';

export const SINGLE_DASH_GROUP_KEYS: SingleDashGroupKey[] = ['energy', 'water', 'temperature', 'tanks'];

export interface SingleDashDeviceCard {
  id: string;
  name: string;
  label?: string;
  identifier?: string;
  deviceType?: string;
  deviceProfile?: string;
  connectivityStatus: string;
  lastActivityTime?: string;
  /** Period figures from the telemetry read-through; null while unavailable. */
  telemetry: {
    instant?: number;
    periodTotal?: number;
    monthTotal?: number;
    sparkline?: number[];
  } | null;
}

export interface SingleDashGroup {
  key: SingleDashGroupKey;
  deviceCount: number;
  online: number;
  offline: number;
  unknown: number;
  devices: SingleDashDeviceCard[];
  telemetry: { available: boolean; reason?: string };
}

export interface SingleDashHealthComponent {
  key: 'activeAlarms' | 'offlineSensors' | 'outOfRange';
  penalty: number;
  detail: string;
}

export interface SingleDashHealth {
  score: number;
  components: SingleDashHealthComponent[];
}

export interface SingleDashGoalProgress {
  domain: GoalDomain;
  unit: string;
  year: number;
  version: number;
  goalMarginPct: number | null;
  monthRef: string; // "2026-07"
  monthTarget: number | null;
  monthTargetAdjusted: number | null;
  annualTarget: number | null;
  annualTargetAdjusted: number | null;
  /** Month-to-date consumption — needs telemetry; null until Q1 lands. */
  monthConsumption: number | null;
}

export interface SingleDashInsight {
  key: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  groupKey?: SingleDashGroupKey;
  deviceId?: string;
  estimatedImpact?: string;
  detectedAt: string;
}

/** Consolidated alarms card: rule inventory today; ACTIVE alarms pend Q2. */
export interface SingleDashAlarmsSummary {
  rulesTotal: number;
  rulesEnabled: number;
  /** Enabled rules by priority (CRITICAL | HIGH | MEDIUM | LOW). */
  byPriority: Record<string, number>;
  /** Active-alarm count — null until the orchestrator integration (RFC-0053 Q2). */
  active: number | null;
}

/** Consolidated annotations card for the customer (RFC-0036 aggregate). */
export interface SingleDashAnnotationsSummary {
  total: number;
  /** Non-archived annotations by type (observation | pending | maintenance | activity). */
  byType: Record<string, number>;
  recent: Array<{
    id: string;
    text: string;
    type: string;
    importance: number;
    status: string;
    createdAt: string;
    createdByName: string | null;
  }>;
}

export interface SingleDashboardResult {
  customerId: string;
  customerName: string;
  range: TelemetryRange;
  groups: SingleDashGroup[];
  /** Devices no rule or override could place — surfaced, never hidden (§3.3). */
  unassigned: SingleDashDeviceCard[];
  health: SingleDashHealth;
  goals: SingleDashGoalProgress[];
  insights: SingleDashInsight[];
  alarms: SingleDashAlarmsSummary | null;
  annotations: SingleDashAnnotationsSummary | null;
  /** Per-section soft failures (partial responses instead of 5xx, §4.2). */
  errors: Array<{ section: string; message: string }>;
}

/** Per-customer overrides block (customer.settings.singleDashboard, §4.4). */
interface SingleDashboardSettings {
  groupOverrides?: Record<string, SingleDashGroupKey>;
}

// -----------------------------------------------------------------------------
// Default device → group mapping (§3.3). First matching rule wins; matching is
// case-insensitive over deviceProfile, deviceType and name. Overrides from
// customer.settings.singleDashboard.groupOverrides take precedence.
// -----------------------------------------------------------------------------

const GROUP_RULES: Array<{ group: SingleDashGroupKey; pattern: RegExp }> = [
  // Tanks first: pump/level/tank names would otherwise leak into water/energy.
  { group: 'tanks', pattern: /CAIXA|TANQUE|TANK|RESERVAT|NIVEL|N[IÍ]VEL|BOMBA|PRESSURIZA/i },
  // Solenoid valves belong to the water panel (MAIN_BAS convention).
  { group: 'water', pattern: /HIDR|WATER|[AÁ]GUA|SOLEN/i },
  { group: 'temperature', pattern: /TERM|TEMP|FREEZER|CAMARA|C[AÂ]MARA|GELADEIRA|ADEGA/i },
  {
    group: 'energy',
    pattern: /MEDIDOR|3F|RELOGIO|REL[OÓ]GIO|QGBT|ENERG|CHILLER|FANCOIL|HVAC|AR[_ ]?COND|ILUMINA|LAMP|TOMADA|COMPRESSOR/i,
  },
];

const GOAL_DOMAINS: GoalDomain[] = ['ENERGY', 'WATER'];

const MAX_STORE_DEVICES = 1000;

export class SingleDashboardService {
  constructor(private readonly telemetry: IngestionTelemetryClient = ingestionTelemetryClient) {}

  async get(tenantId: string, customerId: string, range: TelemetryRange): Promise<SingleDashboardResult> {
    const errors: SingleDashboardResult['errors'] = [];

    // 404s propagate: a dashboard for a missing customer is a client error.
    const customer = await customerService.getById(tenantId, customerId);
    const settings = this.settingsOf(customer.settings);

    const page = await deviceService.listByCustomer(tenantId, customerId, { limit: MAX_STORE_DEVICES });
    const devices = page.items.filter((d) => !d.deletedAt);

    // ── Grouping ──────────────────────────────────────────────────────────────
    const grouped = new Map<SingleDashGroupKey, Device[]>(SINGLE_DASH_GROUP_KEYS.map((k) => [k, []]));
    const unassigned: Device[] = [];
    for (const device of devices) {
      const group = this.groupOf(device, settings);
      if (group) grouped.get(group)!.push(device);
      else unassigned.push(device);
    }

    // ── Telemetry read-through (one batch; degrades to unavailable) ──────────
    let telemetryResult: GroupTelemetryResult;
    try {
      const ingestionIds: Record<string, string> = {};
      for (const d of devices) {
        if (d.ingestionId) ingestionIds[d.id] = d.ingestionId;
      }
      telemetryResult = await this.telemetry.fetchBatch(ingestionIds, range);
    } catch (err) {
      telemetryResult = { available: false, reason: 'UPSTREAM_ERROR', byDevice: {} };
      errors.push({ section: 'telemetry', message: err instanceof Error ? err.message : String(err) });
    }

    const groups: SingleDashGroup[] = SINGLE_DASH_GROUP_KEYS.map((key) =>
      this.buildGroup(key, grouped.get(key)!, telemetryResult),
    );

    // ── Goals (raw + RFC-0052 adjusted) ───────────────────────────────────────
    const goals: SingleDashGoalProgress[] = [];
    const now = new Date();
    for (const domain of GOAL_DOMAINS) {
      try {
        const result = await consumptionGoalService.get(
          { tenantId, customerId, domain, year: now.getFullYear() },
          'month',
          false,
        );
        goals.push(this.buildGoalProgress(domain, result, now));
      } catch (err) {
        errors.push({ section: `goals:${domain}`, message: err instanceof Error ? err.message : String(err) });
      }
    }

    const health = this.buildHealth(devices);
    const insights = this.evaluateInsights(telemetryResult);

    // ── Consolidated alarms (rule inventory; active alarms pend Q2) ───────────
    let alarms: SingleDashAlarmsSummary | null = null;
    try {
      alarms = await this.buildAlarmsSummary(tenantId, customerId);
    } catch (err) {
      errors.push({ section: 'alarms', message: err instanceof Error ? err.message : String(err) });
    }

    // ── Consolidated annotations (RFC-0036, customer-wide) ────────────────────
    let annotations: SingleDashAnnotationsSummary | null = null;
    try {
      annotations = await this.buildAnnotationsSummary(tenantId, customerId);
    } catch (err) {
      errors.push({ section: 'annotations', message: err instanceof Error ? err.message : String(err) });
    }

    return {
      customerId,
      customerName: customer.displayName || customer.name,
      range,
      groups,
      unassigned: unassigned.map((d) => this.buildDeviceCard(d, telemetryResult)),
      health,
      goals,
      insights,
      alarms,
      annotations,
      errors,
    };
  }

  /** Rule inventory grouped by priority; `active` stays null until RFC-0053 Q2. */
  private async buildAlarmsSummary(tenantId: string, customerId: string): Promise<SingleDashAlarmsSummary> {
    const rules = await ruleService.getByCustomerId(tenantId, customerId);
    const enabled = rules.filter((r) => r.enabled);
    const byPriority: Record<string, number> = {};
    for (const r of enabled) {
      const p = String(r.priority || 'MEDIUM').toUpperCase();
      byPriority[p] = (byPriority[p] ?? 0) + 1;
    }
    return { rulesTotal: rules.length, rulesEnabled: enabled.length, byPriority, active: null };
  }

  /** Customer-wide annotation roll-up: counts by type + the 5 most recent. */
  private async buildAnnotationsSummary(
    tenantId: string,
    customerId: string,
  ): Promise<SingleDashAnnotationsSummary> {
    const page = await annotationService.list(tenantId, { customerId, limit: 100 });
    const items = page.items ?? [];
    const byType: Record<string, number> = {};
    for (const a of items) {
      byType[a.type] = (byType[a.type] ?? 0) + 1;
    }
    const recent = items.slice(0, 5).map((a) => ({
      id: a.id,
      text: a.text,
      type: a.type,
      importance: a.importance,
      status: a.status,
      createdAt: a.createdAt,
      createdByName: a.createdBy?.name ?? a.createdBy?.email ?? null,
    }));
    return { total: page.pagination?.total ?? items.length, byType, recent };
  }

  // ---------------------------------------------------------------------------
  // Grouping
  // ---------------------------------------------------------------------------

  private settingsOf(raw: unknown): SingleDashboardSettings {
    if (raw && typeof raw === 'object' && 'singleDashboard' in (raw as Record<string, unknown>)) {
      const block = (raw as Record<string, unknown>).singleDashboard;
      if (block && typeof block === 'object') return block as SingleDashboardSettings;
    }
    return {};
  }

  /** Override first; then the first matching default rule; else unassigned. */
  private groupOf(device: Device, settings: SingleDashboardSettings): SingleDashGroupKey | null {
    const override = settings.groupOverrides?.[device.id];
    if (override && SINGLE_DASH_GROUP_KEYS.includes(override)) return override;

    const haystack = [device.deviceProfile, device.deviceType, device.name, device.label]
      .filter(Boolean)
      .join(' ');
    for (const rule of GROUP_RULES) {
      if (rule.pattern.test(haystack)) return rule.group;
    }
    return null;
  }

  private buildGroup(key: SingleDashGroupKey, devices: Device[], telemetry: GroupTelemetryResult): SingleDashGroup {
    let online = 0;
    let offline = 0;
    let unknown = 0;
    for (const d of devices) {
      const s = (d.connectivityStatus || '').toUpperCase();
      if (s === 'ONLINE') online++;
      else if (s === 'OFFLINE') offline++;
      else unknown++;
    }
    return {
      key,
      deviceCount: devices.length,
      online,
      offline,
      unknown,
      devices: devices.map((d) => this.buildDeviceCard(d, telemetry)),
      telemetry: { available: telemetry.available, ...(telemetry.reason ? { reason: telemetry.reason } : {}) },
    };
  }

  private buildDeviceCard(device: Device, telemetry: GroupTelemetryResult): SingleDashDeviceCard {
    const t = telemetry.byDevice[device.id];
    return {
      id: device.id,
      name: device.name,
      label: device.label,
      identifier: device.identifier,
      deviceType: device.deviceType,
      deviceProfile: device.deviceProfile,
      connectivityStatus: device.connectivityStatus,
      lastActivityTime: device.lastActivityTime,
      telemetry: t ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Health (§4.3) — deterministic, always explainable via components[].
  // Active-alarm penalties are wired but score 0 until the alarm source lands
  // (RFC-0053 Q2); connectivity is computable today.
  // ---------------------------------------------------------------------------

  private buildHealth(devices: Device[]): SingleDashHealth {
    const total = devices.length;
    const offline = devices.filter((d) => (d.connectivityStatus || '').toUpperCase() === 'OFFLINE').length;

    const offlinePenalty = total === 0 ? 0 : Math.min(20, Math.round((offline / total) * 100));

    const components: SingleDashHealthComponent[] = [
      {
        key: 'activeAlarms',
        penalty: 0,
        detail: 'Active-alarm source pending (RFC-0053 Q2)',
      },
      {
        key: 'offlineSensors',
        penalty: offlinePenalty,
        detail: `${offline}/${total} devices offline`,
      },
      {
        key: 'outOfRange',
        penalty: 0,
        detail: 'Needs telemetry (RFC-0053 Q1)',
      },
    ];

    const score = Math.max(0, 100 - components.reduce((sum, c) => sum + c.penalty, 0));
    return { score, components };
  }

  // ---------------------------------------------------------------------------
  // Goals — reuses the RFC-0046/0052 read model (value + adjustedValue).
  // ---------------------------------------------------------------------------

  private buildGoalProgress(domain: GoalDomain, result: GoalGetResult, now: Date): SingleDashGoalProgress {
    const monthKey = String(now.getMonth() + 1).padStart(2, '0');
    const monthNode = result.tree.monthly?.[monthKey];
    const annualNode = result.tree.annual;
    return {
      domain,
      unit: result.unit,
      year: result.year,
      version: result.version,
      goalMarginPct: result.goalMargin?.goalMarginPct ?? null,
      monthRef: `${result.year}-${monthKey}`,
      monthTarget: monthNode?.value ?? null,
      monthTargetAdjusted: monthNode?.adjustedValue ?? null,
      annualTarget: annualNode?.value ?? null,
      annualTargetAdjusted: annualNode?.adjustedValue ?? null,
      monthConsumption: null, // telemetry-dependent (RFC-0053 Q1)
    };
  }

  // ---------------------------------------------------------------------------
  // Insights (§4.5) — every heuristic needs the telemetry window; with the
  // Null client the evaluator returns []. The switch below is the extension
  // point for night-flow-leak / baseline-deviation / temp-out-of-range /
  // runtime-increase / refill-frequency / goal-pace once Q1 lands.
  // ---------------------------------------------------------------------------

  private evaluateInsights(telemetry: GroupTelemetryResult): SingleDashInsight[] {
    if (!telemetry.available) return [];
    return [];
  }
}

export const singleDashboardService = new SingleDashboardService();
