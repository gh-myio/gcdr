import { Router, Request, Response, NextFunction } from 'express';
import { ruleService } from '../services/RuleService';
import { alarmBundleService } from '../services/AlarmBundleService';
import {
  CreateRuleSchema,
  UpdateRuleSchema,
  ToggleRuleSchema,
  EvaluateRuleSchema,
  ListRulesParamsSchema
} from '../dto/request/RuleDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

/**
 * POST /rules
 * Create a new rule
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateRuleSchema.parse(req.body);
    const rule = await ruleService.create(tenantId, data, userId);
    sendCreated(res, rule, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /rules
 * List rules
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;

    const params = ListRulesParamsSchema.parse(req.query);
    const result = await ruleService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /rules/statistics
 * Get rules statistics
 */
router.get('/statistics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const statistics = await ruleService.getStatistics(tenantId);
    sendSuccess(res, statistics, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /rules/maintenance-windows
 * Get active maintenance windows
 */
router.get('/maintenance-windows', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const maintenanceWindows = await ruleService.getActiveMaintenanceWindows(tenantId);

    sendSuccess(res, {
      items: maintenanceWindows.map((rule) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        startTime: rule.maintenanceConfig?.startTime,
        endTime: rule.maintenanceConfig?.endTime,
        recurrence: rule.maintenanceConfig?.recurrence,
        suppressAlarms: rule.maintenanceConfig?.suppressAlarms,
        suppressNotifications: rule.maintenanceConfig?.suppressNotifications,
        affectedRules: rule.maintenanceConfig?.affectedRules || [],
      })),
      count: maintenanceWindows.length,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /rules/evaluate
 * Evaluate a rule with sample data
 */
router.post('/evaluate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = EvaluateRuleSchema.parse(req.body);
    const result = await ruleService.evaluate(tenantId, data.ruleId, data.sampleData);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /rules/:id
 * Get rule by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Rule ID is required');
    }

    const rule = await ruleService.getById(tenantId, id);
    sendSuccess(res, rule, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /rules/:id
 * Update rule
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Rule ID is required');
    }

    const data = UpdateRuleSchema.parse(req.body);
    const rule = await ruleService.update(tenantId, id, data, userId);
    sendSuccess(res, rule, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /rules/:id
 * Delete rule
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Rule ID is required');
    }

    await ruleService.delete(tenantId, id, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /rules/:id/toggle
 * Toggle rule enabled/disabled
 */
router.post('/:id/toggle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Rule ID is required');
    }

    const data = ToggleRuleSchema.parse(req.body);
    const rule = await ruleService.toggle(tenantId, id, data.enabled, userId, data.reason);
    sendSuccess(res, rule, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:customerId/rules
 * List rules by customer (mounted in app.ts)
 */
export const listByCustomerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const rules = await ruleService.getByCustomerId(tenantId, customerId);
    sendSuccess(res, { items: rules, count: rules.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /customers/:customerId/alarm-rules/bundle
 * Get alarm bundle for customer (mounted in app.ts)
 */
export const getAlarmBundleHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    const { domain, deviceType, includeDisabled } = req.query;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    // Check for conditional request (If-None-Match header)
    const ifNoneMatch = req.headers['if-none-match'];

    const bundle = await alarmBundleService.generateBundle({
      tenantId,
      customerId,
      domain: domain as string | undefined,
      deviceType: deviceType as string | undefined,
      includeDisabled: includeDisabled === 'true',
    });

    const etag = `"${bundle.meta.version}"`;

    // Return 304 Not Modified if ETag matches
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.set({
        'ETag': etag,
        'Cache-Control': `private, max-age=${bundle.meta.ttlSeconds}`,
      });
      res.status(304).send();
      return;
    }

    // Return full bundle with caching headers
    res.set({
      'ETag': etag,
      'Cache-Control': `private, max-age=${bundle.meta.ttlSeconds}`,
      'X-Bundle-Version': bundle.meta.version,
      'X-Bundle-Signature': bundle.meta.signature,
    });

    sendSuccess(res, bundle, 200, requestId);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /customers/:customerId/alarm-rules/bundle/simple
 * Get simplified alarm bundle for customer (mounted in app.ts)
 * - No meta in body (metadata via HTTP headers)
 * - No rulesByDeviceType
 * - Minimal device fields (deviceName, centralId, slaveId, ruleIds)
 * - Minimal rule fields (id, name, value, duration, hysteresis, aggregation)
 */
export const getSimplifiedAlarmBundleHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    const { domain, deviceType, includeDisabled } = req.query;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    // Check for conditional request (If-None-Match header)
    const ifNoneMatch = req.headers['if-none-match'];

    const bundle = await alarmBundleService.generateSimplifiedBundle({
      tenantId,
      customerId,
      domain: domain as string | undefined,
      deviceType: deviceType as string | undefined,
      includeDisabled: includeDisabled === 'true',
    });

    const etag = `"${bundle.meta.version}"`;

    // Return 304 Not Modified if ETag matches
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.set({
        'ETag': etag,
        'Cache-Control': `private, max-age=${bundle.meta.ttlSeconds}`,
      });
      res.status(304).send();
      return;
    }

    // Set caching headers (metadata goes here instead of body)
    res.set({
      'ETag': etag,
      'Cache-Control': `private, max-age=${bundle.meta.ttlSeconds}`,
      'X-Bundle-Version': bundle.meta.version,
      'X-Bundle-Signature': bundle.meta.signature,
      'X-Bundle-Rules-Count': String(bundle.meta.rulesCount),
      'X-Bundle-Devices-Count': String(bundle.meta.devicesCount),
    });

    // Return simplified payload with versionId, deviceIndex, and rules
    const simplifiedPayload = {
      versionId: bundle.meta.version,
      deviceIndex: bundle.deviceIndex,
      rules: bundle.rules,
    };

    sendSuccess(res, simplifiedPayload, 200, requestId);
  } catch (err) {
    next(err);
  }
};

export default router;
