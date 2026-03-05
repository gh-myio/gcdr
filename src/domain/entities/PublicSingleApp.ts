export type PublicSingleAppStatus = 'ACTIVE' | 'INACTIVE' | 'DRAFT' | 'ARCHIVED';

export interface PublicSingleApp {
  id: string;
  slug: string;
  name: string;
  description?: string;
  fieldsSchema: Record<string, unknown>;
  status: PublicSingleAppStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  version: number;
}
