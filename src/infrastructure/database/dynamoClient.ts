import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({
  region: process.env.REGION || 'sa-east-1',
});

export const dynamoDb = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

export const TableNames = {
  CUSTOMERS: process.env.CUSTOMERS_TABLE || 'gcdr-customers-dev',
  PARTNERS: process.env.PARTNERS_TABLE || 'gcdr-partners-dev',
  ROLES: process.env.ROLES_TABLE || 'gcdr-roles-dev',
  POLICIES: process.env.POLICIES_TABLE || 'gcdr-policies-dev',
  ROLE_ASSIGNMENTS: process.env.ROLE_ASSIGNMENTS_TABLE || 'gcdr-role-assignments-dev',
  ASSETS: process.env.ASSETS_TABLE || 'gcdr-assets-dev',
  DEVICES: process.env.DEVICES_TABLE || 'gcdr-devices-dev',
  RULES: process.env.RULES_TABLE || 'gcdr-rules-dev',
  INTEGRATIONS: process.env.INTEGRATIONS_TABLE || 'gcdr-integrations-dev',
  SUBSCRIPTIONS: process.env.SUBSCRIPTIONS_TABLE || 'gcdr-subscriptions-dev',
  CENTRALS: process.env.CENTRALS_TABLE || 'gcdr-centrals-dev',
  THEMES: process.env.THEMES_TABLE || 'gcdr-themes-dev',
  USERS: process.env.USERS_TABLE || 'gcdr-users-dev',
};
