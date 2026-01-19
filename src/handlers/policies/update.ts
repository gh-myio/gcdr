import { APIGatewayProxyHandler } from 'aws-lambda';
import { z } from 'zod';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

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

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const policyId = event.pathParameters?.policyId;
    const body = parseBody(event);

    if (!policyId) {
      return handleError(new Error('Policy ID is required'));
    }

    const data = UpdatePolicySchema.parse(body);

    const policy = await authorizationService.updatePolicy(ctx.tenantId, policyId, data, ctx.userId);

    return ok(policy);
  } catch (err) {
    return handleError(err);
  }
};
