#!/usr/bin/env bash
set -euo pipefail

MT_PORT="${1:-443}"
STATS_PORT="${2:-8888}"
WORKDIR="/opt/mtproxy"
SERVICE_NAME="mtproxy"

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run this script as root\n' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y git curl build-essential libssl-dev zlib1g-dev ufw ca-certificates openssl

if ! id -u mtproxy >/dev/null 2>&1; then
  adduser --system --home "${WORKDIR}" --group --disabled-login mtproxy
fi

if [[ ! -d "${WORKDIR}/.git" ]]; then
  git clone https://github.com/TelegramMessenger/MTProxy.git "${WORKDIR}"
else
  git -C "${WORKDIR}" pull --ff-only
fi

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
User=mtproxy
Group=mtproxy
WorkingDirectory=${WORKDIR}
ExecStart=${WORKDIR}/objs/bin/mtproto-proxy -u mtproxy -p ${STATS_PORT} -H ${MT_PORT} -S ${SECRET} --aes-pwd ${WORKDIR}/proxy-secret ${WORKDIR}/proxy-multi.conf
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

if ufw status | grep -q 'Status: active'; then
  ufw allow "${MT_PORT}/tcp"
fi

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
printf 'tg://proxy?server=%s&port=%s&secret=%s\n' "${SERVER_IP:-SERVER_IP}" "${MT_PORT}" "${SECRET}"
