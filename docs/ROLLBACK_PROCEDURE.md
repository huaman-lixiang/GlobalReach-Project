# GlobalReach V2.0 — Rollback Procedure Document
# S079: Production Readiness Assessment
# Version: 1.0.0 | Date: 2026-06-05

---

## 1. Rollback Scenarios & Procedures

### Scenario A: API Container Crash / Failed Deployment
**Severity**: HIGH | **Recovery Time**: < 2 min

```powershell
# Step 1: Check current status
docker ps --filter "name=globalreach" --format "{{.Names}}: {{.Status}}"

# Step 2: If API container is unhealthy/not running
cd C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project
docker compose -f docker-compose.prod.yml restart api

# Step 3: Verify recovery (wait 30s then check)
Start-Sleep 30
curl.exe http://localhost:3000/api/v1/health

# Step 4: If restart fails, recreate from last known good image
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

### Scenario B: Bad Code Push (CI/CD Deployed Broken Version)
**Severity**: CRITICAL | **Recovery Time**: < 5 min

```powershell
# Step 1: Identify last known good commit
git log --oneline -10
# Find the commit BEFORE the broken one

# Step 2: Revert to previous version locally
git revert HEAD   # OR: git reset --hard <good-commit-sha>

# Step 3: Push fix
git push origin main

# Step 4: CI/CD will auto-deploy the fixed version
# Monitor: https://github.com/huaman-lixiang/GlobalReach-Project/actions
```

### Scenario C: Nginx SSL Configuration Breaks HTTPS
**Severity**: CRITICAL | **Recovery Time**: < 3 min

```powershell
# Step 1: Restore nginx config from backup
cp backups/config_YYYYMMDD_HHMMSS.zip ./nginx-config-backup.zip
Expand-Archive ./nginx-config-backup.zip -DestinationPath ./nginx-restore -Force

# Step 2: Recreate nginx with known-good config
docker compose -f docker-compose.prod.yml up -d --force-recreate nginx

# Step 3: Verify HTTPS
curl.exe -skI https://api.globalreach.com/api/v1/health
```

### Scenario D: Database Corruption
**Severity**: CRITICAL | **Recovery Time**: < 15 min

```powershell
# Step 1: Stop all services that depend on DB
docker compose -f docker-compose.prod.yml stop api

# Step 2: Restore from latest backup
cat backups/pg_globalreach_YYYYMMDD_HHMMSS.sql |
  docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod

# Step 3: Restart services
docker compose -f docker-compose.prod.yml start api

# Step 4: Verify data integrity
curl.exe http://localhost:3000/api/v1/health
```

### Scenario E: Full System Recovery (Disaster Recovery)
**Severity**: DISASTER | **Recovery Time**: < 30 min

```powershell
# Prerequisites: Fresh Docker installation on same or new machine

# Step 1: Clone repository
git clone https://github.com/huaman-lixiang/GlobalReach-Project.git
cd GlobalReach-Project

# Step 2: Configure environment variables
Copy-Item .env.example .env  # Edit with real values

# Step 3: Start all services
docker compose -f docker-compose.prod.yml up -d

# Step 4: Restore database
cat backups/pg_globalreach_LATEST.sql |
  docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod

# Step 5: Restore SSL certificates (from secure backup)
# Copy certs to nginx/ssl/globalreach/

# Step 6: Recreate containers with restored data
docker compose -f docker-compose.prod.yml up -d --force-recreate

# Step 7: Run health checks
curl.exe http://localhost:3000/api/v1/health
curl.exe -sk https://api.globalreach.com/api/v1/health
```

---

## 2. Current Known-Good States

| Component | Current Version | Last Verified | Rollback Target |
|-----------|----------------|---------------|-----------------|
| API Image | `globalreach-project-api:latest` (SHA: b49c998+) | S079 | `b49c998` tag |
| Docker Compose | `docker-compose.prod.yml` vS079 | S079 | Previous commit |
| DB Schema | 11 tables, PostgreSQL 15 | S079 | Latest .sql backup |
| SSL Cert | `*.globalreach.com` → 2031-06-04 | S067 | CA-signed PKI chain |
| Nginx Config | production.conf (TLSv1.3) | S079 | config backup zip |

---

## 3. Emergency Contacts & Escalation

| Role | Contact | Responsibility |
|------|---------|---------------|
| Platform Admin | Local (HW112) | Docker/GitHub access |
| GitHub Repo Owner | huaman-lixiang | Code rollback, Secrets mgmt |
| Network Admin | Internal (113.106.x.x) | Firewall/DNS changes |

---

## 4. Monitoring Dashboards

| Tool | URL | Purpose |
|------|-----|---------|
| Grafana | http://localhost:3002 | Metrics visualization |
| Prometheus | http://localhost:9090 | Metrics collection + alerting |
| API Health | http://localhost:3000/api/v1/health | Service health score |
| GitHub Actions | https://github.com/.../actions | CI/CD pipeline status |

---

*Document Generated: S079 Session*
*Protocol: GLOBALREACH_S036_SELF_EXECUTE_PROTOCOL_v4.0*
