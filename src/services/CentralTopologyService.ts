import { deviceRepository } from '../repositories/DeviceRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { NotFoundError } from '../shared/errors/AppError';

// The cloud-server holds the live per-device link quality (status +
// average_retries) and exposes it server-to-server. GCDR joins it onto its own
// device registry to build the CentralDetail topology view.
const CLOUD_SERVER_URL = process.env.CLOUD_SERVER_URL || '';
const CLOUD_STATUS_TOKEN = process.env.CLOUD_STATUS_TOKEN || '';

// centralId flows into a server-to-server URL path; constrain it to a UUID so a
// caller-supplied value cannot alter the request target (CodeQL SSRF).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 */
export class CentralTopologyService {
  async getTopology(tenantId: string, centralId: string): Promise<CentralTopology> {
    const central = await centralRepository.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);

    const { linkBySlave, connected } = await this.fetchLinkQuality(centralId);

    // Reflect the central ONLINE/OFFLINE off the SAME cloud link the topology
    // uses: the cloud-server knows central_connected/disconnected, so GCDR needn't
    // depend on the central sending heartbeats. Best-effort + only on change, so
    // the topology still renders if this write fails.
    if (connected !== null) {
      const desired = connected ? 'ONLINE' : 'OFFLINE';
      if (central.connectionStatus !== desired) {
        try {
          await centralRepository.updateConnectionStatus(tenantId, centralId, desired);
        } catch {
          // reconcile is best-effort; never fail the topology response on it.
        }
      }
    }

    // GCDR devices for the central. A board at a slaveId can expose several
    // channel-rows; the star shows ONE node per slaveId (link quality is
    // per-physical-device, not per-channel), so we group by slaveId.
    const { items } = await deviceRepository.findByCentralId(tenantId, centralId, { limit: 999 });
    const bySlave = new Map<number, (typeof items)[number]>();
    for (const d of items) {
      if (d.slaveId === null || d.slaveId === undefined) continue;
      if (!bySlave.has(d.slaveId)) bySlave.set(d.slaveId, d);
    }

    const nodes: TopologyNode[] = [...bySlave.values()].map((d) => {
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
    });

    // Reflect each device's connectivity off the same cloud link (online|bad ->
    // ONLINE, offline -> OFFLINE; unknown/null left as-is). Best-effort + only on
    // change, so the centrals-list connected/total count reflects reality once a
    // central has been viewed. The topology response still renders if it fails.
    await Promise.allSettled(
      [...bySlave.values()].map((d) => {
        const link = linkBySlave.get(d.slaveId as number);
        if (!link?.status) return Promise.resolve();
        const desired = link.status === 'offline' ? 'OFFLINE' : 'ONLINE';
        if (d.connectivityStatus === desired) return Promise.resolve();
        return deviceRepository.setConnectivityStatus(tenantId, d.id, desired);
      }),
    );

    return { central: { id: central.id, name: central.name }, nodes };
  }

  private async fetchLinkQuality(
    centralId: string
  ): Promise<{ linkBySlave: Map<number, CloudDeviceStatus>; connected: boolean | null }> {
    const map = new Map<number, CloudDeviceStatus>();
    if (!CLOUD_SERVER_URL) return { linkBySlave: map, connected: null };
    try {
      if (!UUID_RE.test(centralId)) return { linkBySlave: map, connected: null };
      const headers: Record<string, string> = {};
      if (CLOUD_STATUS_TOKEN) headers['x-status-token'] = CLOUD_STATUS_TOKEN;
      const res = await fetch(
        `${CLOUD_SERVER_URL}/centrals/${encodeURIComponent(centralId)}/device-status`,
        { headers },
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
