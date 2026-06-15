// RFC-0044 Phase 4 — read-only Freshdesk API client (pagination + 429 backoff).
import {
  FreshdeskTicket,
  FreshdeskConversation,
  FreshdeskCompany,
  FreshdeskAgent,
  FreshdeskContact,
} from './types';

export interface FreshdeskConfig {
  domain: string; // e.g. empresa.freshdesk.com
  apiKey: string;
}

export class FreshdeskClient {
  private readonly base: string;
  private readonly auth: string;

  constructor(cfg: FreshdeskConfig) {
    if (!cfg.domain || !cfg.apiKey) throw new Error('FreshdeskClient requires domain and apiKey');
    const host = cfg.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.base = `https://${host}/api/v2`;
    // Freshdesk uses Basic auth with the API key as username, any password.
    this.auth = 'Basic ' + Buffer.from(`${cfg.apiKey}:X`).toString('base64');
  }

  private async get<T>(path: string): Promise<{ data: T; linkNext: string | null }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`${this.base}${path}`, {
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
      });
      if (res.status === 429) {
        const retry = Number(res.headers.get('Retry-After') ?? '2');
        await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`Freshdesk GET ${path} -> ${res.status} ${await res.text()}`);
      const link = res.headers.get('link');
      const linkNext = link && /rel="next"/.test(link) ? (link.match(/<([^>]+)>/)?.[1] ?? null) : null;
      return { data: (await res.json()) as T, linkNext };
    }
    throw new Error(`Freshdesk GET ${path} exhausted retries (rate limited)`);
  }

  /** Iterate all tickets (optionally updated since an ISO timestamp). */
  async *listTickets(opts: { since?: string; perPage?: number } = {}): AsyncGenerator<FreshdeskTicket> {
    const per = opts.perPage ?? 100;
    const since = opts.since ? `&updated_since=${encodeURIComponent(opts.since)}` : '';
    let page = 1;
    for (;;) {
      const { data, linkNext } = await this.get<FreshdeskTicket[]>(
        `/tickets?per_page=${per}&page=${page}&include=requester&order_by=updated_at&order_type=asc${since}`,
      );
      for (const t of data) yield t;
      if (!linkNext || data.length === 0) break;
      page += 1;
    }
  }

  async getConversations(ticketId: number): Promise<FreshdeskConversation[]> {
    const { data } = await this.get<FreshdeskConversation[]>(`/tickets/${ticketId}/conversations?per_page=100`);
    return data;
  }

  async getCompany(id: number): Promise<FreshdeskCompany | null> {
    try {
      return (await this.get<FreshdeskCompany>(`/companies/${id}`)).data;
    } catch {
      return null;
    }
  }

  async getAgent(id: number): Promise<FreshdeskAgent | null> {
    try {
      return (await this.get<FreshdeskAgent>(`/agents/${id}`)).data;
    } catch {
      return null;
    }
  }

  async getContact(id: number): Promise<FreshdeskContact | null> {
    try {
      return (await this.get<FreshdeskContact>(`/contacts/${id}`)).data;
    } catch {
      return null;
    }
  }

  /** Download an attachment (signed URL) as bytes. */
  async downloadAttachment(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`attachment download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
