# Build context: repository root.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo

# Manifests first for layer caching. All workspace manifests are copied so the frozen lockfile matches.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile --filter "@engine/web..."

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @engine/web build

FROM nginx:1.27-alpine
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
