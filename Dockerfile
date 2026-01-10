FROM node:22-bookworm

# Install basic tools + socat + chromium (for Browser tool)
RUN apt-get update && apt-get install -y curl socat chromium && rm -rf /var/lib/apt/lists/*


# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG CLAWDBOT_DOCKER_APT_PACKAGES=""
RUN if [ -n "$CLAWDBOT_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $CLAWDBOT_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV CLAWDBOT_PREFER_PNPM=1
RUN pnpm ui:install
RUN pnpm ui:build

# [Custom Binaries]
# GOG
RUN curl -L https://github.com/steipete/gogcli/releases/download/v0.5.4/gogcli_0.5.4_linux_amd64.tar.gz -o /tmp/gog.tar.gz && \
    tar -xzf /tmp/gog.tar.gz -C /usr/local/bin && \
    mv /usr/local/bin/gogcli /usr/local/bin/gog && \
    chmod +x /usr/local/bin/gog && \
    rm /tmp/gog.tar.gz

# GOPLACES
RUN curl -L https://github.com/steipete/goplaces/releases/download/v0.2.0/goplaces_0.2.0_linux_amd64.tar.gz -o /tmp/goplaces.tar.gz && \
    tar -xzf /tmp/goplaces.tar.gz -C /usr/local/bin && \
    chmod +x /usr/local/bin/goplaces && \
    rm /tmp/goplaces.tar.gz

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
