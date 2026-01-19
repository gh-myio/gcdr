import { APIGatewayProxyHandler } from 'aws-lambda';
import { RejectPartnerSchema } from '../../dto/request/PartnerDTO';
import { partnerService } from '../../services/PartnerService';
import { success } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);
    const body = parseBody(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    // Validate input
    const data = RejectPartnerSchema.parse(body);

    // Reject partner
    const partner = await partnerService.reject(ctx.tenantId, id, data, ctx.userId);

    return success({
      message: 'Partner rejected',
      partner: {
        id: partner.id,
        companyName: partner.companyName,
        status: partner.status,
        rejectedAt: partner.rejectedAt,
        rejectedBy: partner.rejectedBy,
        rejectionReason: partner.rejectionReason,
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
