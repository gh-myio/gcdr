import { deviceRepository } from '../repositories/DeviceRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { NotFoundError } from '../shared/errors/AppError';

// The cloud-server holds the live per-device link quality (status +
// average_retries) and exposes it server-to-server. GCDR joins it onto its own
// device registry to build the CentralDetail topology view.
const CLOUD_SERVER_URL = process.env.CLOUD_SERVER_URL || '';
const CLOUD_STATUS_TOKEN = process.env.CLOUD_STATUS_TOKEN || '';

// Shape returned by GET (cloud-server) /centrals/:id/device-status.
interface CloudDeviceStatus {
  id: number; // erlradio device id == GCDR devices.slaveId
  status: string | null; // online | bad | offline
  average_retries: number | null; // null for devices that don't report it (three_phase)
  updated_at: number; // epoch seconds
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

    const linkBySlave = await this.fetchLinkQuality(centralId);

    // GCDR devices for the central. A board at a slaveId can expose several
    // channel-rows; the star shows ONE node per slaveId (link quality is
    // per-physical-device, not per-channel), so we group by slaveId.
    const { items } = await deviceRepository.findByCentralId(tenantId, centralId, { limit: 999 });
    const bySlave = new Map<number, (typeof items)[number]>();
    for (const d of items) {
      if (d.slaveId == null) continue;
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
        signalPct: avg == null ? null : Math.max(0, Math.min(100, Math.round(100 - avg * 10))),
        updatedAt: link?.updated_at ?? null,
      };
    });

    return { central: { id: central.id, name: central.name }, nodes };
  }

  private async fetchLinkQuality(centralId: string): Promise<Map<number, CloudDeviceStatus>> {
    const map = new Map<number, CloudDeviceStatus>();
    if (!CLOUD_SERVER_URL) return map;
    try {
      const headers: Record<string, string> = {};
      if (CLOUD_STATUS_TOKEN) headers['x-status-token'] = CLOUD_STATUS_TOKEN;
      const res = await fetch(`${CLOUD_SERVER_URL}/centrals/${centralId}/device-status`, { headers });
      if (!res.ok) return map;
      const list = (await res.json()) as CloudDeviceStatus[];
      for (const e of list) map.set(e.id, e);
    } catch {
      // cloud-server unreachable -> nodes still render, with null link quality.
    }
    return map;
  }
}

export const centralTopologyService = new CentralTopologyService();
