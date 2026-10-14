# syntax=docker/dockerfile:1
# Build context: REPO ROOT.  docker build -f apps/bot/Dockerfile .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY packages packages
COPY apps/web apps/web
COPY apps/bot apps/bot
RUN pnpm --filter @celeste/shared build \
 && pnpm --filter @celeste/web build \
 && pnpm --filter @celeste/bot build
# Prune to production dependencies only (workspace deps are copied in, not symlinked).
RUN pnpm --filter @celeste/bot --prod deploy --legacy /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    WEB_STATIC_DIR=/app/web \
    WEB_PORT=8080 \
    METRICS_PORT=9090
WORKDIR /app/bot
COPY --from=build --chown=node:node /out/ ./
COPY --from=build --chown=node:node /repo/apps/web/dist /app/web
USER node
EXPOSE 8080 9090
CMD ["node", "dist/index.js"]
