# GlobalReach Production Deployment Checklist

> **Version**: 2.0 | **Date**: 2026-06-04

---

## 📋 Pre-Deployment Checklist

### 1. Infrastructure
- [ ] Server provisioned (Ubuntu 22.04 LTS recommended)
- [ ] SSH access configured
- [ ] Firewall rules configured (ports 80, 443, 22 open)
- [ ] DNS records pointing to server IP

### 2. Environment Configuration
- [ ] `.env.prod` file created with all required variables
- [ ] Database credentials configured
- [ ] JWT secret generated (min 32 characters)
- [ ] CSRF secret generated
- [ ] SendGrid API key configured
- [ ] Firebase credentials (for push notifications)
- [ ] APN credentials (for iOS push notifications)

### 3. SSL Certificate
- [ ] Let's Encrypt certificate obtained
- [ ] Certbot installed
- [ ] Automatic renewal configured

### 4. Docker Configuration
- [ ] Docker installed
- [ ] Docker Compose installed
- [ ] `docker-compose.prod.yml` configured
- [ ] Nginx production config in place

### 5. Security
- [ ] SSH key-based authentication only
- [ ] Root login disabled
- [ ] Fail2ban configured
- [ ] Regular security updates scheduled

### 6. Monitoring
- [ ] Prometheus configured
- [ ] Grafana dashboards set up
- [ ] Alerting rules configured
- [ ] Log aggregation configured

### 7. Database
- [ ] PostgreSQL 15+ installed
- [ ] Database created
- [ ] User created with appropriate permissions
- [ ] Connection pooling configured

---

## 🚀 Deployment Steps

### Step 1: Clone Repository
```bash
git clone https://github.com/globalreach/globalreach.git
cd globalreach
git checkout v2.0.0
```

### Step 2: Configure Environment
```bash
cp .env.example .env.prod
# Edit .env.prod with production values
nano .env.prod
```

### Step 3: Obtain SSL Certificate
```bash
sudo certbot certonly --webroot -w /var/www/certbot -d api.globalreach.com
```

### Step 4: Deploy
```bash
chmod +x scripts/deploy-prod.sh
./scripts/deploy-prod.sh
```

### Step 5: Verify Deployment
```bash
./scripts/health-check.sh
```

---

## ✅ Post-Deployment Verification

### API Verification
- [ ] `GET /api/v1/health` returns 200 OK
- [ ] `GET /api/v1/auth/me` works with valid token
- [ ] `GET /api/v1/docs` serves Swagger UI

### Frontend Verification
- [ ] Frontend loads correctly at https://api.globalreach.com
- [ ] Login page works
- [ ] Dashboard loads correctly

### Security Verification
- [ ] HTTPS is enforced (HTTP redirects to HTTPS)
- [ ] HSTS headers present
- [ ] Security headers present (X-Frame-Options, X-XSS-Protection, etc.)
- [ ] TLS 1.2/1.3 only

### Performance Verification
- [ ] Response times under 500ms
- [ ] Database connection pool healthy
- [ ] Redis caching working

---

## 🚨 Rollback Procedure

### In case of deployment failure:
1. Stop current services:
   ```bash
   docker-compose -f docker-compose.prod.yml down
   ```

2. Revert to previous version:
   ```bash
   git checkout v1.9.0
   ```

3. Restart services:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

4. Verify rollback:
   ```bash
   ./scripts/health-check.sh
   ```

---

## 📊 Monitoring Dashboard

### Key Metrics to Monitor
- API response time
- Database query performance
- Memory usage
- CPU usage
- Request rate
- Error rate
- Email delivery rate
- Open/click/conversion rates

### Alert Thresholds
- API response time > 2s → Warning
- API response time > 5s → Critical
- Error rate > 5% → Warning
- Error rate > 10% → Critical
- Memory usage > 80% → Warning
- Memory usage > 90% → Critical

---

## 📝 Maintenance Schedule

| Task | Frequency | Owner |
|------|-----------|-------|
| Security updates | Weekly | DevOps |
| Log rotation check | Daily | DevOps |
| Database backup | Daily | DevOps |
| SSL certificate renewal | Monthly | DevOps |
| Performance review | Monthly | Dev Team |
| Security audit | Quarterly | Security Team |

---

## 🔧 Troubleshooting Guide

### Common Issues

**Issue**: API not responding
- Check Docker logs: `docker-compose -f docker-compose.prod.yml logs api`
- Verify database connection
- Check environment variables

**Issue**: SSL certificate not working
- Verify certbot installation
- Check certificate paths in nginx config
- Verify DNS records

**Issue**: Frontend not loading
- Check Nginx logs
- Verify frontend container is running
- Check CDN caching

**Issue**: Email delivery failing
- Check SendGrid API key
- Verify email account status
- Check rate limits

---

## 📞 Emergency Contacts

| Role | Contact |
|------|---------|
| DevOps | ops@globalreach.com |
| Development | dev@globalreach.com |
| Security | security@globalreach.com |
| Support | support@globalreach.com |

---

## ✅ Deployment Sign-Off

| Role | Name | Date |
|------|------|------|
| Developer | | |
| DevOps | | |
| QA | | |
| Security | | |

---

*Document Version: 2.0*
*Last Updated: 2026-06-04*