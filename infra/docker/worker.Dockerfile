# Worker image: Node worker agent + pinned nsjail + read-only per-language rootfs.
# Build context: repository root.

ARG NSJAIL_VERSION=3.4

# ---- nsjail, built from a pinned release tag ----
FROM debian:bookworm-slim AS nsjail
ARG NSJAIL_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends \
      autoconf bison flex gcc g++ git make pkg-config ca-certificates \
      libprotobuf-dev libnl-route-3-dev libtool protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${NSJAIL_VERSION} https://github.com/google/nsjail.git /src \
    && cd /src && make -j"$(nproc)" && cp nsjail /usr/local/bin/nsjail \
    && cp config.proto /usr/local/share/nsjail-config.proto

# ---- per-language rootfs ----
FROM python:3.12-slim AS rootfs-python
COPY infra/rootfs/strip-rootfs.sh /strip.sh
RUN sh /strip.sh && rm /strip.sh

FROM node:20-slim AS rootfs-node
COPY infra/rootfs/strip-rootfs.sh /strip.sh
RUN sh /strip.sh && rm /strip.sh

FROM gcc:13 AS rootfs-gcc
COPY infra/rootfs/strip-rootfs.sh /strip.sh
RUN sh /strip.sh && rm /strip.sh

# ---- worker ----
FROM node:20-bookworm-slim
ARG NSJAIL_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends \
      libprotobuf32 libnl-route-3-200 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=nsjail /usr/local/bin/nsjail /usr/local/bin/nsjail
COPY --from=nsjail /usr/local/share/nsjail-config.proto /usr/local/share/nsjail-config.proto
RUN echo "${NSJAIL_VERSION}" > /usr/local/share/nsjail.version

COPY --from=rootfs-python / /opt/sandbox/rootfs/python
COPY --from=rootfs-node / /opt/sandbox/rootfs/node
COPY --from=rootfs-gcc / /opt/sandbox/rootfs/gcc

RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile --filter "@engine/worker..." --filter .
COPY packages packages
COPY apps/worker apps/worker
COPY infra/nsjail infra/nsjail
COPY vitest.workspace.ts ./

ENV SANDBOX_SECCOMP_DIR=/app/infra/nsjail/seccomp
RUN mkdir -p /var/lib/worker/runs && chmod 0711 /var/lib/worker/runs
CMD ["pnpm", "--filter", "@engine/worker", "start"]
