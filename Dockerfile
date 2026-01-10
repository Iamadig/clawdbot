
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
RUN curl -L https://github.com/steipete/gog/releases/latest/download/gog_Linux_x86_64.tar.gz -o /tmp/gog.tar.gz && \
    tar -xzf /tmp/gog.tar.gz -C /usr/local/bin && \
    chmod +x /usr/local/bin/gog && \
    rm /tmp/gog.tar.gz

# GOPLACES
RUN curl -L https://github.com/steipete/goplaces/releases/latest/download/goplaces_Linux_x86_64.tar.gz -o /tmp/goplaces.tar.gz && \
    tar -xzf /tmp/goplaces.tar.gz -C /usr/local/bin && \
    chmod +x /usr/local/bin/goplaces && \
    rm /tmp/goplaces.tar.gz

# WACLI
RUN curl -L https://github.com/steipete/wacli/releases/latest/download/wacli_Linux_x86_64.tar.gz -o /tmp/wacli.tar.gz && \
    tar -xzf /tmp/wacli.tar.gz -C /usr/local/bin && \
    chmod +x /usr/local/bin/wacli && \
    rm /tmp/wacli.tar.gz

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
