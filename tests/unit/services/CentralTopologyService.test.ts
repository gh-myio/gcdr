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

  it('loads only ACTIVE devices, so a removed device leaves the topology', async () => {
    findByCentralId.mockResolvedValue(onePage([device({ id: 'a', slaveId: 1 })]));
    await svc.getTopology(TENANT, CID);
    expect(findByCentralId).toHaveBeenCalledWith(
      TENANT,
      CID,
      expect.objectContaining({ status: 'ACTIVE' }),
    );
  });

  it('keeps the ACTIVE filter on every page, not just the first', async () => {
    findByCentralId
      .mockResolvedValueOnce({
        items: [device({ id: 'a', slaveId: 1 })],
        pagination: { total: 2, totalPages: 2, hasMore: true, nextCursor: '100' },
      })
      .mockResolvedValueOnce(onePage([device({ id: 'b', slaveId: 2 })]));
    await svc.getTopology(TENANT, CID);
    for (const call of findByCentralId.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ status: 'ACTIVE' }));
    }
  });

  it('builds the cloud URL from the stored central id, not the caller string', async () => {
    // The row the repository returns is the only source of the id that reaches
    // the server-to-server URL; a caller-supplied string never gets there.
    getById.mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
      name: 'C1',
      connectionStatus: 'ONLINE',
    });
    await svc.getTopology(TENANT, CID);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://cloud.test/centrals/22222222-2222-2222-2222-222222222222/device-status',
      expect.anything(),
    );
  });

  it('does not call the cloud-server at all when the id is not a UUID', async () => {
    getById.mockResolvedValue({ id: '../../admin', name: 'C1', connectionStatus: 'ONLINE' });
    findByCentralId.mockResolvedValue(onePage([device({ id: 'a', slaveId: 1 })]));
    const topo = await svc.getTopology(TENANT, CID);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(topo.nodes[0].signalPct).toBeNull();
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

  // -----------------------------------------------------------------------
  // Boards with several channel rows
  //
  // A board is one row per channel in the registry (the unique index is
  // tenant+central+slave+channel+type), but the radio link is per BOARD. The
  // topology draws one node per board; the centrals-list connected/total column
  // counts ROWS. So a reconcile that writes only the row it happened to draw
  // leaves the sibling rows on their old value, and a NodeHub that went offline
  // keeps most of its rows ONLINE for good.
  // -----------------------------------------------------------------------

  it('draws one node per board, however many channel rows the board has', async () => {
    findByCentralId.mockResolvedValue(
      onePage([
        device({ id: 'ch1', slaveId: 7, name: 'Hub' }),
        device({ id: 'ch2', slaveId: 7, name: 'Hub' }),
        device({ id: 'ch3', slaveId: 7, name: 'Hub' }),
      ]),
    );
    fetchMock.mockResolvedValue(
      cloud([{ id: 7, status: 'online', average_retries: 0, updated_at: 10 }]),
    );

    const topo = await svc.getTopology(TENANT, CID);
    expect(topo.nodes).toHaveLength(1);
    expect(topo.nodes[0].slaveId).toBe(7);
    expect(topo.nodes[0].signalPct).toBe(100);
  });

  it('reconciles EVERY channel row of a board, not just the one it drew', async () => {
    findByCentralId.mockResolvedValue(
      onePage([
        device({ id: 'ch1', slaveId: 7, connectivityStatus: 'ONLINE' }),
        device({ id: 'ch2', slaveId: 7, connectivityStatus: 'ONLINE' }),
        device({ id: 'ch3', slaveId: 7, connectivityStatus: 'ONLINE' }),
      ]),
    );
    fetchMock.mockResolvedValue(
      cloud([{ id: 7, status: 'offline', average_retries: 10, updated_at: 10 }]),
    );

    await svc.getTopology(TENANT, CID);
    expect(setConnectivityStatusBatch).toHaveBeenCalledWith(TENANT, ['ch1', 'ch2', 'ch3'], 'OFFLINE');
  });

  it('writes only the rows that actually differ, so a settled board costs no writes', async () => {
    findByCentralId.mockResolvedValue(
      onePage([
        device({ id: 'ch1', slaveId: 7, connectivityStatus: 'OFFLINE' }),
        device({ id: 'ch2', slaveId: 7, connectivityStatus: 'ONLINE' }),
      ]),
    );
    fetchMock.mockResolvedValue(
      cloud([{ id: 7, status: 'offline', average_retries: 10, updated_at: 10 }]),
    );

    await svc.getTopology(TENANT, CID);
    expect(setConnectivityStatusBatch).toHaveBeenCalledWith(TENANT, ['ch2'], 'OFFLINE');
    expect(setConnectivityStatusBatch).toHaveBeenCalledWith(TENANT, [], 'ONLINE');
  });

  it('groups the rows of one board even when they land on different pages', async () => {
    findByCentralId
      .mockResolvedValueOnce({
        items: [device({ id: 'ch1', slaveId: 7, connectivityStatus: 'OFFLINE' })],
        pagination: { total: 2, totalPages: 2, hasMore: true, nextCursor: '100' },
      })
      .mockResolvedValueOnce(
        onePage([device({ id: 'ch2', slaveId: 7, connectivityStatus: 'OFFLINE' })]),
      );
    fetchMock.mockResolvedValue(
      cloud([{ id: 7, status: 'online', average_retries: 2, updated_at: 10 }]),
    );

    const topo = await svc.getTopology(TENANT, CID);
    expect(topo.nodes).toHaveLength(1);
    expect(setConnectivityStatusBatch).toHaveBeenCalledWith(TENANT, ['ch1', 'ch2'], 'ONLINE');
  });

  it('leaves a board alone when the cloud has no status for it', async () => {
    findByCentralId.mockResolvedValue(
      onePage([
        device({ id: 'ch1', slaveId: 7, connectivityStatus: 'ONLINE' }),
        device({ id: 'ch2', slaveId: 7, connectivityStatus: 'ONLINE' }),
      ]),
    );
    fetchMock.mockResolvedValue(cloud([]));

    await svc.getTopology(TENANT, CID);
    expect(setConnectivityStatusBatch).toHaveBeenCalledWith(TENANT, [], 'ONLINE');
    expect(setConnectivityStatusBatch).toHaveBeenCalledWith(TENANT, [], 'OFFLINE');
  });
});
