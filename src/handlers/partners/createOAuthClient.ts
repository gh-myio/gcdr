import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateOAuthClientSchema } from '../../dto/request/PartnerDTO';
import { partnerService } from '../../services/PartnerService';
import { created } from '../middleware/response';
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

    const data = CreateOAuthClientSchema.parse(body);

    const { clientId, clientSecret } = await partnerService.createOAuthClient(
      ctx.tenantId,
      id,
      data,
      ctx.userId
    );

    return created({
      message: 'OAuth client created successfully. Store the client secret securely - it will not be shown again.',
      client: {
        clientId,
        clientSecret,
        name: data.name,
        scopes: data.scopes,
        grantTypes: data.grantTypes,
        redirectUris: data.redirectUris,
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
