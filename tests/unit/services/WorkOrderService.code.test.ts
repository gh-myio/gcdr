import { WorkOrderService } from '../../../src/services/work-orders/WorkOrderService';
import { generateWorkOrderCode } from '../../../src/services/work-orders/woCode';
import { ConflictError } from '../../../src/shared/errors/AppError';
import type { IWorkOrderRepository } from '../../../src/repositories/interfaces/work-orders/IWorkOrderRepository';
import type { ICustomerRepository } from '../../../src/repositories/interfaces/ICustomerRepository';
import type { IDeviceRepository } from '../../../src/repositories/interfaces/IDeviceRepository';
import type { IAssetRepository } from '../../../src/repositories/interfaces/IAssetRepository';

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const customerId = '33333333-3333-3333-3333-333333333333';
const woId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const ctx = { userId, actorType: 'USER' as const, actor: { id: userId } };

// OS- + Mercosul plate (LLLNLNN) without lookalikes I, O, 1, 0.
const CODE_PATTERN = /^OS-[A-HJ-NP-Z]{3}[2-9][A-HJ-NP-Z][2-9]{2}$/;

function makeService(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const wo = { id: woId, type: 'VISITA_TECNICA', status: 'PLANEJADA', code: 'OS-ABC2D34', assignedTo: null };
  const repo = {
    create: jest.fn().mockImplementation((_t, data) => Promise.resolve({ ...wo, ...data, id: woId })),
    getById: jest.fn().mockResolvedValue(wo),
    update: jest.fn().mockImplementation((_t, _id, data) => Promise.resolve({ ...wo, ...data })),
    codeExists: jest.fn().mockResolvedValue(false),
    appendEvent: jest.fn().mockImplementation((_t, _id, data) => Promise.resolve({ id: 'evt-1', ...data })),
    listDevices: jest.fn().mockResolvedValue([]),
    listEvents: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  const customerRepo = { getById: jest.fn().mockResolvedValue({ id: customerId }) };
  const deviceRepo = { getById: jest.fn().mockResolvedValue({ id: 'dev-1' }) };
  const assetRepo = { getById: jest.fn().mockResolvedValue({ id: 'asset-1' }) };
  const service = new WorkOrderService(
    repo as unknown as IWorkOrderRepository,
    customerRepo as unknown as ICustomerRepository,
    deviceRepo as unknown as IDeviceRepository,
    assetRepo as unknown as IAssetRepository,
  );
  return { service, repo };
}

describe('generateWorkOrderCode', () => {
  it('produces OS-<Mercosul plate> codes without I, O, 1 or 0', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateWorkOrderCode();
      expect(code).toMatch(CODE_PATTERN);
      expect(code.slice(3)).not.toMatch(/[IO10]/);
    }
  });
});

describe('WorkOrderService — code resolution on create', () => {
  it('generates a pattern-conforming code when none is provided', async () => {
    const { service, repo } = makeService();

    await service.create(tenantId, { customerId, type: 'VISITA_TECNICA' } as never, ctx);

    const created = repo.create.mock.calls[0][1];
    expect(created.code).toMatch(CODE_PATTERN);
  });

  it('retries generation when the candidate code is taken', async () => {
    const codeExists = jest.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const { service, repo } = makeService({ codeExists });

    await service.create(tenantId, { customerId, type: 'VISITA_TECNICA' } as never, ctx);

    expect(codeExists).toHaveBeenCalledTimes(2);
    expect(repo.create.mock.calls[0][1].code).toMatch(CODE_PATTERN);
  });

  it('keeps an explicit free code as-is', async () => {
    const { service, repo } = makeService();

    await service.create(tenantId, { customerId, type: 'VISITA_TECNICA', code: 'OS-CUSTOM' } as never, ctx);

    expect(repo.create.mock.calls[0][1].code).toBe('OS-CUSTOM');
  });

  it('rejects an explicit code that is already in use', async () => {
    const { service } = makeService({ codeExists: jest.fn().mockResolvedValue(true) });

    await expect(
      service.create(tenantId, { customerId, type: 'VISITA_TECNICA', code: 'OS-TAKEN' } as never, ctx),
    ).rejects.toThrow(ConflictError);
  });
});

describe('WorkOrderService — code uniqueness on update', () => {
  it('rejects changing the code to one already in use', async () => {
    const { service } = makeService({ codeExists: jest.fn().mockResolvedValue(true) });

    await expect(
      service.update(tenantId, woId, { code: 'OS-TAKEN' } as never, ctx),
    ).rejects.toThrow(ConflictError);
  });

  it('allows keeping the current code on update', async () => {
    const codeExists = jest.fn().mockResolvedValue(true);
    const { service, repo } = makeService({ codeExists });

    await service.update(tenantId, woId, { code: 'OS-ABC2D34' } as never, ctx);

    expect(codeExists).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });
});
