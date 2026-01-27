import { Router, Request, Response, NextFunction } from 'express';
import { customerService } from '../services/CustomerService';
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  MoveCustomerSchema,
  ListCustomersParams
} from '../dto/request/CustomerDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { CustomerType, EventType } from '../shared/types';

const router = Router();

/**
 * POST /customers
 * Create a new customer
 */
router.post('/',
  logEvent({
    eventType: EventType.CUSTOMER_CREATED,
    description: (req) => `Customer "${req.body.name}" created`,
    getEntityId: (_req, res) => res.locals.data?.id,
    getCustomerId: (_req, res) => res.locals.data?.id,
    getNewValue: (_req, res) => res.locals.data,
    getMetadata: (req) => ({ type: req.body.type, parentCustomerId: req.body.parentCustomerId }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const data = CreateCustomerSchema.parse(req.body);
      const customer = await customerService.create(tenantId, data, userId);
      res.locals.data = customer;
      sendCreated(res, customer, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /customers
 * List customers
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { limit, cursor, type, status, parentCustomerId } = req.query;

    const params: ListCustomersParams = {
      limit: limit ? parseInt(limit as string, 10) : 20,
      cursor: cursor as string | undefined,
      type: type as CustomerType | undefined,
      status: status as 'ACTIVE' | 'INACTIVE' | undefined,
      parentCustomerId: parentCustomerId === 'null' ? null : (parentCustomerId as string | undefined),
    };

    const result = await customerService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:id
 * Get customer by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Customer ID is required');
    }

    const customer = await customerService.getById(tenantId, id);
    sendSuccess(res, customer, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /customers/:id
 * Update customer
 */
router.put('/:id',
  logEvent({
    eventType: EventType.CUSTOMER_UPDATED,
    description: (req) => `Customer ${req.params.id} updated`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req) => req.params.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
    getNewValue: (_req, res) => res.locals.data,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Customer ID is required');
      }

      // Get previous value for audit
      const previous = await customerService.getById(tenantId, id);
      res.locals.previousData = previous;

      const data = UpdateCustomerSchema.parse(req.body);
      const customer = await customerService.update(tenantId, id, data, userId);
      res.locals.data = customer;
      sendSuccess(res, customer, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /customers/:id
 * Delete customer
 */
router.delete('/:id',
  logEvent({
    eventType: EventType.CUSTOMER_DELETED,
    description: (req) => `Customer ${req.params.id} deleted`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req) => req.params.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Customer ID is required');
      }

      // Get previous value for audit
      const previous = await customerService.getById(tenantId, id);
      res.locals.previousData = previous;

      await customerService.delete(tenantId, id, userId);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /customers/:id/children
 * Get direct children of a customer
 */
router.get('/:id/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Customer ID is required');
    }

    const children = await customerService.getChildren(tenantId, id);
    sendSuccess(res, { items: children, count: children.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:id/descendants
 * Get all descendants of a customer
 */
router.get('/:id/descendants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;
    const { maxDepth } = req.query;

    if (!id) {
      throw new ValidationError('Customer ID is required');
    }

    const params = {
      maxDepth: maxDepth ? parseInt(maxDepth as string, 10) : undefined,
    };

    const descendants = await customerService.getDescendants(tenantId, id, params);
    sendSuccess(res, { items: descendants, count: descendants.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:id/tree
 * Get customer tree structure
 */
router.get('/:id/tree', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Customer ID is required');
    }

    const tree = await customerService.getTree(tenantId, id);
    sendSuccess(res, { tree }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /customers/:id/move
 * Move customer to new parent
 */
router.post('/:id/move',
  logEvent({
    eventType: EventType.CUSTOMER_MOVED,
    description: (req) => `Customer ${req.params.id} moved to parent ${req.body.newParentCustomerId || 'root'}`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req) => req.params.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
    getNewValue: (_req, res) => res.locals.data,
    getMetadata: (req) => ({ newParentCustomerId: req.body.newParentCustomerId }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Customer ID is required');
      }

      // Get previous value for audit
      const previous = await customerService.getById(tenantId, id);
      res.locals.previousData = previous;

      const data = MoveCustomerSchema.parse(req.body);
      const customer = await customerService.move(tenantId, id, data, userId);
      res.locals.data = customer;
      sendSuccess(res, customer, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
