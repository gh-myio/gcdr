// RFC-0032 — Free-text customer-level observation (with optional photo).
//
// Distinct from installation observations — this is "general notes about
// the site" rather than "notes about a specific installed device".

export interface CustomerObservation {
  id: string;
  tenantId: string;
  customerId: string;
  observation: string;
  /** Optional FK to file_assets.id (with owner_type='qrc_customer_observation'). */
  fileAssetId: string | null;
  createdBy: string;
  createdAt: string;
}
