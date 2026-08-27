/**
 * RFC-0061 M2 — exit-requirements matrix (W4), full combination coverage.
 *
 * | Domain            | is_manufactured | Exit requires                    |
 * |-------------------|-----------------|----------------------------------|
 * | PRODUCT           | true            | QRs (count = quantity) AND photo |
 * | PRODUCT/COMPONENT | false           | QR OR photo                      |
 * | THIRD_PARTY       | —               | photo (no QRs)                   |
 * | TOOL              | —               | destination (responsible)        |
 *
 * Service with mocked repository — no DB.
 */

import { InventoryStockService } from '../../../src/services/inventory/InventoryStockService';
import type { CreateMovementDTO } from '../../../src/dto/request/InventoryDTO';
import { ValidationError } from '../../../src/shared/errors/AppError';
import { CTX, ITEM_ID, PHOTO_ID, makeItem, makeRepo } from './m2-helpers';

const KEY = 'idem-key-1';

function exitDto(overrides: Partial<CreateMovementDTO> = {}): CreateMovementDTO {
  return {
    itemId: ITEM_ID,
    location: 'FABRICA',
    quantity: 2,
    type: 'SAIDA',
    ...overrides,
  } as CreateMovementDTO;
}

const qrs = (n: number) => Array.from({ length: n }, (_, i) => ({ qrValue: `QR-${i}` }));

describe('M2 exit-requirements matrix (W4)', () => {
  describe('PRODUCT manufactured — QRs (count = quantity) AND photo', () => {
    const item = makeItem({ domain: 'PRODUCT', isManufactured: true });

    it('rejects an exit without QRs', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      await expect(svc.createMovement(CTX, exitDto({ photoFileId: PHOTO_ID }), KEY)).rejects.toThrow(
        ValidationError,
      );
    });

    it('rejects an exit whose QR count differs from quantity', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      await expect(
        svc.createMovement(CTX, exitDto({ quantity: 3, qrs: qrs(2), photoFileId: PHOTO_ID }), KEY),
      ).rejects.toThrow(/quantidade.*QRs|QRs.*quantidade/i);
    });

    it('rejects an exit with QRs but no photo', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      await expect(svc.createMovement(CTX, exitDto({ qrs: qrs(2) }), KEY)).rejects.toThrow(/foto/i);
    });

    it('accepts QRs (count = quantity) + photo, persisting the QR links', async () => {
      const repo = makeRepo({ lockItem: jest.fn(async () => item) });
      const svc = new InventoryStockService(repo);
      const result = await svc.createMovement(
        CTX,
        exitDto({ quantity: 2, qrs: qrs(2), photoFileId: PHOTO_ID }),
        KEY,
      );
      expect(result.type).toBe('SAIDA');
      expect(result.qrs).toHaveLength(2);
      expect(repo.insertMovementQrs).toHaveBeenCalledTimes(1);
    });
  });

  describe.each(['PRODUCT', 'COMPONENT'] as const)('%s non-manufactured — QR OR photo', (domain) => {
    const item = makeItem({ domain, isManufactured: false });

    it('rejects an exit with neither QR nor photo', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      await expect(svc.createMovement(CTX, exitDto(), KEY)).rejects.toThrow(/QR ou foto/i);
    });

    it('accepts an exit with a QR only', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      const result = await svc.createMovement(CTX, exitDto({ qrs: qrs(1) }), KEY);
      expect(result.type).toBe('SAIDA');
    });

    it('accepts an exit with a photo only', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      const result = await svc.createMovement(CTX, exitDto({ photoFileId: PHOTO_ID }), KEY);
      expect(result.photoFileId).toBe(PHOTO_ID);
    });
  });

  describe('THIRD_PARTY — photo required, QRs not accepted', () => {
    const item = makeItem({ domain: 'THIRD_PARTY' });

    it('rejects an exit without photo', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      await expect(svc.createMovement(CTX, exitDto(), KEY)).rejects.toThrow(/foto/i);
    });

    it('rejects an exit carrying QRs', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      await expect(
        svc.createMovement(CTX, exitDto({ qrs: qrs(1), photoFileId: PHOTO_ID }), KEY),
      ).rejects.toThrow(/QR/i);
    });

    it('accepts an exit with a photo', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      const result = await svc.createMovement(CTX, exitDto({ photoFileId: PHOTO_ID }), KEY);
      expect(result.type).toBe('SAIDA');
    });
  });

  describe('TOOL — destination (responsible) required, photo optional', () => {
    const item = makeItem({ domain: 'TOOL' });

    it('rejects an exit without responsible/destination', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      await expect(svc.createMovement(CTX, exitDto(), KEY)).rejects.toThrow(/destino/i);
    });

    it('rejects a blank responsible', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      await expect(svc.createMovement(CTX, exitDto({ responsible: '   ' }), KEY)).rejects.toThrow(
        ValidationError,
      );
    });

    it('accepts an exit with responsible and no photo', async () => {
      const svc = new InventoryStockService(makeRepo({ lockItem: jest.fn(async () => item) }));
      const result = await svc.createMovement(CTX, exitDto({ responsible: 'Bancada 3' }), KEY);
      expect(result.responsible).toBe('Bancada 3');
    });
  });

  describe('non-exit movements skip the matrix', () => {
    it.each(['ENTRADA', 'AJUSTE'] as const)('%s needs neither QR, photo nor responsible', async (type) => {
      const item = makeItem({ domain: 'PRODUCT', isManufactured: true });
      const repo = makeRepo({ lockItem: jest.fn(async () => item) });
      const svc = new InventoryStockService(repo);
      const result = await svc.createMovement(CTX, exitDto({ type }), `${KEY}:${type}`);
      expect(result.type).toBe(type);
      // No balance guard on additive movements either.
      expect(repo.getBalance).not.toHaveBeenCalled();
    });
  });
});
