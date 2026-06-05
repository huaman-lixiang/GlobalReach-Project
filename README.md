# GlobalReach

> **Enterprise Email Marketing Platform**

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
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **PostgreSQL** - Relational database
- **Redis** - Caching and session storage
- **Sequelize** - ORM
- **JWT** - Authentication
- **Prometheus** - Metrics collection
- **Swagger UI** - API documentation

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
| **API Endpoints** | 118 |
| **Unit Tests** | 196 |
| **E2E Tests** | 24+ |
| **Prometheus Metrics** | 18 |
| **Code Coverage** | ~95% |

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

## 📋 Changelog

### v2.0.0
- Complete enterprise feature set
- 118 API endpoints
- 196 unit tests
- Docker containerization
- CI/CD pipeline
- Mobile API integration
- Push notifications (APNs/FCM)
- Advanced analytics
- Team collaboration
- Custom templates
- Data export (CSV/Excel/PDF)

### v1.0.0
- Initial release
- Core email functionality
- Basic analytics
- User authentication