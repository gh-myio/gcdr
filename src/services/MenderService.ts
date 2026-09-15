import { NotFoundError, ValidationError, ConflictError } from '../shared/errors/AppError';

/**
 * Firmware updates for a central, through the Mender management API.
 *
 * WHY THIS IS NOT A CENTRAL COMMAND. Everything else this API asks a central to do
 * -- REBOOT, RESTART_ERLANG, SET_WIFI -- goes into a queue that the board's agent
 * claims on its next poll (see CentralCommandService). Firmware does not, and must
 * not, work that way:
 *
 *   the board already polls hosted.mender on its own. That is how it picks up a
 *     deployment today, when somebody clicks in the Mender console. So gcdr does not
 *     need to reach the board at all -- it needs to create the deployment, server to
 *     server, and the board finds it by itself;
 *
 *   the fleet does not run the agent. Measured on 2026-09-15: of 151 boards
 *     reporting inventory, 92 run rc12.4.2 and 16 run rc10.1, and none of those
 *     images carry the gcdr agent. A command-based design would reach almost none of
 *     the fleet, which is exactly the fleet somebody needs to update.
 *
 * So this service talks only to Mender. The board never learns that gcdr was
 * involved. Keeping those two paths apart is the whole reason this file exists
 * separately from CentralCommandService.
 */

const MENDER_BASE = process.env.MENDER_API_URL || 'https://hosted.mender.io/api/management';
const MENDER_TOKEN = process.env.MENDER_API_TOKEN || '';
const MENDER_TIMEOUT_MS = Number(process.env.MENDER_TIMEOUT_MS || 20000);

/** One board as Mender knows it. Everything here comes from the device's own
 *  inventory except `id` and `status`, which are Mender's. */
export interface MenderDevice {
  id: string;
  mac: string;
  status: string | null;
  artifactName: string | null;
  deviceType: string | null;
  /** The UUID of the central this board serves. Only images from rc14.1.x publish
   *  it; for the rest the caller resolves it from the mac. Both halves of an HA
   *  pair report the SAME value, because the site identity travels with the role. */
  centralUuid: string | null;
  haRole: string | null;
  haSlot: string | null;
  haGeneration: string | null;
  /** Permanent per-board identifier. The one thing that does NOT move between the
   *  halves of a pair, and therefore the only way to say which board is which. */
  boardId: string | null;
  menderClientVersion: string | null;
}

export interface MenderArtifact {
  name: string;
  deviceTypesCompatible: string[];
  modified: string | null;
  signed: boolean;
}

export interface FirmwareRefusal {
  code: string;
  message: string;
}

export interface DeploymentInFlight {
  id: string;
  artifactName: string;
  status: string;
  created: string | null;
}

export interface FirmwareView {
  device: MenderDevice | null;
  running: string | null;
  available: MenderArtifact[];
  /** Present when this central is served by an HA pair: the OTHER board. */
  pairPeer: MenderDevice | null;
  refusals: FirmwareRefusal[];
  canDeploy: boolean;
}

/* ===================================================================
 * The decisions. Pure, and separated from the HTTP on purpose: a refusal
 * that only runs when hosted.mender answers is a refusal nobody can test.
 * =================================================================== */

/**
 * Everything that makes this deployment a bad idea, decided BEFORE anything is
 * created in Mender.
 *
 * Mender would reject some of these itself, and that is not good enough. A
 * deployment that is created and then fails leaves a failure in the history, an
 * alarm somebody has to read, and a message written for a machine. Refusing here
 * costs nothing and can explain itself in the words of whoever has to act.
 *
 * `peers` is every OTHER board serving the same central. In a healthy standalone
 * install it is empty. It is non-empty for exactly one reason -- the central is
 * half of an HA pair -- and that case is the most expensive one to get wrong, so
 * it is the one this function says the most about.
 */
export function refusalsFor(
  device: MenderDevice | null,
  target: MenderArtifact | null,
  peers: MenderDevice[] = [],
  inFlight: DeploymentInFlight | null = null,
): FirmwareRefusal[] {
  const out: FirmwareRefusal[] = [];

  if (!device) {
    return [{
      code: 'DEVICE_NOT_FOUND',
      message: 'esta central não corresponde a nenhum dispositivo no Mender',
    }];
  }

  // A board can be registered and still not be updatable, and the difference
  // matters to whoever is looking at the screen: 76 of the 232 boards registered
  // on 2026-09-15 were sitting in `pending', which is a person's job to clear,
  // not a fault.
  if (device.status === 'pending') {
    out.push({
      code: 'DEVICE_PENDING',
      message: 'dispositivo pendente de autorização no Mender: aceite-o antes de atualizar',
    });
  }

  if (!device.artifactName) {
    out.push({
      code: 'NO_INVENTORY',
      message: 'o dispositivo nunca reportou inventário, então não sabemos o que ele roda',
    });
  }

  if (!target) {
    out.push({ code: 'NO_TARGET', message: 'nenhuma versão de destino foi informada' });
    return out;
  }

  if (!device.deviceType) {
    out.push({ code: 'NO_DEVICE_TYPE', message: 'o dispositivo não declara device_type' });
  } else if (!target.deviceTypesCompatible.includes(device.deviceType)) {
    // The one that bricks a board if it gets through.
    out.push({
      code: 'DEVICE_TYPE_MISMATCH',
      message: `incompatível: a placa é ${device.deviceType} e o artifact serve `
        + `${target.deviceTypesCompatible.join(', ') || '(nada declarado)'}`,
    });
  }

  if (!target.signed) {
    out.push({
      code: 'ARTIFACT_UNSIGNED',
      message: 'o artifact não está assinado, e a verificação de assinatura é obrigatória nas duas plataformas',
    });
  }

  if (device.artifactName && device.artifactName === target.name) {
    out.push({
      code: 'ALREADY_RUNNING',
      message: `a placa já roda ${target.name}`,
    });
  }

  if (inFlight) {
    out.push({
      code: 'DEPLOYMENT_IN_FLIGHT',
      message: `já existe um deployment em andamento para esta placa (${inFlight.artifactName}, ${inFlight.status})`,
    });
  }

  // THE EXPENSIVE ONE.
  //
  // A pair exists so a site keeps a central when one board dies. Updating both
  // halves at once removes exactly the property the pair was bought for, and it
  // does it during the one window where nobody is watching the site.
  //
  // The pair is detected without any field anybody has to fill in: both halves
  // publish the same `central_uuid` in their Mender inventory, because the site
  // identity travels with the role. So two boards answering to one central IS the
  // pair, and `ha_role` from the same inventory says which is which.
  if (peers.length > 0) {
    const peer = peers[0];
    out.push({
      code: 'HA_PAIR',
      message: `esta central é atendida por um par: a outra placa é ${peer.boardId || peer.mac}`
        + ` (slot ${peer.haSlot || '?'}, ${peer.haRole || 'papel desconhecido'}, ${peer.artifactName || 'versão desconhecida'}).`
        + ' Atualize a standby primeiro, confirme, e só então a primária.',
    });
    if (device.haRole === 'primary') {
      out.push({
        code: 'HA_PRIMARY_FIRST',
        message: 'esta é a primária do par: atualizá-la agora deixa o sítio sem central.'
          + ' Comece pela standby.',
      });
    }
  }

  return out;
}

/** The newest artifact this board can take. Newest by Mender's own `modified`,
 *  because that is the only ordering the server agrees with -- rc names sort
 *  lexically in ways nobody wants (rc9.7.2 after rc10.1). */
export function newestFor(deviceType: string | null, artifacts: MenderArtifact[]): MenderArtifact | null {
  if (!deviceType) return null;
  const usable = artifacts
    .filter((a) => a.deviceTypesCompatible.includes(deviceType))
    .sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));
  return usable[0] || null;
}

/**
 * The UUID of the central a board serves.
 *
 * Two steps, and the second one exists because of the fleet. Images from rc14.1.x
 * publish `central_uuid` in their own inventory, which is exact and needs nothing
 * else -- but on 2026-09-15 only 4 of 151 boards did that. The other 227 are
 * resolved through their mac, which the caller looks up in gcdr's own records.
 *
 * When the fleet has moved on, step two stops being reached and this function is
 * the only thing that has to change.
 */
export function resolveCentralUuid(
  device: Pick<MenderDevice, 'centralUuid' | 'mac'>,
  macToUuid: Map<string, string>,
): { uuid: string | null; via: 'inventory' | 'mac' | null } {
  if (device.centralUuid) return { uuid: device.centralUuid, via: 'inventory' };
  const byMac = macToUuid.get(device.mac.toLowerCase());
  if (byMac) return { uuid: byMac, via: 'mac' };
  return { uuid: null, via: null };
}

/* ===================================================================
 * The HTTP. Injectable so the tests above never open a socket.
 * =================================================================== */

export interface MenderHttp {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

class FetchMenderHttp implements MenderHttp {
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!MENDER_TOKEN) {
      throw new ValidationError('MENDER_API_TOKEN não está configurado');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MENDER_TIMEOUT_MS);
    try {
      const res = await fetch(`${MENDER_BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${MENDER_TOKEN}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 404) throw new NotFoundError('recurso não encontrado no Mender');
      if (res.status === 409) throw new ConflictError('o Mender recusou por conflito');
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // The token must never reach a log or a response body.
        throw new ValidationError(`Mender respondeu ${res.status}: ${text.slice(0, 300)}`);
      }
      if (res.status === 204) return undefined as unknown as T;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return undefined as unknown as T;
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  get<T>(path: string) { return this.call<T>('GET', path); }
  post<T>(path: string, body: unknown) { return this.call<T>('POST', path, body); }
  put<T>(path: string, body: unknown) { return this.call<T>('PUT', path, body); }
}

/* ===================================================================
 * Shapes Mender actually returns. Narrow on purpose: everything below
 * reads from these and nothing else, so a change upstream shows up here.
 * =================================================================== */

interface RawAttribute { name: string; value: unknown; scope?: string }
interface RawInventoryDevice { id: string; attributes?: RawAttribute[] }
interface RawArtifact {
  id: string;
  name: string;
  device_types_compatible?: string[];
  modified?: string;
  signed?: boolean;
}
interface RawDeployment {
  id: string;
  artifact_name?: string;
  status?: string;
  created?: string;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  return String(v);
}

export function deviceFromInventory(raw: RawInventoryDevice): MenderDevice {
  const a = new Map<string, unknown>();
  for (const at of raw.attributes || []) a.set(at.name, at.value);
  return {
    id: raw.id,
    mac: (str(a.get('mac')) || '').toLowerCase(),
    status: str(a.get('status')),
    artifactName: str(a.get('artifact_name')),
    deviceType: str(a.get('device_type')),
    centralUuid: str(a.get('central_uuid')),
    haRole: str(a.get('ha_role')),
    haSlot: str(a.get('ha_slot')),
    haGeneration: str(a.get('ha_generation')),
    boardId: str(a.get('board_id')),
    menderClientVersion: str(a.get('mender_client_version')),
  };
}

export function artifactFromRaw(raw: RawArtifact): MenderArtifact {
  return {
    name: raw.name,
    deviceTypesCompatible: raw.device_types_compatible || [],
    modified: raw.modified || null,
    // Mender does not report signature state on the artifact listing of every
    // plan, and an absent field must not read as "unsigned" -- that would refuse
    // every deployment on a tenant that simply does not expose it.
    signed: raw.signed !== false,
  };
}

export class MenderService {
  constructor(private readonly http: MenderHttp = new FetchMenderHttp()) {}

  async listArtifacts(): Promise<MenderArtifact[]> {
    const raw = await this.http.get<RawArtifact[]>('/v1/deployments/artifacts?per_page=500');
    return (raw || []).map(artifactFromRaw);
  }

  async listDevices(): Promise<MenderDevice[]> {
    const raw = await this.http.get<RawInventoryDevice[]>('/v1/inventory/devices?per_page=500');
    return (raw || []).map(deviceFromInventory);
  }

  /** Every board serving this central. More than one means an HA pair. */
  async devicesForCentral(centralUuid: string, macs: string[]): Promise<MenderDevice[]> {
    const wanted = new Set(macs.map((m) => m.toLowerCase()));
    const all = await this.listDevices();
    return all.filter((d) => d.centralUuid === centralUuid || wanted.has(d.mac));
  }

  async inFlightFor(deviceId: string): Promise<DeploymentInFlight | null> {
    const raw = await this.http.get<RawDeployment[]>(
      `/v1/deployments/deployments/devices/${encodeURIComponent(deviceId)}?per_page=20`,
    ).catch(() => [] as RawDeployment[]);
    const live = (raw || []).find((d) => ['pending', 'inprogress'].includes(String(d.status)));
    if (!live) return null;
    return {
      id: live.id,
      artifactName: live.artifact_name || '',
      status: String(live.status),
      created: live.created || null,
    };
  }

  /**
   * Create the deployment. The refusals are NOT re-checked here: the caller owns
   * that decision and has the central's own records, which this service does not.
   * Keeping the check in one place is what stops the two from drifting apart.
   */
  async deploy(deviceId: string, artifactName: string, name: string): Promise<{ id: string }> {
    const id = await this.http.post<string>('/v1/deployments/deployments', {
      name,
      artifact_name: artifactName,
      devices: [deviceId],
    });
    return { id: String(id || '').replace(/"/g, '') };
  }

  async abort(deploymentId: string): Promise<void> {
    await this.http.put(
      `/v1/deployments/deployments/${encodeURIComponent(deploymentId)}/status`,
      { status: 'aborted' },
    );
  }

  async statistics(deploymentId: string): Promise<Record<string, number>> {
    return this.http.get<Record<string, number>>(
      `/v1/deployments/deployments/${encodeURIComponent(deploymentId)}/statistics`,
    );
  }
}

export const menderService = new MenderService();
