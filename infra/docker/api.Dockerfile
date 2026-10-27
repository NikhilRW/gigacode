# API image (also used for the one-shot migrate/init job). Build context: repository root.
FROM node:20-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile --filter "@engine/api..." --filter .
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/storage packages/storage
COPY apps/api apps/api
COPY scripts scripts
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@engine/api", "start"]
