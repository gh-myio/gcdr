const getById = jest.fn();
jest.mock('../../../src/services/CentralService', () => ({
  centralService: { getById: (...a: unknown[]) => getById(...a) },
}));

import { CentralFirmwareService } from '../../../src/services/CentralFirmwareService';
import { MenderService, MenderDevice, MenderArtifact } from '../../../src/services/MenderService';
import { ValidationError, NotFoundError, UnprocessableError } from '../../../src/shared/errors/AppError';

/**
 * The orchestration: what the screen is told, and what deploy() refuses.
 *
 * The property worth the most here is that deploy() decides the refusals AGAIN
 * rather than trusting the screen. A screen can sit open for an hour, and in that
 * hour the peer can start updating or the board can fall back to pending. Without
 * the re-check the refusals are a decoration on a button that fires anyway.
 */

const TENANT = 't1';
const CENTRAL = '34e55153-c2b2-4c07-9949-2fc5ee809617';

function device(over: Partial<MenderDevice> = {}): MenderDevice {
  return {
    id: 'dev-1', mac: '02:42:ba:a3:2f:e2', status: 'accepted',
    artifactName: 'rc14.1.1', deviceType: 'orange-pi-zero',
    centralUuid: CENTRAL, haRole: null, haSlot: null, haGeneration: null,
    boardId: null, menderClientVersion: '5.1.0', ...over,
  };
}

const ARTIFACTS: MenderArtifact[] = [
  { name: 'rc14.1.3', deviceTypesCompatible: ['orange-pi-zero'], modified: '2026-09-14T01:54:19Z', signed: true },
  { name: 'rc14.1.1', deviceTypesCompatible: ['orange-pi-zero'], modified: '2026-09-10T18:56:17Z', signed: true },
  { name: 'cm4-1.0.0-rc8', deviceTypesCompatible: ['raspberrypi-cm4-64'], modified: '2026-08-01T00:00:00Z', signed: true },
];

/** A MenderService with every call stubbed; no socket is opened. */
function fakeMender(devices: MenderDevice[], inFlight: unknown = null): MenderService {
  return {
    listDevices: jest.fn().mockResolvedValue(devices),
    listArtifacts: jest.fn().mockResolvedValue(ARTIFACTS),
    inFlightFor: jest.fn().mockResolvedValue(inFlight),
    deploy: jest.fn().mockResolvedValue({ id: 'dep-1' }),
    abort: jest.fn().mockResolvedValue(undefined),
    statistics: jest.fn().mockResolvedValue({ pending: 1 }),
    devicesForCentral: jest.fn(),
  } as unknown as MenderService;
}

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue({ id: CENTRAL, name: 'Guilherme Ito Prod', config: {} });
});

describe('state() — what the card is told', () => {
  it('describes a board that can take the newest image', async () => {
    const svc = new CentralFirmwareService(fakeMender([device()]));
    const s = await svc.state(TENANT, CENTRAL);

    expect(s.matchedVia).toBe('inventory');
    expect(s.running).toBe('rc14.1.1');
    expect(s.target?.name).toBe('rc14.1.3');
    expect(s.canDeploy).toBe(true);
    expect(s.refusals).toEqual([]);
  });

  it('offers only artifacts this hardware can take', async () => {
    const svc = new CentralFirmwareService(fakeMender([device()]));
    const s = await svc.state(TENANT, CENTRAL);
    // The CM4 artifact must not appear in a list shown for an orange-pi-zero.
    expect(s.available.map((a) => a.name)).toEqual(['rc14.1.3', 'rc14.1.1']);
  });

  it('honours an explicit target instead of the newest', async () => {
    const svc = new CentralFirmwareService(fakeMender([device()]));
    const s = await svc.state(TENANT, CENTRAL, 'rc14.1.1');
    expect(s.target?.name).toBe('rc14.1.1');
    // ...and then refuses it, because that is what the board already runs.
    expect(s.refusals.map((r) => r.code)).toContain('ALREADY_RUNNING');
  });

  it('says DEVICE_NOT_FOUND when no board answers to the central', async () => {
    const svc = new CentralFirmwareService(fakeMender([device({ centralUuid: 'other' })]));
    const s = await svc.state(TENANT, CENTRAL);
    expect(s.device).toBeNull();
    expect(s.matchedVia).toBeNull();
    expect(s.refusals.map((r) => r.code)).toEqual(['DEVICE_NOT_FOUND']);
    expect(s.canDeploy).toBe(false);
  });

  it('matches through the recorded mac when the board does not publish its uuid', async () => {
    getById.mockResolvedValue({
      id: CENTRAL, name: 'Escritorio dimension', config: { menderMac: '0242f9f9721f' },
    });
    const svc = new CentralFirmwareService(fakeMender([
      device({ id: 'x', centralUuid: null, mac: '02:42:f9:f9:72:1f', artifactName: 'tcp-central6' }),
    ]));
    const s = await svc.state(TENANT, CENTRAL);
    expect(s.matchedVia).toBe('mac');
    expect(s.running).toBe('tcp-central6');
  });

  it('describes the primary of a pair and names the peer', async () => {
    const primary = device({ id: 'teta', haRole: 'primary', haSlot: 'b', boardId: 'bbb...d4032c20' });
    const standby = device({ id: 'al2', haRole: 'standby', haSlot: 'a', boardId: 'aaa...1404282c' });
    const svc = new CentralFirmwareService(fakeMender([standby, primary]));
    const s = await svc.state(TENANT, CENTRAL);

    expect(s.device?.id).toBe('teta');
    expect(s.pairPeer?.id).toBe('al2');
    expect(s.refusals.map((r) => r.code)).toEqual(
      expect.arrayContaining(['HA_PAIR', 'HA_PRIMARY_FIRST']),
    );
    expect(s.canDeploy).toBe(false);
  });

  it('does not let a failure reading the in-flight deployment break the card', async () => {
    const mender = fakeMender([device()]);
    (mender.inFlightFor as jest.Mock).mockRejectedValue(new Error('Mender fora do ar'));
    const s = await new CentralFirmwareService(mender).state(TENANT, CENTRAL);
    expect(s.inFlight).toBeNull();
    expect(s.running).toBe('rc14.1.1');
  });

  it('never asks about deployments for a central with no board', async () => {
    const mender = fakeMender([]);
    await new CentralFirmwareService(mender).state(TENANT, CENTRAL);
    expect(mender.inFlightFor).not.toHaveBeenCalled();
  });
});

describe('deploy() — the refusals decided again', () => {
  it('creates the deployment when nothing objects', async () => {
    const mender = fakeMender([device()]);
    const r = await new CentralFirmwareService(mender).deploy(TENANT, CENTRAL, 'rc14.1.3', 'ana');

    expect(r).toEqual({ deploymentId: 'dep-1', artifactName: 'rc14.1.3' });
    expect(mender.deploy).toHaveBeenCalledWith('dev-1', 'rc14.1.3', expect.stringContaining('Guilherme Ito Prod'));
    // Who asked for it goes into the deployment's name, which is the only field
    // Mender will show back to whoever is looking at it later.
    expect((mender.deploy as jest.Mock).mock.calls[0][2]).toContain('ana');
  });

  it('refuses the primary of a pair, and creates NOTHING', async () => {
    // The screen already said so. This proves the button cannot get past it.
    const mender = fakeMender([
      device({ id: 'teta', haRole: 'primary' }),
      device({ id: 'al2', haRole: 'standby' }),
    ]);
    await expect(
      new CentralFirmwareService(mender).deploy(TENANT, CENTRAL, 'rc14.1.3', 'ana'),
    ).rejects.toThrow(UnprocessableError);
    expect(mender.deploy).not.toHaveBeenCalled();
  });

  it('refuses a board that went to pending after the screen was drawn', async () => {
    const mender = fakeMender([device({ status: 'pending' })]);
    await expect(
      new CentralFirmwareService(mender).deploy(TENANT, CENTRAL, 'rc14.1.3', 'ana'),
    ).rejects.toThrow(/pendente de autoriza/);
    expect(mender.deploy).not.toHaveBeenCalled();
  });

  it('refuses a deployment that started while the screen was open', async () => {
    const mender = fakeMender(
      [device()],
      { id: 'dep-9', artifactName: 'rc14.1.3', status: 'inprogress', deviceStatus: 'downloading', created: null },
    );
    await expect(
      new CentralFirmwareService(mender).deploy(TENANT, CENTRAL, 'rc14.1.3', 'ana'),
    ).rejects.toThrow(/em andamento/);
    expect(mender.deploy).not.toHaveBeenCalled();
  });

  it('carries the refusals on the error, so the screen can show all of them', async () => {
    const mender = fakeMender([device({ status: 'pending', artifactName: null })]);
    // Captured rather than caught: an expect inside a catch does not run at all
    // if the call unexpectedly succeeds, which is the one outcome this test
    // exists to rule out.
    const err = await new CentralFirmwareService(mender)
      .deploy(TENANT, CENTRAL, 'rc14.1.3', 'ana')
      .then(() => null, (e: unknown) => e);

    // 422, and every refusal travels in `reasons' so the screen shows all of
    // them rather than one joined sentence.
    expect(err).toBeInstanceOf(UnprocessableError);
    expect((err as UnprocessableError).statusCode).toBe(422);
    const details = (err as UnprocessableError).reasons;
    expect(details?.map((d) => d.code)).toEqual(
      expect.arrayContaining(['DEVICE_PENDING', 'NO_INVENTORY']),
    );
  });

  it('refuses an artifact name that is not a real artifact', async () => {
    const mender = fakeMender([device()]);
    await expect(
      new CentralFirmwareService(mender).deploy(TENANT, CENTRAL, 'rc99.9.9', 'ana'),
    ).rejects.toThrow(/não existe ou não serve/);
    expect(mender.deploy).not.toHaveBeenCalled();
  });

  it('refuses an artifact for the wrong hardware even when it exists', async () => {
    const mender = fakeMender([device()]);
    await expect(
      new CentralFirmwareService(mender).deploy(TENANT, CENTRAL, 'cm4-1.0.0-rc8', 'ana'),
    ).rejects.toThrow(/não existe ou não serve/);
    expect(mender.deploy).not.toHaveBeenCalled();
  });

  it('refuses an empty artifact name before doing anything at all', async () => {
    const mender = fakeMender([device()]);
    await expect(
      new CentralFirmwareService(mender).deploy(TENANT, CENTRAL, '   ', 'ana'),
    ).rejects.toThrow(ValidationError);
    expect(getById).not.toHaveBeenCalled();
  });

  it('refuses when no board answers to the central', async () => {
    const mender = fakeMender([]);
    await expect(
      new CentralFirmwareService(mender).deploy(TENANT, CENTRAL, 'rc14.1.3', 'ana'),
    ).rejects.toThrow(NotFoundError);
    expect(mender.deploy).not.toHaveBeenCalled();
  });
});

describe('deploymentStatus() and abort()', () => {
  it('returns nothing when no deployment is running', async () => {
    const svc = new CentralFirmwareService(fakeMender([device()]));
    expect(await svc.deploymentStatus(TENANT, CENTRAL)).toEqual({ inFlight: null, statistics: null });
  });

  it('returns Mender own statistics for the one that is', async () => {
    const mender = fakeMender([device()], { id: 'dep-9', artifactName: 'rc14.1.3', status: 'pending', deviceStatus: 'pending', created: null });
    const r = await new CentralFirmwareService(mender).deploymentStatus(TENANT, CENTRAL);
    expect(r.inFlight?.id).toBe('dep-9');
    expect(r.statistics).toEqual({ pending: 1 });
  });

  it('still answers when the statistics call fails', async () => {
    const mender = fakeMender([device()], { id: 'dep-9', artifactName: 'rc', status: 'pending', deviceStatus: 'pending', created: null });
    (mender.statistics as jest.Mock).mockRejectedValue(new Error('boom'));
    const r = await new CentralFirmwareService(mender).deploymentStatus(TENANT, CENTRAL);
    expect(r.inFlight?.id).toBe('dep-9');
    expect(r.statistics).toBeNull();
  });

  it('aborts the deployment in flight', async () => {
    const mender = fakeMender([device()], { id: 'dep-9', artifactName: 'rc', status: 'pending', deviceStatus: 'pending', created: null });
    await new CentralFirmwareService(mender).abort(TENANT, CENTRAL);
    expect(mender.abort).toHaveBeenCalledWith('dep-9');
  });

  it('refuses to abort what is not running', async () => {
    const mender = fakeMender([device()]);
    await expect(new CentralFirmwareService(mender).abort(TENANT, CENTRAL)).rejects.toThrow(NotFoundError);
    expect(mender.abort).not.toHaveBeenCalled();
  });
});
