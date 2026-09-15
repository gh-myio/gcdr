import { centralService } from './CentralService';
import {
  menderService,
  MenderService,
  MenderDevice,
  MenderArtifact,
  FirmwareRefusal,
  DeploymentInFlight,
  refusalsFor,
  newestFor,
} from './MenderService';
import { ValidationError, NotFoundError, UnprocessableError } from '../shared/errors/AppError';

/**
 * What gcdr shows and does about a central's firmware.
 *
 * This is the layer that knows about centrals; MenderService knows only about
 * Mender. The split matters because the refusals need both halves -- the board's
 * state comes from Mender, and whether this central is even ours comes from here
 * -- and putting them in one class is how the Mender client ends up importing the
 * database.
 */

/** How a gcdr central is matched to a board in Mender.
 *
 *  `inventory` -- the board publishes `central_uuid` and it equals this central's
 *    id. Exact, needs nothing from us, and is the direction the fleet is moving:
 *    images from rc14.1.x do it. Measured on 2026-09-15: 4 of 151 boards.
 *
 *  `mac` -- the board does not publish it, so we match on the mac address kept in
 *    the central's own `config.menderMac`. That field is filled by reconciliation,
 *    not by the board, which is why it can be absent.
 *
 *  When neither works the answer is DEVICE_NOT_FOUND, and that is the honest
 *  answer: guessing which board belongs to which central is how somebody updates
 *  a stranger's site.
 */
export type MatchVia = 'inventory' | 'mac';

export interface FirmwareState {
  centralId: string;
  centralName: string;
  matchedVia: MatchVia | null;
  device: MenderDevice | null;
  running: string | null;
  target: MenderArtifact | null;
  available: MenderArtifact[];
  pairPeer: MenderDevice | null;
  inFlight: DeploymentInFlight | null;
  refusals: FirmwareRefusal[];
  canDeploy: boolean;
}

interface CentralLike {
  id: string;
  name: string;
  config?: Record<string, unknown> | null;
}

/** The mac this central's board answers to, if anybody has recorded it. */
export function menderMacOf(central: CentralLike): string | null {
  const raw = (central.config || {})['menderMac'];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const mac = raw.trim().toLowerCase();
  // Accept both shapes, because the two systems write it differently: Mender's
  // identity is `02:42:ae:07:43:52' and a central's serial is `0242ae074352'.
  if (/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) return mac;
  if (/^[0-9a-f]{12}$/.test(mac)) return mac.match(/.{2}/g)!.join(':');
  return null;
}

/**
 * Every board serving this central.
 *
 * More than one is not an error and not a duplicate: it is an HA pair. Both halves
 * publish the same `central_uuid`, because the site identity travels with the role
 * -- so two boards answering to one central IS the pair, and no operator has to
 * declare it anywhere. Verified against the bench pair on 2026-09-15, where slot b
 * reported `primary' and slot a reported `standby' under one uuid.
 */
export function boardsForCentral(
  central: CentralLike,
  devices: MenderDevice[],
): { matched: MenderDevice[]; via: MatchVia | null } {
  const byUuid = devices.filter((d) => d.centralUuid && d.centralUuid === central.id);
  if (byUuid.length > 0) return { matched: byUuid, via: 'inventory' };

  const mac = menderMacOf(central);
  if (mac) {
    // THE BOARD'S OWN WORD BEATS THE TYPED ADDRESS.
    //
    // config.menderMac is filled by reconciliation -- by a person or a script,
    // from a cadastre that can be stale. If it points at a board that publishes
    // a DIFFERENT central_uuid, the board is right and the record is wrong, and
    // matching it anyway is precisely the failure this module exists to prevent:
    // a deploy aimed at somebody else's site, with both screens looking correct.
    //
    // A board that publishes no central_uuid at all -- 227 of 232 on 2026-09-15
    // -- cannot contradict anything, so it is accepted. Only a board that names
    // another central is excluded.
    const byMac = devices.filter(
      (d) => d.mac === mac && (!d.centralUuid || d.centralUuid === central.id),
    );
    if (byMac.length > 0) return { matched: byMac, via: 'mac' };
  }
  return { matched: [], via: null };
}

/**
 * Which of the matched boards this screen is about.
 *
 * For a standalone central there is one and the question does not arise. For a
 * pair, the board that is serving the site is the one the operator means when they
 * say "this central" -- so the primary is what we describe, and the refusals then
 * tell them to start with the other one.
 */
export function primaryOf(matched: MenderDevice[]): MenderDevice | null {
  if (matched.length === 0) return null;
  return matched.find((d) => d.haRole === 'primary') || matched[0];
}

export class CentralFirmwareService {
  constructor(private readonly mender: MenderService = menderService) {}

  async state(tenantId: string, centralId: string, targetName?: string): Promise<FirmwareState> {
    const central = await centralService.getById(tenantId, centralId) as unknown as CentralLike;

    const [devices, artifacts] = await Promise.all([
      this.mender.listDevices(),
      this.mender.listArtifacts(),
    ]);

    const { matched, via } = boardsForCentral(central, devices);
    const device = primaryOf(matched);
    const peers = device ? matched.filter((d) => d.id !== device.id) : [];

    const available = device?.deviceType
      ? artifacts.filter((a) => a.deviceTypesCompatible.includes(device.deviceType!))
        .sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')))
      : [];

    const target = targetName
      ? available.find((a) => a.name === targetName) || null
      : newestFor(device?.deviceType || null, artifacts);

    // Only asked when there is a board to ask about, and never allowed to fail the
    // whole screen: not knowing about an in-flight deployment is a worse answer
    // than a blank card, but a 500 is worse than both.
    let inFlight: DeploymentInFlight | null = null;
    if (device) {
      inFlight = await this.mender.inFlightFor(device.id).catch(() => null);
    }

    const refusals = refusalsFor(device, target, peers, inFlight);

    return {
      centralId: central.id,
      centralName: central.name,
      matchedVia: via,
      device,
      running: device?.artifactName || null,
      target,
      available,
      pairPeer: peers[0] || null,
      inFlight,
      refusals,
      canDeploy: refusals.length === 0,
    };
  }

  /**
   * Create the deployment, and only if the same refusals that the screen showed
   * still hold.
   *
   * Re-deciding here rather than trusting the caller is deliberate. The screen may
   * have been open for an hour; in that time the peer may have started updating,
   * somebody else may have deployed, or the board may have gone to `pending'. The
   * check is cheap and it is the difference between a guard and a decoration.
   */
  async deploy(
    tenantId: string,
    centralId: string,
    artifactName: string,
    requestedBy: string,
  ): Promise<{ deploymentId: string; artifactName: string }> {
    if (!artifactName || !artifactName.trim()) {
      throw new ValidationError('artifactName é obrigatório');
    }

    const state = await this.state(tenantId, centralId, artifactName);

    if (!state.device) {
      throw new NotFoundError('esta central não corresponde a nenhum dispositivo no Mender');
    }
    if (!state.target) {
      throw new ValidationError(`o artifact ${artifactName} não existe ou não serve esta placa`);
    }
    if (state.refusals.length > 0) {
      // 422, not 400: the request is well formed and the situation is not. A
      // client that keys off the status can offer a retry for this and must not
      // for a malformed request -- and every refusal travels in `reasons`, so
      // the screen shows all of them rather than one joined sentence.
      throw new UnprocessableError(
        `atualização recusada: ${state.refusals.map((r) => r.message).join(' | ')}`,
        state.refusals,
      );
    }

    const name = `gcdr ${state.centralName} -> ${artifactName} (${requestedBy})`;
    const { id } = await this.mender.deploy(state.device.id, artifactName, name);
    return { deploymentId: id, artifactName };
  }

  async deploymentStatus(tenantId: string, centralId: string) {
    const state = await this.state(tenantId, centralId);
    if (!state.inFlight) return { inFlight: null, statistics: null };
    const statistics = await this.mender.statistics(state.inFlight.id).catch(() => null);
    return { inFlight: state.inFlight, statistics };
  }

  async abort(tenantId: string, centralId: string): Promise<void> {
    const state = await this.state(tenantId, centralId);
    if (!state.inFlight) {
      throw new NotFoundError('não há deployment em andamento para esta central');
    }
    await this.mender.abort(state.inFlight.id);
  }
}

export const centralFirmwareService = new CentralFirmwareService();
