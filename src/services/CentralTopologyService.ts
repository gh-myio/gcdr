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

// The id that reaches the server-to-server URL is read back from the database
// (see getTopology), and the route rejects a non-UUID before the service is even
// reached. This is the third barrier, kept so the guarantee is local to the code
// that builds the URL and cannot be lost by a future caller (CodeQL SSRF).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Page the device registry at the API's max page size (100). A NodeHub with
// 20-30+ slaves, each exposing several channel-rows, can exceed one page.
const DEVICE_PAGE_LIMIT = 100;

// Soft-deleted devices keep their row for history. The topology, the device list
// and the centrals-list connected/total column all count the same set: ACTIVE.
const DEVICE_ACTIVE_STATUS = 'ACTIVE';
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
 * change). It is a read that mutates -- documented here so it isn't a surprise,
 * and tracked for migration off the read path in gh-myio/gcdr#26.
 */
export class CentralTopologyService {
  async getTopology(tenantId: string, centralId: string): Promise<CentralTopology> {
    const central = await centralRepository.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);

    // Deliberately `central.id`, not the request parameter: the id that reaches
    // the server-to-server URL is the primary key of a row this tenant owns,
    // read back from the database, never a caller-supplied string.
    const { linkBySlave, connected } = await this.fetchLinkQuality(central.id);
    await this.reconcileCentralStatus(tenantId, central.id, central.connectionStatus, connected);

    // One node per physical device (grouped by slaveId), carrying its live link.
    const bySlave = await this.loadDevicesBySlave(tenantId, centralId);
    const nodes = [...bySlave.values()].map((rows) => this.toNode(rows[0], linkBySlave));
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

  // Every registry row, grouped by the slaveId it belongs to, paged through at
  // the API's max page size.
  //
  // ALL rows of a slave, not just the first: a board exposes one row per channel
  // (the unique index is tenant+central+slave+channel+type), the topology draws
  // one node per BOARD -- so rows[0] -- but the reconcile has to write every row
  // of that board. Keeping only the first is what let a NodeHub's channel rows
  // stay ONLINE forever after it went offline, since the centrals-list column
  // counts rows and only one of them was ever updated.
  //
  // ACTIVE only: a device removed from the central is soft-deleted, and drawing
  // uninstalled hardware on the topology (permanently offline, since the radio
  // no longer answers for it) is both wrong and alarming to the operator.
  private async loadDevicesBySlave(
    tenantId: string,
    centralId: string,
  ): Promise<Map<number, TopologyDeviceRow[]>> {
    const bySlave = new Map<number, TopologyDeviceRow[]>();
    let cursor: string | undefined;
    do {
      const page = await deviceRepository.findByCentralId(tenantId, centralId, {
        limit: DEVICE_PAGE_LIMIT,
        status: DEVICE_ACTIVE_STATUS,
        cursor,
      });
      for (const d of page.items) {
        if (d.slaveId === null || d.slaveId === undefined) continue;
        const rows = bySlave.get(d.slaveId);
        if (rows) rows.push(d);
        else bySlave.set(d.slaveId, [d]);
      }
      cursor = page.pagination.hasMore ? page.pagination.nextCursor : undefined;
    } while (cursor);
    return bySlave;
  }

  // The factor of 10 is not arbitrary: erlradio retries a device transmission at
  // most ?MAX_RETRIES = 10 times before giving up (light_switch.erl), and
  // average_retries is the mean retry_count over the last transmissions. So the
  // reported value spans 0..10 — 0 retries is a perfect link, 10 is the ceiling
  // where the device is declared offline — and *10 maps that onto 0..100%.
  private static readonly MAX_RETRIES = 10;

  private toNode(d: TopologyDeviceRow, linkBySlave: Map<number, CloudDeviceStatus>): TopologyNode {
    const link = linkBySlave.get(d.slaveId as number);
    // erlradio reports -1 for "no sample yet" (calculate_avg_retries on an empty
    // window). Treat it as unknown, otherwise the clamp below would round a
    // never-polled device up to a perfect 100%.
    const raw = link?.average_retries ?? null;
    const avg = raw === null || raw < 0 ? null : raw;
    return {
      deviceId: d.id,
      slaveId: d.slaveId as number,
      name: d.name,
      type: d.deviceType ?? null,
      status: link?.status ?? null,
      averageRetries: avg,
      signalPct:
        avg === null
          ? null
          : Math.max(0, Math.min(100, Math.round(100 - (avg * 100) / CentralTopologyService.MAX_RETRIES))),
      updatedAt: link?.updated_at ?? null,
    };
  }

  // Reflect each device's connectivity off the same cloud link (online|bad ->
  // ONLINE, offline -> OFFLINE; unknown/null left as-is). Best-effort + only on
  // change; the desired status is binary, so the writes batch into at most two
  // UPDATEs. The topology response still renders if it fails.
  //
  // The link is per BOARD and the status column is per ROW, so one verdict fans
  // out over every channel row of that slave. Rows already holding the desired
  // value are skipped individually, which is what keeps the steady state at zero
  // writes.
  private async reconcileDeviceStatus(
    tenantId: string,
    bySlave: Map<number, TopologyDeviceRow[]>,
    linkBySlave: Map<number, CloudDeviceStatus>,
  ): Promise<void> {
    const toOnline: string[] = [];
    const toOffline: string[] = [];
    for (const rows of bySlave.values()) {
      const link = linkBySlave.get(rows[0].slaveId as number);
      if (!link?.status) continue;
      const desired = link.status === 'offline' ? 'OFFLINE' : 'ONLINE';
      for (const d of rows) {
        if (d.connectivityStatus === desired) continue;
        (desired === 'ONLINE' ? toOnline : toOffline).push(d.id);
      }
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
