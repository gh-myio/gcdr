import { APIGatewayProxyHandler } from 'aws-lambda';
import { success } from './middleware/response';

export const handler: APIGatewayProxyHandler = async () => {
  return success({
    status: 'healthy',
    service: 'gcdr-api',
    version: process.env.npm_package_version || '1.0.0',
    stage: process.env.STAGE || 'dev',
    timestamp: new Date().toISOString(),
  });
};
