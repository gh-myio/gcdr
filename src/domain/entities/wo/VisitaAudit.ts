// RFC-0032 — Visita audit log (revision-scoped, immutable).

export interface VisitaAudit {
  id: string;
  tenantId: string;
  visitaId: string;
  /** Optional — narrows the change to a specific ambiente within the visita. */
  ambienteId: string | null;
  revision: number;
  changeType: string;
  changeDescription: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  changedBy: string;
  changedAt: string;
}
