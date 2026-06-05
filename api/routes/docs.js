/**
 * API Documentation Route — D16 Swagger UI
 *
 * Serves:
 *   GET /api/v1/docs/openapi.json — Raw OpenAPI 3.0 spec (JSON)
 *   GET /api/v1/docs/ — Swagger UI (interactive HTML documentation)
 */

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const openapiSpec = require('../docs/openapi');

const router = express.Router();

// MUST be registered before swaggerUi catch-all
router.get('/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openapiSpec);
});

// Serve interactive Swagger UI (catch-all for /docs/* paths)
router.use('/', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customCss: `
    .swagger-ui .topbar { background-color: #1a1a2e; }
    .swagger-ui .info .title { color: #e94560; }
    .swagger-ui .info .base-url { display: none; }
    .swagger-ui .execute-wrapper { clear: both; }
  `,
  customSiteTitle: 'GlobalReach V2.0 Enterprise API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    deepLinking: true,
    displayOperationId: true,
    defaultModelsExpandDepth: 2,
    defaultModelExpandDepth: 2,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    syntaxHighlight: { activate: true, theme: 'monokai' },
  },
}));

module.exports = router;
