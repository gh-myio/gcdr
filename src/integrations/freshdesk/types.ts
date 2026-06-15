// RFC-0044 Phase 4 — minimal Freshdesk API shapes (the fields the importer uses).

export interface FreshdeskTicket {
  id: number;
  subject: string;
  type: string | null;
  status: number; // 2 Open, 3 Pending, 4 Resolved, 5 Closed, 6+ custom
  priority: number; // 1 Low .. 4 Urgent
  requester_id: number;
  responder_id: number | null;
  company_id: number | null;
  cc_emails: string[] | null;
  description_text?: string | null;
  description?: string | null;
  custom_fields?: Record<string, unknown>;
  tags?: string[];
  created_at: string;
  updated_at: string;
  // present when include=requester is requested
  requester?: { id: number; name: string; email: string } | null;
}

export interface FreshdeskConversation {
  id: number;
  body_text?: string | null;
  body?: string | null;
  incoming: boolean;
  private: boolean; // true = internal note
  user_id: number | null;
  from_email?: string | null;
  created_at: string;
  attachments?: FreshdeskAttachment[];
}

export interface FreshdeskAttachment {
  id: number;
  name: string;
  content_type: string;
  size: number;
  attachment_url: string;
}

export interface FreshdeskCompany {
  id: number;
  name: string;
  // custom/lookup fields may hold a GCDR customer external id
  custom_fields?: Record<string, unknown>;
}

export interface FreshdeskAgent {
  id: number;
  contact?: { email?: string; name?: string };
}

export interface FreshdeskContact {
  id: number;
  name: string;
  email: string | null;
}
