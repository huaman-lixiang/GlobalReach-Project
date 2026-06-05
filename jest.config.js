/** @type {import('jest').Config} */
module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Root directory for tests
  roots: ['<rootDir>/api/__tests__'],

  // File patterns
  testMatch: ['**/*.test.js', '**/*.spec.js'],

  // Coverage configuration
  collectCoverageFrom: [
    'api/middleware/**/*.js',
    'api/routes/**/*.js',
    'api/services/**/*.js',
    '!api/**/*.test.js',
    '!api/**/*.spec.js',
    '!api/**/index.js',
  ],
  coverageDirectory: 'api/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 70,
      lines: 75,
      statements: 75,
    },
  },

  // Timeout for async tests
  testTimeout: 10000,

  // Verbose output
  verbose: true,

  // Force exit after tests (needed for DB connections, timers)
  forceExit: true,
  detectOpenHandles: true,

  // Setup file (shared test utilities)
  setupFilesAfterEnv: ['<rootDir>/api/__tests__/setup.js'],

  // Module paths
  moduleDirectories: ['node_modules', 'api'],
};
