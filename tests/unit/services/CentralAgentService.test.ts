import { CentralAgentService } from '../../../src/services/CentralAgentService';
import { NotFoundError } from '../../../src/shared/errors/AppError';

const CTX = { tenantId: 't1', centralId: 'c1' };

function makeService(
  opts: { job?: unknown; backup?: unknown } = {},
) {
  const jobs = {
    claimNextQueued: jest.fn(async () =>
      'job' in opts
        ? opts.job
        : {
            id: 'job-1',
            status: 'RUNNING',
            currentPhase: 'QUEUED',
            sourceBackupId: 'bkp-1',
          },
    ),
  };
  const backups = {
    getById: jest.fn(async () =>
      'backup' in opts
        ? opts.backup
        : {
            id: 'bkp-1',
            status: 'AVAILABLE',
            storageKey: 'backups/t1/c1/bkp-1.pgdump.custom',
          },
    ),
  };
  const storage = { getPresignedDownloadUrl: jest.fn(async () => 'https://s3.test/get?sig=xyz') };
  const restore = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateProgress: jest.fn(async (_t: string, _c: string, id: string, patch: any) => ({
      id,
      ...patch,
    })),
  };
  const svc = new CentralAgentService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jobs as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    backups as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    restore as any,
  );
  return { svc, jobs, backups, storage, restore };
}

describe('CentralAgentService', () => {
  describe('nextJob', () => {
    it('claims the QUEUED job (now RUNNING) and returns a download URL', async () => {
      const { svc, jobs, backups, storage } = makeService();
      const res = await svc.nextJob(CTX);

      expect(jobs.claimNextQueued).toHaveBeenCalledWith('t1', 'c1');
      expect(backups.getById).toHaveBeenCalledWith('t1', 'c1', 'bkp-1');
      expect(storage.getPresignedDownloadUrl).toHaveBeenCalled();
      expect(res).toEqual({
        jobId: 'job-1',
        type: 'restore',
        sourceBackupId: 'bkp-1',
        downloadUrl: 'https://s3.test/get?sig=xyz',
        phase: 'QUEUED',
      });
    });

    it('returns null when there is no QUEUED job (no backup/url lookups)', async () => {
      const { svc, backups, storage } = makeService({ job: null });
      const res = await svc.nextJob(CTX);

      expect(res).toBeNull();
      expect(backups.getById).not.toHaveBeenCalled();
      expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the source backup is missing', async () => {
      const { svc } = makeService({ backup: null });
      await expect(svc.nextJob(CTX)).rejects.toThrow(NotFoundError);
    });

    it('scopes the claim to the AUTHENTICATED central only', async () => {
      const { svc, jobs } = makeService();
      await svc.nextJob({ tenantId: 't9', centralId: 'c9' });
      expect(jobs.claimNextQueued).toHaveBeenCalledWith('t9', 'c9');
    });
  });

  describe('reportProgress', () => {
    it('delegates to updateProgress scoped to the authenticated central', async () => {
      const { svc, restore } = makeService();
      const patch = { currentPhase: 'RESTORE_DB' as const, message: 'restoring' };
      const res = await svc.reportProgress(CTX, 'job-1', patch);

      expect(restore.updateProgress).toHaveBeenCalledWith('t1', 'c1', 'job-1', patch);
      expect(res).toEqual(expect.objectContaining({ id: 'job-1', currentPhase: 'RESTORE_DB' }));
    });

    it('passes the central scope from ctx, never a caller-supplied central', async () => {
      const { svc, restore } = makeService();
      await svc.reportProgress({ tenantId: 't2', centralId: 'c2' }, 'job-7', { message: 'x' });
      expect(restore.updateProgress).toHaveBeenCalledWith('t2', 'c2', 'job-7', { message: 'x' });
    });
  });
});
