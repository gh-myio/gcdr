import {
  FileAsset,
  FileAssetOwnerType,
  FileAssetScanStatus,
  FileAssetStatus,
  FileAssetStorageProvider,
} from '../../domain/entities/FileAsset';
import { PaginatedResult } from '../../shared/types';
import { ListFileAssetsParams } from '../../dto/request/FileAssetDTO';

export interface CreateFileAssetInput {
  /** Pre-generated UUID — needed to compute the storage key before insert. */
  id: string;
  tenantId: string;
  customerId?: string | null;

  ownerType: FileAssetOwnerType;
  ownerId: string | null;

  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;

  storageProvider: FileAssetStorageProvider;
  storageBucket: string;
  storageKey: string;

  status?: FileAssetStatus;
  scanStatus?: FileAssetScanStatus;

  uploadedBy: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateFileAssetInput {
  ownerType?: FileAssetOwnerType;
  ownerId?: string | null;
  status?: FileAssetStatus;
  scanStatus?: FileAssetScanStatus;
  metadata?: Record<string, unknown>;
}

export interface IFileAssetRepository {
  create(input: CreateFileAssetInput): Promise<FileAsset>;
  getById(tenantId: string, id: string): Promise<FileAsset | null>;
  getBySha256(tenantId: string, sha256: string): Promise<FileAsset | null>;
  list(tenantId: string, params?: ListFileAssetsParams): Promise<PaginatedResult<FileAsset>>;
  update(tenantId: string, id: string, patch: UpdateFileAssetInput): Promise<FileAsset>;
  softDelete(tenantId: string, id: string): Promise<void>;
}
