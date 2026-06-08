# GlobalReach V2.0 — GitHub Secrets Configuration Guide
# S114/PhaseI: BL-002 Production Secrets Setup
#
# This document describes ALL secrets required for production deployment.
# Configure these in: GitHub Repo → Settings → Secrets and variables → Actions

# ════════════════════════════════════════════════════════════════════
# SECRETS CHECKLIST (6 required + 2 optional)
# ════════════════════════════════════════════════════════════════════

┌────────────────┬─────────────────────────────────┬──────────┬────────┐
│ Secret Name    │ Description                     │ Required │ Example │
├────────────────┼─────────────────────────────────┼──────────┼────────┤
│ PROD_HOST      │ Production server IP or domain   │ YES      │ 1.2.3.4 │
│                │                                 │          │ or     │
│                │                                 │          │ prod.  │
│                │                                 │          │ global-│
│                │                                 │          │ reach. │
│                │                                 │          │ com    │
├────────────────┼─────────────────────────────────┼──────────┼────────┤
│ PROD_USER      │ SSH login username on server     │ YES      │ ubuntu │
│                │                                 │          │ or root│
├────────────────┼─────────────────────────────────┼──────────┼────────┤
│ PROD_SSH_KEY   │ SSH private key (PEM format)     │ YES      │ See    │
│                │ Generate: ssh-keygen -t ed25519  │          │ below  │
│                │ -C "github-actions" -f deploy_key│          │        │
├────────────────┼─────────────────────────────────┼──────────┼────────┤
│ SLACK_WEBHOOK_ │ Slack incoming webhook URL       │ NO       │ https://│
│ URL            │ (for CI/CD notifications)        │          │ hooks. │
│                │                                 │          │ slack. │
│                │                                 │          │ com/...│
├────────────────┼─────────────────────────────────┼──────────┼────────┤
│ SLACK_BOT_TOKEN│ Slack bot token (OAuth)         │ NO       │ xoxb-..│
│                │ (for richer notifications)       │          │        │
└────────────────┴─────────────────────────────────┴──────────┴────────┘

# ════════════════════════════════════════════════════════════════════
# STEP-BY-STEP SETUP INSTRUCTIONS
# ════════════════════════════════════════════════════════════════════

## Step 1: Generate SSH Deploy Key

```bash
# On your local machine (or CI runner):
ssh-keygen -t ed25519 -C "github-actions-globalreach" -f ~/.ssh/globalreach-deploy -N ""
```

This creates two files:
  - `~/.ssh/globalreach-deploy`  ← Private key → PROD_SSH_KEY secret
  - `~/.ssh/globalreach-deploy.pub` ← Public key → Add to server's authorized_keys

## Step 2: Add Public Key to Production Server

```bash
# Copy public key to server:
ssh user@your-server "mkdir -p ~/.ssh && chmod 700 ~/.ssh"
cat ~/.ssh/globalreach-deploy.pub | ssh user@your-server "cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

## Step 3: Configure GitHub Secrets

Go to: https://github.com/huaman-lixiang/GlobalReach-Project/settings/secrets/actions

For each secret, click "New repository secret":

### PROD_HOST
  Name: PROD_HOST
  Value: your-production-server-ip-or-domain
  Example: 203.0.113.50 or prod.globalreach.com

### PROD_USER
  Name: PROD_USER
  Value: your-ssh-username
  Example: ubuntu

### PROD_SSH_KEY
  Name: PROD_SSH_KEY
  Value: (paste ENTIRE contents of ~/.ssh/globalreach-deploy)
  Important: Include -----BEGIN OPENSSH PRIVATE KEY----- through -----END OPENSSH PRIVATE KEY-----

### SLACK_WEBHOOK_URL (optional)
  Name: SLACK_WEBHOOK_URL
  Value: https://hooks.slack.com/services/TXX/BXX/XXX

### SLACK_BOT_TOKEN (optional)
  Name: SLACK_BOT_TOKEN
  Value: xoxb-your-bot-token-here

# ════════════════════════════════════════════════════════════════════
# VERIFICATION
# ════════════════════════════════════════════════════════════════════

After configuring, verify by running a manual workflow dispatch:

1. Go to Actions tab in GitHub
2. Select "CI/CD Pipeline" workflow
3. Click "Run workflow"
4. Check that SSH connection succeeds in logs

Expected success output in workflow:
  ✅ Connected to ${{ secrets.PROD_HOST }} as ${{ secrets.PROD_USER }}
  ✅ Docker Compose deployed successfully
  ✅ Health check passed: HTTP 200

# ════════════════════════════════════════════════════════════════════
# SECURITY REMINDERS
# ════════════════════════════════════════════════════════════════════

⚠️ NEVER commit secrets to the repository!
⚠️ Rotate SSH keys every 90 days
⚠️ Use least-privilege accounts (not root)
⚠️ Restrict IP access via firewall rules
⚠️ Enable GitHub branch protection rules for main
