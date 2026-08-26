import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../middleware';
import {
  INV_ITEM_DOMAINS,
  INV_STOCK_LOCATIONS,
  INV_MOVEMENT_TYPES,
  INV_PURCHASE_TYPES,
  INV_BOX_SIZES,
  INV_SHIPPING_METHODS,
  PURCHASE_ORDER_TRANSITIONS,
  EXPEDITION_ORDER_TRANSITIONS,
} from '../../domain/entities/Inventory';
import type { InvMetaResponse } from '../../dto/response/InventoryResponseDTO';

// Contract metadata (concrete) — enums + state machines + error codes.
const router = Router();

router.get('/meta', (req: Request, res: Response, next: NextFunction) => {
  try {
    const data: InvMetaResponse = {
      itemDomains: [...INV_ITEM_DOMAINS],
      stockLocations: [...INV_STOCK_LOCATIONS],
      movementTypes: [...INV_MOVEMENT_TYPES],
      purchaseTypes: [...INV_PURCHASE_TYPES],
      boxSizes: [...INV_BOX_SIZES],
      shippingMethods: [...INV_SHIPPING_METHODS],
      purchaseOrderTransitions: PURCHASE_ORDER_TRANSITIONS,
      expeditionOrderTransitions: EXPEDITION_ORDER_TRANSITIONS,
      errorCodes: [
        'INV_ILLEGAL_TRANSITION', 'INV_ALREADY_IN_STATE', 'INV_INSUFFICIENT_STOCK',
        'INV_QR_ALREADY_USED', 'INV_QR_DUPLICATE', 'INV_QR_NOT_IN_REGISTRY',
        'INV_QR_WRONG_ITEM', 'INV_BOX_FULL', 'INV_BOX_EMPTY', 'INV_BOX_TOO_BIG',
        'INV_EDIT_LOCKED_STATE', 'INV_CONFIRMATION_REQUIRED',
        'INV_IDEMPOTENCY_KEY_MISSING', 'INV_NOT_IMPLEMENTED',
      ],
    };
    sendSuccess(res, data, 200, req.context?.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
