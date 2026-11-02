#!/usr/bin/env bash
set -euo pipefail

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) { console.error("Expo SDK 57 requires Node >=22.13"); process.exit(1); }'
node --version
bun --version
docker compose version
node .devcontainer/setup.mjs
printf '\nNo application dependencies installed and no services started. Follow docs/CODESPACES.md.\n'
