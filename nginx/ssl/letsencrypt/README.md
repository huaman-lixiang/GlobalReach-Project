# S101/PhaseH: Let's Encrypt Certificate Management
# ===================================================
# This directory stores live certificates issued by Let's Encrypt.
#
# STRUCTURE:
#   letsencrypt/live/globalreach.com/
#     ├── fullchain.pem    → Nginx ssl_certificate
#     ├── privkey.pem      → Nginx ssl_certificate_key
#     ├── chain.pem        → Intermediate CA (optional)
#     └── cert.pem         → Leaf certificate only
#
# RENEWAL:
#   Certificates auto-renew via cron/systemd timer.
#   See: scripts/renew-ssl-certs.sh
#
# MIGRATION (Self-signed → LE):
#   1. Ensure DNS A records point to this server's public IP
#   2. Run: docker compose -f docker-compose.prod.yml run --rm certbot certonly ...
#   3. Update nginx/conf.d/production.conf to use /etc/nginx/ssl/le/ paths
#   4. Reload Nginx: docker exec globalreach-nginx-prod nginx -s reload
#
# STAGING (Testing):
#   Use --staging flag to test without hitting rate limits:
#   docker compose run --rm certbot certonly --staging ...
#
