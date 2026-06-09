#!/bin/bash
# Pre-commit secret scanning using gitleaks
# Exit 1 if secrets detected, blocking the commit
set -euo pipefail

# Check if gitleaks is installed
if ! command -v gitleaks &> /dev/null; then
    echo "[WARN] gitleaks not installed. Run: go install github.com/gitleaks/gitleaks/v8/cmd/gitleaks@latest"
    exit 0  # Don't block if not installed
fi

# Get list of staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
    exit 0
fi

# Run gitleaks on staged files
if ! echo "$STAGED_FILES" | xargs gitleaks protect --verbose --config .gitleaks.toml -f csv 2>&1; then
    echo ""
    echo "❌ SECRETS DETECTED in staged files! Commit blocked."
    echo "Review findings above. If false positive, add to .gitleaks.toml allowlist."
    exit 1
fi

echo "✅ No secrets detected in staged files."
exit 0
