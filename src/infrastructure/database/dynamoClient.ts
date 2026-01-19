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
};
