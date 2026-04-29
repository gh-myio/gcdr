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
  // Coverage gate strategy:
  //   - global = current baseline minus a safety margin. CI fails if
  //     someone removes tests or merges code that drops coverage below
  //     this floor. Raise gradually as old code gets tested (10 → 30
  //     → 50 → 70).
  //   - per-folder = high bars on actively-tested modules so they
  //     don't backslide. New folders that earn high coverage join here.
  // See docs/QUALITY-GATE.md for the roadmap.
  coverageThreshold: {
    // Global bar = current actual minus safety margin. Files matching a
    // per-folder rule below are subtracted from the global denominator
    // by Jest, hence the very low numbers here. This is a floor, not a
    // target — raise as old code gets tested. See docs/QUALITY-GATE.md.
    global: {
      branches:   1,
      functions:  3,
      lines:      3,
      statements: 3,
    },
    // High bar on the QR Checker module — it has 84 unit tests today.
    'src/services/qrc/': {
      branches:   55,
      functions:  45,
      lines:      65,
      statements: 65,
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
