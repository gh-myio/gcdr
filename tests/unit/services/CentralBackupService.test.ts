import { CentralBackupService } from '../../../src/services/CentralBackupService';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const SHA = 'a'.repeat(64);

function makeService(
  opts: { central?: unknown; backupRow?: unknown; listResult?: unknown[] } = {},
) {
  const storage = {
    bucket: 'test-bucket',
    getPresignedUploadUrl: jest.fn(async () => 'https://s3.test/put?sig=abc'),
    getPresignedDownloadUrl: jest.fn(async () => 'https://s3.test/get?sig=xyz'),
  };
  const backups = {
    create: jest.fn(async (input: { id?: string }) => ({
      id: input.id ?? 'bkp-1',
      status: 'PENDING',
      ...input,
    })),
    getById: jest.fn(async () => ('backupRow' in opts ? opts.backupRow : null)),
    listByCentral: jest.fn(async () => opts.listResult ?? []),
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
      expect(res.expiresIn).toBe(900);
      expect(res.storageKey).toMatch(/^backups\/t1\/c1\/.+\.pgdump\.custom$/);

      expect(storage.getPresignedUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'application/octet-stream', expiresInSeconds: 900 }),
      );
      expect(backups.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', centralId: 'c1', createdBy: 'u1' }),
      );
    });

    it('throws NotFoundError when the central does not exist', async () => {
      const { svc, storage } = makeService({ central: null });
      await expect(svc.createBackup('t1', 'missing', 'u1', {})).rejects.toThrow(NotFoundError);
      expect(storage.getPresignedUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe('confirmBackup', () => {
    it('marks a PENDING backup AVAILABLE with sha256 + byteSize', async () => {
      const { svc, backups } = makeService({ backupRow: { id: 'bkp-1', status: 'PENDING' } });
      const res = await svc.confirmBackup('t1', 'c1', 'bkp-1', { sha256: SHA, byteSize: 1234 });
      expect(res.status).toBe('AVAILABLE');
      expect(backups.markAvailable).toHaveBeenCalledWith('t1', 'bkp-1', SHA, 1234);
    });

    it('is idempotent: re-confirming an AVAILABLE backup does not touch the row', async () => {
      const { svc, backups } = makeService({ backupRow: { id: 'bkp-1', status: 'AVAILABLE' } });
      const res = await svc.confirmBackup('t1', 'c1', 'bkp-1', { sha256: SHA, byteSize: 1234 });
      expect(res.status).toBe('AVAILABLE');
      expect(backups.markAvailable).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the backup is missing', async () => {
      const { svc } = makeService({ backupRow: null });
      await expect(
        svc.confirmBackup('t1', 'c1', 'nope', { sha256: SHA, byteSize: 1 }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listBackups', () => {
    it('throws NotFoundError when the central does not exist', async () => {
      const { svc } = makeService({ central: null });
      await expect(svc.listBackups('t1', 'missing')).rejects.toThrow(NotFoundError);
    });

    it('returns the repository list for an existing central', async () => {
      const rows = [{ id: 'b1' }, { id: 'b2' }];
      const { svc } = makeService({ listResult: rows });
      await expect(svc.listBackups('t1', 'c1')).resolves.toEqual(rows);
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
