# Clawdbot VPS Skill Installation Guide

This document outlines the authoritative process for installing new skills on the Clawdbot VPS. This process respects the Git-based deployment workflow and persistence layer.

## 1. Understanding the Architecture

*   **Repository Source**: The VPS runs code from your fork (`Iamadig/clawdbot`), specifically the `custom/prod` branch.
*   **Project Directory**: The main application lives in `/root/clawdbot` on the VPS.
*   **Skill Locations**:
    *   **User/Runtime Skills**: Stored in `/root/clawd/skills` (Host) -> `/home/node/clawd/skills` (Container). These are manually installed or managed by separate agents.
    *   **repo-native Skills**: Stored in `skills/` within the repository. These are built into the Docker image or mounted if running locally.

## 2. Methodology: The "Git Push" Workflow (Recommended)

To install a skill like `nano-banana-pro` or `perplexity` so that it is version-controlled and deployed correctly, follow these steps.

### Step A: Local Preparation
1.  **Switch Branch**: Ensure you are on the `custom/prod` branch locally.
    ```bash
    git checkout custom/prod
    ```
2.  **Add Skill**: Place the new skill folder into the `skills/` directory of the repo.
    ```bash
    mkdir -p skills/<skill_name>
    cp -r /path/to/downloaded/skill/* skills/<skill_name>/
    # Example: cp -r ~/Downloads/perplexity-1.0.0/* skills/perplexity/
    ```
3.  **Commit & Push**:
    ```bash
    git add skills/<skill_name>
    git commit -m "feat: add <skill_name> skill"
    git push fork custom/prod
    ```

### Step B: VPS Deployment
1.  **SSH into VPS**:
    ```bash
    ssh -i ~/.ssh/hetzner_worker root@<VPS_IP>
    ```
2.  **Pull Changes**:
    ```bash
    cd /root/clawdbot
    git pull origin custom/prod   # or 'fork' depending on your remote name
    ```
3.  **Rebuild Container**:
    Since new code was added to the image context (or if we need to bake in new dependencies), rebuild the service.
    ```bash
    docker compose up -d --build
    ```

## 3. Methodology: The "Runtime Persistence" Workflow (Immediate Hotfix)

If you need to install a skill *without* committing it to the repo (e.g., testing a downloaded zip), assume the VPS has a persistent volume mounted at `/root/clawd/skills`.

1.  **Copy Files**: Use `scp` to upload directly to the persistent volume.
    ```bash
    scp -i ~/.ssh/hetzner_worker -r ~/Downloads/<skill-folder> root@<VPS_IP>:/root/clawd/skills/
    ```
2.  **Restart**: Restart the gateway to load the new skill.
    ```bash
    ssh -i ~/.ssh/hetzner_worker root@<VPS_IP> "cd /root/clawdbot && docker compose restart clawdbot-gateway"
    ```

## 4. Environment Variables (API Keys)

Regardless of the installation method, if the skill requires secrets (e.g., `PERPLEXITY_API_KEY`):

1.  **Edit Env File**: On the VPS, edit the `.env` file (usually `/root/clawdbot/.env`).
    ```bash
    nano /root/clawdbot/.env
    # Add: PERPLEXITY_API_KEY=your_key_here
    ```
2.  **Restart**:
    ```bash
    docker compose restart clawdbot-gateway
    ```

## 5. Verification

To verify installation:
1.  Check the logs: `docker logs -f --tail 100 clawdbot-clawdbot-gateway-1`
2.  Look for "Loaded skill: <skill_name>" in the startup sequence.

---
**Current State (Jan 2026):**
*   VPS IP: `65.108.48.234`
*   Active Branch: `custom/prod`
*   Repo: `Iamadig/clawdbot`
