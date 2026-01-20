#!/bin/bash
# Syncs "User Space" content (Skills) from the VPS back to your local repo.
# Usage: ./sync-from-vps.sh [skill_name]
# Example: ./sync-from-vps.sh crypto-price

VPS_HOST="root@65.108.48.234"
VPS_PATH="/root/clawd"
LOCAL_SKILLS_DIR="./skills"

if [ -z "$1" ]; then
    echo "Usage: $0 <skill_name>"
    echo "Example: $0 my-new-skill"
    echo ""
    echo "Available skills on VPS:"
    ssh -i ~/.ssh/hetzner_worker $VPS_HOST "ls $VPS_PATH/skills"
    exit 1
fi

SKILL_NAME="$1"

echo "Downloading skill '$SKILL_NAME' from VPS..."

# Ensure local dir exists
mkdir -p "$LOCAL_SKILLS_DIR"

# SCP the folder
scp -r -i ~/.ssh/hetzner_worker "$VPS_HOST:$VPS_PATH/skills/$SKILL_NAME" "$LOCAL_SKILLS_DIR/"

if [ $? -eq 0 ]; then
    echo "✅ Skill '$SKILL_NAME' synced to $LOCAL_SKILLS_DIR/$SKILL_NAME"
    echo "You can now git add/commit this skill."
else
    echo "❌ Failed to sync skill."
    exit 1
fi
