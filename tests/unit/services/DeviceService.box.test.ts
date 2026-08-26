import { DeviceService } from '../../../src/services/DeviceService';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';
import type { IDeviceRepository } from '../../../src/repositories/interfaces/IDeviceRepository';
import type { IAssetRepository } from '../../../src/repositories/interfaces/IAssetRepository';

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const assetId = '33333333-3333-3333-3333-333333333333';
const customerId = '44444444-4444-4444-4444-444444444444';

const boxId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const memberId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const otherId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

type DeviceRow = { id: string; deviceProfile?: string; [k: string]: unknown };

/**
 * Builds a DeviceService with mocked repositories. `store` maps device id ->
 * row so repository.getById can resolve the box (and any existing device)
 * during BOX-assignment validation.
 */
function makeService(store: Record<string, DeviceRow> = {}) {
  const deviceRepo = {
    getBySerialNumber: jest.fn().mockResolvedValue(null),
    getByExternalId: jest.fn().mockResolvedValue(null),
    findBySlaveId: jest.fn().mockResolvedValue(null),
    getById: jest.fn().mockImplementation((_t: string, id: string) => Promise.resolve(store[id] ?? null)),
    create: jest.fn().mockImplementation((_t, data) => Promise.resolve({ id: 'dev-new', ...data })),
    update: jest.fn().mockImplementation((_t, id, data) => Promise.resolve({ id, ...data })),
    list: jest.fn().mockResolvedValue({ items: [], pagination: { total: 0, totalPages: 0, hasMore: false } }),
    getContentsSummary: jest.fn().mockResolvedValue({ '3F': 3, HIDR: 2, total: 5 }),
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

const baseCreate = {
  assetId,
  name: 'HIDR member',
  type: 'METER' as const,
};

describe('DeviceService — RFC-0058 BOX membership invariants', () => {
  it('accepts a member pointing at a valid BOX in the same tenant (create)', async () => {
    const { service, deviceRepo } = makeService({
      [boxId]: { id: boxId, deviceProfile: 'BOX' },
    });

    await service.create(tenantId, { ...baseCreate, boxId } as never, userId);

    expect(deviceRepo.getById).toHaveBeenCalledWith(tenantId, boxId);
    expect(deviceRepo.create).toHaveBeenCalled();
  });

  it('rejects assigning to a non-existent box (NotFoundError)', async () => {
    const { service, deviceRepo } = makeService(/* empty store */);

    await expect(
      service.create(tenantId, { ...baseCreate, boxId } as never, userId),
    ).rejects.toThrow(NotFoundError);

    expect(deviceRepo.create).not.toHaveBeenCalled();
  });

  it('rejects assigning to a device that is not a BOX (ValidationError)', async () => {
    const { service, deviceRepo } = makeService({
      [boxId]: { id: boxId, deviceProfile: '3F' }, // not a BOX
    });

    await expect(
      service.create(tenantId, { ...baseCreate, boxId } as never, userId),
    ).rejects.toThrow(ValidationError);

    expect(deviceRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a BOX device from being a member of another box (create)', async () => {
    const { service, deviceRepo } = makeService({
      [boxId]: { id: boxId, deviceProfile: 'BOX' },
    });

    await expect(
      service.create(
        tenantId,
        { ...baseCreate, deviceProfile: 'BOX', boxId } as never,
        userId,
      ),
    ).rejects.toThrow(ValidationError);

    // Fails on the profile check before ever looking up the target box.
    expect(deviceRepo.create).not.toHaveBeenCalled();
  });

  it('allows creating a BOX with no box_id', async () => {
    const { service, deviceRepo } = makeService();

    await service.create(tenantId, { ...baseCreate, deviceProfile: 'BOX' } as never, userId);

    expect(deviceRepo.create).toHaveBeenCalled();
  });

  it('rejects a device referencing itself as its box (update)', async () => {
    const { service, deviceRepo } = makeService({
      [memberId]: { id: memberId, deviceProfile: '3F', customerId },
    });

    await expect(
      service.update(tenantId, memberId, { boxId: memberId } as never, userId),
    ).rejects.toThrow(/cannot reference itself/);

    expect(deviceRepo.update).not.toHaveBeenCalled();
  });

  it('allows assigning a member to a BOX (update)', async () => {
    const { service, deviceRepo } = makeService({
      [memberId]: { id: memberId, deviceProfile: '3F', customerId },
      [boxId]: { id: boxId, deviceProfile: 'BOX' },
    });

    await service.update(tenantId, memberId, { boxId } as never, userId);

    expect(deviceRepo.update).toHaveBeenCalled();
  });

  it('allows detaching a member (boxId: null) without validating a target', async () => {
    const { service, deviceRepo } = makeService({
      [memberId]: { id: memberId, deviceProfile: '3F', customerId },
    });

    await service.update(tenantId, memberId, { boxId: null } as never, userId);

    // null short-circuits: only the existing-device getById runs, never a box lookup.
    expect(deviceRepo.getById).toHaveBeenCalledTimes(1);
    expect(deviceRepo.update).toHaveBeenCalled();
  });

  it('rejects turning an existing BOX into a member via update', async () => {
    const { service, deviceRepo } = makeService({
      [memberId]: { id: memberId, deviceProfile: 'BOX', customerId },
      [boxId]: { id: boxId, deviceProfile: 'BOX' },
    });

    await expect(
      service.update(tenantId, memberId, { boxId } as never, userId),
    ).rejects.toThrow(ValidationError);

    expect(deviceRepo.update).not.toHaveBeenCalled();
  });
});

describe('DeviceService — RFC-0058 contents summary', () => {
  it('returns the profile-grouped summary with a total', async () => {
    const { service, deviceRepo } = makeService({
      [boxId]: { id: boxId, deviceProfile: 'BOX', customerId },
    });

    const contents = await service.getContents(tenantId, boxId);

    expect(deviceRepo.getById).toHaveBeenCalledWith(tenantId, boxId);
    expect(deviceRepo.getContentsSummary).toHaveBeenCalledWith(tenantId, boxId);
    expect(contents).toEqual({ '3F': 3, HIDR: 2, total: 5 });
  });

  it('404s when the box/device does not exist', async () => {
    const { service, deviceRepo } = makeService(/* empty */);

    await expect(service.getContents(tenantId, otherId)).rejects.toThrow(NotFoundError);
    expect(deviceRepo.getContentsSummary).not.toHaveBeenCalled();
  });
});

describe('DeviceService — RFC-0058 boxId list filter', () => {
  it('passes the boxId filter through to the repository', async () => {
    const { service, deviceRepo } = makeService();

    await service.list(tenantId, { boxId, limit: 20 } as never);

    expect(deviceRepo.list).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ boxId }),
    );
  });
});
