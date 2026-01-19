import { APIGatewayProxyHandler } from 'aws-lambda';
import { ruleService } from '../../services/RuleService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);

    const maintenanceWindows = await ruleService.getActiveMaintenanceWindows(ctx.tenantId);

    return ok({
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
    });
  } catch (err) {
    return handleError(err);
  }
};
