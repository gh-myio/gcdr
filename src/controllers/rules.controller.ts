import { Router, Request, Response, NextFunction } from 'express';
import { ruleService } from '../services/RuleService';
import { alarmBundleService } from '../services/AlarmBundleService';
import { DeviceRepository } from '../repositories/DeviceRepository';
import { CentralRepository } from '../repositories/CentralRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import {
  CreateRuleSchema,
  UpdateRuleSchema,
  ToggleRuleSchema,
  EvaluateRuleSchema,
  ListRulesParamsSchema,
  SetDeviceOverrideSchema,
} from '../dto/request/RuleDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { EventType } from '../shared/types';

const router = Router();

/**
 * POST /rules
 * Create a new rule
 */
router.post('/',
  logEvent({
    eventType: EventType.RULE_CREATED,
    description: (req) => `Rule "${req.body.name}" created`,
    getEntityId: (req, res) => res.locals.responseBody?.data?.id,
    getCustomerId: (req) => req.body.customerId,
    getMetadata: (req) => ({ type: req.body.type, priority: req.body.priority }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const data = CreateRuleSchema.parse(req.body);
      const rule = await ruleService.create(tenantId, data, userId);
      sendCreated(res, rule, requestId);
    } catch (err) {
      next(err);
    }
  }
);

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
 * GET /rules/notification-categories
 * List alarm actions available as notification trigger points (RFC-0024).
 * Each action represents a lifecycle event in the alarm state machine.
 */
router.get('/notification-categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    sendSuccess(res, [
      {
        id: 'OPEN',
        label: 'Alarme Disparado',
        description: 'Notificação imediata quando um alarme é aberto.',
        icon: 'bell-alert',
        templateType: 'EMAIL_ALARM',
      },
      {
        id: 'ACK',
        label: 'Alarme Reconhecido',
        description: 'Notificação quando um operador reconhece o alarme.',
        icon: 'check-circle',
        templateType: 'EMAIL_ALARM',
      },
      {
        id: 'ESCALATE',
        label: 'Alarme Escalado',
        description: 'Notificação quando o alarme é escalado para nível superior.',
        icon: 'arrow-up-circle',
        templateType: 'EMAIL_ALARM',
      },
      {
        id: 'SNOOZE',
        label: 'Alarme Sonecado',
        description: 'Notificação quando o alarme é adiado temporariamente.',
        icon: 'clock',
        templateType: 'EMAIL_ALARM',
      },
      {
        id: 'CLOSE',
        label: 'Alarme Fechado',
        description: 'Notificação quando o alarme é encerrado.',
        icon: 'x-circle',
        templateType: 'EMAIL_ALARM',
      },
      {
        id: 'STATE_HISTORY',
        label: 'Histórico de Estado',
        description: 'Relatório periódico consolidado do histórico de estados do alarme.',
        icon: 'chart-bar',
        templateType: 'EMAIL_REPORT',
      },
    ], 200, requestId);
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
 * GET /rules/:id/devices
 * List devices associated to a rule via scope_entity_id or scope_entity_ids
 */
router.get('/:id/devices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    const rule = await ruleService.getById(tenantId, id);

    // Collect all device IDs from both scope fields
    const ids = new Set<string>();
    if (rule.scope.entityId) ids.add(rule.scope.entityId);
    if (rule.scope.entityIds) rule.scope.entityIds.forEach(eid => ids.add(eid));

    const deviceRepo = new DeviceRepository();
    const items = await deviceRepo.listByIds(tenantId, [...ids]);

    sendSuccess(res, { items, count: items.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    if (!UUID_REGEX.test(id)) {
      throw new ValidationError(`Invalid rule ID format: "${id}"`);
    }

    const rule = await ruleService.getById(tenantId, id);

    // Enrich with gatewayToken from customer config
    const customerRepo = new CustomerRepository();
    const customer = await customerRepo.getById(tenantId, rule.customerId);
    const gatewayToken = customer?.config?.gatewayToken;

    sendSuccess(res, { ...rule, ...(gatewayToken ? { gatewayToken } : {}) }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /rules/:id
 * Partial update rule (alias for PUT — accepts partial body)
 */
router.patch('/:id',
  logEvent({
    eventType: EventType.RULE_UPDATED,
    description: (req) => `Rule ${req.params.id} partially updated`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req, res) => res.locals.responseBody?.data?.customerId,
    getMetadata: (req) => ({ updatedFields: Object.keys(req.body) }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Rule ID is required');
      }

      if (!UUID_REGEX.test(id)) {
        throw new ValidationError(`Invalid rule ID format: "${id}"`);
      }

      const data = UpdateRuleSchema.parse(req.body);
      const rule = await ruleService.update(tenantId, id, data, userId);
      sendSuccess(res, rule, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /rules/:id
 * Update rule
 */
router.put('/:id',
  logEvent({
    eventType: EventType.RULE_UPDATED,
    description: (req) => `Rule ${req.params.id} updated`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req, res) => res.locals.responseBody?.data?.customerId,
    getMetadata: (req) => ({ updatedFields: Object.keys(req.body) }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Rule ID is required');
      }

      if (!UUID_REGEX.test(id)) {
        throw new ValidationError(`Invalid rule ID format: "${id}"`);
      }

      const data = UpdateRuleSchema.parse(req.body);
      const rule = await ruleService.update(tenantId, id, data, userId);
      sendSuccess(res, rule, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /rules/:id/overrides/:deviceId
 * Set (or replace) the value override for a specific device in a rule.
 * Other devices' overrides are preserved.
 * Body: { value?: number, valueHigh?: number }
 */
router.put('/:id/overrides/:deviceId',
  logEvent({
    eventType: EventType.RULE_UPDATED,
    description: (req) => `Rule ${req.params.id} override set for device ${req.params.deviceId}`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req, res) => res.locals.responseBody?.data?.customerId,
    getMetadata: (req) => ({ deviceId: req.params.deviceId, override: req.body }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id, deviceId } = req.params;

      const override = SetDeviceOverrideSchema.parse(req.body);
      const rule = await ruleService.setDeviceOverride(tenantId, id, deviceId, override, userId);
      sendSuccess(res, rule, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /rules/:id/overrides/:deviceId
 * Remove the value override for a specific device.
 * Other devices' overrides are preserved.
 */
router.delete('/:id/overrides/:deviceId',
  logEvent({
    eventType: EventType.RULE_UPDATED,
    description: (req) => `Rule ${req.params.id} override removed for device ${req.params.deviceId}`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req, res) => res.locals.responseBody?.data?.customerId,
    getMetadata: (req) => ({ deviceId: req.params.deviceId }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id, deviceId } = req.params;

      const rule = await ruleService.removeDeviceOverride(tenantId, id, deviceId, userId);
      sendSuccess(res, rule, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /rules/:id
 * Delete rule
 */
router.delete('/:id',
  logEvent({
    eventType: EventType.RULE_DELETED,
    description: (req) => `Rule ${req.params.id} deleted`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Rule ID is required');
      }

      if (!UUID_REGEX.test(id)) {
        throw new ValidationError(`Invalid rule ID format: "${id}"`);
      }

      await ruleService.delete(tenantId, id, userId);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /rules/:id/toggle
 * Toggle rule enabled/disabled
 */
router.post('/:id/toggle',
  logEvent({
    eventType: EventType.RULE_ENABLED,
    description: (req) => `Rule ${req.params.id} ${req.body.enabled ? 'enabled' : 'disabled'}`,
    getEntityId: (req) => req.params.id,
    getMetadata: (req) => ({ enabled: req.body.enabled, reason: req.body.reason }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
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
  }
);

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
 * DELETE /customers/:customerId/rules/devices
 * Remove all device associations from every DEVICE-scoped rule of a customer.
 * Affected rules: scope_type → GLOBAL, scope_entity_ids → [], enabled → false.
 * (mounted in app.ts)
 */
export const clearCustomerRuleDevicesHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { customerId } = req.params;

    const result = await ruleService.clearDevicesFromCustomerRules(tenantId, customerId, userId);
    sendSuccess(res, result, 200, requestId);
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

    const bundleParams = {
      tenantId,
      customerId,
      domain: domain as string | undefined,
      deviceType: deviceType as string | undefined,
      includeDisabled: includeDisabled === 'true',
    };

    // Quick ETag check (cache-only, no DB queries)
    if (ifNoneMatch) {
      const cachedVersion = alarmBundleService.getVersion(bundleParams, 'full');
      if (cachedVersion && ifNoneMatch === `"${cachedVersion}"`) {
        res.set({
          'ETag': `"${cachedVersion}"`,
          'Cache-Control': 'private, max-age=300',
        });
        res.status(304).send();
        return;
      }
    }

    const bundle = await alarmBundleService.generateBundle(bundleParams);

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

    // Optional X-Central-Id header to filter devices by central
    const centralId = req.headers['x-central-id'] as string | undefined;

    // Optional X-Version-Id header for cache validation (simpler than ETag for Node-RED)
    const clientVersionId = req.headers['x-version-id'] as string | undefined;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    // Validate X-Central-Id if provided
    if (centralId) {
      const centralRepo = new CentralRepository();
      const central = await centralRepo.getById(tenantId, centralId);

      if (!central) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'CENTRAL_NOT_FOUND',
            message: `Central '${centralId}' not found`,
          },
          meta: { requestId },
        });
      }

      if (central.customerId !== customerId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CENTRAL_CUSTOMER_MISMATCH',
            message: `Central '${centralId}' does not belong to customer '${customerId}'`,
          },
          meta: { requestId },
        });
      }
    }

    const bundleParams = {
      tenantId,
      customerId,
      centralId,
      domain: domain as string | undefined,
      deviceType: deviceType as string | undefined,
      includeDisabled: includeDisabled === 'true',
    };

    // Check for conditional request (If-None-Match header - standard HTTP)
    const ifNoneMatch = req.headers['if-none-match'];

    const bundle = await alarmBundleService.generateSimplifiedBundle(bundleParams);

    const etag = `"${bundle.meta.version}"`;
    const currentVersionId = bundle.meta.version;

    // RFC-0019: skip version checks if customer.config.bundle.checkVersion === false
    if (!bundle.meta.skipVersionCheck) {
      // Return 200 Not Modified if X-Version-Id matches current version
      if (clientVersionId && clientVersionId === currentVersionId) {
        res.set({
          'ETag': etag,
          'Cache-Control': `private, max-age=${bundle.meta.ttlSeconds}`,
          'X-Bundle-Version': currentVersionId,
        });
        res.status(200).json({ versionId: currentVersionId, message: 'Not Modified' });
        return;
      }

      // Return 200 Not Modified if ETag matches (standard HTTP caching)
      if (ifNoneMatch && ifNoneMatch === etag) {
        res.set({
          'ETag': etag,
          'Cache-Control': `private, max-age=${bundle.meta.ttlSeconds}`,
          'X-Bundle-Version': currentVersionId,
        });
        res.status(200).json({ versionId: currentVersionId, message: 'Not Modified' });
        return;
      }
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

/**
 * GET /customers/:customerId/alarm-rules/bundle/verify
 * Same as /bundle/simple but enriched with:
 *   - meta.gatewayToken  — customer gateway auth token
 *   - rules[id].notifications — per-category recipients + emailRelay config
 */
export const getAlarmBundleVerifyHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    const { domain, deviceType, includeDisabled } = req.query;
    const centralId = req.headers['x-central-id'] as string | undefined;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const bundle = await alarmBundleService.verifyBundle({
      tenantId,
      customerId,
      centralId,
      domain: domain as string | undefined,
      deviceType: deviceType as string | undefined,
      includeDisabled: includeDisabled === 'true',
    });

    sendSuccess(res, {
      versionId: bundle.meta.version,
      gatewayToken: bundle.meta.gatewayToken,
      deviceIndex: bundle.deviceIndex,
      rules: bundle.rules,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /customers/:customerId/alarm-rules/bundle/cache
 * Invalidate in-memory alarm bundle cache for a customer
 * Forces next GET /bundle or /bundle/simple to regenerate from DB
 */
export const invalidateAlarmBundleCacheHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { customerId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    alarmBundleService.invalidateCache(tenantId, customerId, {
      reason: 'manual_invalidation',
      entityType: 'customer',
      entityId: customerId,
      userId,
    });

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /customers/:customerId/alarm-rules/bundle/versions
 * Get alarm bundle version history
 */
export const getAlarmBundleVersionsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    const { customerId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const versions = await alarmBundleService.getVersionHistory(tenantId, customerId, limit);

    sendSuccess(res, versions);
  } catch (error) {
    next(error);
  }
};

export default router;
