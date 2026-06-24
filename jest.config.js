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
    // Work Orders module (RFC-0037 rewrite replaced src/services/wo/ and
    // its 84 QR Checker tests). Baseline reset to current actual minus
    // margin — raise as the new event-model suite grows.
    'src/services/work-orders/': {
      branches:   28,
      functions:  12,
      lines:      22,
      statements: 20,
    },
    // RFC-0047 Generic Entity Registry — gate the new module so its unit
    // coverage doesn't backslide. Modest floors the layer agents' unit suites
    // can realistically meet; raise as the suites grow.
    'src/services/EntityService.ts': {
      branches:   20,
      functions:  15,
      lines:      20,
      statements: 20,
    },
    'src/repositories/EntityRepository.ts': {
      branches:   20,
      functions:  15,
      lines:      20,
      statements: 20,
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
