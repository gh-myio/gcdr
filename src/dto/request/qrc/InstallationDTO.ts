import { z } from 'zod';
import { ALL_INSTALLATION_STATUSES, ALL_TC_TYPES } from '../../../domain/entities/qrc/Installation';

// RFC-0032 — Installation create/update inputs.
//
// `POST /api/v1/qrc/install` accepts EITHER a deviceId OR an
// (addrLow, addrHigh) pair. The server resolves both forms to a single
// devices row before upserting the installation.

const installationCommon = {
  position:          z.string().min(1).max(500),
  tcType:            z.enum(ALL_TC_TYPES as unknown as [string, ...string[]]).nullable().optional(),
  obs:               z.string().max(2000).nullable().optional(),
  currentMultiplier: z.number().nullable().optional(),
  voltageMultiplier: z.number().nullable().optional(),
  status:            z.enum(ALL_INSTALLATION_STATUSES as unknown as [string, ...string[]]).optional(),
};

export const InstallByDeviceIdSchema = z.object({
  customerId: z.string().uuid(),
  deviceId:   z.string().uuid(),
  ...installationCommon,
});

export const InstallByAddressSchema = z.object({
  customerId: z.string().uuid(),
  addrLow:    z.number().int().min(0).max(255),
  addrHigh:   z.number().int().min(0).max(255),
  ...installationCommon,
});

export const InstallSchema = z.union([InstallByDeviceIdSchema, InstallByAddressSchema]);
export type InstallDTO = z.infer<typeof InstallSchema>;

export const UpdateInstallationSchema = z.object(installationCommon).partial();
export type UpdateInstallationDTO = z.infer<typeof UpdateInstallationSchema>;

// Image join row inputs
export const CreateInstallationImageSchema = z.object({
  fileAssetId: z.string().uuid(),
  imageOrder:  z.number().int().min(0).max(19).optional(),
  caption:     z.string().max(500).nullable().optional(),
});
export type CreateInstallationImageDTO = z.infer<typeof CreateInstallationImageSchema>;

export const UpdateInstallationImageSchema = z.object({
  imageOrder: z.number().int().min(0).max(19).optional(),
  caption:    z.string().max(500).nullable().optional(),
});
export type UpdateInstallationImageDTO = z.infer<typeof UpdateInstallationImageSchema>;
