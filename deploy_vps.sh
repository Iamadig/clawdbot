#!/bin/bash
set -e

VPS_USER="root"
# Replace with your actual VPS IP if needed, or set as env var
VPS_HOST="${CLAWDBOT_VPS_HOST:-65.108.48.234}" 

echo ">>> Deploying Remote Node Configuration to $VPS_HOST..."

echo ">>> Uploading configuration files..."
scp -i ~/.ssh/hetzner_worker -r Dockerfile docker-compose.yml *_config.json vps_setup_script.sh vps_skills "$VPS_USER@$VPS_HOST:/root/clawdbot/"

echo ">>> Updating repo on VPS..."
ssh -i ~/.ssh/hetzner_worker "$VPS_USER@$VPS_HOST" "cd /root/clawdbot && if [ -d .git ]; then git fetch origin && git checkout custom/prod && git pull --rebase origin main; else echo 'No git repo found at /root/clawdbot'; fi"

echo ">>> Executing setup on VPS..."
ssh -i ~/.ssh/hetzner_worker "$VPS_USER@$VPS_HOST" "chmod +x /root/clawdbot/vps_setup_script.sh && /root/clawdbot/vps_setup_script.sh"

echo ">>> Deployment script finished."
