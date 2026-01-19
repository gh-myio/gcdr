import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdatePartnerSchema } from '../../dto/request/PartnerDTO';
import { partnerService } from '../../services/PartnerService';
import { ok } from '../middleware/response';
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

    const data = UpdatePartnerSchema.parse(body);

    const partner = await partnerService.update(ctx.tenantId, id, data, ctx.userId);

    return ok({
      id: partner.id,
      companyName: partner.companyName,
      companyWebsite: partner.companyWebsite,
      companyDescription: partner.companyDescription,
      industry: partner.industry,
      country: partner.country,
      contactName: partner.contactName,
      contactEmail: partner.contactEmail,
      contactPhone: partner.contactPhone,
      technicalContactEmail: partner.technicalContactEmail,
      status: partner.status,
      updatedAt: partner.updatedAt,
    });
  } catch (err) {
    return handleError(err);
  }
};
