import { CentralCommandService } from '../../../src/services/CentralCommandService';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

function makeService(
  opts: {
    central?: unknown;
    command?: unknown;
    listResult?: unknown[];
    activeCommand?: unknown;
    updateResult?: unknown;
  } = {},
) {
  const commands = {
    create: jest.fn(async (i: { id?: string; type?: string }) => ({
      id: i.id ?? 'cmd-1',
      status: 'QUEUED',
      ...i,
    })),
    getById: jest.fn(async () => ('command' in opts ? opts.command : null)),
    listByCentralPaged: jest.fn(async () => ({
      items: opts.listResult ?? [],
      total: (opts.listResult ?? []).length,
    })),
    findActiveByCentral: jest.fn(async () =>
      'activeCommand' in opts ? opts.activeCommand : null,
    ),
    update: jest.fn(
      async (
        _t: string,
        id: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        patch: any,
        _expectedStatus?: string,
      ) => ('updateResult' in opts ? opts.updateResult : { id, ...patch }),
    ),
  };
  const centrals = {
    getById: jest.fn(async () => ('central' in opts ? opts.central : { id: 'c1' })),
  };
  const svc = new CentralCommandService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    commands as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    centrals as any,
  );
  return { svc, commands, centrals };
}

describe('CentralCommandService', () => {
  describe('createCommand', () => {
    it('creates a QUEUED command for the central', async () => {
      const { svc, commands } = makeService();
      const res = await svc.createCommand('t1', 'c1', 'u1', { type: 'RESTART_ERLANG' });
      expect(res.status).toBe('QUEUED');
      expect(commands.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          centralId: 'c1',
          type: 'RESTART_ERLANG',
          createdBy: 'u1',
        }),
      );
    });

    it('throws NotFoundError when the central is missing (no command created)', async () => {
      const { svc, commands } = makeService({ central: null });
      await expect(svc.createCommand('t1', 'x', 'u1', { type: 'REBOOT' })).rejects.toThrow(
        NotFoundError,
      );
      expect(commands.create).not.toHaveBeenCalled();
    });

    it('rejects a second command while one is still in flight (dedup guard)', async () => {
      const { svc, commands } = makeService({
        activeCommand: { id: 'cmd-active', type: 'REBOOT', status: 'QUEUED' },
      });
      await expect(svc.createCommand('t1', 'c1', 'u1', { type: 'REBOOT' })).rejects.toThrow(
        ValidationError,
      );
      expect(commands.create).not.toHaveBeenCalled();
    });

    it('rejects SET_WIFI on a non-CM4 central', async () => {
      const { svc, commands } = makeService({
        central: { id: 'c1', metadata: { platform: 'orangepi-zero2' } },
      });
      await expect(
        svc.createCommand('t1', 'c1', 'u1', {
          type: 'SET_WIFI',
          payload: { ssid: 'net', password: 'password1' },
        }),
      ).rejects.toThrow(ValidationError);
      expect(commands.create).not.toHaveBeenCalled();
    });

    it('rejects SET_WIFI when the platform is unknown', async () => {
      const { svc, commands } = makeService({ central: { id: 'c1' } });
      await expect(
        svc.createCommand('t1', 'c1', 'u1', {
          type: 'SET_WIFI',
          payload: { ssid: 'net', password: 'password1' },
        }),
      ).rejects.toThrow(ValidationError);
      expect(commands.create).not.toHaveBeenCalled();
    });

    it('accepts SET_WIFI on a CM4 central, passes the payload, and strips it from the response', async () => {
      const { svc, commands } = makeService({
        central: { id: 'c1', metadata: { platform: 'raspberrypi-cm4-64' } },
      });
      const res = await svc.createCommand('t1', 'c1', 'u1', {
        type: 'SET_WIFI',
        payload: { ssid: 'net', password: 'password1', country: 'BR' },
      });
      expect(commands.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_WIFI',
          payload: { ssid: 'net', password: 'password1', country: 'BR' },
        }),
      );
      // the WiFi password must never come back to the operator
      expect((res as Record<string, unknown>).payload).toBeUndefined();
    });
  });

  describe('updateResult', () => {
    it('stores exit_code + stdout/stderr and stamps completedAt on DONE', async () => {
      const { svc, commands } = makeService({ command: { id: 'cmd-1', status: 'RUNNING' } });
      await svc.updateResult('t1', 'c1', 'cmd-1', {
        status: 'DONE',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      });
      const patch = commands.update.mock.calls[0][2];
      expect(patch.status).toBe('DONE');
      expect(patch.exitCode).toBe(0);
      expect(patch.stdout).toBe('ok');
      expect(patch.completedAt).toBeInstanceOf(Date);
    });

    it('stamps completedAt on FAILED', async () => {
      const { svc, commands } = makeService({ command: { id: 'cmd-1', status: 'RUNNING' } });
      await svc.updateResult('t1', 'c1', 'cmd-1', {
        status: 'FAILED',
        exitCode: 1,
        errorMessage: 'boom',
      });
      const patch = commands.update.mock.calls[0][2];
      expect(patch.status).toBe('FAILED');
      expect(patch.completedAt).toBeInstanceOf(Date);
    });

    it('allows a RUNNING report without a terminal status (no completedAt)', async () => {
      const { svc, commands } = makeService({ command: { id: 'cmd-1', status: 'QUEUED' } });
      await svc.updateResult('t1', 'c1', 'cmd-1', { status: 'RUNNING' });
      const patch = commands.update.mock.calls[0][2];
      expect(patch.status).toBe('RUNNING');
      expect(patch.completedAt).toBeUndefined();
    });

    it('rejects an illegal status transition RUNNING -> QUEUED', async () => {
      const { svc, commands } = makeService({ command: { id: 'cmd-1', status: 'RUNNING' } });
      await expect(svc.updateResult('t1', 'c1', 'cmd-1', { status: 'QUEUED' })).rejects.toThrow(
        ValidationError,
      );
      expect(commands.update).not.toHaveBeenCalled();
    });

    it('rejects updates to an already-finished command', async () => {
      const { svc, commands } = makeService({ command: { id: 'cmd-1', status: 'DONE' } });
      await expect(svc.updateResult('t1', 'c1', 'cmd-1', { stdout: 'late' })).rejects.toThrow(
        ValidationError,
      );
      expect(commands.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the command is missing', async () => {
      const { svc } = makeService({ command: null });
      await expect(svc.updateResult('t1', 'c1', 'nope', { status: 'RUNNING' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('CAS: rejects the report when the command changed concurrently (update no-op)', async () => {
      const { svc, commands } = makeService({
        command: { id: 'cmd-1', status: 'RUNNING' },
        updateResult: null, // reaper flipped it to FAILED between read and write
      });
      await expect(
        svc.updateResult('t1', 'c1', 'cmd-1', { status: 'DONE', exitCode: 0 }),
      ).rejects.toThrow(ValidationError);
      // CAS predicate carries the pre-read status
      expect(commands.update).toHaveBeenCalledWith('t1', 'cmd-1', expect.any(Object), 'RUNNING');
    });
  });

  describe('getCommand / listCommands', () => {
    it('getCommand throws NotFoundError when missing', async () => {
      const { svc } = makeService({ command: null });
      await expect(svc.getCommand('t1', 'c1', 'nope')).rejects.toThrow(NotFoundError);
    });

    it('listCommands throws NotFoundError when the central is missing', async () => {
      const { svc } = makeService({ central: null });
      await expect(svc.listCommands('t1', 'x')).rejects.toThrow(NotFoundError);
    });

    it('listCommands returns a PaginatedResult envelope', async () => {
      const { svc } = makeService({ listResult: [{ id: 'cmd-1' }] });
      const res = await svc.listCommands('t1', 'c1', { page: 1, limit: 50 });
      expect(res.items).toHaveLength(1);
      expect(res.pagination).toEqual(
        expect.objectContaining({ total: 1, totalPages: 1, hasMore: false }),
      );
    });
  });
});
