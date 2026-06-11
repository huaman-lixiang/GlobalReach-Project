# GlobalReach V2.0

> **Enterprise Email Marketing Platform · Global Reach Edition**
> **Status:** Post-O AIOps-Ready | **Protocol:** v6.0-STEADY-STATE-EVOLUTION | **Tests:** 90/90 PASS

A comprehensive enterprise-grade email marketing platform built with Node.js, Express, and React.

---

## 🚀 Features

### Core Features
- **Email Campaign Management** - Create, manage, and track email campaigns
- **Multi-Platform Support** - Gmail, Outlook, SendGrid, and custom SMTP
- **Real-time Analytics** - Track opens, clicks, conversions, and bounce rates
- **Client Management** - Organize contacts with tags and segmentation

### Security & Compliance
- **JWT Authentication** - Secure token-based authentication
- **CSRF Protection** - Double-submit token protection
- **Rate Limiting** - Prevent API abuse
- **Input Validation** - Comprehensive request validation

### Advanced Features
- **Custom Templates** - Create and manage email templates with variables
- **Advanced Search** - Full-text search across all resources
- **Data Export** - Export data to CSV, Excel, and PDF
- **Webhooks** - Real-time event notifications
- **Team Collaboration** - Multi-user teams with role-based access
- **Mobile Integration** - Dedicated mobile API endpoints
- **Push Notifications** - APNs and FCM integration

### Monitoring & Maintenance
- **Health Monitoring** - System health checks
- **Error Tracking** - Centralized error logging
- **User Feedback** - Collect and analyze user feedback

---

## 🛠️ Tech Stack

### Backend
- **Node.js 24** - Runtime environment
- **Express.js** - Web framework
- **PostgreSQL 15** - Relational database (11 tables)
- **Redis 7.x** - Caching and session storage
- **Sequelize** - ORM
- **JWT + CSRF** - Authentication & protection
- **Prometheus + Grafana** - Metrics collection & visualization
- **Alertmanager** - Alert routing (QQ Mail SMTP)

### Frontend
- **React** - UI framework
- **TypeScript** - Type safety
- **TailwindCSS** - Styling
- **React Query** - Data fetching
- **React Hook Form** - Form handling

### DevOps
- **Docker** - Containerization
- **Docker Compose** - Local development
- **GitHub Actions** - CI/CD pipeline
- **Nginx** - Reverse proxy
- **Grafana** - Monitoring dashboard

---

## 📋 Requirements

- Node.js >= 20.x
- PostgreSQL >= 15.x
- Redis >= 7.x
- Docker (optional, for containerized development)

---

## 🚀 Quick Start

### Prerequisites
```bash
# Install Node.js dependencies
cd api
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Environment Configuration

Create `.env` file in the `api` directory:

```env
# Database Configuration
DB_NAME=globalreach
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Configuration
JWT_SECRET=your_secure_jwt_secret_here
JWT_EXPIRES_IN=7d

# CSRF Configuration
CSRF_SECRET=your_csrf_secret_here

# Email Configuration
SENDGRID_API_KEY=your_sendgrid_api_key

# Server Configuration
PORT=3000
NODE_ENV=development
```

### Running Locally

```bash
# Start PostgreSQL and Redis
docker-compose up -d

# Start backend
cd api
npm run dev

# Start frontend (in separate terminal)
cd frontend
npm start
```

### Docker Deployment

```bash
# Development
docker-compose up -d

# Production
docker-compose -f docker-compose.prod.yml up -d
```

---

## 📡 API Documentation

### Swagger UI
Access the Swagger UI at:
- Local: `http://localhost:3000/api/v1/docs`
- Production: `https://api.globalreach.com/api/v1/docs`

### OpenAPI Specification
The full OpenAPI specification is available at:
- `api/docs/openapi-full.yaml`

---

## 🔧 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/login` | User login |
| POST | `/api/v1/auth/register` | User registration |
| POST | `/api/v1/auth/refresh` | Refresh access token |

### Campaigns
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/campaigns` | Get campaigns |
| POST | `/api/v1/campaigns` | Create campaign |
| GET | `/api/v1/campaigns/:id` | Get campaign by ID |
| PUT | `/api/v1/campaigns/:id` | Update campaign |
| DELETE | `/api/v1/campaigns/:id` | Delete campaign |

### Emails
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/emails` | Get emails |
| POST | `/api/v1/emails` | Send email |
| GET | `/api/v1/emails/:id` | Get email by ID |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/analytics/overview` | Analytics overview |
| GET | `/api/v1/analytics/campaigns` | Campaign analytics |
| GET | `/api/v1/analytics/trend` | Trend analysis |

### Search
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/search/emails` | Search emails |
| GET | `/api/v1/search/campaigns` | Search campaigns |
| GET | `/api/v1/search/global` | Global search |

### Export
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/export/emails/csv` | Export emails as CSV |
| GET | `/api/v1/export/emails/excel` | Export emails as Excel |
| GET | `/api/v1/export/analytics/pdf` | Export analytics as PDF |

### Mobile
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/mobile/dashboard` | Mobile dashboard |
| GET | `/api/v1/mobile/quick-stats` | Quick statistics |
| POST | `/api/v1/mobile/devices/register` | Register device |

---

## 🧪 Testing

### Unit Tests
```bash
cd api
npm test
```

### E2E Tests
```bash
cd api
npm run test:e2e
```

### Test Coverage
```bash
cd api
npm run test:coverage
```

---

## 📊 Project Statistics

| Metric | Value |
|--------|-------|
| **Version** | V2.0 (Steady State Evolution) |
| **Sessions Completed** | S029–S133 (104 sessions) |
| **Git Commits** | 106+ |
| **API Endpoints** | 118+ (26 route files) |
| **Unit Tests (Jest)** | 90 / 90 PASS (3 suites) |
| **Docker Containers** | 13 (full-stack monitoring) |
| **Database Tables** | 11 |
| **Technical Debt Repaid** | 17/28 (60.7%) |
| **Known Bugs** | 6/6 fixed |
| **Tech Debt Register** | `docs/technical-debt/TECHNICAL_DEBT_REGISTER.md` |
| **Self-Execute Protocol** | `02-ENTERPRISE-REPORTS/GLOBALREACH_S037_SELF_EXECUTE_PROTOCOL_v6_0.md` |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GlobalReach Architecture                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Frontend   │    │     API      │    │   Database   │  │
│  │   React +    │    │  Express.js  │    │  PostgreSQL  │  │
│  │   TypeScript │    │   Node.js    │    │              │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                    │           │
│         ▼                   ▼                    ▼           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Swagger    │    │    Redis     │    │   Prometheus │  │
│  │    UI        │    │   Cache      │    │   Metrics    │  │
│  └──────────────┘    └──────────────┘    └──────┬───────┘  │
│                                                 │           │
│                                                 ▼           │
│                                    ┌──────────────┐         │
│                                    │   Grafana    │         │
│                                    │  Dashboard   │         │
│                                    └──────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) file for details.

---

## 📧 Support

For support, email `support@globalreach.com` or create an issue in the GitHub repository.

---

**GlobalReach V2.0 Enterprise Edition** 🚀

*Built with ❤️ for enterprise email marketing*

---

## Changelog

> Full changelog: [CHANGELOG.md](CHANGELOG.md)

### v2.0.0 (Steady State) — Latest: S134
- **S134**: Batch 5 Quick Wins — DEBT-006 (Certbot pin), DEBT-010 (SMTP_QQ cleanup), DEBT-016 (.env.cdn.example), DEBT-020 (TODO/FIXME cleanup), setex() bug fix, N+1 annotation, README sync
- **S133**: Batch 4 — 16 debts repaid (DEBT-002/004/007-009/011-013/015/023-027), Prometheus tuning, Nginx optimization
- **S132**: Batch 3 — Security hardening (CSP/HSTS/CORS), Docker secrets migration, alertmanager config
- **S131**: Batch 2 — SMTP migration to QQ Mail, Grafana alerting pipeline
- **S130**: Batch 1 — 6 known bugs fixed (email dedup, timezone, template preview, etc.)
- **Post-O Phase**: AIOps readiness, full-stack monitoring (13 containers), runbooks RB-001~008
- **Phase O**: Operations Hardening — backup automation, log rotation, health checks

### v1.0.0
- Initial release
- Core email functionality
- Basic analytics
- User authentication