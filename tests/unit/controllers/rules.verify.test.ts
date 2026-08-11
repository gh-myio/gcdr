import type { Request, Response } from 'express';
import { getAlarmBundleVerifyHandler } from '../../../src/controllers/rules.controller';
import { alarmBundleService } from '../../../src/services/AlarmBundleService';

// RFC-0055 — the Alarms Orchestrator consumes /alarm-rules/bundle/to-verify-service.
// verifyBundle already builds noConsumptionRules; the handler must forward them
// (and only them — not on /simple, which is Node-RED). These tests pin that the
// field is passed through when present and omitted when absent.

jest.mock('../../../src/services/AlarmBundleService', () => ({
  alarmBundleService: { verifyBundle: jest.fn() },
}));

const verifyBundleMock = alarmBundleService.verifyBundle as jest.Mock;

interface VerifyData {
  versionId: string;
  deviceIndex: unknown;
  rules: unknown;
  noConsumptionRules?: unknown[];
}

function mockRes(): { res: Response; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn();
  const set = jest.fn();
  const res = { status, json, set } as unknown as Response;
  status.mockReturnValue(res);
  json.mockReturnValue(res);
  set.mockReturnValue(res);
  return { res, json };
}

function mockReq(): Request {
  return {
    context: { tenantId: 't-1', requestId: 'req-1' },
    params: { customerId: '84e0370e-636a-4741-9874-504b5e0b3577' },
    query: {},
    headers: {},
  } as unknown as Request;
}

const baseBundle = {
  meta: { version: 'v-1' },
  deviceIndex: { 'dev-1': { deviceName: 'x' } },
  rules: { 'rule-1': { id: 'rule-1' } },
};

function dataFrom(json: jest.Mock): VerifyData {
  return (json.mock.calls[0][0] as { data: VerifyData }).data;
}

describe('getAlarmBundleVerifyHandler — RFC-0055 noConsumptionRules on to-verify-service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('forwards noConsumptionRules to the Alarms consumer when present', async () => {
    const nc = [
      {
        id: 'nc-1',
        name: 'Sem consumo (1h)',
        priority: 'MEDIUM',
        scope: { type: 'CUSTOMER', entityIds: ['84e0370e-636a-4741-9874-504b5e0b3577'] },
        config: { metric: 'energy_consumption', windowMinutes: 60 },
      },
    ];
    verifyBundleMock.mockResolvedValue({ ...baseBundle, noConsumptionRules: nc });

    const { res, json } = mockRes();
    await getAlarmBundleVerifyHandler(mockReq(), res, jest.fn());

    const data = dataFrom(json);
    expect(data.noConsumptionRules).toEqual(nc);
    expect(data.rules).toEqual(baseBundle.rules);
    expect(data.deviceIndex).toEqual(baseBundle.deviceIndex);
    expect(data.versionId).toBe('v-1');
  });

  it('omits noConsumptionRules when the customer has none (empty array)', async () => {
    verifyBundleMock.mockResolvedValue({ ...baseBundle, noConsumptionRules: [] });

    const { res, json } = mockRes();
    await getAlarmBundleVerifyHandler(mockReq(), res, jest.fn());

    expect(dataFrom(json)).not.toHaveProperty('noConsumptionRules');
  });

  it('omits noConsumptionRules when the field is absent', async () => {
    verifyBundleMock.mockResolvedValue({ ...baseBundle });

    const { res, json } = mockRes();
    await getAlarmBundleVerifyHandler(mockReq(), res, jest.fn());

    expect(dataFrom(json)).not.toHaveProperty('noConsumptionRules');
  });
});
