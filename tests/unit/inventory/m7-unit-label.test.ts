/**
 * RFC-0061 M7 — unit-product creation: label = available homologated QR.
 *
 * The optional label is validated against M5: it must exist in
 * inv_qr_registry as a UNIT QR and must not be the label of another ACTIVE
 * unit product (the DB unique index — spanning moved units too — is the
 * backstop, mapped to 409).
 */

import { InventoryFieldService } from '../../../src/services/inventory/InventoryFieldService';
import {
  CTX,
  TENANT,
  ITEM_ID,
  QR,
  PROJECT_ID,
  makeFieldRepo,
  makeStockRepo,
  makeQrRepo,
  makeUnit,
  makeRegistryRow,
} from './m7-helpers';

function build(overrides: {
  field?: Record<string, jest.Mock>;
  qr?: Record<string, jest.Mock>;
} = {}) {
  const fieldRepo = makeFieldRepo(overrides.field);
  const qrRepo = makeQrRepo(overrides.qr);
  const service = new InventoryFieldService(fieldRepo, makeStockRepo(), qrRepo);
  return { service, fieldRepo, qrRepo };
}

describe('M7 POST unit-products — label validation', () => {
  it('valid homologated label → creates the unit with status PARADO', async () => {
    const { service, fieldRepo, qrRepo } = build();
    const result = await service.createUnitProduct(CTX, { itemId: ITEM_ID, label: QR, projectId: PROJECT_ID });

    expect(qrRepo.findRegistryByValues).toHaveBeenCalledWith(TENANT, [QR], expect.anything());
    expect(fieldRepo.findUnitByLabel).toHaveBeenCalledWith(TENANT, QR, true, expect.anything());
    const inputs = fieldRepo.insertUnitProducts.mock.calls[0][0];
    expect(inputs[0]).toMatchObject({
      itemId: ITEM_ID,
      label: QR,
      status: 'PARADO',
      projectId: PROJECT_ID,
      clientNameSnapshot: 'Projeto Moxuara', // Projeto = Cliente
    });
    expect(result.label).toBe(QR);
    expect(result.status).toBe('PARADO');
  });

  it('label given as the full QR URL is normalized to the bare code', async () => {
    const { service, fieldRepo } = build();
    await service.createUnitProduct(CTX, { itemId: ITEM_ID, label: `https://produto.myio.com.br/${QR}` });
    const inputs = fieldRepo.insertUnitProducts.mock.calls[0][0];
    expect(inputs[0].label).toBe(QR);
  });

  it('label not in the M5 registry → 422 INV_QR_NOT_IN_REGISTRY', async () => {
    const { service, fieldRepo } = build({
      qr: { findRegistryByValues: jest.fn(async () => []) },
    });
    await expect(service.createUnitProduct(CTX, { itemId: ITEM_ID, label: QR })).rejects.toMatchObject({
      statusCode: 422,
      code: 'INV_QR_NOT_IN_REGISTRY',
    });
    expect(fieldRepo.insertUnitProducts).not.toHaveBeenCalled();
  });

  it('a BOX QR cannot be a unit label → 422 INV_QR_NOT_IN_REGISTRY', async () => {
    const { service } = build({
      qr: { findRegistryByValues: jest.fn(async () => [makeRegistryRow({ kind: 'BOX' })]) },
    });
    await expect(service.createUnitProduct(CTX, { itemId: ITEM_ID, label: QR })).rejects.toMatchObject({
      statusCode: 422,
      code: 'INV_QR_NOT_IN_REGISTRY',
    });
  });

  it('label already used by another ACTIVE unit → 409 INV_QR_DUPLICATE', async () => {
    const { service, fieldRepo } = build({
      field: { findUnitByLabel: jest.fn(async () => makeUnit()) },
    });
    await expect(service.createUnitProduct(CTX, { itemId: ITEM_ID, label: QR })).rejects.toMatchObject({
      statusCode: 409,
      code: 'INV_QR_DUPLICATE',
    });
    expect(fieldRepo.insertUnitProducts).not.toHaveBeenCalled();
  });

  it('DB unique-index race (23505) maps to a 409 conflict', async () => {
    const dbErr = Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('duplicate key value violates unique constraint "inv_unit_products_label_uq"'), {
        code: '23505',
      }),
    });
    const { service } = build({
      field: { insertUnitProducts: jest.fn(async () => { throw dbErr; }) },
    });
    await expect(service.createUnitProduct(CTX, { itemId: ITEM_ID, label: QR })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('no label is fine (units from technician moves have none)', async () => {
    const { service, fieldRepo, qrRepo } = build();
    await service.createUnitProduct(CTX, { itemId: ITEM_ID });
    expect(qrRepo.findRegistryByValues).not.toHaveBeenCalled();
    const inputs = fieldRepo.insertUnitProducts.mock.calls[0][0];
    expect(inputs[0].label).toBeNull();
  });

  it('unknown item → 404', async () => {
    const { service } = build({ qr: { getItem: jest.fn(async () => null) } });
    await expect(service.createUnitProduct(CTX, { itemId: ITEM_ID })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('M7 PATCH unit-products — install toggle', () => {
  it('PARADO → INSTALADO stamps installed_at', async () => {
    const { service, fieldRepo } = build();
    await service.updateUnitProduct(CTX, makeUnit().id, { status: 'INSTALADO' });
    expect(fieldRepo.updateUnitStatus).toHaveBeenCalledWith(
      TENANT,
      makeUnit().id,
      'INSTALADO',
      expect.any(Date),
      expect.anything(),
    );
  });

  it('INSTALADO → PARADO clears installed_at', async () => {
    const { service, fieldRepo } = build({
      field: {
        getUnitProductForUpdate: jest.fn(async () =>
          makeUnit({ status: 'INSTALADO', installedAt: new Date('2026-03-02T00:00:00Z') }),
        ),
      },
    });
    await service.updateUnitProduct(CTX, makeUnit().id, { status: 'PARADO' });
    expect(fieldRepo.updateUnitStatus).toHaveBeenCalledWith(TENANT, makeUnit().id, 'PARADO', null, expect.anything());
  });

  it('toggle to the SAME status → 409 INV_ALREADY_IN_STATE', async () => {
    const { service } = build();
    await expect(service.updateUnitProduct(CTX, makeUnit().id, { status: 'PARADO' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'INV_ALREADY_IN_STATE',
    });
  });

  it('a moved unit cannot be toggled → 409', async () => {
    const { service } = build({
      field: { getUnitProductForUpdate: jest.fn(async () => makeUnit({ movedTo: 'PERDIDO' })) },
    });
    await expect(service.updateUnitProduct(CTX, makeUnit().id, { status: 'INSTALADO' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
