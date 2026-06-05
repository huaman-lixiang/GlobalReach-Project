const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'GlobalReach V2.0 Enterprise API',
      version: '2.0.0',
      description: `
## 🚀 Enterprise Email Marketing Multi-Platform API

### Overview
RESTful API for managing multi-platform email marketing operations across Gmail, Outlook, QQ Mail, 163 Mail, and custom SMTP servers.

### Features
- 🔐 **JWT Authentication** - Secure token-based authentication
- 📧 **Multi-Platform Support** - 5 email platforms with unified API
- ⚡ **Failover System** - Automatic platform switching on failures
- 📊 **Performance Analytics** - Real-time delivery/open/reply statistics
- 👥 **Multi-Tenant** - SaaS-ready data isolation
- 🔄 **Batch Operations** - Bulk import/export and batch sending
- 🛡️ **Rate Limiting** - Protection against abuse

### Authentication
All endpoints (except public ones) require JWT token in Authorization header:
\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

### Base URL
\`\`\`
http://localhost:3000/api
\`\`\`

### Error Response Format
\`\`\`json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "timestamp": "2026-06-02T...",
  "path": "/api/endpoint"
}
\`\`\`
      `,
      contact: {
        name: 'GlobalReach API Support',
        email: 'api-support@globalreach.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        Account: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'gmail-001' },
            platform: { type: 'string', enum: ['gmail', 'outlook', 'qq', '163', 'custom'] },
            status: { type: 'string', enum: ['active', 'inactive', 'error'] },
            healthStatus: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Email: {
          type: 'object',
          required: ['to', 'subject'],
          properties: {
            from: { type: 'string' },
            to: { type: 'array', items: { type: 'string' } },
            cc: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string' },
            html: { type: 'string' },
            text: { type: 'string' },
            attachments: { type: 'array' }
          }
        },
        Tenant: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            plan: { type: 'string', enum: ['basic', 'professional', 'enterprise'] },
            status: { type: 'string' },
            accountsCount: { type: 'integer' },
            clientsCount: { type: 'integer' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string' },
            message: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            path: { type: 'string' }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: {},
            message: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' }
          }
        }
      }
    },
    tags: [
      { name: 'Authentication', description: 'User login and registration' },
      { name: 'Accounts', description: 'Email account management CRUD' },
      { name: 'Emails', description: 'Email sending and formatting' },
      { name: 'Platforms', description: 'Platform configuration and monitoring' },
      { name: 'Tenants', description: 'Multi-tenant management (Admin only)' },
      { name: 'Statistics', description: 'Performance analytics and reports' },
      { name: 'Health', description: 'System health checks' }
    ]
  },
  apis: ['./routes/*.js']
};

const swaggerSpec = swaggerJsdoc(options);

function setupSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'GlobalReach V2.0 API Docs'
  }));

  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

module.exports = { setupSwagger, swaggerSpec };
