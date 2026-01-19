import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApprovePartnerSchema } from '../../dto/request/PartnerDTO';
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
    const data = ApprovePartnerSchema.parse(body);

    // Approve partner
    const partner = await partnerService.approve(ctx.tenantId, id, data, ctx.userId);

    return success({
      message: 'Partner approved successfully',
      partner: {
        id: partner.id,
        companyName: partner.companyName,
        status: partner.status,
        scopes: partner.scopes,
        rateLimitPerMinute: partner.rateLimitPerMinute,
        rateLimitPerDay: partner.rateLimitPerDay,
        monthlyQuota: partner.monthlyQuota,
        approvedAt: partner.approvedAt,
        approvedBy: partner.approvedBy,
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
