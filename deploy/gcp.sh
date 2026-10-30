#!/bin/sh
# Creates the faucet VM on Google Cloud's free tier (e2-micro, us-central1) with a static IP.
#   PROJECT=<id> GITHUB_CLIENT_ID=<oauth app id> GITHUB_CLIENT_SECRET=<oauth app secret> sh deploy/gcp.sh
set -e
: "${PROJECT:?}" "${GITHUB_CLIENT_ID:?}" "${GITHUB_CLIENT_SECRET:?}"
R=us-central1 Z=us-central1-a
g() { gcloud --project "$PROJECT" "$@"; }
g services enable compute.googleapis.com
g compute addresses describe zcash-faucet-ip --region $R >/dev/null 2>&1 || g compute addresses create zcash-faucet-ip --region $R
IP=$(g compute addresses describe zcash-faucet-ip --region $R --format='value(address)')
g compute firewall-rules describe zcash-faucet-web >/dev/null 2>&1 || g compute firewall-rules create zcash-faucet-web --allow tcp:80,tcp:443 --target-tags zcash-faucet
g compute instances create zcash-faucet --zone $Z --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-standard \
  --tags zcash-faucet --address "$IP" \
  --metadata "DOMAIN=$IP.sslip.io,GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET" \
  --metadata-from-file startup-script="$(dirname "$0")/startup.sh"
echo "Faucet will be at https://$IP.sslip.io in a few minutes"
echo "Logs: gcloud --project $PROJECT compute ssh zcash-faucet --zone $Z -- sudo docker compose -f /opt/zcash-faucet/docker-compose.yml logs -f faucet"
