/**
 * The HTTP client itself, with global fetch replaced.
 *
 * Everything else in this service is pure and tested without a socket. This file
 * is the exception because the client holds decisions of its own -- which status
 * codes become which error, what happens when the token is missing, and how an
 * id is read out of a header rather than a body -- and those only exist here.
 *
 * The module is re-imported per test because the token and the base URL are read
 * at module load, which is what makes "no token configured" a real state rather
 * than a hypothetical one.
 */

const TOKEN = 'fake-token-for-tests';

type FetchArgs = { url: string; init: RequestInit };

function loadService(env: Record<string, string | undefined> = {}) {
  jest.resetModules();
  const prev = { ...process.env };
  process.env.MENDER_API_TOKEN = TOKEN;
  process.env.MENDER_API_URL = 'https://mender.test/api/management';
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const mod = require('../../../src/services/MenderService');
  process.env = prev;
  return mod as typeof import('../../../src/services/MenderService');
}

function stubFetch(
  responses: Array<{ status: number; body?: unknown; location?: string; contentType?: string }>,
): { calls: FetchArgs[] } {
  const calls: FetchArgs[] = [];
  let i = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: {
        get: (h: string) => {
          if (h.toLowerCase() === 'location') return r.location ?? null;
          if (h.toLowerCase() === 'content-type') return r.contentType ?? 'application/json';
          return null;
        },
      },
      json: async () => r.body,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? '')),
    };
  });
  return { calls };
}

afterEach(() => {
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  jest.resetModules();
});

describe('the request it actually sends', () => {
  it('carries the bearer token and the base URL', async () => {
    const { MenderService } = loadService();
    const { calls } = stubFetch([{ status: 200, body: [] }]);
    await new MenderService().listArtifacts();

    expect(calls[0].url).toBe('https://mender.test/api/management/v1/deployments/artifacts?per_page=500');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('sends JSON only when there is a body', async () => {
    const { MenderService } = loadService();
    const { calls } = stubFetch([{ status: 200, body: [] }]);
    await new MenderService().listDevices();
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
  });

  it('refuses to call Mender at all with no token, rather than getting a 401', async () => {
    const { MenderService, ValidationErrorCheck } = {
      ...loadService({ MENDER_API_TOKEN: undefined }),
      ValidationErrorCheck: null,
    };
    stubFetch([{ status: 200, body: [] }]);
    await expect(new MenderService().listArtifacts()).rejects.toThrow(/MENDER_API_TOKEN/);
    expect(ValidationErrorCheck).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('what each status means', () => {
  it('turns 404 into a not-found', async () => {
    const { MenderService } = loadService();
    stubFetch([{ status: 404 }]);
    await expect(new MenderService().listArtifacts()).rejects.toThrow(/não encontrado/);
  });

  it('turns 409 into a conflict', async () => {
    const { MenderService } = loadService();
    stubFetch([{ status: 409 }]);
    await expect(new MenderService().listArtifacts()).rejects.toThrow(/conflito/);
  });

  it('reports any other failure with the status and a slice of the body', async () => {
    const { MenderService } = loadService();
    stubFetch([{ status: 500, body: 'internal explosion' }]);
    await expect(new MenderService().listArtifacts()).rejects.toThrow(/500.*internal explosion/);
  });

  it('never puts the token in the error', async () => {
    // The message goes to a log and to an API response.
    const { MenderService } = loadService();
    stubFetch([{ status: 500, body: 'boom' }]);
    await expect(new MenderService().listArtifacts()).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(TOKEN) }) as unknown as Error,
    );
  });

  it('answers undefined for 204, instead of trying to parse nothing', async () => {
    const { MenderService } = loadService();
    stubFetch([{ status: 204 }]);
    await expect(new MenderService().abort('dep-1')).resolves.toBeUndefined();
  });

  it('answers undefined when the body is not JSON', async () => {
    const { MenderService } = loadService();
    stubFetch([{ status: 200, contentType: 'text/plain', body: 'hello' }]);
    // listArtifacts maps over the result, so a non-JSON answer must degrade to
    // an empty list rather than throwing on .map of undefined.
    await expect(new MenderService().listArtifacts()).resolves.toEqual([]);
  });
});

describe('creating a deployment', () => {
  it('reads the id out of Location, because the body is empty', async () => {
    const { MenderService } = loadService();
    const { calls } = stubFetch([{
      status: 201,
      location: '/api/management/v1/deployments/deployments/a6f34728-85c1-403a-b2d9-0f577dbc1491',
    }]);

    const r = await new MenderService().deploy('dev-1', 'rc14.1.3', 'gcdr X -> rc14.1.3');

    expect(r.id).toBe('a6f34728-85c1-403a-b2d9-0f577dbc1491');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'gcdr X -> rc14.1.3',
      artifact_name: 'rc14.1.3',
      devices: ['dev-1'],
    });
  });

  it('answers an empty id rather than throwing when Location is missing', async () => {
    // A missing receipt must not turn a successful update into an error.
    const { MenderService } = loadService();
    stubFetch([{ status: 201 }]);
    await expect(new MenderService().deploy('dev-1', 'rc', 'n')).resolves.toEqual({ id: '' });
  });

  it('propagates a refusal from Mender instead of inventing an id', async () => {
    const { MenderService } = loadService();
    stubFetch([{ status: 400, body: 'artifact not found' }]);
    await expect(new MenderService().deploy('dev-1', 'rc', 'n')).rejects.toThrow(/400/);
  });
});

describe('the timeout', () => {
  it('gives up rather than holding a request open forever', async () => {
    const { MenderService } = loadService({ MENDER_TIMEOUT_MS: '10' });
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
      (_u: string, init: RequestInit) => new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      }),
    );
    await expect(new MenderService().listArtifacts()).rejects.toThrow(/abort/i);
  });
});
