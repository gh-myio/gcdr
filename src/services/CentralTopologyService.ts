import { deviceRepository } from '../repositories/DeviceRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { NotFoundError } from '../shared/errors/AppError';

// The cloud-server holds the live per-device link quality (status +
// average_retries) and exposes it server-to-server. GCDR joins it onto its own
// device registry to build the CentralDetail topology view. Read at call time
// (not module load) so runtime config and tests take effect.
// Best-effort join: cap the cloud-server call so a hung server can't hold the
// whole topology response until undici's multi-minute default timeout.
const CLOUD_FETCH_TIMEOUT_MS = 3000;

// centralId flows into a server-to-server URL path; constrain it to a UUID so a
// caller-supplied value cannot alter the request target (CodeQL SSRF).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Page the device registry at the API's max page size (100). A NodeHub with
// 20-30+ slaves, each exposing several channel-rows, can exceed one page.
const DEVICE_PAGE_LIMIT = 100;
type TopologyDeviceRow = Awaited<
  ReturnType<typeof deviceRepository.findByCentralId>
>['items'][number];

// Shape returned by GET (cloud-server) /centrals/:id/device-status.
interface CloudDeviceStatus {
  id: number; // erlradio device id == GCDR devices.slaveId
  status: string | null; // online | bad | offline
  average_retries: number | null; // null for devices that don't report it (three_phase)
  updated_at: number; // epoch seconds
}

interface CloudDeviceStatusResponse {
  connected?: boolean; // is the central's WS to the cloud currently up?
  devices?: CloudDeviceStatus[];
}

export interface TopologyNode {
  deviceId: string;
  slaveId: number;
  name: string;
  type: string | null;
  status: string | null;
  averageRetries: number | null;
  signalPct: number | null; // 0..100 derived from averageRetries (100 = perfect)
  updatedAt: number | null;
}

export interface CentralTopology {
  central: { id: string; name: string };
  nodes: TopologyNode[];
}

/**
 * Builds the hub-and-spoke topology for a central: one node per physical device
 * (grouped by slaveId), each carrying its live link quality from the cloud-server.
 * The central is the hub; the edge quality is `signalPct`/`status`.
 *
 * SIDE EFFECT: getTopology also reconciles the central's connection_status and
 * each device's connectivity_status off the same cloud link (best-effort, only on
 * change). It is a read that mutates — documented here so it isn't a surprise.
 */
export class CentralTopologyService {
  async getTopology(tenantId: string, centralId: string): Promise<CentralTopology> {
    const central = await centralRepository.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);

    const { linkBySlave, connected } = await this.fetchLinkQuality(centralId);
    await this.reconcileCentralStatus(tenantId, centralId, central.connectionStatus, connected);

    // One node per physical device (grouped by slaveId), carrying its live link.
    const bySlave = await this.loadDevicesBySlave(tenantId, centralId);
    const nodes = [...bySlave.values()].map((d) => this.toNode(d, linkBySlave));
    await this.reconcileDeviceStatus(tenantId, bySlave, linkBySlave);

    return { central: { id: central.id, name: central.name }, nodes };
  }

  // Reflect the central ONLINE/OFFLINE off the SAME cloud link the topology uses,
  // so GCDR needn't depend on the central sending heartbeats. Best-effort + only
  // on change; the topology still renders if this write fails.
  private async reconcileCentralStatus(
    tenantId: string,
    centralId: string,
    current: string | null,
    connected: boolean | null,
  ): Promise<void> {
    if (connected === null) return;
    const desired = connected ? 'ONLINE' : 'OFFLINE';
    if (current === desired) return;
    try {
      await centralRepository.updateConnectionStatus(tenantId, centralId, desired);
    } catch {
      // reconcile is best-effort; never fail the topology response on it.
    }
  }

  // One row per slaveId (a board can expose several channel-rows; first wins),
  // paged through the registry at the API's max page size.
  private async loadDevicesBySlave(
    tenantId: string,
    centralId: string,
  ): Promise<Map<number, TopologyDeviceRow>> {
    const bySlave = new Map<number, TopologyDeviceRow>();
    let cursor: string | undefined;
    do {
      const page = await deviceRepository.findByCentralId(tenantId, centralId, {
        limit: DEVICE_PAGE_LIMIT,
        cursor,
      });
      for (const d of page.items) {
        if (d.slaveId === null || d.slaveId === undefined) continue;
        if (!bySlave.has(d.slaveId)) bySlave.set(d.slaveId, d);
      }
      cursor = page.pagination.hasMore ? page.pagination.nextCursor : undefined;
    } while (cursor);
    return bySlave;
  }

  private toNode(d: TopologyDeviceRow, linkBySlave: Map<number, CloudDeviceStatus>): TopologyNode {
    const link = linkBySlave.get(d.slaveId as number);
    const avg = link?.average_retries ?? null;
    return {
      deviceId: d.id,
      slaveId: d.slaveId as number,
      name: d.name,
      type: d.deviceType ?? null,
      status: link?.status ?? null,
      averageRetries: avg,
      signalPct: avg === null ? null : Math.max(0, Math.min(100, Math.round(100 - avg * 10))),
      updatedAt: link?.updated_at ?? null,
    };
  }

  // Reflect each device's connectivity off the same cloud link (online|bad ->
  // ONLINE, offline -> OFFLINE; unknown/null left as-is). Best-effort + only on
  // change; the desired status is binary, so the writes batch into at most two
  // UPDATEs. The topology response still renders if it fails.
  private async reconcileDeviceStatus(
    tenantId: string,
    bySlave: Map<number, TopologyDeviceRow>,
    linkBySlave: Map<number, CloudDeviceStatus>,
  ): Promise<void> {
    const toOnline: string[] = [];
    const toOffline: string[] = [];
    for (const d of bySlave.values()) {
      const link = linkBySlave.get(d.slaveId as number);
      if (!link?.status) continue;
      const desired = link.status === 'offline' ? 'OFFLINE' : 'ONLINE';
      if (d.connectivityStatus === desired) continue;
      (desired === 'ONLINE' ? toOnline : toOffline).push(d.id);
    }
    try {
      await Promise.all([
        deviceRepository.setConnectivityStatusBatch(tenantId, toOnline, 'ONLINE'),
        deviceRepository.setConnectivityStatusBatch(tenantId, toOffline, 'OFFLINE'),
      ]);
    } catch {
      // reconcile is best-effort; never fail the topology response on it.
    }
  }

  private async fetchLinkQuality(
    centralId: string
  ): Promise<{ linkBySlave: Map<number, CloudDeviceStatus>; connected: boolean | null }> {
    const map = new Map<number, CloudDeviceStatus>();
    const cloudUrl = process.env.CLOUD_SERVER_URL || '';
    const cloudToken = process.env.CLOUD_STATUS_TOKEN || '';
    if (!cloudUrl) return { linkBySlave: map, connected: null };
    try {
      if (!UUID_RE.test(centralId)) return { linkBySlave: map, connected: null };
      const headers: Record<string, string> = {};
      if (cloudToken) headers['x-status-token'] = cloudToken;
      const res = await fetch(
        `${cloudUrl}/centrals/${encodeURIComponent(centralId)}/device-status`,
        { headers, signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS) },
      );
      if (!res.ok) return { linkBySlave: map, connected: null };
      const body = (await res.json()) as CloudDeviceStatusResponse;
      for (const e of body.devices ?? []) map.set(e.id, e);
      return { linkBySlave: map, connected: body.connected ?? null };
    } catch {
      // cloud-server unreachable -> nodes still render, with null link quality.
      return { linkBySlave: map, connected: null };
    }
  }
}

export const centralTopologyService = new CentralTopologyService();
