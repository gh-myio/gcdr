import { APIGatewayProxyHandler } from 'aws-lambda';
import { z } from 'zod';
import { partnerService } from '../../services/PartnerService';
import { handleError } from '../middleware/errorHandler';
import { parseBody } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

const TokenRequestSchema = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  scope: z.string().optional(),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseBody(event);
    const data = TokenRequestSchema.parse(body);

    if (data.grant_type !== 'client_credentials') {
      throw new ValidationError('Unsupported grant type. Only client_credentials is supported.');
    }

    const requestedScopes = data.scope ? data.scope.split(' ') : undefined;

    const tokenResponse = await partnerService.issueAccessToken(
      data.client_id,
      data.client_secret,
      requestedScopes
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
      body: JSON.stringify({
        access_token: tokenResponse.accessToken,
        token_type: tokenResponse.tokenType,
        expires_in: tokenResponse.expiresIn,
        scope: tokenResponse.scopes.join(' '),
      }),
    };
  } catch (err) {
    // OAuth2 error format
    if (err instanceof ValidationError) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'invalid_client',
          error_description: err.message,
        }),
      };
    }
    return handleError(err);
  }
};
