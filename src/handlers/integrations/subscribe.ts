import { APIGatewayProxyHandler } from 'aws-lambda';
import { SubscribePackageSchema } from '../../dto/request/IntegrationDTO';
import { toSubscriptionDTO } from '../../dto/response/IntegrationResponseDTO';
import { integrationService } from '../../services/IntegrationService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = SubscribePackageSchema.parse(body);

    // Determine subscriber type based on context
    // For now, assume partner subscription
    const subscriberType = 'partner' as const;

    const subscription = await integrationService.subscribe(
      ctx.tenantId,
      data.packageId,
      ctx.userId,
      subscriberType,
      data.version,
      data.config
    );

    // Get package name for response
    const pkg = await integrationService.getPackageById(ctx.tenantId, data.packageId);

    return created({
      message: 'Successfully subscribed to package',
      subscription: toSubscriptionDTO(subscription, pkg.name),
    });
  } catch (err) {
    return handleError(err);
  }
};
