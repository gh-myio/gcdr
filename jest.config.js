module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/shared/types/**',
  ],
  coverageDirectory: 'coverage',
  // json-summary feeds the PR-comment action with one-line totals.
  // text-summary prints the same totals to CI logs for quick eyeballing.
  coverageReporters: ['text', 'text-summary', 'lcov', 'html', 'json', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 10,
      functions: 15,
      lines: 10,
      statements: 10,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@controllers/(.*)$': '<rootDir>/src/controllers/$1',
    '^@repositories/(.*)$': '<rootDir>/src/repositories/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@dto/(.*)$': '<rootDir>/src/dto/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/setup.ts'],
  testTimeout: 10000,
  verbose: true,
};
