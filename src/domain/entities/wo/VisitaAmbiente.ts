// RFC-0032 — Room / area within a Visita Técnica.

export interface VisitaAmbiente {
  id: string;
  tenantId: string;
  visitaId: string;
  name: string;
  observation: string | null;
  /** AC unit count if applicable. */
  acQuantity: number | null;
  /** Generic product count (free-form complement to the products table). */
  productQuantity: number | null;
  /** Free-text product type label. */
  productType: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
