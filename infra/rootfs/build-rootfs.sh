#!/usr/bin/env bash
# Build a read-only sandbox rootfs for one language on a worker VM:
#   docker build -> docker export -> unpack to /opt/sandbox/rootfs/<name>
# Usage: sudo infra/rootfs/build-rootfs.sh python|node|gcc [dest-root]
set -euo pipefail

name="${1:?usage: build-rootfs.sh python|node|gcc [dest-root]}"
dest_root="${2:-/opt/sandbox/rootfs}"
here="$(cd "$(dirname "$0")" && pwd)"

case "$name" in
  python) base="python:3.12-slim" ;;
  node) base="node:20-slim" ;;
  gcc) base="gcc:13" ;;
  *) echo "unknown rootfs: $name" >&2; exit 1 ;;
esac

tag="sandbox-rootfs-${name}:build"
docker build -t "$tag" --build-arg BASE="$base" -f "$here/rootfs.Dockerfile" "$here"
cid="$(docker create "$tag")"
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT

tmp="$(mktemp -d)"
docker export "$cid" | tar -C "$tmp" -xf -
rm -rf "${dest_root:?}/${name}.new"
mkdir -p "$dest_root"
mv "$tmp" "$dest_root/${name}.new"
chown -R root:root "$dest_root/${name}.new"
chmod 0755 "$dest_root/${name}.new"
# atomic-ish swap so running sandboxes keep the old tree until they finish
if [ -d "$dest_root/$name" ]; then mv "$dest_root/$name" "$dest_root/${name}.old"; fi
mv "$dest_root/${name}.new" "$dest_root/$name"
rm -rf "$dest_root/${name}.old"
echo "rootfs $name ready at $dest_root/$name"
