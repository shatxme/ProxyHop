#!/usr/bin/env bash
set -euo pipefail

PROXY_PORT="${1:-24861}"

OS_ID=""
OS_LIKE=""
PKG_MANAGER=""
DANTE_SERVICE=""
DANTE_CONFIG=""

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run this script as root\n' >&2
  exit 1
fi

detect_os() {
  if [[ ! -f /etc/os-release ]]; then
    printf 'Unsupported OS: missing /etc/os-release\n' >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release

  OS_ID="${ID:-}"
  OS_LIKE="${ID_LIKE:-}"

  case "${OS_ID}:${OS_LIKE}" in
    ubuntu:*|debian:*|*:debian*)
      PKG_MANAGER="apt"
      DANTE_SERVICE="danted"
      DANTE_CONFIG="/etc/danted.conf"
      ;;
    almalinux:*|rocky:*|centos:*|rhel:*|*:rhel*|*:fedora*)
      PKG_MANAGER="dnf"
      DANTE_SERVICE="sockd"
      DANTE_CONFIG="/etc/sockd.conf"
      ;;
    *)
      printf 'Unsupported OS: %s\n' "${OS_ID:-unknown}" >&2
      exit 1
      ;;
  esac
}

install_packages() {
  case "${PKG_MANAGER}" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update
      apt-get install -y dante-server ufw curl
      ;;
    dnf)
      dnf install -y epel-release
      dnf install -y dnf-plugins-core || true
      dnf config-manager --set-enabled crb >/dev/null 2>&1 || true
      dnf config-manager --set-enabled powertools >/dev/null 2>&1 || true
      dnf install -y dante-server firewalld curl iproute
      ;;
  esac
}

ensure_sockd_user() {
  if ! id -u sockd >/dev/null 2>&1; then
    useradd --system --no-create-home --user-group --shell /usr/sbin/nologin sockd 2>/dev/null \
      || useradd --system --no-create-home --user-group --shell /sbin/nologin sockd
  fi
}

open_firewall_port() {
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
    ufw allow "${PROXY_PORT}/tcp"
    return
  fi

  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port="${PROXY_PORT}/tcp"
    firewall-cmd --reload
  fi
}

detect_os
install_packages

ensure_sockd_user

IFACE="$(ip route get 1.1.1.1 | awk '{for (i=1; i<=NF; i++) if ($i == "dev") {print $(i+1); exit}}')"

cp "${DANTE_CONFIG}" "${DANTE_CONFIG}.bak.$(date +%s)" 2>/dev/null || true

cat >"${DANTE_CONFIG}" <<EOF
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

open_firewall_port

systemctl enable "${DANTE_SERVICE}"
systemctl restart "${DANTE_SERVICE}"

SERVER_IP="$(curl -4 -s ifconfig.me || true)"

printf '\nDone.\n'
printf 'IP:Port\n'
printf '%s:%s\n' "${SERVER_IP:-SERVER_IP}" "${PROXY_PORT}"
printf 'Test with:\n'
printf 'curl --proxy socks5h://%s:%s https://ifconfig.me\n' "${SERVER_IP:-SERVER_IP}" "${PROXY_PORT}"
