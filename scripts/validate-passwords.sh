#!/bin/bash
# Validate that no default/weak passwords are in use
# DEBT-004: PostgreSQL default password enforcement
set -euo pipefail

ERRORS=0

# Check .env.prod for weak passwords (if exists)
if [ -f .env.prod ]; then
    if grep -qE '(changeme|password|123456|admin|default)\s*=' .env.prod; then
        echo "❌ WEAK PASSWORD DETECTED in .env.prod"
        grep -E '(changeme|password|123456|admin|default)\s*=' .env.prod
        ERRORS=$((ERRORS+1))
    fi
    
    # Check POSTGRES_PASSWORD is not changeme
    PG_PASS=$(grep '^POSTGRES_PASSWORD=' .env.prod 2>/dev/null | cut -d= -f2-)
    if [ "$PG_PASS" = "changeme" ]; then
        echo "❌ POSTGRES_PASSWORD is still 'changeme'!"
        ERRORS=$((ERRORS+1))
    fi
fi

# Check docker-compose for remaining defaults
if grep -q 'changeme' docker-compose.prod.yml; then
    echo "⚠️  'changeme' still found in docker-compose.prod.yml (should only be in comments)"
    grep -n 'changeme' docker-compose.prod.yml
fi

if [ $ERRORS -gt 0 ]; then
    echo ""
    echo "💥 Password validation FAILED with $ERRORS error(s)"
    exit 1
else
    echo "✅ Password validation PASSED"
    exit 0
fi
