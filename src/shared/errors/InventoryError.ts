import { AppError } from './AppError';

// =============================================================================
// RFC-0061 — Inventory error contract (Appendix D, A3/S3).
//
// Machine-readable `code` + `params` — the frontend renders pt-BR from codes
// and never parses messages. `params` is surfaced by the global errorHandler
// as `error.details` (AppError branch), so callers get e.g. the current state
// and allowedTransitions on a 409, or itemId/location/balance on a stock guard.
//
// `ConflictError` (HTTP 409) already exists in AppError; these subclasses carry
// the specific inventory codes and their params on top of the base class.
// =============================================================================

export type InventoryErrorCode =
  | 'INV_ILLEGAL_TRANSITION'
  | 'INV_ALREADY_IN_STATE'
  | 'INV_INSUFFICIENT_STOCK'
  | 'INV_QR_ALREADY_USED'
  | 'INV_QR_DUPLICATE'
  | 'INV_QR_NOT_IN_REGISTRY'
  | 'INV_QR_WRONG_ITEM'
  | 'INV_BOX_FULL'
  | 'INV_BOX_EMPTY'
  | 'INV_BOX_TOO_BIG'
  | 'INV_EDIT_LOCKED_STATE'
  | 'INV_CONFIRMATION_REQUIRED'
  | 'INV_IDEMPOTENCY_KEY_MISSING'
  | 'INV_NOT_IMPLEMENTED';

/** An inventory error carrying a machine-readable code and structured params. */
export class InventoryError extends AppError {
  public readonly details?: Record<string, unknown>;

  constructor(
    code: InventoryErrorCode,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, statusCode);
    this.details = details;
  }
}

// --- Appendix D factories -----------------------------------------------------

export function illegalTransition(current: string, allowedTransitions: string[]): InventoryError {
  return new InventoryError(
    'INV_ILLEGAL_TRANSITION',
    'Transição de status não permitida para o estado atual',
    409,
    { current, allowedTransitions },
  );
}

export function alreadyInState(current: string): InventoryError {
  return new InventoryError('INV_ALREADY_IN_STATE', 'O registro já está neste status', 409, { current });
}

export function insufficientStock(
  itemId: string,
  location: string,
  balance: number | string,
  requested: number | string,
): InventoryError {
  return new InventoryError(
    'INV_INSUFFICIENT_STOCK',
    'Estoque insuficiente',
    409,
    { itemId, location, balance, requested },
  );
}

export function qrAlreadyUsed(qrValue: string): InventoryError {
  return new InventoryError('INV_QR_ALREADY_USED', 'QR já utilizado em uma saída', 409, { qrValue });
}

export function qrDuplicate(qrValue: string): InventoryError {
  return new InventoryError('INV_QR_DUPLICATE', 'QR já registrado (unidade ou caixa)', 409, { qrValue });
}

export function qrNotInRegistry(qrValue: string): InventoryError {
  return new InventoryError('INV_QR_NOT_IN_REGISTRY', 'QR não homologado', 422, { qrValue });
}

export function qrWrongItem(qrValue: string, expectedItemId: string): InventoryError {
  return new InventoryError('INV_QR_WRONG_ITEM', 'QR pertence a outro item', 422, { qrValue, expectedItemId });
}

export function editLockedState(current: string): InventoryError {
  return new InventoryError('INV_EDIT_LOCKED_STATE', 'Edição permitida apenas em PENDENTE', 409, { current });
}

export function confirmationRequired(): InventoryError {
  return new InventoryError('INV_CONFIRMATION_REQUIRED', 'Operação destrutiva requer confirmationToken', 428);
}

export function idempotencyKeyMissing(): InventoryError {
  return new InventoryError('INV_IDEMPOTENCY_KEY_MISSING', 'Header Idempotency-Key é obrigatório', 400);
}

/**
 * 501 marker for modules whose business logic ships in a later phase. The
 * contract (route, auth, DTO validation) is real; only the service is deferred.
 */
export function notImplemented(module: string, phase: string): InventoryError {
  return new InventoryError(
    'INV_NOT_IMPLEMENTED',
    `Módulo ${module} será entregue na fase ${phase} (RFC-0061)`,
    501,
    { module, phase },
  );
}
