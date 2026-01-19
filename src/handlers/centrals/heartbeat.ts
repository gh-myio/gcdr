import { APIGatewayProxyHandler } from 'aws-lambda';
import { z } from 'zod';
import { centralService } from '../../services/CentralService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

const HeartbeatSchema = z.object({
  connectedDevices: z.number().min(0).optional(),
  activeRules: z.number().min(0).optional(),
  pendingSyncEvents: z.number().min(0).optional(),
  uptimeSeconds: z.number().min(0).optional(),
  cpuUsage: z.number().min(0).max(100).optional(),
  memoryUsage: z.number().min(0).max(100).optional(),
  diskUsage: z.number().min(0).max(100).optional(),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const centralId = event.pathParameters?.id;

    if (!centralId) {
      return handleError(new Error('Central ID is required'));
    }

    const body = parseBody(event);
    const stats = HeartbeatSchema.parse(body);

    await centralService.recordHeartbeat(ctx.tenantId, centralId, stats);

    return ok({ message: 'Heartbeat recorded', timestamp: new Date().toISOString() });
  } catch (err) {
    return handleError(err);
  }
};
