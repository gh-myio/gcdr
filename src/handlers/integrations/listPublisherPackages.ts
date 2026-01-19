import { APIGatewayProxyHandler } from 'aws-lambda';
import { toPackageSummaryDTO } from '../../dto/response/IntegrationResponseDTO';
import { integrationService } from '../../services/IntegrationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);

    const packages = await integrationService.listPublisherPackages(ctx.tenantId, ctx.userId);

    return ok({
      items: packages.map(toPackageSummaryDTO),
      count: packages.length,
    });
  } catch (err) {
    return handleError(err);
  }
};
