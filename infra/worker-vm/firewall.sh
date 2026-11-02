#!/usr/bin/env bash
# Worker VM egress policy (IPv4; IPv6 is disabled in setup.sh).
# - No inbound except established traffic (no listening services).
# - Agent outbound only to Postgres, Redis and S3, plus DNS/NTP.
# - Instance metadata (169.254.169.254) reachable only by root (the worker agent), never by
#   sandbox uids (200000+). Offline runs also have an empty network namespace.
#   Explicit online runs temporarily prepend RunEgress's per-UID public-destination rules.
# Usage: firewall.sh <postgres-cidr> <redis-cidr> <s3-cidr-or-vpc-endpoint-cidr>
set -euo pipefail
PG="${1:?postgres cidr}" REDIS="${2:?redis cidr}" S3="${3:?s3 cidr}"

iptables -F
iptables -X
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# metadata: only uid 0, everything else rejected
iptables -A OUTPUT -d 169.254.169.254 -m owner --uid-owner 0 -j ACCEPT
iptables -A OUTPUT -d 169.254.169.254 -j REJECT
# Default deny for sandbox UIDs; online runs install their scoped guard ahead of this.
iptables -A OUTPUT -m owner --uid-owner 199999-299999 -j REJECT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p udp --dport 123 -j ACCEPT
iptables -A OUTPUT -p tcp -d "$PG" --dport 5432 -j ACCEPT
iptables -A OUTPUT -p tcp -d "$REDIS" --dport 6379 -j ACCEPT
iptables -A OUTPUT -p tcp -d "$S3" --dport 443 -j ACCEPT
iptables -A OUTPUT -j REJECT
