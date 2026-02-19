export interface AlarmBundleVersion {
  id: string;
  tenantId: string;
  customerId: string;
  version: string;
  previousVersion?: string;
  bundleType: string;
  reason: string;
  entityType: string;
  entityId?: string;
  rulesCount: number;
  devicesCount: number;
  createdAt: string;
  createdBy?: string;
}
