#!/bin/sh
# GCE startup script: installs Docker and runs the faucet + Caddy. Runs on every boot; safe to re-run.
set -e
md() { curl -fsS -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
[ -f /swapfile ] || { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile; }
swapon /swapfile 2>/dev/null || true
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
mkdir -p /opt/zcash-faucet && cd /opt/zcash-faucet
curl -fsSLo docker-compose.yml https://raw.githubusercontent.com/anukulpandey/zcash-faucet/main/deploy/docker-compose.yml
cat > .env <<ENV
DOMAIN=$(md DOMAIN)
GITHUB_CLIENT_ID=$(md GITHUB_CLIENT_ID)
GITHUB_CLIENT_SECRET=$(md GITHUB_CLIENT_SECRET)
ENV
docker compose pull && docker compose up -d
