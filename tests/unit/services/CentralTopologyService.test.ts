import { CentralTopologyService } from '../../../src/services/CentralTopologyService';
import { centralRepository } from '../../../src/repositories/CentralRepository';
import { deviceRepository } from '../../../src/repositories/DeviceRepository';

jest.mock('../../../src/repositories/CentralRepository', () => ({
  centralRepository: { getById: jest.fn(), updateConnectionStatus: jest.fn() },
}));
jest.mock('../../../src/repositories/DeviceRepository', () => ({
  deviceRepository: { findByCentralId: jest.fn(), setConnectivityStatusBatch: jest.fn() },
}));

const getById = centralRepository.getById as jest.Mock;
const updateConnectionStatus = centralRepository.updateConnectionStatus as jest.Mock;
const findByCentralId = deviceRepository.findByCentralId as jest.Mock;
const setConnectivityStatusBatch = deviceRepository.setConnectivityStatusBatch as jest.Mock;
const fetchMock = jest.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).fetch = fetchMock;

const TENANT = 'tenant-1';
const CID = '11111111-1111-1111-1111-111111111111';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function device(over: Record<string, any> = {}) {
  return {
    id: 'dev',
    slaveId: 1,
    name: 'Device',
    deviceType: 'energy',
    connectivityStatus: null,
    ...over,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onePage(items: any[]) {
  return { items, pagination: { total: items.length, totalPages: 1, hasMore: false, nextCursor: undefined } };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cloud(devices: any[], connected: boolean | null = true) {
  return { ok: true, json: async () => ({ connected, devices }) };
}

describe('CentralTopologyService', () => {
  const svc = new CentralTopologyService();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLOUD_SERVER_URL = 'http://cloud.test';
    delete process.env.CLOUD_STATUS_TOKEN;
    getById.mockResolvedValue({ id: CID, name: 'C1', connectionStatus: 'ONLINE' });
    findByCentralId.mockResolvedValue(onePage([]));
    fetchMock.mockResolvedValue(cloud([]));
  });

  it('throws NotFoundError when the central does not exist', async () => {
    getById.mockResolvedValue(null);
    await expect(svc.getTopology(TENANT, CID)).rejects.toThrow(/not found/i);
  });

  it('derives signalPct (clamped 0..100) and passes the raw cloud status through', async () => {
    findByCentralId.mockResolvedValue(
      onePage([
        device({ id: 'a', slaveId: 1, connectivityStatus: 'ONLINE' }),
        device({ id: 'b', slaveId: 2, connectivityStatus: 'ONLINE' }),
        device({ id: 'c', slaveId: 3, connectivityStatus: 'OFFLINE' }),
        device({ id: 'd', slaveId: 4, connectivityStatus: 'ONLINE' }),
      ]),
    );
    fetchMock.mockResolvedValue(
      cloud([
        { id: 1, status: 'online', average_retries: 0, updated_at: 10 }, // 100
        { id: 2, status: 'bad', average_retries: 5, updated_at: 10 }, // 50
        { id: 3, status: 'offline', average_retries: 15, updated_at: 10 }, // clamps to 0
        // slave 4: no link row -> null quality
      ]),
    );

    const topo = await svc.getTopology(TENANT, CID);
    const bySlave = Object.fromEntries(topo.nodes.map((n) => [n.slaveId, n]));
    expect(bySlave[1].signalPct).toBe(100);
    expect(bySlave[1].status).toBe('online');
    expect(bySlave[2].signalPct).toBe(50);
    expect(bySlave[3].signalPct).toBe(0); // clamped, not -50
    expect(bySlave[4].signalPct).toBeNull();
    expect(bySlave[4].averageRetries).toBeNull();
    expect(bySlave[4].status).toBeNull();
  });

  it('treats the erlradio -1 "no sample yet" sentinel as unknown quality', async () => {
    findByCentralId.mockResolvedValue(onePage([device({ id: 'a', slaveId: 1 })]));
    fetchMock.mockResolvedValue(
      cloud([{ id: 1, status: 'online', average_retries: -1, updated_at: 10 }]),
    );

    const topo = await svc.getTopology(TENANT, CID);
    // Without the guard the clamp would round -1 up to a perfect 100%.
    expect(topo.nodes[0].signalPct).toBeNull();
    expect(topo.nodes[0].averageRetries).toBeNull();
    expect(topo.nodes[0].status).toBe('online');
  });

  it('groups multiple channel rows for the same slaveId into a single node', async () => {
    findByCentralId.mockResolvedValue(
      onePage([
        device({ id: 'ch1', slaveId: 7, name: 'Board ch1' }),
        device({ id: 'ch2', slaveId: 7, name: 'Board ch2' }),
        device({ id: 'ch3', slaveId: 8, name: 'Other' }),
        device({ id: 'noSlave', slaveId: null }),
      ]),
    );
    const topo = await svc.getTopology(TENANT, CID);
    expect(topo.nodes).toHaveLength(2); // slave 7 (first row wins) + slave 8; null slaveId dropped
    expect(topo.nodes.find((n) => n.slaveId === 7)?.deviceId).toBe('ch1');
  });

  it('reconciles central and device status only on change (batched)', async () => {
    getById.mockResolvedValue({ id: CID, name: 'C1', connectionStatus: 'OFFLINE' }); // -> ONLINE (change)
    findByCentralId.mockResolvedValue(
      onePage([
        device({ id: 'a', slaveId: 1, connectivityStatus: 'OFFLINE' }), // online -> ONLINE (change)
        device({ id: 'b', slaveId: 2, connectivityStatus: 'ONLINE' }), // bad -> ONLINE (no change)
        device({ id: 'c', slaveId: 3, connectivityStatus: 'ONLINE' }), // offline -> OFFLINE (change)
        device({ id: 'd', slaveId: 4, connectivityStatus: 'ONLINE' }), // null status -> left as-is
      ]),
    );
    fetchMock.mockResolvedValue(
      cloud([
        { id: 1, status: 'online', average_retries: 1, updated_at: 1 },
        { id: 2, status: 'bad', average_retries: 1, updated_at: 1 },
        { id: 3, status: 'offline', average_retries: 1, updated_at: 1 },
        { id: 4, status: null, average_retries: null, updated_at: 1 },
      ]),
    );

    await svc.getTopology(TENANT, CID);
    expect(updateConnectionStatus).toHaveBeenCalledWith(TENANT, CID, 'ONLINE');
    expect(setConnectivityStatusBatch).toHaveBeenCalledWith(TENANT, ['a'], 'ONLINE');
    expect(setConnectivityStatusBatch).toHaveBeenCalledWith(TENANT, ['c'], 'OFFLINE');
  });

  it('does not reconcile the central when connection_status already matches', async () => {
    getById.mockResolvedValue({ id: CID, name: 'C1', connectionStatus: 'ONLINE' });
    fetchMock.mockResolvedValue(cloud([], true));
    await svc.getTopology(TENANT, CID);
    expect(updateConnectionStatus).not.toHaveBeenCalled();
  });

  it('renders nodes with null link quality when the cloud-server throws', async () => {
    findByCentralId.mockResolvedValue(onePage([device({ id: 'a', slaveId: 1, connectivityStatus: 'ONLINE' })]));
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const topo = await svc.getTopology(TENANT, CID);
    expect(topo.nodes).toHaveLength(1);
    expect(topo.nodes[0].signalPct).toBeNull();
    expect(topo.nodes[0].status).toBeNull();
    expect(updateConnectionStatus).not.toHaveBeenCalled(); // connected null -> no reconcile
  });

  it('renders null link quality on a non-OK cloud response', async () => {
    findByCentralId.mockResolvedValue(onePage([device({ id: 'a', slaveId: 1 })]));
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const topo = await svc.getTopology(TENANT, CID);
    expect(topo.nodes[0].signalPct).toBeNull();
    expect(updateConnectionStatus).not.toHaveBeenCalled();
  });

  it('pages through the device registry until hasMore is false', async () => {
    findByCentralId
      .mockResolvedValueOnce({
        items: [device({ id: 'a', slaveId: 1 })],
        pagination: { total: 2, totalPages: 2, hasMore: true, nextCursor: '100' },
      })
      .mockResolvedValueOnce({
        items: [device({ id: 'b', slaveId: 2 })],
        pagination: { total: 2, totalPages: 2, hasMore: false, nextCursor: undefined },
      });
    const topo = await svc.getTopology(TENANT, CID);
    expect(findByCentralId).toHaveBeenCalledTimes(2);
    expect(topo.nodes).toHaveLength(2);
  });
});
