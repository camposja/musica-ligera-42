# Single Debian base for both stages — keeps better-sqlite3's native binding
# compiled against the same glibc the runtime uses. Don't switch to Alpine here.
# Node 22.14+ ships an updated corepack signing key; older 22.x fails to verify
# pnpm's signature and exits with `Cannot find matching keyid`.
ARG NODE_VERSION=22.14.0
ARG PNPM_VERSION=10.33.2
ARG PRISMA_VERSION=7.8.0
ARG YTDLP_VERSION=2026.03.17

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# --- builder ----------------------------------------------------------------
# Installs build deps (node-gyp needs python + g++), restores deps, generates
# Prisma client, runs `next build` (emits .next/standalone thanks to
# next.config.ts: output: "standalone").
FROM base AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Install deps with the lockfile only first → maximizes Docker layer cache
# when only source changes.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# Build-time DATABASE_URL is just a placeholder so prisma.config.ts validates;
# `prisma generate` emits client types without touching a DB. The runtime
# DATABASE_URL is set via Fly's [env] block (see fly.toml).
ENV DATABASE_URL=file:./build-placeholder.db
RUN pnpm prisma generate && pnpm build

# --- runner -----------------------------------------------------------------
# Same base as builder for native-binding ABI compatibility. Adds yt-dlp
# (standalone binary, pinned), sqlite3 CLI for SSH smoke tests, and a global
# Prisma CLI install for the entrypoint's `prisma migrate deploy` step.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

ARG YTDLP_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl sqlite3 python3 \
    && curl -L -o /usr/local/bin/yt-dlp \
        https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Standalone server bundle already includes @prisma/client (with the generated
# client) and better-sqlite3 (with the compiled native binding). No need to
# copy individual node_modules sub-trees — Next standalone traces them.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Schema + migrations are read at runtime by `prisma migrate deploy`.
COPY --from=builder /app/prisma ./prisma
# Prisma 7's runtime CLI looks for `prisma.config.ts` at the project root.
# Without this, `prisma migrate deploy` fails with "datasource.url property
# is required in your Prisma config file".
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json

# Prisma CLI installed in an isolated dir (NOT inside /app/node_modules — npm
# 10.x trips over pnpm's symlink-heavy node_modules with `Cannot read
# properties of null`). NODE_PATH below points imports at this dir so
# `prisma.config.ts` can resolve `prisma/config` at boot time.
ARG PRISMA_VERSION
RUN mkdir -p /opt/prisma-cli \
    && cd /opt/prisma-cli \
    && npm init -y > /dev/null \
    && npm install --no-save prisma@${PRISMA_VERSION} \
    && npm cache clean --force
ENV NODE_PATH=/opt/prisma-cli/node_modules
ENV PATH="/opt/prisma-cli/node_modules/.bin:$PATH"

COPY bin/docker-entrypoint /usr/local/bin/docker-entrypoint
RUN chmod +x /usr/local/bin/docker-entrypoint

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint"]
CMD ["node", "server.js"]
