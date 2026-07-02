import { CentralBackupService } from '../../../src/services/CentralBackupService';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const SHA = 'a'.repeat(64);

function makeService(
  opts: {
    central?: unknown;
    backupRow?: unknown;
    listResult?: unknown[];
    headResult?: unknown;
    uploadUrlImpl?: () => Promise<string>;
  } = {},
) {
  const storage = {
    bucket: 'test-bucket',
    getPresignedUploadUrl: jest.fn(opts.uploadUrlImpl ?? (async () => 'https://s3.test/put?sig=abc')),
    getPresignedDownloadUrl: jest.fn(async () => 'https://s3.test/get?sig=xyz'),
    // Default HeadObject reports a 1234-byte object (matches the confirm tests).
    headObject: jest.fn(async () =>
      'headResult' in opts
        ? opts.headResult
        : { byteSize: 1234, contentType: 'application/octet-stream', etag: null, lastModified: null },
    ),
  };
  const backups = {
    create: jest.fn(async (input: { id?: string }) => ({
      id: input.id ?? 'bkp-1',
      status: 'PENDING',
      ...input,
    })),
    getById: jest.fn(async () => ('backupRow' in opts ? opts.backupRow : null)),
    listByCentralPaged: jest.fn(async () => ({
      items: opts.listResult ?? [],
      total: (opts.listResult ?? []).length,
    })),
    markAvailable: jest.fn(async (_t: string, id: string, sha256: string, byteSize: number) => ({
      id,
      status: 'AVAILABLE',
      sha256,
      byteSize,
    })),
  };
  const centrals = {
    getById: jest.fn(async () =>
      'central' in opts ? opts.central : { id: 'c1', serialNumber: '1.2.3.4' },
    ),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new CentralBackupService(storage as any, backups as any, centrals as any);
  return { svc, storage, backups, centrals };
}

describe('CentralBackupService', () => {
  describe('createBackup', () => {
    it('mints a presigned PUT, records a PENDING row, returns the slot', async () => {
      const { svc, storage, backups } = makeService();
      const res = await svc.createBackup('t1', 'c1', 'u1', { sourceLabel: 'manual' });

      expect(res.status).toBe('PENDING');
      expect(res.uploadUrl).toBe('https://s3.test/put?sig=abc');
      expect(res.bucket).toBe('test-bucket');
      expect(res.expiresIn).toBe(3600);
      expect(res.storageKey).toMatch(/^backups\/t1\/c1\/.+\.pgdump\.custom$/);

      expect(storage.getPresignedUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'application/octet-stream', expiresInSeconds: 3600 }),
      );
      expect(backups.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', centralId: 'c1', createdBy: 'u1' }),
      );
    });

    it('derives the storage key server-side from tenant+central+backupId (CR-S9a)', async () => {
      const { svc } = makeService();
      const res = await svc.createBackup('t1', 'c1', 'u1', {});
      // Key is never client-supplied: fixed prefix + server ids, no traversal.
      expect(res.storageKey).toMatch(/^backups\/t1\/c1\/[^/]+\.pgdump\.custom$/);
      expect(res.storageKey).not.toContain('..');
    });

    it('throws NotFoundError when the central does not exist', async () => {
      const { svc, storage } = makeService({ central: null });
      await expect(svc.createBackup('t1', 'missing', 'u1', {})).rejects.toThrow(NotFoundError);
      expect(storage.getPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('leaves NO row when the presign fails (CR-S10)', async () => {
      const { svc, backups } = makeService({
        uploadUrlImpl: async () => {
          throw new Error('presign boom');
        },
      });
      await expect(svc.createBackup('t1', 'c1', 'u1', {})).rejects.toThrow('presign boom');
      // The metadata row is created AFTER the presign, so a presign failure must
      // not leave an orphan PENDING row.
      expect(backups.create).not.toHaveBeenCalled();
    });
  });

  describe('confirmBackup', () => {
    const PENDING_ROW = {
      id: 'bkp-1',
      status: 'PENDING',
      storageKey: 'backups/t1/c1/bkp-1.pgdump.custom',
    };

    it('marks a PENDING backup AVAILABLE after HeadObject confirms the size', async () => {
      const { svc, backups, storage } = makeService({ backupRow: PENDING_ROW });
      const res = await svc.confirmBackup('t1', 'c1', 'bkp-1', { sha256: SHA, byteSize: 1234 });
      expect(res.status).toBe('AVAILABLE');
      expect(storage.headObject).toHaveBeenCalledWith('backups/t1/c1/bkp-1.pgdump.custom');
      expect(backups.markAvailable).toHaveBeenCalledWith('t1', 'bkp-1', SHA, 1234);
    });

    it('rejects when the object is not in storage (upload never landed, CR-S4)', async () => {
      const { svc, backups } = makeService({ backupRow: PENDING_ROW, headResult: null });
      await expect(
        svc.confirmBackup('t1', 'c1', 'bkp-1', { sha256: SHA, byteSize: 1234 }),
      ).rejects.toThrow(ValidationError);
      expect(backups.markAvailable).not.toHaveBeenCalled();
    });

    it('rejects when the storage size mismatches the reported byteSize (CR-S4)', async () => {
      const { svc, backups } = makeService({
        backupRow: PENDING_ROW,
        headResult: { byteSize: 999, contentType: null, etag: null, lastModified: null },
      });
      await expect(
        svc.confirmBackup('t1', 'c1', 'bkp-1', { sha256: SHA, byteSize: 1234 }),
      ).rejects.toThrow(ValidationError);
      expect(backups.markAvailable).not.toHaveBeenCalled();
    });

    it('is idempotent: re-confirming an AVAILABLE backup is a no-op (no HeadObject)', async () => {
      const { svc, backups, storage } = makeService({
        backupRow: { id: 'bkp-1', status: 'AVAILABLE' },
      });
      const res = await svc.confirmBackup('t1', 'c1', 'bkp-1', { sha256: SHA, byteSize: 1234 });
      expect(res.status).toBe('AVAILABLE');
      expect(storage.headObject).not.toHaveBeenCalled();
      expect(backups.markAvailable).not.toHaveBeenCalled();
    });

    it('rejects a FAILED/EXPIRED backup deterministically (400, not 500)', async () => {
      const { svc, backups } = makeService({ backupRow: { id: 'bkp-1', status: 'FAILED' } });
      await expect(
        svc.confirmBackup('t1', 'c1', 'bkp-1', { sha256: SHA, byteSize: 1 }),
      ).rejects.toThrow(ValidationError);
      expect(backups.markAvailable).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the backup is missing', async () => {
      const { svc } = makeService({ backupRow: null });
      await expect(
        svc.confirmBackup('t1', 'c1', 'nope', { sha256: SHA, byteSize: 1 }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('reissueUploadUrl (CR-S9)', () => {
    it('re-mints a PUT URL for a PENDING backup using the SAME key, no new row', async () => {
      const { svc, storage, backups } = makeService({
        backupRow: {
          id: 'bkp-1',
          status: 'PENDING',
          storageKey: 'backups/t1/c1/bkp-1.pgdump.custom',
          bucket: 'test-bucket',
        },
      });
      const res = await svc.reissueUploadUrl('t1', 'c1', 'bkp-1');
      expect(res.uploadUrl).toBe('https://s3.test/put?sig=abc');
      expect(res.storageKey).toBe('backups/t1/c1/bkp-1.pgdump.custom');
      expect(storage.getPresignedUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'backups/t1/c1/bkp-1.pgdump.custom' }),
      );
      expect(backups.create).not.toHaveBeenCalled();
    });

    it('refuses to reissue for an already-confirmed (AVAILABLE) backup', async () => {
      const { svc } = makeService({ backupRow: { id: 'bkp-1', status: 'AVAILABLE' } });
      await expect(svc.reissueUploadUrl('t1', 'c1', 'bkp-1')).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError when the backup is missing', async () => {
      const { svc } = makeService({ backupRow: null });
      await expect(svc.reissueUploadUrl('t1', 'c1', 'nope')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listBackups', () => {
    it('throws NotFoundError when the central does not exist', async () => {
      const { svc } = makeService({ central: null });
      await expect(svc.listBackups('t1', 'missing')).rejects.toThrow(NotFoundError);
    });

    it('returns a PaginatedResult envelope for an existing central', async () => {
      const rows = [{ id: 'b1' }, { id: 'b2' }];
      const { svc } = makeService({ listResult: rows });
      const res = await svc.listBackups('t1', 'c1');
      expect(res.items).toEqual(rows);
      expect(res.pagination).toEqual(
        expect.objectContaining({ total: 2, totalPages: 1, hasMore: false }),
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('mints a presigned GET URL for an AVAILABLE backup', async () => {
      const { svc, storage } = makeService({
        backupRow: {
          id: 'bkp-1',
          status: 'AVAILABLE',
          storageKey: 'backups/t1/c1/bkp-1.pgdump.custom',
          sha256: SHA,
          byteSize: 99,
        },
      });
      const res = await svc.getDownloadUrl('t1', 'c1', 'bkp-1');
      expect(res.downloadUrl).toBe('https://s3.test/get?sig=xyz');
      expect(res.sha256).toBe(SHA);
      expect(res.expiresIn).toBe(3600);
      expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'backups/t1/c1/bkp-1.pgdump.custom', expiresInSeconds: 3600 }),
      );
    });

    it('throws ValidationError when the backup is not AVAILABLE', async () => {
      const { svc, storage } = makeService({ backupRow: { id: 'bkp-1', status: 'PENDING' } });
      await expect(svc.getDownloadUrl('t1', 'c1', 'bkp-1')).rejects.toThrow(ValidationError);
      expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the backup is missing', async () => {
      const { svc } = makeService({ backupRow: null });
      await expect(svc.getDownloadUrl('t1', 'c1', 'nope')).rejects.toThrow(NotFoundError);
    });
  });
});
