#!/usr/bin/env bash
set -euo pipefail

PROXY_PORT="${1:-24861}"

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run this script as root\n' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y dante-server ufw curl

if ! id -u sockd >/dev/null 2>&1; then
  adduser --system --no-create-home --group --disabled-login sockd
fi

IFACE="$(ip route get 1.1.1.1 | awk '{for (i=1; i<=NF; i++) if ($i == "dev") {print $(i+1); exit}}')"

cp /etc/danted.conf "/etc/danted.conf.bak.$(date +%s)" 2>/dev/null || true

cat >/etc/danted.conf <<EOF
logoutput: syslog

internal: 0.0.0.0 port = ${PROXY_PORT}
external: ${IFACE}

user.privileged: root
user.unprivileged: sockd
user.libwrap: sockd

socksmethod: none
clientmethod: none

client pass {
  from: 0.0.0.0/0 to: 0.0.0.0/0
  log: error connect disconnect
}

socks pass {
  from: 0.0.0.0/0 to: 0.0.0.0/0
  command: connect
  log: error connect disconnect
}
EOF

if ufw status | grep -q 'Status: active'; then
  ufw allow "${PROXY_PORT}/tcp"
fi

systemctl enable danted
systemctl restart danted

SERVER_IP="$(curl -4 -s ifconfig.me || true)"

printf '\nDone.\n'
printf 'IP:Port\n'
printf '%s:%s\n' "${SERVER_IP:-SERVER_IP}" "${PROXY_PORT}"
printf 'Test with:\n'
printf 'curl --proxy socks5h://%s:%s https://ifconfig.me\n' "${SERVER_IP:-SERVER_IP}" "${PROXY_PORT}"
