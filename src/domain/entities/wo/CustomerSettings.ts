// RFC-0032 — Opt-in extension marking a customer as QR-enabled.
//
// Presence of a row in `wo_customer_settings` for a given customerId
// means that customer is reachable from the QR Checker mobile app.
// Absent row → customer not part of the QR Checker flow (default).

export interface WoCustomerSettings {
  /** PK + FK to customers.id */
  customerId: string;
  tenantId: string;
  /** bcrypt hash of the read-only viewer password (per-customer). */
  viewerPasswordHash: string | null;
  /** Default central (gateway) for this customer's QR-tagged devices. */
  defaultCentralId: string | null;
  /** Free-form QR-Checker-specific settings. */
  woMetadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
