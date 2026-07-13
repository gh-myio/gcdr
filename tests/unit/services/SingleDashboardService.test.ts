// RFC-0053 — One-Store Dash: unit tests over mocked registry/goals singletons.
// Covers the device→group mapping (defaults + settings override + unassigned),
// the explainable health score and the goal progress block (raw + adjusted).

jest.mock('../../../src/services/DeviceService', () => ({
  deviceService: { listByCustomer: jest.fn() },
}));
jest.mock('../../../src/services/CustomerService', () => ({
  customerService: { getById: jest.fn() },
}));
jest.mock('../../../src/services/ConsumptionGoalService', () => ({
  consumptionGoalService: { get: jest.fn() },
}));
jest.mock('../../../src/services/RuleService', () => ({
  ruleService: { getByCustomerId: jest.fn() },
}));
jest.mock('../../../src/services/AnnotationService', () => ({
  annotationService: { list: jest.fn() },
}));

import { SingleDashboardService } from '../../../src/services/SingleDashboardService';
import { NullIngestionTelemetryClient } from '../../../src/services/IngestionTelemetryClient';
import { deviceService } from '../../../src/services/DeviceService';
import { customerService } from '../../../src/services/CustomerService';
import { consumptionGoalService } from '../../../src/services/ConsumptionGoalService';
import { ruleService } from '../../../src/services/RuleService';
import { annotationService } from '../../../src/services/AnnotationService';

const tenantId = '11111111-1111-1111-1111-111111111111';
const customerId = '84e0370e-636a-4741-9874-504b5e0b3577';

const mockedDevices = deviceService.listByCustomer as jest.Mock;
const mockedCustomer = customerService.getById as jest.Mock;
const mockedGoals = consumptionGoalService.get as jest.Mock;
const mockedRules = ruleService.getByCustomerId as jest.Mock;
const mockedAnnotations = annotationService.list as jest.Mock;

function device(partial: Record<string, unknown>) {
  return {
    id: 'dev-' + Math.random().toString(36).slice(2, 8),
    name: 'Device',
    connectivityStatus: 'UNKNOWN',
    ...partial,
  };
}

function goalResult(domain: string, withMargin: boolean) {
  return {
    customerId,
    domain,
    unit: domain === 'WATER' ? 'm3' : 'kWh',
    aggregationMethod: 'SUM',
    year: new Date().getFullYear(),
    version: 3,
    goalMargin: withMargin ? { goalMarginPct: -5, updatedBy: null, updatedAt: null } : null,
    tree: {
      annual: { value: 1200, adjustedValue: withMargin ? 1140 : 1200, method: 'SUM' },
      monthly: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          String(i + 1).padStart(2, '0'),
          { value: 100, adjustedValue: withMargin ? 95 : 100, method: 'SUM' },
        ]),
      ),
    },
  };
}

function makeService() {
  return new SingleDashboardService(new NullIngestionTelemetryClient());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedCustomer.mockResolvedValue({ id: customerId, name: 'Loja', displayName: 'Loja Teste', settings: {} });
  mockedGoals.mockImplementation((key: { domain: string }) => Promise.resolve(goalResult(key.domain, key.domain === 'ENERGY')));
  mockedDevices.mockResolvedValue({ items: [], total: 0 });
  mockedRules.mockResolvedValue([]);
  mockedAnnotations.mockResolvedValue({ items: [], pagination: { hasMore: false, total: 0 } });
});

describe('SingleDashboardService — RFC-0053', () => {
  it('groups devices by profile/type keywords and surfaces unmatched as unassigned', async () => {
    mockedDevices.mockResolvedValue({
      items: [
        device({ id: 'd1', name: 'Medidor Geral', deviceType: '3F_MEDIDOR' }),
        device({ id: 'd2', name: 'Hidrômetro Cozinha', deviceProfile: 'HIDROMETRO_AREA_COMUM' }),
        device({ id: 'd3', name: 'Freezer 2', deviceType: 'TERMOMETRO' }),
        device({ id: 'd4', name: 'Caixa Superior', deviceType: 'NIVEL_CAIXA' }),
        device({ id: 'd5', name: 'Bomba Recalque' }),
        device({ id: 'd6', name: 'Sensor Presença', deviceChannelType: 'presence_sensor' }),
      ],
    });
    const result = await makeService().get(tenantId, customerId, {});

    const byKey = Object.fromEntries(result.groups.map((g) => [g.key, g.devices.map((d) => d.id)]));
    expect(byKey.energy).toEqual(['d1']);
    expect(byKey.water).toEqual(['d2']);
    expect(byKey.temperature).toEqual(['d3']);
    expect(byKey.tanks).toEqual(expect.arrayContaining(['d4', 'd5']));
    expect(result.unassigned.map((d) => d.id)).toEqual(['d6']);
  });

  it('applies customer.settings.singleDashboard.groupOverrides before default rules', async () => {
    mockedCustomer.mockResolvedValue({
      id: customerId,
      name: 'Loja',
      displayName: 'Loja Teste',
      settings: { singleDashboard: { groupOverrides: { d1: 'tanks' } } },
    });
    mockedDevices.mockResolvedValue({
      items: [device({ id: 'd1', name: 'Medidor Geral', deviceType: '3F_MEDIDOR' })],
    });
    const result = await makeService().get(tenantId, customerId, {});

    const tanks = result.groups.find((g) => g.key === 'tanks')!;
    const energy = result.groups.find((g) => g.key === 'energy')!;
    expect(tanks.devices.map((d) => d.id)).toEqual(['d1']);
    expect(energy.deviceCount).toBe(0);
  });

  it('computes an explainable health score from connectivity (alarms/telemetry pending)', async () => {
    mockedDevices.mockResolvedValue({
      items: [
        device({ id: 'd1', name: 'Medidor', deviceType: '3F_MEDIDOR', connectivityStatus: 'ONLINE' }),
        device({ id: 'd2', name: 'Hidro', deviceType: 'HIDROMETRO', connectivityStatus: 'OFFLINE' }),
        device({ id: 'd3', name: 'Termo', deviceType: 'TERMOMETRO', connectivityStatus: 'OFFLINE' }),
        device({ id: 'd4', name: 'Caixa', deviceType: 'CAIXA_DAGUA', connectivityStatus: 'ONLINE' }),
      ],
    });
    const result = await makeService().get(tenantId, customerId, {});

    // 2/4 offline → ratio penalty capped at 20.
    const offlineComponent = result.health.components.find((c) => c.key === 'offlineSensors')!;
    expect(offlineComponent.penalty).toBe(20);
    expect(result.health.score).toBe(80);
    expect(result.health.components).toHaveLength(3);
  });

  it('returns goal progress with raw and RFC-0052 adjusted targets for the current month', async () => {
    const result = await makeService().get(tenantId, customerId, {});

    const energy = result.goals.find((g) => g.domain === 'ENERGY')!;
    expect(energy.goalMarginPct).toBe(-5);
    expect(energy.monthTarget).toBe(100);
    expect(energy.monthTargetAdjusted).toBe(95);
    expect(energy.annualTargetAdjusted).toBe(1140);
    expect(energy.monthConsumption).toBeNull(); // telemetry pending (Q1)

    const water = result.goals.find((g) => g.domain === 'WATER')!;
    expect(water.goalMarginPct).toBeNull();
    expect(water.monthTargetAdjusted).toBe(100);
  });

  it('degrades telemetry to unavailable with the pending-contract reason', async () => {
    mockedDevices.mockResolvedValue({
      items: [device({ id: 'd1', name: 'Medidor', deviceType: '3F_MEDIDOR', ingestionId: 'ing-1' })],
    });
    const result = await makeService().get(tenantId, customerId, {});

    const energy = result.groups.find((g) => g.key === 'energy')!;
    expect(energy.telemetry).toEqual({ available: false, reason: 'INGESTION_CONTRACT_PENDING' });
    expect(energy.devices[0].telemetry).toBeNull();
    expect(result.insights).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('consolidates alarm rules by priority and annotations by type', async () => {
    mockedRules.mockResolvedValue([
      { id: 'r1', priority: 'CRITICAL', enabled: true },
      { id: 'r2', priority: 'HIGH', enabled: true },
      { id: 'r3', priority: 'HIGH', enabled: true },
      { id: 'r4', priority: 'LOW', enabled: false },
    ]);
    mockedAnnotations.mockResolvedValue({
      items: [
        { id: 'a1', text: 'Trocar filtro', type: 'maintenance', importance: 4, status: 'created', createdAt: '2026-07-10T10:00:00Z', createdBy: { name: 'Rodrigo' } },
        { id: 'a2', text: 'Sensor instável', type: 'observation', importance: 3, status: 'created', createdAt: '2026-07-09T10:00:00Z', createdBy: { email: 'x@y.z' } },
      ],
      pagination: { hasMore: false, total: 2 },
    });
    const result = await makeService().get(tenantId, customerId, {});

    expect(result.alarms).toEqual({
      rulesTotal: 4,
      rulesEnabled: 3,
      byPriority: { CRITICAL: 1, HIGH: 2 },
      active: null, // orchestrator integration pending (RFC-0053 Q2)
    });
    expect(result.annotations?.total).toBe(2);
    expect(result.annotations?.byType).toEqual({ maintenance: 1, observation: 1 });
    expect(result.annotations?.recent[0]).toMatchObject({ id: 'a1', createdByName: 'Rodrigo' });
    expect(result.annotations?.recent[1]).toMatchObject({ id: 'a2', createdByName: 'x@y.z' });
  });

  it('collects per-section errors instead of failing the whole snapshot', async () => {
    mockedGoals.mockRejectedValue(new Error('goals backend down'));
    const result = await makeService().get(tenantId, customerId, {});

    expect(result.goals).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ section: 'goals:ENERGY' }),
        expect.objectContaining({ section: 'goals:WATER' }),
      ]),
    );
  });
});
