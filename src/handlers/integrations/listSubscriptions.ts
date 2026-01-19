import { APIGatewayProxyHandler } from 'aws-lambda';
import { toSubscriptionDTO } from '../../dto/response/IntegrationResponseDTO';
import { integrationService } from '../../services/IntegrationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);

    const subscriptions = await integrationService.listSubscriberSubscriptions(ctx.tenantId, ctx.userId);

    // Get package names for each subscription
    const items = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const pkg = await integrationService.getPackageById(ctx.tenantId, sub.packageId);
          return toSubscriptionDTO(sub, pkg.name);
        } catch {
          return toSubscriptionDTO(sub, 'Unknown Package');
        }
      })
    );

    return ok({
      items,
      count: items.length,
    });
  } catch (err) {
    return handleError(err);
  }
};
