// RFC-0032 — Inventoried product within a Visita ambiente.

export interface VisitaProduct {
  id: string;
  tenantId: string;
  ambienteId: string;
  productType: string;
  description: string | null;
  quantity: number;
  createdBy: string;
  createdAt: string;
}
