import {
  MenderService,
  MenderHttp,
  idFromLocation,
} from '../../../src/services/MenderService';

/**
 * The calls themselves, with the HTTP injected so nothing opens a socket.
 *
 * These exist because of a defect that only a real deployment could surface: the
 * first one this service created came back with an empty id, while the
 * deployment was in Mender, correctly aimed at one device, initial_device_count
 * 1. The update was right; the receipt was missing. Creating a deployment
 * answers 201 with an EMPTY BODY and the id in Location, and the code was
 * reading the body.
 */

class FakeHttp implements MenderHttp {
  public calls: Array<{ method: string; path: string; body?: unknown }> = [];
  constructor(
    private readonly responses: Record<string, unknown> = {},
    private readonly location: string | null = null,
  ) {}

  async get<T>(path: string): Promise<T> {
    this.calls.push({ method: 'GET', path });
    const key = Object.keys(this.responses).find((k) => path.startsWith(k));
    if (key === undefined) throw new Error(`no fake for ${path}`);
    return this.responses[key] as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    this.calls.push({ method: 'POST', path, body });
    return undefined as unknown as T;
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    this.calls.push({ method: 'PUT', path, body });
    return undefined as unknown as T;
  }

  async create(path: string, body: unknown): Promise<string> {
    this.calls.push({ method: 'CREATE', path, body });
    return idFromLocation(this.location);
  }
}

describe('idFromLocation — the id Mender puts in a header', () => {
  it('reads the id off a real Location', () => {
    expect(idFromLocation(
      '/api/management/v1/deployments/deployments/a6f34728-85c1-403a-b2d9-0f577dbc1491',
    )).toBe('a6f34728-85c1-403a-b2d9-0f577dbc1491');
  });

  it('reads it off an absolute URL too', () => {
    expect(idFromLocation(
      'https://hosted.mender.io/api/management/v1/deployments/deployments/abc-123',
    )).toBe('abc-123');
  });

  it('tolerates a trailing slash and a query string', () => {
    expect(idFromLocation('/v1/deployments/deployments/abc-123/')).toBe('abc-123');
    expect(idFromLocation('/v1/deployments/deployments/abc-123?x=1')).toBe('abc-123');
  });

  it('answers empty rather than throwing when there is no header', () => {
    // An empty id is a bad receipt; an exception here would turn a successful
    // update into an error the operator has to interpret.
    expect(idFromLocation(null)).toBe('');
    expect(idFromLocation('')).toBe('');
  });
});

describe('MenderService.deploy — the shape Mender expects', () => {
  it('sends name, artifact and exactly one device, and returns the id', async () => {
    const http = new FakeHttp({}, '/v1/deployments/deployments/dep-42');
    const svc = new MenderService(http);

    const r = await svc.deploy('6f844310-e68f-41b3-8434-af0545317dc8', 'rc14.1.3', 'gcdr X -> rc14.1.3');

    expect(r.id).toBe('dep-42');
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].method).toBe('CREATE');
    expect(http.calls[0].body).toEqual({
      name: 'gcdr X -> rc14.1.3',
      artifact_name: 'rc14.1.3',
      devices: ['6f844310-e68f-41b3-8434-af0545317dc8'],
    });
  });

  it('never sets force_installation', async () => {
    // The Mender console sets it; this does not. It tells the client to install
    // even when it would rather not, and the conservative default is what makes
    // this safe to hand over.
    const http = new FakeHttp({}, '/v1/deployments/deployments/dep-1');
    await new MenderService(http).deploy('d', 'rc14.1.3', 'n');
    expect(http.calls[0].body).not.toHaveProperty('force_installation');
  });
});

describe('MenderService — reading', () => {
  it('maps the artifact listing, defaulting signed to true when absent', async () => {
    const http = new FakeHttp({
      '/v1/deployments/artifacts': [
        { id: '1', name: 'rc14.1.3', device_types_compatible: ['orange-pi-zero'], modified: '2026-09-14T01:54:19Z' },
        { id: '2', name: 'bad', device_types_compatible: ['x'], signed: false },
      ],
    });
    const arts = await new MenderService(http).listArtifacts();
    expect(arts[0]).toEqual({
      name: 'rc14.1.3',
      deviceTypesCompatible: ['orange-pi-zero'],
      modified: '2026-09-14T01:54:19Z',
      signed: true,
    });
    expect(arts[1].signed).toBe(false);
  });

  it('survives an empty artifact listing', async () => {
    const http = new FakeHttp({ '/v1/deployments/artifacts': null });
    expect(await new MenderService(http).listArtifacts()).toEqual([]);
  });

  it('maps the inventory into the shape the refusals read', async () => {
    const http = new FakeHttp({
      '/v1/inventory/devices': [{
        id: 'dev-1',
        attributes: [
          { name: 'mac', value: '02:42:BA:A3:2F:E2' },
          { name: 'status', value: 'accepted' },
          { name: 'artifact_name', value: 'rc14.1.1' },
          { name: 'device_type', value: 'orange-pi-zero' },
          { name: 'central_uuid', value: '34e55153-c2b2-4c07-9949-2fc5ee809617' },
          { name: 'ha_role', value: 'primary' },
        ],
      }],
    });
    const [d] = await new MenderService(http).listDevices();
    expect(d.mac).toBe('02:42:ba:a3:2f:e2');
    expect(d.centralUuid).toBe('34e55153-c2b2-4c07-9949-2fc5ee809617');
    expect(d.haRole).toBe('primary');
  });

  it('finds every board serving a central, by uuid or by mac', async () => {
    const http = new FakeHttp({
      '/v1/inventory/devices': [
        { id: 'a', attributes: [{ name: 'mac', value: 'aa:aa:aa:aa:aa:aa' }, { name: 'central_uuid', value: 'C' }] },
        { id: 'b', attributes: [{ name: 'mac', value: 'bb:bb:bb:bb:bb:bb' }] },
        { id: 'c', attributes: [{ name: 'mac', value: 'cc:cc:cc:cc:cc:cc' }] },
      ],
    });
    const found = await new MenderService(http).devicesForCentral('C', ['BB:BB:BB:BB:BB:BB']);
    expect(found.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });
});

describe('MenderService.inFlightFor — one at a time', () => {
  it('finds a pending or in-progress deployment', async () => {
    const http = new FakeHttp({
      '/v1/deployments/deployments/devices/': [
        { id: 'old', status: 'finished', artifact_name: 'rc14.1.1' },
        { id: 'live', status: 'inprogress', artifact_name: 'rc14.1.3', created: '2026-09-15T18:39:19Z' },
      ],
    });
    const r = await new MenderService(http).inFlightFor('dev-1');
    expect(r).toEqual({
      id: 'live', artifactName: 'rc14.1.3', status: 'inprogress', created: '2026-09-15T18:39:19Z',
    });
  });

  it('answers null when every deployment is over', async () => {
    const http = new FakeHttp({
      '/v1/deployments/deployments/devices/': [{ id: 'old', status: 'finished' }],
    });
    expect(await new MenderService(http).inFlightFor('dev-1')).toBeNull();
  });

  it('answers null rather than failing the whole screen when Mender errors', async () => {
    // Not knowing about an in-flight deployment is a worse answer than a blank
    // card, but a 500 on the whole page is worse than both.
    const http = new FakeHttp({});
    expect(await new MenderService(http).inFlightFor('dev-1')).toBeNull();
  });
});

describe('MenderService.abort', () => {
  it('sets the deployment to aborted', async () => {
    const http = new FakeHttp();
    await new MenderService(http).abort('dep-1');
    expect(http.calls[0]).toEqual({
      method: 'PUT',
      path: '/v1/deployments/deployments/dep-1/status',
      body: { status: 'aborted' },
    });
  });

  it('escapes an id that would otherwise change the path', async () => {
    const http = new FakeHttp();
    await new MenderService(http).abort('a/b');
    expect(http.calls[0].path).toBe('/v1/deployments/deployments/a%2Fb/status');
  });
});
