// RFC-0045 — Email-to-Ticket ingestion config (env-driven).
// Read by both transports: the public webhook (Option A) and the IMAP poller
// (Option B). The mapping logic in EmailToTicketService is transport-agnostic;
// only this config and the transport differ.

export interface EmailIngestionConfig {
  /** Tenant that owns the support mailbox (MVP: single tenant via env). */
  tenantId: string;
  /** Where unknown sender domains land so nothing is dropped (triage). */
  defaultCustomerId: string;
  /** The "atendimento" service user — work_orders.created_by + event actor. */
  systemUserId: string;
  /** Recipient addresses routed to this tenant (lower-cased), informational/validation. */
  supportAddresses: string[];
  /** Pilot guard: if non-empty, only these sender domains are ingested. */
  domainAllowlist: string[];
  /** Webhook shared secret (Option A); null disables the webhook. */
  inboundSecret: string | null;
  /** Hard cap on the stored body to avoid huge timeline payloads. */
  maxBodyChars: number;
}

function csv(v?: string): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadEmailIngestionConfig(): EmailIngestionConfig {
  return {
    tenantId: process.env.SUPPORT_TENANT_ID ?? '',
    defaultCustomerId: process.env.SUPPORT_DEFAULT_CUSTOMER_ID ?? '',
    systemUserId: process.env.SUPPORT_SYSTEM_USER_ID ?? '',
    supportAddresses: csv(process.env.SUPPORT_ADDRESSES),
    domainAllowlist: csv(process.env.SUPPORT_DOMAIN_ALLOWLIST),
    inboundSecret: process.env.EMAIL_INBOUND_SECRET || null,
    maxBodyChars: Number(process.env.SUPPORT_MAX_BODY_CHARS ?? 20000),
  };
}

/** Throws a readable error if the minimum config to ingest is missing. */
export function assertEmailIngestionConfig(cfg: EmailIngestionConfig): void {
  const missing: string[] = [];
  if (!cfg.tenantId) missing.push('SUPPORT_TENANT_ID');
  if (!cfg.defaultCustomerId) missing.push('SUPPORT_DEFAULT_CUSTOMER_ID');
  if (!cfg.systemUserId) missing.push('SUPPORT_SYSTEM_USER_ID');
  if (missing.length) {
    throw new Error(`Email ingestion misconfigured — missing env: ${missing.join(', ')}`);
  }
}
