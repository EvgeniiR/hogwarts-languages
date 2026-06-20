#!/bin/bash
# ── Hogwarts Español Worker deploy guard ─────────────────────────────────────
# Validates required Cloudflare Worker secrets before deploying.
# Usage: bash scripts/deploy-worker.sh
set -euo pipefail
cd "$(dirname "$0")/../worker"

REQUIRED_SECRETS=(JWT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET)
REQUIRED_VARS=(ALLOWED_ORIGIN)

echo "🔍 Checking Worker required secrets..."
SECRETS=$(npx wrangler secret list --format json 2>/dev/null)

for name in "${REQUIRED_SECRETS[@]}"; do
  if echo "$SECRETS" | grep -q "\"$name\""; then
    echo "   ✅ $name"
  else
    echo "   ❌ $name — missing. Run: npx wrangler secret put $name"
    exit 1
  fi
done

echo "🔍 Checking wrangler.toml [vars]..."
for name in "${REQUIRED_VARS[@]}"; do
  val=$(grep "$name" wrangler.toml | grep -o '"[^"]*"' | tr -d '"' | head -1)
  if [ -n "$val" ]; then
    echo "   ✅ $name = $val"
  else
    echo "   ❌ $name is empty or missing in wrangler.toml [vars]"
    exit 1
  fi
done

echo "🚀 All checks passed. Deploying Worker..."
npx wrangler deploy
