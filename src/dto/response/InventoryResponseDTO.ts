// =============================================================================
// RFC-0061 — Inventory response DTOs (read models). The success envelope
// (`{ success, data, meta }`) is added by sendSuccess; these types describe the
// `data` payloads the frontend builds against.
// =============================================================================

import type {
  InvItemDomain,
  InvPurchaseType,
  InvStockLocation,
  InvPurchaseOrderStatus,
  InvExpeditionStatus,
} from '../../domain/entities/Inventory';

/** Generic paginated list payload (total / totalPages per convention). */
export interface InvPaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface InvItemResponse {
  id: string;
  name: string;
  domain: InvItemDomain;
  link: string | null;
  description: string | null;
  isManufactured: boolean;
  lossPercent: number;
  lotQuantity: number | null;
  purchaseType: InvPurchaseType | null;
  photoFileId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvStockBalanceResponse {
  itemId: string;
  itemName: string;
  domain: InvItemDomain;
  location: InvStockLocation;
  balance: number;
  totalIn: number;
  totalOut: number;
  lastMovementAt: string | null;
}

export interface InvStockConsistencyRow {
  itemId: string;
  location: InvStockLocation;
  ledgerBalance: number;
  activeQrCount: number;
  drift: number;
}

export interface InvPurchaseOrderResponse {
  id: string;
  projectId: string;
  itemId: string;
  itemNameSnapshot: string | null;
  quantity: number;
  status: InvPurchaseOrderStatus;
  deadlineType: string | null;
  deadlineDate: string | null;
  deliveryForecast: string | null;
  requesterNotes: string | null;
  buyerNotes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Transitions the calling role may perform from the current status (S3). */
  allowedTransitions: InvPurchaseOrderStatus[];
}

export interface InvExpeditionOrderResponse {
  id: string;
  title: string | null;
  projectId: string | null;
  customerId: string | null;
  deliveryDate: string;
  status: InvExpeditionStatus;
  isReplacement: boolean;
  allowedTransitions: InvExpeditionStatus[];
  createdAt: string;
  updatedAt: string;
}

export interface InvProjectResponse {
  id: string;
  name: string;
  description: string | null;
  customerId: string | null;
  legacyClientName: string | null;
  legacyClientCnpj: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-code verdict for POST /qr/validate (S2). */
export interface InvQrValidateVerdict {
  code: string;
  ok: boolean;
  reason?: string; // one of the Appendix D QR codes when !ok
}
export interface InvQrValidateResponse {
  results: InvQrValidateVerdict[];
}

/** GET /qr/trace/:code (S5) — current-state header + normalized timeline. */
export interface InvQrTraceEvent {
  ts: string;
  type: string;
  actor: string | null;
  location: string | null;
  refs: Record<string, unknown>;
}
export interface InvQrTraceResponse {
  code: string;
  current: {
    location: string | null;
    status: string | null;
    client: string | null;
  };
  isBox: boolean;
  units?: string[]; // populated when the code is a box QR
  timeline: InvQrTraceEvent[];
}

/** Static contract metadata (enums + state machines + error codes). */
export interface InvMetaResponse {
  itemDomains: string[];
  stockLocations: string[];
  movementTypes: string[];
  purchaseTypes: string[];
  boxSizes: number[];
  shippingMethods: string[];
  purchaseOrderTransitions: Record<string, string[]>;
  expeditionOrderTransitions: Record<string, string[]>;
  errorCodes: string[];
}
