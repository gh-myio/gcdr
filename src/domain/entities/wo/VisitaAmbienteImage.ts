// RFC-0032 — Photo of a Visita ambiente.

export interface VisitaAmbienteImage {
  id: string;
  tenantId: string;
  ambienteId: string;
  /** FK to file_assets.id (with owner_type='wo_visita_ambiente'). */
  fileAssetId: string;
  imageOrder: number;
  caption: string | null;
  createdAt: string;
}
