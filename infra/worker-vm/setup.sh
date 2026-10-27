#!/usr/bin/env bash
# Provision a dedicated worker VM (Ubuntu 22.04+/24.04, kernel 5.15+, cgroup v2).
# Run as root from a checkout of this repository at /opt/engine.
# Env: PG_CIDR REDIS_CIDR S3_CIDR  (egress allowlist), plus /etc/engine-worker/env for the agent.
set -euo pipefail
NSJAIL_VERSION=3.4

[ -f /sys/fs/cgroup/cgroup.controllers ] || { echo "cgroup v2 required" >&2; exit 1; }

apt-get update
apt-get install -y --no-install-recommends \
  autoconf bison flex gcc g++ git make pkg-config ca-certificates curl iptables \
  libprotobuf-dev libnl-route-3-dev libtool protobuf-compiler docker.io

# Node 20 + pnpm for the agent
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
corepack enable

# nsjail pinned
rm -rf /tmp/nsjail && git clone --depth 1 --branch "$NSJAIL_VERSION" https://github.com/google/nsjail.git /tmp/nsjail
make -C /tmp/nsjail -j"$(nproc)"
install -m 0755 /tmp/nsjail/nsjail /usr/local/bin/nsjail
echo "$NSJAIL_VERSION" > /usr/local/share/nsjail.version

# rootfs per language (docker is only used here, at provisioning time)
for l in python node gcc; do /opt/engine/infra/rootfs/build-rootfs.sh "$l"; done
systemctl disable --now docker || true

# per-run directories on a capped tmpfs
mkdir -p /var/lib/worker/runs
grep -q /var/lib/worker/runs /etc/fstab || echo 'tmpfs /var/lib/worker/runs tmpfs size=4g,mode=0711 0 0' >> /etc/fstab
mount /var/lib/worker/runs || true

# kernel hardening relevant to sandboxing
cat > /etc/sysctl.d/90-engine-worker.conf <<'EOF'
kernel.unprivileged_bpf_disabled = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
EOF
sysctl --system

# IMDSv2 with hop limit 1 must be set on the instance (cloud API), e.g. on AWS:
#   aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required --http-put-response-hop-limit 1
cat > /etc/systemd/system/engine-worker-firewall.service <<EOF
[Unit]
Description=Worker egress firewall
Before=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/opt/engine/infra/worker-vm/firewall.sh ${PG_CIDR:?} ${REDIS_CIDR:?} ${S3_CIDR:?}
[Install]
WantedBy=multi-user.target
EOF

cd /opt/engine && pnpm install --frozen-lockfile --filter "@engine/worker..." --filter .
install -m 0644 infra/worker-vm/engine-worker.service /etc/systemd/system/engine-worker.service
mkdir -p /etc/engine-worker
[ -f /etc/engine-worker/env ] || { echo "create /etc/engine-worker/env (see .env.example)" >&2; exit 1; }
chmod 0600 /etc/engine-worker/env

systemctl daemon-reload
systemctl enable --now engine-worker-firewall.service engine-worker.service
echo "worker provisioned"
