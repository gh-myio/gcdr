import { APIGatewayProxyHandler } from 'aws-lambda';
import { partnerService } from '../../services/PartnerService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const partner = await partnerService.activate(ctx.tenantId, id, ctx.userId);

    return ok({
      message: 'Partner activated successfully',
      partner: {
        id: partner.id,
        companyName: partner.companyName,
        status: partner.status,
        activatedAt: partner.activatedAt,
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
