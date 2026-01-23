import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authorizationService } from '../services/AuthorizationService';
import { CreatePolicySchema } from '../dto/request/AuthorizationDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

// Schema for updating policies
const UpdatePolicySchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  conditions: z
    .object({
      requiresMFA: z.boolean().optional(),
      onlyBusinessHours: z.boolean().optional(),
      allowedDeviceTypes: z.array(z.string()).optional(),
      ipAllowlist: z.array(z.string()).optional(),
      maxSessionDuration: z.number().optional(),
    })
    .optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

/**
 * POST /policies
 * Create a new policy
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreatePolicySchema.parse(req.body);
    const policy = await authorizationService.createPolicy(tenantId, data, userId);
    sendCreated(res, policy, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /policies
 * List policies
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { limit, cursor, riskLevel, isSystem } = req.query;

    const params = {
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
      riskLevel: riskLevel as string | undefined,
      isSystem: isSystem === 'true' ? true : isSystem === 'false' ? false : undefined,
    };

    const result = await authorizationService.listPolicies(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /policies/:policyId
 * Get policy by ID
 */
router.get('/:policyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { policyId } = req.params;

    if (!policyId) {
      throw new ValidationError('Policy ID is required');
    }

    const policy = await authorizationService.getPolicyById(tenantId, policyId);
    sendSuccess(res, policy, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /policies/key/:policyKey
 * Get policy by key
 */
router.get('/key/:policyKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { policyKey } = req.params;

    if (!policyKey) {
      throw new ValidationError('Policy key is required');
    }

    const policy = await authorizationService.getPolicyByKey(tenantId, policyKey);
    sendSuccess(res, policy, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /policies/:policyId
 * Update policy
 */
router.put('/:policyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { policyId } = req.params;

    if (!policyId) {
      throw new ValidationError('Policy ID is required');
    }

    const data = UpdatePolicySchema.parse(req.body);
    const policy = await authorizationService.updatePolicy(tenantId, policyId, data, userId);
    sendSuccess(res, policy, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /policies/:policyId
 * Delete policy
 */
router.delete('/:policyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { policyId } = req.params;

    if (!policyId) {
      throw new ValidationError('Policy ID is required');
    }

    await authorizationService.deletePolicy(tenantId, policyId, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

export default router;
