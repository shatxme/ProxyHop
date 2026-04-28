#!/usr/bin/env bash
set -euo pipefail

MT_PORT="${1:-443}"
STATS_PORT="${2:-8888}"
WORKDIR="/opt/mtproxy"
SERVICE_NAME="mtproxy"
OS_ID=""
OS_LIKE=""
PKG_MANAGER=""

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
      ;;
    almalinux:*|rocky:*|centos:*|rhel:*|*:rhel*|*:fedora*)
      PKG_MANAGER="dnf"
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
      apt-get install -y git curl build-essential libssl-dev zlib1g-dev ufw ca-certificates openssl
      ;;
    dnf)
      dnf install -y git curl gcc make openssl-devel zlib-devel firewalld ca-certificates openssl
      ;;
  esac
}

ensure_mtproxy_user() {
  if ! id -u mtproxy >/dev/null 2>&1; then
    useradd --system --home-dir "${WORKDIR}" --no-create-home --user-group --shell /usr/sbin/nologin mtproxy 2>/dev/null \
      || useradd --system --home-dir "${WORKDIR}" --no-create-home --user-group --shell /sbin/nologin mtproxy
  fi
}

prepare_workdir() {
  if [[ -d "${WORKDIR}/.git" ]]; then
    git -C "${WORKDIR}" pull --ff-only
    return
  fi

  mkdir -p "${WORKDIR}"

  tmpdir="$(mktemp -d)"
  git clone https://github.com/TelegramMessenger/MTProxy.git "${tmpdir}/MTProxy"
  cp -a "${tmpdir}/MTProxy/." "${WORKDIR}/"
  rm -rf "${tmpdir}"
}

open_firewall_port() {
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
    ufw allow "${MT_PORT}/tcp"
    return
  fi

  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port="${MT_PORT}/tcp"
    firewall-cmd --reload
  fi
}

detect_os
install_packages

ensure_mtproxy_user

prepare_workdir

make -C "${WORKDIR}"

SECRET="$(openssl rand -hex 16)"

curl -fsSL https://core.telegram.org/getProxySecret -o "${WORKDIR}/proxy-secret"
curl -fsSL https://core.telegram.org/getProxyConfig -o "${WORKDIR}/proxy-multi.conf"

chown -R mtproxy:mtproxy "${WORKDIR}"
chmod 600 "${WORKDIR}/proxy-secret" "${WORKDIR}/proxy-multi.conf"

cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Telegram MTProto Proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${WORKDIR}
ExecStart=${WORKDIR}/objs/bin/mtproto-proxy -u mtproxy -p ${STATS_PORT} -H ${MT_PORT} -S ${SECRET} --aes-pwd ${WORKDIR}/proxy-secret ${WORKDIR}/proxy-multi.conf
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

open_firewall_port

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

SERVER_IP="$(curl -4 -s ifconfig.me || true)"

printf '\nDone.\n'
printf 'MTProto endpoint\n'
printf '%s:%s\n' "${SERVER_IP:-SERVER_IP}" "${MT_PORT}"
printf 'Secret\n'
printf '%s\n' "${SECRET}"
printf 'Telegram link\n'
printf 'https://t.me/proxy?server=%s&port=%s&secret=%s\n' "${SERVER_IP:-SERVER_IP}" "${MT_PORT}" "${SECRET}"
