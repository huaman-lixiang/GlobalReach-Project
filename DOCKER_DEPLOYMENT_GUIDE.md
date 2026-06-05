# GlobalReach V2.0 - Docker Deployment Guide

## 📋 Prerequisites

Before deploying GlobalReach V2.0 with Docker, ensure you have:

- **Docker Engine** v20.10+
- **Docker Compose** v2.0+
- **Git** (for cloning the repository)
- **Minimum Resources**: 2 CPU cores, 4GB RAM, 20GB disk space

## 🚀 Quick Start (5 Minutes)

### 1. Clone and Configure

```bash
git clone <your-repo-url>
cd GlobalReach-Project

# Copy environment template
cp .env.example .env

# Edit configuration (IMPORTANT!)
nano .env
```

### 2. Generate SSL Certificates (Optional but Recommended)

For production HTTPS deployment:

```bash
# Create SSL directory
mkdir -p ssl

# Generate self-signed certificate (for development/testing)
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout ssl/key.pem \
  -out ssl/cert.pem \
  -subj "/C=CN/ST=Beijing/L=Beijing/O=GlobalReach/CN=localhost"
```

**For production**: Use Let's Encrypt or your CA's certificates.

### 3. Build and Start Services

```bash
# Build Docker images
docker-compose build

# Start all services in background
docker-compose up -d

# View logs
docker-compose logs -f
```

### 4. Verify Deployment

```bash
# Check all containers are running
docker ps --filter "name=globalreach"

# Run health check script
./scripts/health-check.sh          # Linux/Mac
powershell scripts\health-check.ps1 # Windows
```

## 🔧 Configuration Guide

### Environment Variables (.env)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | `production` | No |
| `API_PORT` | API server port | `3000` | No |
| `JWT_SECRET` | JWT signing secret | *(change in production!)* | **Yes** |
| `DB_PATH` | SQLite database path | `/app/data/globalreach.db` | No |
| `CORS_ORIGIN` | Allowed CORS origins | `*` | Recommended |
| `NGINX_HTTP_PORT` | HTTP port for Nginx | `80` | No |
| `NGINX_HTTPS_PORT` | HTTPS port for Nginx | `443` | No |

### Security Best Practices

⚠️ **CRITICAL**: Before production deployment:

1. **Change JWT_SECRET** to a strong random string (min 32 characters):
   ```bash
   openssl rand -base64 32
   ```

2. **Update CORS_ORIGIN** to your actual domain:
   ```
   CORS_ORIGIN=https://yourdomain.com
   ```

3. **Use real SSL certificates** (not self-signed)

4. **Configure firewall rules**:
   - Allow: 80 (HTTP), 443 (HTTPS)
   - Deny: 3000 (direct API access)

## 📦 Service Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│    Nginx    │────▶│ API Gateway │
│  (Browser)  │◀────│  (Reverse   │◀────│  (Express)  │
└─────────────┘     │   Proxy)    │     └──────┬──────┘
                    └─────────────┘            │
                                               ▼
                                        ┌─────────────┐
                                        │   SQLite DB │
                                        │  (Volume)   │
                                        └─────────────┘
```

### Container Details

#### api (GlobalReach API)
- **Base Image**: Node.js 20 Alpine
- **Port**: 3000 (internal only)
- **Health Check**: `/api/health`
- **Resource Limits**: 1 CPU / 512MB RAM
- **Data Persistence**: `/app/data` volume

#### nginx (Reverse Proxy)
- **Base Image**: Nginx Alpine
- **Ports**: 80 (HTTP), 443 (HTTPS)
- **Features**:
  - SSL/TLS termination
  - Gzip compression
  - Rate limiting ready
  - Security headers (HSTS, XSS protection)

## 🛠️ Common Operations

### Starting/Stopping

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart with rebuild
docker-compose up -d --build
```

### Monitoring

```bash
# View real-time logs
docker-compose logs -f api
docker-compose logs -f nginx

# Check container stats
docker stats globalreach-api globalreach-nginx

# Execute command inside container
docker exec -it globalreach-api sh
```

### Database Management

```bash
# Access database file (backup)
docker cp globalreach-api:/app/data/globalreach.db ./backup.db

# Restore database
docker cp ./backup.db globalreach-api:/app/data/globalreach.db

# Restart to apply changes
docker-compose restart api
```

### Updates

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## 🔒 Production Hardening Checklist

- [ ] Change default passwords and secrets
- [ ] Install valid SSL certificate
- [ ] Configure firewall (only expose 80/443)
- [ ] Set up log rotation (included by default)
- [ ] Enable automatic security updates
- [ ] Configure backup strategy for database
- [ ] Set up monitoring alerts (e.g., UptimeRobot)
- [ ] Review and adjust resource limits
- [ ] Enable Docker Content Trust (DCT)
- [ ] Use non-root user in containers (already configured!)

## 🚨 Troubleshooting

### Port Already in Use

```bash
# Check what's using the port
netstat -tulpn | :80

# Change port in .env
NGINX_HTTP_PORT=8080
```

### Permission Denied (Linux)

```bash
# Fix directory permissions
sudo chown -R $USER:$USER .
sudo chmod +x scripts/*.sh
```

### Database Locked

```bash
# Restart API service (releases locks)
docker-compose restart api
```

### Health Check Failing

```bash
# Check container logs
docker-compose logs api --tail=100

# Verify API is responding
curl http://localhost:3000/api/health
```

## 📊 Performance Tuning

### For High Traffic (>1000 req/min)

1. **Increase worker connections** in `nginx/nginx.conf`:
   ```nginx
   worker_connections 4096;
   ```

2. **Scale API instances**:
   ```bash
   docker-compose up -d --scale api=3
   ```

3. **Add Redis caching** (future enhancement)

4. **Use PostgreSQL instead of SQLite** for better concurrency

## 📞 Support

- **Documentation**: See `/api-docs` when running
- **Issues**: Check GitHub Issues
- **Logs**: Always check `docker-compose logs` first!

---

**Last Updated**: 2026-06-02  
**Version**: GlobalReach V2.0 Enterprise  
**Maintained by**: GlobalReach Team
