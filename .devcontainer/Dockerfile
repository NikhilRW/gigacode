# Expo SDK 57 requires Node >=22.13; backend images keep their own Node version.
# Tool versions are explicit; image tags and upstream apt packages are not digest-locked.
FROM oven/bun:1.3.13 AS bun
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx
