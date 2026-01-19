import { APIGatewayProxyHandler } from 'aws-lambda';
import { z } from 'zod';
import { partnerService } from '../../services/PartnerService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

const SuspendPartnerSchema = z.object({
  reason: z.string().min(10).max(1000),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);
    const body = parseBody(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const { reason } = SuspendPartnerSchema.parse(body);

    const partner = await partnerService.suspend(ctx.tenantId, id, reason, ctx.userId);

    return ok({
      message: 'Partner suspended successfully',
      partner: {
        id: partner.id,
        companyName: partner.companyName,
        status: partner.status,
        suspendedAt: partner.suspendedAt,
        suspendedBy: partner.suspendedBy,
        suspensionReason: partner.suspensionReason,
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
