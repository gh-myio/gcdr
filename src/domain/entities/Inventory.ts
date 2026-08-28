// =============================================================================
// RFC-0061 — Inventory & Warehouse Management ("Menu de Estoque")
// Domain types, enums and the server-side state machines (DEC-4/DEC-6, S3).
//
// These are the shared shapes the DTOs, controllers, services and the paired
// frontend build against. Enums are string-literal unions matching the
// `text + CHECK` columns in schema.ts / migration 0067.
// =============================================================================

/** Item catalog domain (DEC-1). Only PRODUCT may be manufactured (W4). */
export type InvItemDomain = 'COMPONENT' | 'PRODUCT' | 'THIRD_PARTY' | 'TOOL';
export const INV_ITEM_DOMAINS: readonly InvItemDomain[] = ['COMPONENT', 'PRODUCT', 'THIRD_PARTY', 'TOOL'];

export type InvPurchaseType = 'NACIONAL' | 'IMPORTACAO';
export const INV_PURCHASE_TYPES: readonly InvPurchaseType[] = ['NACIONAL', 'IMPORTACAO'];

/** Stock locations (DEC-3) — a column of the movement, not of the item. */
export type InvStockLocation = 'FABRICA' | 'ALMOXARIFADO' | 'ALMOXARIFADO_GERAL';
export const INV_STOCK_LOCATIONS: readonly InvStockLocation[] = ['FABRICA', 'ALMOXARIFADO', 'ALMOXARIFADO_GERAL'];

/** Ledger movement types. TRANSFERENCIA legs share a transfer_group_id. */
export type InvMovementType = 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'TRANSFERENCIA_IN' | 'TRANSFERENCIA_OUT';
export const INV_MOVEMENT_TYPES: readonly InvMovementType[] = ['ENTRADA', 'SAIDA', 'AJUSTE', 'TRANSFERENCIA_IN', 'TRANSFERENCIA_OUT'];

/** QR identity kind (inv_qr_registry). */
export type InvQrKind = 'UNIT' | 'BOX';

/** Purchase-order status (M3 state machine). */
export type InvPurchaseOrderStatus =
  | 'PENDENTE'
  | 'COMPRADO_AGUARDANDO'
  | 'ENTREGUE'
  | 'RECEBIDO_OK'
  | 'RECEBIDO_PROBLEMA'
  | 'CANCELADO';

export type InvDeadlineType = 'URGENTE' | 'ESTA_SEMANA' | 'ESTE_MES' | 'CUSTOMIZADO';

/** Expedition-order status (M6 state machine). */
export type InvExpeditionStatus =
  | 'PENDENTE'
  | 'PRODUZINDO'
  | 'PRONTO_ENTREGA'
  | 'EM_TRANSITO'
  | 'ENTREGUE_CLIENTE'
  | 'PERDIDO';

export type InvBoxSize = 1 | 10 | 50 | 100 | 224;
export const INV_BOX_SIZES: readonly InvBoxSize[] = [1, 10, 50, 100, 224];

export type InvShippingMethod = 'AZUL_CARGO' | 'CORREIOS' | 'CARRO_MYIO' | 'UBER';
export const INV_SHIPPING_METHODS: readonly InvShippingMethod[] = ['AZUL_CARGO', 'CORREIOS', 'CARRO_MYIO', 'UBER'];

export type InvTechnicianDestination = 'UNIDADE' | 'PERDIDO' | 'ALMOXARIFADO' | 'AVARIADO';
export type InvUnitMovedTo = 'TECNICO' | 'ALMOXARIFADO' | 'PERDIDO' | 'AVARIADO';
export type InvUnitStatus = 'PARADO' | 'INSTALADO';

// -----------------------------------------------------------------------------
// State machines (DEC-4). The server is the authority; reads expose
// `allowedTransitions` so the frontend never re-implements these (S3).
// -----------------------------------------------------------------------------

/** M3 purchase-order transition map (role-gating layered in the service). */
export const PURCHASE_ORDER_TRANSITIONS: Record<InvPurchaseOrderStatus, InvPurchaseOrderStatus[]> = {
  PENDENTE:            ['COMPRADO_AGUARDANDO', 'CANCELADO'],
  COMPRADO_AGUARDANDO: ['ENTREGUE', 'CANCELADO'],
  ENTREGUE:            ['RECEBIDO_OK', 'RECEBIDO_PROBLEMA'],
  RECEBIDO_OK:         [],
  RECEBIDO_PROBLEMA:   [],
  CANCELADO:           [],
};

/** M6 expedition-order transition map (PERDIDO ↔ found returns to a chosen sector). */
export const EXPEDITION_ORDER_TRANSITIONS: Record<InvExpeditionStatus, InvExpeditionStatus[]> = {
  PENDENTE:         ['PRODUZINDO'],
  PRODUZINDO:       ['PRONTO_ENTREGA'],
  PRONTO_ENTREGA:   ['EM_TRANSITO'],
  EM_TRANSITO:      ['ENTREGUE_CLIENTE', 'PERDIDO'],
  ENTREGUE_CLIENTE: [],
  PERDIDO:          ['PRODUZINDO', 'PRONTO_ENTREGA', 'EM_TRANSITO'],
};

// -----------------------------------------------------------------------------
// Core entity interfaces (subset used by P0/P1; extended per phase).
// -----------------------------------------------------------------------------

export interface InvItem {
  id: string;
  tenantId: string;
  name: string;
  normalizedName: string;
  domain: InvItemDomain;
  link: string | null;
  description: string | null;
  isManufactured: boolean;
  lossPercent: string;      // numeric — string per Drizzle numeric mapping
  lotQuantity: number | null;
  purchaseType: InvPurchaseType | null;
  photoFileId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvStockBalance {
  itemId: string;
  location: InvStockLocation;
  balance: string;
  totalIn: string;
  totalOut: string;
  lastMovementAt: string | null;
}

export interface InvProject {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  customerId: string | null;
  legacyClientName: string | null;
  legacyClientCnpj: string | null;
  createdAt: string;
  updatedAt: string;
}
