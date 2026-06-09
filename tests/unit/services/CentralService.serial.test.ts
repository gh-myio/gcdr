import { CentralService } from '../../../src/services/CentralService';
import { ConflictError } from '../../../src/shared/errors/AppError';
import type { ICentralRepository } from '../../../src/repositories/interfaces/ICentralRepository';

function makeService(existsImpl?: (s: string) => boolean) {
  const repo = {
    existsBySerialNumberGlobal: jest.fn(async (s: string) => existsImpl?.(s) ?? false),
  } as unknown as ICentralRepository;
  return { svc: new CentralService(repo, {} as never), repo };
}

describe('CentralService — central_id (serial) S1.S2.S3.S4', () => {
  const { svc } = makeService();

  describe('isValidSerial', () => {
    it.each(['1.1.1.1', '254.254.254.254', '92.238.22.98', '10.200.3.99'])('accepts %s', (v) => {
      expect(svc.isValidSerial(v)).toBe(true);
    });
    it.each(['0.1.1.1', '255.1.1.1', '999.1.1.1', '1.2.3', '1.2.3.4.5', '1.2.3.', 'abc', '1.2.3.0', ''])(
      'rejects %s',
      (v) => {
        expect(svc.isValidSerial(v)).toBe(false);
      },
    );
  });

  describe('generateSerial', () => {
    it('always produces a valid serial with 4 slots in 1..254', () => {
      for (let i = 0; i < 500; i++) {
        const s = svc.generateSerial();
        expect(svc.isValidSerial(s)).toBe(true);
        for (const part of s.split('.')) {
          const n = Number(part);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(254);
        }
      }
    });
  });

  describe('isSerialAvailable', () => {
    it('returns false for an invalid format without hitting the repo', async () => {
      const { svc, repo } = makeService();
      expect(await svc.isSerialAvailable('999.1.1.1')).toBe(false);
      expect(repo.existsBySerialNumberGlobal).not.toHaveBeenCalled();
    });
    it('returns true when valid and not taken', async () => {
      const { svc } = makeService(() => false);
      expect(await svc.isSerialAvailable('10.20.30.40')).toBe(true);
    });
    it('returns false when valid but already taken', async () => {
      const { svc } = makeService(() => true);
      expect(await svc.isSerialAvailable('10.20.30.40')).toBe(false);
    });
  });

  describe('findAvailableSerial', () => {
    it('returns a valid serial when the first draw is free', async () => {
      const { svc } = makeService(() => false);
      expect(svc.isValidSerial(await svc.findAvailableSerial())).toBe(true);
    });
    it('retries past collisions', async () => {
      let calls = 0;
      const { svc } = makeService(() => ++calls <= 2); // first 2 taken, 3rd free
      const s = await svc.findAvailableSerial();
      expect(svc.isValidSerial(s)).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(3);
    });
    it('throws ConflictError if it cannot allocate after maxTries', async () => {
      const { svc } = makeService(() => true); // always taken
      await expect(svc.findAvailableSerial(5)).rejects.toThrow(ConflictError);
    });
  });
});
