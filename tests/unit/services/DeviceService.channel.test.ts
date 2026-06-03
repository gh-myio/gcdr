import { DeviceService } from '../../../src/services/DeviceService';
import { ConflictError } from '../../../src/shared/errors/AppError';
import type { IDeviceRepository } from '../../../src/repositories/interfaces/IDeviceRepository';
import type { IAssetRepository } from '../../../src/repositories/interfaces/IAssetRepository';

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const assetId = '33333333-3333-3333-3333-333333333333';
const customerId = '44444444-4444-4444-4444-444444444444';
const centralId = '55555555-5555-5555-5555-555555555555';

function makeService() {
  const deviceRepo = {
    getBySerialNumber: jest.fn().mockResolvedValue(null),
    getByExternalId: jest.fn().mockResolvedValue(null),
    findBySlaveId: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((_t, data) => Promise.resolve({ id: 'dev-1', ...data })),
  };
  const assetRepo = {
    getById: jest.fn().mockResolvedValue({ id: assetId, customerId }),
  };
  const service = new DeviceService(
    deviceRepo as unknown as IDeviceRepository,
    assetRepo as unknown as IAssetRepository,
    {} as never,
    {} as never,
  );
  return { service, deviceRepo, assetRepo };
}

const baseData = {
  assetId,
  name: 'SW QGBT Lamp 1',
  type: 'OUTLET' as const,
  centralId,
  slaveId: 1,
};

describe('DeviceService.create — channel-aware (central, slave) uniqueness', () => {
  it('passes channel + deviceChannelType to the duplicate lookup', async () => {
    const { service, deviceRepo } = makeService();

    await service.create(tenantId, { ...baseData, channel: 0, deviceChannelType: 'lamp' } as never, userId);

    expect(deviceRepo.findBySlaveId).toHaveBeenCalledWith(tenantId, centralId, 1, 0, 'lamp');
    expect(deviceRepo.create).toHaveBeenCalled();
  });

  it('defaults absent channel/type to null in the lookup (board-level check preserved)', async () => {
    const { service, deviceRepo } = makeService();

    await service.create(tenantId, { ...baseData } as never, userId);

    expect(deviceRepo.findBySlaveId).toHaveBeenCalledWith(tenantId, centralId, 1, null, null);
  });

  it('allows the same (central, slave) when channel differs (no existing match)', async () => {
    const { service, deviceRepo } = makeService();
    deviceRepo.findBySlaveId.mockResolvedValue(null); // nothing on channel 1

    const created = await service.create(
      tenantId,
      { ...baseData, channel: 1, deviceChannelType: 'lamp' } as never,
      userId,
    );

    expect(created).toBeTruthy();
    expect(deviceRepo.create).toHaveBeenCalled();
  });

  it('throws ConflictError when the same (central, slave, channel, type) already exists', async () => {
    const { service, deviceRepo } = makeService();
    deviceRepo.findBySlaveId.mockResolvedValue({ id: 'existing-dev' });

    await expect(
      service.create(tenantId, { ...baseData, channel: 0, deviceChannelType: 'lamp' } as never, userId),
    ).rejects.toThrow(ConflictError);

    await expect(
      service.create(tenantId, { ...baseData, channel: 0, deviceChannelType: 'lamp' } as never, userId),
    ).rejects.toThrow(/channel 0, type lamp/);

    expect(deviceRepo.create).not.toHaveBeenCalled();
  });

  it('does not run the central/slave check when slaveId is absent', async () => {
    const { service, deviceRepo } = makeService();

    await service.create(tenantId, { assetId, name: 'no-slave', type: 'SENSOR' } as never, userId);

    expect(deviceRepo.findBySlaveId).not.toHaveBeenCalled();
    expect(deviceRepo.create).toHaveBeenCalled();
  });
});
