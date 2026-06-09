// RFC-0032 — Visita Técnica: site survey for environmental audits.
//
// Distinct from installations — these are walkthroughs (room counts, AC
// inventory, product census) not tied to a specific device.

export type VisitaStatus = 'pending' | 'in_progress' | 'done';

export interface Visita {
  id: string;
  tenantId: string;
  /** Customer this visita relates to. Nullable: a visita can pre-exist
   *  the customer assignment (e.g. surveying a prospective site). */
  customerId: string | null;
  name: string;
  observation: string | null;
  status: VisitaStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
