#!/usr/bin/env bash
set -euo pipefail

root="$(realpath "$(dirname "${BASH_SOURCE[0]}")/..")"
if [[ ! -f "$root/.devcontainer/.env.codespaces" ]]; then
  printf 'Missing .devcontainer/.env.codespaces; run node .devcontainer/setup.mjs first.\n' >&2
  exit 1
fi

# Keep all build paths relative to the original Compose file in infra/.
# A separate project name avoids colliding with the root/local Compose stack.
exec docker compose --project-name gigacode-codespaces \
  --project-directory "$root/infra" \
  --env-file "$root/.devcontainer/.env.codespaces" \
  -f "$root/infra/docker-compose.yml" \
  -f "$root/infra/docker-compose.codespaces.yml" "$@"
