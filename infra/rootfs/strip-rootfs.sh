#!/bin/sh
# Remove package managers, caches and credentials from a runtime image so it can serve as a
# read-only sandbox rootfs. Run inside the language image (Dockerfile RUN) before export.
set -eu

rm -rf \
  /usr/bin/apt* /usr/bin/dpkg* /usr/lib/apt /var/lib/apt /var/lib/dpkg /var/cache/* /etc/apt \
  /usr/local/bin/pip* /usr/local/lib/python3*/site-packages/pip* /usr/local/lib/python3*/ensurepip \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn* \
  /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
  /root/.cache /root/.npm /tmp/* /var/tmp/* /usr/share/doc /usr/share/man

# Mount points nsjail binds onto.
mkdir -p /workspace /tmp /proc /dev
chmod 1777 /tmp
# No credentials or host identity in the rootfs.
: > /etc/hostname 2>/dev/null || true
rm -f /etc/machine-id /etc/ssh/ssh_host_* 2>/dev/null || true
