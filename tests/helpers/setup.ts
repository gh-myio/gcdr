// Global test setup

// Set test environment variables
process.env.STAGE = 'test';
process.env.REGION = 'us-east-1';
process.env.CUSTOMERS_TABLE = 'gcdr-customers-test';
process.env.PARTNERS_TABLE = 'gcdr-partners-test';
process.env.ROLES_TABLE = 'gcdr-roles-test';
process.env.POLICIES_TABLE = 'gcdr-policies-test';
process.env.ROLE_ASSIGNMENTS_TABLE = 'gcdr-role-assignments-test';
process.env.EVENT_BUS_NAME = 'gcdr-events-test';

// Global test timeout
jest.setTimeout(10000);

// Clean up after all tests
afterAll(() => {
  jest.clearAllMocks();
});
