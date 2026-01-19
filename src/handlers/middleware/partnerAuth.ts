import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { partnerService } from '../../services/PartnerService';
import { Partner, ApiKey, OAuthClient } from '../../domain/entities/Partner';
import { unauthorized } from './response';

export interface PartnerAuthContext {
  partner: Partner;
  authMethod: 'api_key' | 'oauth';
  scopes: string[];
  keyInfo?: ApiKey;
  clientInfo?: OAuthClient;
}

export interface AuthenticatedEvent extends APIGatewayProxyEvent {
  partnerAuth?: PartnerAuthContext;
}

/**
 * Extracts and validates partner authentication from request headers.
 * Supports both API Key (X-Api-Key header) and OAuth Bearer token authentication.
 */
export async function authenticatePartner(event: APIGatewayProxyEvent): Promise<PartnerAuthContext | null> {
  const authHeader = event.headers['Authorization'] || event.headers['authorization'];
  const apiKeyHeader = event.headers['X-Api-Key'] || event.headers['x-api-key'];

  // Try API Key authentication first
  if (apiKeyHeader) {
    return authenticateWithApiKey(apiKeyHeader);
  }

  // Try OAuth Bearer token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return authenticateWithOAuth(token);
  }

  return null;
}

async function authenticateWithApiKey(apiKey: string): Promise<PartnerAuthContext | null> {
  // Extract tenant from API key prefix or use default
  // For MVP, we'll scan all tenants - in production this should be optimized
  const result = await partnerService.validateApiKey('*', apiKey);

  if (!result) {
    return null;
  }

  const { partner, keyInfo } = result;

  // Check partner status
  if (partner.status !== 'ACTIVE') {
    return null;
  }

  return {
    partner,
    authMethod: 'api_key',
    scopes: keyInfo.scopes,
    keyInfo,
  };
}

async function authenticateWithOAuth(token: string): Promise<PartnerAuthContext | null> {
  // Check if it's our OAuth token format
  if (!token.startsWith('gcdr_oauth_')) {
    return null;
  }

  try {
    // Decode the token (in production, verify JWT signature)
    const payload = token.substring('gcdr_oauth_'.length);
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());

    // Check token expiration
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    // Get partner details
    const partner = await partnerService.getById(decoded.tenantId, decoded.partnerId);

    // Check partner status
    if (partner.status !== 'ACTIVE') {
      return null;
    }

    // Find the OAuth client
    const clientInfo = partner.oauthClients.find((c) => c.clientId === decoded.clientId && c.status === 'ACTIVE');

    if (!clientInfo) {
      return null;
    }

    return {
      partner,
      authMethod: 'oauth',
      scopes: decoded.scopes,
      clientInfo,
    };
  } catch {
    return null;
  }
}

/**
 * Checks if the authenticated partner has the required scope.
 */
export function hasScope(context: PartnerAuthContext, requiredScope: string): boolean {
  // Check for wildcard scope
  if (context.scopes.includes('*')) {
    return true;
  }

  // Check for exact match
  if (context.scopes.includes(requiredScope)) {
    return true;
  }

  // Check for partial wildcards (e.g., "customers:*" matches "customers:read")
  const [resource, action] = requiredScope.split(':');
  if (context.scopes.includes(`${resource}:*`)) {
    return true;
  }

  return false;
}

/**
 * Higher-order function to wrap handlers with partner authentication.
 */
export function requirePartnerAuth(
  requiredScopes: string[] = []
): (
  handler: (event: AuthenticatedEvent) => Promise<APIGatewayProxyResult>
) => (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  return (handler) => async (event: APIGatewayProxyEvent) => {
    const authContext = await authenticatePartner(event);

    if (!authContext) {
      return unauthorized('Invalid or missing authentication credentials');
    }

    // Check required scopes
    for (const scope of requiredScopes) {
      if (!hasScope(authContext, scope)) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'FORBIDDEN',
            message: `Insufficient permissions. Required scope: ${scope}`,
          }),
        };
      }
    }

    // Attach auth context to event
    const authenticatedEvent: AuthenticatedEvent = {
      ...event,
      partnerAuth: authContext,
    };

    return handler(authenticatedEvent);
  };
}

/**
 * Extract partner context from an already authenticated event.
 */
export function extractPartnerContext(event: AuthenticatedEvent): PartnerAuthContext {
  if (!event.partnerAuth) {
    throw new Error('Partner authentication context not found. Use requirePartnerAuth middleware.');
  }
  return event.partnerAuth;
}
