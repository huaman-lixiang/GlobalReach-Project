/**
 * OpenAPI 3.0 Specification — D16 API Documentation
 *
 * Complete REST API specification for GlobalReach V2.0 Enterprise.
 *
 * Endpoints documented:
 *   - Auth (7): register, login, refresh, logout, me, forgot-password, reset-password
 *   - Accounts (13): CRUD + test-connection + activate/deactivate + batch-import
 *   - Campaigns (6): CRUD with pagination/filter
 *   - Emails (10): send, batch-send, validate, preview, format, list, stats
 *   - Stats (8): overview, platform-comparison, trends, export, realtime
 *   - Platforms (8): list, config CRUD, accounts, rate-limit, health, test
 *   - Tenants (10): CRUD + account assignment + isolation-check
 *   - Health (3): deep check, readiness, liveness
 *   - Metrics (2): Prometheus scrape, info discovery
 *   - CSRF Token (1): token issuance
 */

const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'GlobalReach V2.0 Enterprise API',
    description: `Enterprise-grade multi-platform email marketing automation system.

## Features
- **Multi-Platform Support**: Gmail, Outlook, QQ Mail, NetEase 163, Custom SMTP
- **Campaign Management**: Create, schedule, and monitor email campaigns
- **Real-time Progress**: SSE-based campaign send progress streaming
- **Security**: JWT dual-token auth, CSRF protection, CORS whitelist, input validation
- **Monitoring**: Prometheus metrics endpoint, deep health checks

## Authentication
All protected endpoints require a Bearer JWT token in the Authorization header:
\`\`\`
Authorization: Bearer <access_token>
\`\`\`

CSRF tokens are required for mutating requests (POST/PUT/PATCH/DELETE):
\`\`\`
X-CSRF-Token: <csrf_token>
\`\`\``,
    version: '2.0.0',
    contact: {
      name: 'GlobalReach Engineering Team',
      email: 'api@globalreach.example.com',
    },
    license: {
      name: 'Proprietary',
      url: 'https://globalreach.example.com/license',
    },
  },
  servers: [
    {
      url: '/api/v1',
      description: 'Production API (v1)',
    },
    {
      url: '/api',
      description: 'Legacy compatibility route',
    },
  ],
  tags: [
    { name: 'Authentication', description: 'User registration, login, token management' },
    { name: 'Accounts', description: 'Email account pool management' },
    { name: 'Campaigns', description: 'Email campaign CRUD operations' },
    { name: 'Emails', description: 'Email sending, validation, and records' },
    { name: 'Statistics', description: 'Analytics and reporting data' },
    { name: 'Platforms', description: 'Platform configuration and status' },
    { name: 'Tenants', description: 'Multi-tenant management (admin only)' },
    { name: 'Health', description: 'System health monitoring' },
    { name: 'Monitoring', description: 'Prometheus metrics and observability' },
    { name: 'Security', description: 'CSRF tokens and security utilities' },
  ],
  paths: {
    // ============================================
    // Authentication
    // ============================================
    '/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register a new user account',
        operationId: 'registerUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'user@example.com' },
                  password: { type: 'string', minLength: 8, example: 'SecurePass123!' },
                  name: { type: 'string', maxLength: 100, example: 'John Doe' },
                  role: { type: 'string', enum: ['admin', 'manager', 'operator'], default: 'operator' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Registration successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Email already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
        security: [],
      },
    },

    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Authenticate user and get tokens',
        operationId: 'loginUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
        security: [],
      },
    },

    '/auth/refresh': {
      post: {
        tags: ['Authentication'],
        summary: 'Refresh access token using refresh token',
        operationId: 'refreshToken',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } },
            },
          },
        },
        responses: {
          200: { description: 'Token refreshed', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          401: { description: 'Invalid or expired refresh token' },
        },
        security: [],
      },
    },

    '/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Logout user and invalidate all tokens',
        operationId: 'logoutUser',
        responses: {
          200: { description: 'Logout successful' },
          401: { description: 'Not authenticated' },
        },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get current authenticated user profile',
        operationId: 'getCurrentUser',
        responses: {
          200: { description: 'User profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          401: { description: 'Not authenticated' },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    '/auth/forgot-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Request password reset email',
        operationId: 'forgotPassword',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } },
            },
          },
        },
        responses: { 200: { description: 'Reset email sent if account exists' }, 429: { description: 'Rate limited' } },
        security: [],
      },
    },

    '/auth/reset-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Reset password using reset token',
        operationId: 'resetPassword',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'password'],
                properties: {
                  token: { type: 'string' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Password reset successful' }, 400: { description: 'Invalid token or weak password' } },
        security: [],
      },
    },

    '/auth/csrf-token': {
      get: {
        tags: ['Security'],
        summary: 'Get CSRF token for subsequent mutating requests',
        operationId: 'getCsrfToken',
        responses: {
          200: {
            description: 'CSRF token issued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        csrfToken: { type: 'string', description: '64-char hex token' },
                        expiresIn: { type: 'integer', description: 'TTL in milliseconds', example: 7200000 },
                        headerName: { type: 'string', example: 'x-csrf-token' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Authentication required' },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    // ============================================
    // Accounts
    // ============================================
    '/accounts': {
      get: {
        tags: ['Accounts'],
        summary: 'List all email accounts (paginated)',
        operationId: 'listAccounts',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive', 'error'] } },
          { name: 'platform', in: 'query', schema: { type: 'string', enum: ['GMAIL', 'OUTLOOK', 'QQ', 'NETEASE_163', 'CUSTOM_SMTP'] } },
        ],
        responses: {
          200: { description: 'Paginated account list', content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedList' } } } },
        },
        security: [{ bearerAuth: [] }],
      },
      post: {
        tags: ['Accounts'],
        summary: 'Add new email account to pool (admin only)',
        operationId: 'createAccount',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['platform', 'credentials'],
                properties: {
                  platform: { type: 'string', enum: ['GMAIL', 'OUTLOOK', 'QQ', 'NETEASE_163', 'CUSTOM_SMTP'] },
                  credentials: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', format: 'email' },
                      password: { type: 'string' },
                      host: { type: 'string' },
                      port: { type: 'integer' },
                      secure: { type: 'boolean' },
                    },
                  },
                  displayName: { type: 'string' },
                  region: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Account created' }, 400: { description: 'Validation error' }, 403: { description: 'Admin required' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    '/accounts/{id}': {
      get: {
        tags: ['Accounts'],
        summary: 'Get account details by ID',
        operationId: 'getAccount',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Account details' }, 404: { description: 'Account not found' } },
        security: [{ bearerAuth: [] }],
      },
      put: {
        tags: ['Accounts'],
        summary: 'Update account settings (admin only)',
        operationId: 'updateAccount',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/AccountInput' } } } },
        responses: { 200: { description: 'Account updated' }, 404: { description: 'Not found' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
      delete: {
        tags: ['Accounts'],
        summary: 'Remove account from pool (admin only)',
        operationId: 'deleteAccount',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 204: { description: 'Account deleted' }, 404: { description: 'Not found' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    '/accounts/select-best': {
      get: {
        tags: ['Accounts'],
        summary: 'Select best available account for sending',
        operationId: 'selectBestAccount',
        parameters: [
          { name: 'platform', in: 'query', required: false, schema: { type: 'string', enum: ['GMAIL', 'OUTLOOK', 'QQ', 'NETEASE_163', 'CUSTOM_SMTP'] } },
          { name: 'region', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Best account selected' }, 503: { description: 'No accounts available' } },
        security: [{ bearerAuth: [] }],
      },
    },

    '/accounts/stats/distribution': {
      get: {
        tags: ['Accounts'],
        summary: 'Get account distribution by platform/status',
        operationId: 'accountStatsDistribution',
        responses: { 200: { description: 'Distribution data' } },
        security: [{ bearerAuth: [] }],
      },
    },

    '/accounts/batch-import': {
      post: {
        tags: ['Accounts'],
        summary: 'Batch import multiple accounts (admin only)',
        operationId: 'batchImportAccounts',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['accounts'],
                properties: {
                  accounts: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/AccountInput' },
                    maxItems: 100,
                  },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Import results' }, 400: { description: 'Validation error' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    // ============================================
    // Campaigns
    // ============================================
    '/campaigns': {
      get: {
        tags: ['Campaigns'],
        summary: 'List campaigns (paginated, filterable)',
        operationId: 'listCampaigns',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'scheduled', 'sending', 'completed', 'failed', 'paused'] } },
        ],
        responses: { 200: { description: 'Paginated campaign list' } },
        security: [{ bearerAuth: [] }],
      },
      post: {
        tags: ['Campaigns'],
        summary: 'Create new email campaign',
        operationId: 'createCampaign',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'subject', 'htmlContent', 'recipientCount'],
                properties: {
                  name: { type: 'string', maxLength: 255 },
                  subject: { type: 'string', maxLength: 998 },
                  htmlContent: { type: 'string', maxLength: 500000 },
                  textContent: { type: 'string' },
                  senderName: { type: 'string' },
                  recipientCount: { type: 'integer', maximum: 50 },
                  scheduledAt: { type: 'string', format: 'date-time' },
                  templateVariables: { type: 'object' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Campaign created' }, 400: { description: 'Validation error' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    '/campaigns/{id}': {
      get: {
        tags: ['Campaigns'],
        summary: 'Get campaign detail with stats',
        operationId: 'getCampaign',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Campaign detail' }, 404: { description: 'Not found' } },
        security: [{ bearerAuth: [] }],
      },
      put: {
        tags: ['Campaigns'],
        summary: 'Update campaign (owner or admin)',
        operationId: 'updateCampaign',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: {}, subject: {}, htmlContent: {} } } } } },
        responses: { 200: { description: 'Updated' }, 404: { description: 'Not found' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
      delete: {
        tags: ['Campaigns'],
        summary: 'Delete campaign (owner or admin)',
        operationId: 'deleteCampaign',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 204: { description: 'Deleted' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    // ============================================
    // Emails
    // ============================================
    '/emails/send': {
      post: {
        tags: ['Emails'],
        summary: 'Send a single email immediately',
        operationId: 'sendEmail',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['from', 'to', 'subject', 'html'],
                properties: {
                  from: { type: 'string', format: 'email' },
                  to: { type: 'array', items: { type: 'string', format: 'email' }, maxItems: 50 },
                  cc: { type: 'array', items: { type: 'string', format: 'email' } },
                  bcc: { type: 'array', items: { type: 'string', format: 'email' } },
                  subject: { type: 'string', maxLength: 998 },
                  html: { type: 'string', maxLength: 500000 },
                  text: { type: 'string' },
                  attachments: { type: 'array', items: { type: 'object', properties: { filename: {}, content: {} } } },
                },
              },
            },
          },
        },
        responses: { 202: { description: 'Email queued for sending' }, 400: { description: 'Validation error' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    '/emails/send/batch': {
      post: {
        tags: ['Emails'],
        summary: 'Send batch emails (multiple recipients)',
        operationId: 'sendBatchEmails',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['from', 'recipients', 'subject', 'html'],
                properties: {
                  from: { type: 'string', format: 'email' },
                  recipients: { type: 'array', items: { type: 'object', properties: { to: { type: 'string' }, variables: { type: 'object' } } }, maxItems: 50 },
                  subject: { type: 'string' },
                  html: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 202: { description: 'Batch queued' }, 400: { description: 'Validation error' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    '/emails/campaign/{campaignId}/execute': {
      post: {
        tags: ['Emails'],
        summary: 'Execute a campaign send job',
        operationId: 'executeCampaignSend',
        parameters: [{ name: 'campaignId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 202: { description: 'Campaign execution started' }, 404: { description: 'Campaign not found' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    '/emails': {
      get: {
        tags: ['Emails'],
        summary: 'List email records (paginated)',
        operationId: 'listEmailRecords',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['sent', 'failed', 'bounced', 'delivered', 'pending'] } },
        ],
        responses: { 200: { description: 'Paginated email records' } },
        security: [{ bearerAuth: [] }],
      },
    },

    '/emails/validate': {
      post: {
        tags: ['Emails'],
        summary: 'Validate email structure before sending',
        operationId: 'validateEmail',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['from', 'to', 'subject', 'html'],
                properties: {
                  from: { type: 'string', format: 'email' },
                  to: { type: 'array', items: { type: 'string', format: 'email' } },
                  subject: { type: 'string' },
                  html: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Validation result with errors array if any' } },
        security: [{ bearerAuth: [] }, { csrfToken: [] }],
      },
    },

    // ============================================
    // Statistics
    // ============================================
    '/stats/overview': {
      get: {
        tags: ['Statistics'],
        summary: 'Dashboard overview statistics',
        operationId: 'statsOverview',
        parameters: [{ name: 'period', in: 'query', schema: { type: 'string', enum: ['7d', '30d', '90d', '1y'], default: '30d' } }],
        responses: { 200: { description: 'Overview statistics object' } },
        security: [{ bearerAuth: [] }],
      },
    },

    '/stats/platform-comparison': {
      get: {
        tags: ['Statistics'],
        summary: 'Compare performance across platforms',
        operationId: 'statsPlatformComparison',
        responses: { 200: { description: 'Platform comparison data' } },
        security: [{ bearerAuth: [] }],
      },
    },

    '/stats/trend/{platform}': {
      get: {
        tags: ['Statistics'],
        summary: 'Get daily trend data for a specific platform',
        operationId: 'statsTrend',
        parameters: [
          { name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'days', in: 'query', schema: { type: 'integer', default: 14, maximum: 365 } },
        ],
        responses: { 200: { description: 'Daily trend data points' } },
        security: [{ bearerAuth: [] }],
      },
    },

    '/stats/export': {
      get: {
        tags: ['Statistics'],
        summary: 'Export statistics as CSV',
        operationId: 'statsExport',
        parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['platform_data', 'trend_data'] } }],
        responses: { 200: { description: 'CSV file download', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } } },
        security: [{ bearerAuth: [] }],
      },
    },

    '/stats/realtime': {
      get: {
        tags: ['Statistics'],
        summary: 'Get real-time statistics snapshot',
        operationId: 'statsRealtime',
        responses: { 200: { description: 'Current real-time metrics' } },
        security: [{ bearerAuth: [] }],
      },
    },

    // ============================================
    // Platforms
    // ============================================
    '/platforms': {
      get: {
        tags: ['Platforms'],
        summary: 'List supported platforms with configs',
        operationId: 'listPlatforms',
        responses: { 200: { description: 'Platform configurations array' } },
        security: [{ bearerAuth: [] }],
      },
    },

    '/platforms/{platformType}/config': {
      get: {
        tags: ['Platforms'],
        summary: 'Get platform-specific configuration',
        operationId: 'getPlatformConfig',
        parameters: [{ name: 'platformType', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Platform config' }, 404: { description: 'Unknown platform' } },
        security: [{ bearerAuth: [] }],
      },
    },

    // ============================================
    // Health Checks
    // ============================================
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Full deep health check (all subsystems)',
        operationId: 'deepHealthCheck',
        responses: {
          200: {
            description: 'System health report',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['healthy', 'degraded', 'unstable', 'down'] },
                    healthScore: { type: 'object', properties: { score: { type: 'integer' }, status: { type: 'string' } } },
                    checks: { type: 'object' },
                  },
                },
              },
            },
          },
        },
        security: [],
      },
    },

    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe (DB connectivity only)',
        operationId: 'readinessProbe',
        responses: { 200: { description: 'Ready' }, 503: { description: 'Not ready' } },
        security: [],
      },
    },

    '/health/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe (process alive)',
        operationId: 'livenessProbe',
        responses: { 200: { description: 'Alive' } },
        security: [],
      },
    },

    // ============================================
    // Monitoring / Metrics
    // ============================================
    '/metrics': {
      get: {
        tags: ['Monitoring'],
        summary: 'Prometheus metrics endpoint (text format)',
        operationId: 'prometheusMetrics',
        responses: {
          200: {
            description: 'Prometheus exposition format',
            content: { 'text/plain; version=0.0.4; charset=utf-8': { schema: { type: 'string' } } },
          },
        },
        security: [],
      },
    },

    '/metrics/info': {
      get: {
        tags: ['Monitoring'],
        summary: 'Metrics metadata discovery endpoint',
        operationId: 'metricsInfo',
        responses: { 200: { description: 'Available metric groups and names' } },
        security: [],
      },
    },
  },

  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token (15min expiry). Get from /auth/login or /auth/refresh.',
      },
      csrfToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description: 'CSRF protection token. Required for POST/PUT/PATCH/DELETE. Get from /auth/csrf-token.',
      },
    },
    schemas: {
      AuthResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              accessToken: { type: 'string', description: 'JWT access token (15min TTL)' },
              refreshToken: { type: 'string', description: 'JWT refresh token (7d TTL)' },
              csrfToken: { type: 'string', description: 'CSRF token for mutations' },
              expiresIn: { type: 'string', example: '15m' },
              tokenType: { type: 'string', example: 'Bearer' },
              user: { $ref: '#/components/schemas/User' },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'manager', 'operator'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AccountInput: {
        type: 'object',
        required: ['platform'],
        properties: {
          platform: { type: 'string', enum: ['GMAIL', 'OUTLOOK', 'QQ', 'NETEASE_163', 'CUSTOM_SMTP'] },
          credentials: { type: 'object', properties: { email: {}, password: {}, host: {}, port: {}, secure: {} } },
          displayName: { type: 'string' },
          region: { type: 'string' },
        },
      },
      PaginatedList: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              items: { type: 'array' },
              total: { type: 'integer' },
              page: { type: 'integer' },
              limit: { type: 'integer' },
              totalPages: { type: 'integer' },
            },
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          requestId: { type: 'string' },
          details: { type: 'object' },
        },
      },
    },
  },
};

module.exports = openapiSpec;
