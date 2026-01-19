import { Asset } from '../../domain/entities/Asset';

export interface AssetResponseDTO {
  id: string;
  tenantId: string;
  customerId: string;
  parentAssetId: string | null;
  path: string;
  depth: number;
  name: string;
  displayName: string;
  code: string;
  type: string;
  description?: string;
  location?: {
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
    floor?: string;
    room?: string;
    zone?: string;
  };
  specs?: {
    area?: number;
    capacity?: number;
    powerRating?: number;
    voltage?: number;
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    installationDate?: string;
    warrantyExpiration?: string;
  };
  tags: string[];
  metadata: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface AssetTreeNode extends AssetResponseDTO {
  children: AssetTreeNode[];
}

export function toAssetResponse(asset: Asset): AssetResponseDTO {
  return {
    id: asset.id,
    tenantId: asset.tenantId,
    customerId: asset.customerId,
    parentAssetId: asset.parentAssetId,
    path: asset.path,
    depth: asset.depth,
    name: asset.name,
    displayName: asset.displayName,
    code: asset.code,
    type: asset.type,
    description: asset.description,
    location: asset.location,
    specs: asset.specs,
    tags: asset.tags,
    metadata: asset.metadata,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    createdBy: asset.createdBy,
  };
}

export function toAssetTreeNode(asset: Asset, children: AssetTreeNode[] = []): AssetTreeNode {
  return {
    ...toAssetResponse(asset),
    children,
  };
}
