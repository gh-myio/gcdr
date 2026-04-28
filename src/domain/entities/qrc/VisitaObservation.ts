// RFC-0032 — Free-text observation at the Visita level (not ambiente-specific).

export interface VisitaObservation {
  id: string;
  tenantId: string;
  visitaId: string;
  observation: string;
  /** Optional FK to file_assets.id (with owner_type='qrc_visita_observation'). */
  fileAssetId: string | null;
  createdBy: string;
  createdAt: string;
}
