/**
 * Create a test Express app instance for integration testing.
 *
 * server.js exports the Express app directly (module.exports = app),
 * so we can import it for supertest-based integration tests.
 * Note: importing server.js triggers require.main checks that skip
 * DB sync / worker startup / HTTP listen when not run as main module.
 */
const express = require('express');

/**
 * Get the full app from server.js (includes all middleware + routes).
 * Use this for integration-level tests that need the real middleware stack.
 */
function getFullApp() {
  // server.js does `module.exports = app` at the end
  // The require.main === module guard prevents DB sync & server.listen
  return require('../../server');
}

/**
 * Create a minimal Express app for unit-testing individual middleware.
 * No routes, no DB connections, no external services.
 */
function createMinimalApp() {
  const app = express();
  app.use(express.json());
  return app;
}

module.exports = { getFullApp, createMinimalApp };
