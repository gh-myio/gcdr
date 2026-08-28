// =============================================================================
// RFC-0061 M8 — External platform HTTP client (produto.myio.com.br).
//
// The 3-endpoint public contract (Appendix A, kept as-is):
//   GET   /api/public/products            → full product list
//   POST  /api/public/products            → create product (QR generation)
//   PATCH /api/public/products/:code      → update location/status/technician
// Auth: `x-api-key` header.
//
// v1 configuration is process-wide via env (single Myio tenant):
//   MYIO_PRODUCTS_API_BASE  (default: the Lovable project URL below)
//   MYIO_PRODUCTS_API_KEY   (no default — client is "not configured" without it)
//   MYIO_PRODUCTS_API_TIMEOUT_MS (default 15000)
//
// FOLLOW-UP (DEC-7): per-tenant configuration with the API key stored via the
// RFC-0056 `secretEnvelope` pattern (customer-config), resolved per tenant at
// worker start. The class already takes its config through the constructor so
// the per-tenant resolver only needs to build one instance per enabled tenant;
// the env-based `externalPlatformClientFromEnv()` then becomes the single
// default-tenant fallback.
//
// NEVER call the real platform from tests — inject `fetchImpl` (or mock the
// whole module) instead.
// =============================================================================

import { AppError } from '../../shared/errors/AppError';

export const DEFAULT_PRODUCTS_API_BASE =
  'https://project--efd53831-b793-40e3-a8ef-13627f3457db.lovable.app';
const DEFAULT_TIMEOUT_MS = 15_000;

/** External product locations (source contract — Appendix A). */
export const EXTERNAL_LOCATIONS = [
  'estoque',
  'expedicao',
  'transporte',
  'cliente',
  'tecnico',
  'perdido',
  'avariado',
] as const;
export type ExternalLocation = (typeof EXTERNAL_LOCATIONS)[number];

/** External product statuses (source contract). */
export const EXTERNAL_STATUSES = ['instalado', 'parado'] as const;
export type ExternalStatus = (typeof EXTERNAL_STATUSES)[number];

/** One product as reported by the platform (tolerant shape — `raw` keeps all). */
export interface ExternalProduct {
  code: string;
  productType: string | null;
  location: string | null;
  status: string | null;
  technician: string | null;
  clientName: string | null;
  /** Platform-side change timestamp when provided (updated_at / last_change_at). */
  changedAt: string | null;
  /** The untouched platform payload (mirrored into inv_external_states.payload). */
  raw: Record<string, unknown>;
}

export interface CreateExternalProductInput {
  product_type: string;
  location: ExternalLocation;
  status: ExternalStatus;
}

export interface PatchExternalProductInput {
  location?: string;
  status?: string;
  technician?: string | null;
  client_name?: string | null;
}

export interface ExternalPlatformClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** Test seam — never let a test reach the real platform. */
  fetchImpl?: typeof fetch;
}

/** 502 wrapper for any platform-side failure (HTTP error, timeout, bad JSON). */
export class ExternalPlatformError extends AppError {
  public readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super('INV_EXTERNAL_PLATFORM_ERROR', message, 502);
    this.details = details;
  }
}

/** 503 — the external client has no API key configured (env or tenant config). */
export function externalNotConfigured(): AppError {
  return new AppError(
    'INV_EXTERNAL_NOT_CONFIGURED',
    'Plataforma externa não configurada: defina MYIO_PRODUCTS_API_KEY (e opcionalmente MYIO_PRODUCTS_API_BASE)',
    503,
  );
}

// -----------------------------------------------------------------------------
// Tolerant payload normalization
// -----------------------------------------------------------------------------

function asStringOrNull(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

/** Normalize one raw platform record; null when it carries no usable code. */
export function normalizeExternalProduct(raw: unknown): ExternalProduct | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const code = asStringOrNull(r.code ?? r.codigo);
  if (!code) return null;
  return {
    code,
    productType: asStringOrNull(r.product_type ?? r.productType ?? r.tipo),
    location: asStringOrNull(r.location ?? r.localizacao)?.toLowerCase() ?? null,
    status: asStringOrNull(r.status)?.toLowerCase() ?? null,
    technician: asStringOrNull(r.technician ?? r.tecnico),
    clientName: asStringOrNull(r.client_name ?? r.clientName ?? r.cliente),
    changedAt: asStringOrNull(r.updated_at ?? r.last_change_at ?? r.updatedAt),
    raw: r,
  };
}

/** The list endpoint may answer a bare array or {data|products|items: [...]}. */
export function extractProductArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const key of ['data', 'products', 'items']) {
      if (Array.isArray(b[key])) return b[key] as unknown[];
    }
  }
  throw new ExternalPlatformError('Resposta inesperada da plataforma externa (lista de produtos)');
}

// -----------------------------------------------------------------------------
// Client
// -----------------------------------------------------------------------------

export class ExternalPlatformClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ExternalPlatformClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** GET /api/public/products — the full platform state (pull worker input). */
  async listProducts(): Promise<ExternalProduct[]> {
    const body = await this.request('GET', '/api/public/products');
    return extractProductArray(body)
      .map(normalizeExternalProduct)
      .filter((p): p is ExternalProduct => p !== null);
  }

  /** POST /api/public/products — QR generation (source parity: external-only). */
  async createProduct(input: CreateExternalProductInput): Promise<ExternalProduct> {
    const body = await this.request('POST', '/api/public/products', input);
    // Tolerate {data: {...}} envelopes on the create response too.
    const record =
      body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)
        ? (body as Record<string, unknown>).data
        : body;
    const product = normalizeExternalProduct(record);
    if (!product) {
      throw new ExternalPlatformError('Plataforma externa não retornou um code na criação do produto');
    }
    return product;
  }

  /** PATCH /api/public/products/:code — outbox drain target. */
  async patchProduct(code: string, patch: PatchExternalProductInput): Promise<void> {
    await this.request('PATCH', `/api/public/products/${encodeURIComponent(code)}`, patch);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'x-api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ExternalPlatformError(`Plataforma externa respondeu ${res.status} em ${method} ${path}`, {
          status: res.status,
          body: text.slice(0, 500),
        });
      }
      if (res.status === 204) return undefined;
      const text = await res.text();
      if (text.trim() === '') return undefined;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ExternalPlatformError(`Plataforma externa retornou JSON inválido em ${method} ${path}`);
      }
    } catch (err) {
      if (err instanceof ExternalPlatformError) throw err;
      if ((err as Error)?.name === 'AbortError') {
        throw new ExternalPlatformError(`Timeout (${this.timeoutMs}ms) em ${method} ${path}`);
      }
      throw new ExternalPlatformError(
        `Falha de rede em ${method} ${path}: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

// -----------------------------------------------------------------------------
// Env-based factory (v1 single-tenant; see DEC-7 follow-up in the header)
// -----------------------------------------------------------------------------

/** Whether the env carries enough config to talk to the platform. */
export function isExternalPlatformConfigured(): boolean {
  return !!(process.env.MYIO_PRODUCTS_API_KEY && process.env.MYIO_PRODUCTS_API_KEY.trim() !== '');
}

/** Build the client from env, or null when not configured (callers 503 / skip). */
export function externalPlatformClientFromEnv(): ExternalPlatformClient | null {
  if (!isExternalPlatformConfigured()) return null;
  return new ExternalPlatformClient({
    baseUrl: process.env.MYIO_PRODUCTS_API_BASE?.trim() || DEFAULT_PRODUCTS_API_BASE,
    apiKey: process.env.MYIO_PRODUCTS_API_KEY as string,
    timeoutMs: Number(process.env.MYIO_PRODUCTS_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  });
}
