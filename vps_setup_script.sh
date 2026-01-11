#!/bin/bash
set -e
cd /root/clawdbot

echo ">>> Installing Dependencies on VPS..."
apt-get update && apt-get install -y jq curl socat

# Install Tailscale if not present
if ! command -v tailscale >/dev/null; then
    echo ">>> Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh
    echo ">>> Starting Tailscale..."
    sudo tailscale up
else
    echo ">>> Tailscale already installed."
fi

# Install Skills
echo ">>> Installing proxy skills..."
mkdir -p /root/.clawdbot/skills
if [ -d "/root/clawdbot/vps_skills" ]; then
    cp -r /root/clawdbot/vps_skills/* /root/.clawdbot/skills/
    chmod +x /root/.clawdbot/skills/*/run
    echo ">>> Proxy skills installed."
else
    echo ">>> No vps_skills directory found, skipping skill install."
fi

echo ">>> Updating Clawdbot Configuration..."
CONFIG_FILE="/root/.clawdbot/clawdbot.json"
# Merge any config files found in the directory
for config_file in *_config.json; do
    if [ -f "$config_file" ]; then
        echo ">>> Merging configuration from $config_file..."
        jq -s '.[0] * .[1]' "$CONFIG_FILE" "$config_file" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    fi
done

echo ">>> Rebuilding Containers..."
cd /root/clawdbot
docker compose down
docker compose up --build -d

echo ">>> Deployment Complete!"
echo ">>> Remember to authenticate Tailscale if requested above."
