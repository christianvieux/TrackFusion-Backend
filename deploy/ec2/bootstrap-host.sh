#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  ffmpeg \
  git \
  nginx \
  openssl \
  postgresql \
  postgresql-client \
  python3 \
  python3-pip \
  python3-venv \
  redis-server \
  rsync \
  ufw \
  xz-utils

node_version="${NODE_VERSION:-24.16.0}"
node_directory="node-v${node_version}-linux-x64"
node_archive="${node_directory}.tar.xz"

if [[ ! -x /opt/${node_directory}/bin/node ]]; then
  curl -fsSLo "/tmp/${node_archive}" \
    "https://nodejs.org/dist/v${node_version}/${node_archive}"
  curl -fsSLo /tmp/SHASUMS256.txt \
    "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt"
  (
    cd /tmp
    grep " ${node_archive}$" SHASUMS256.txt | sha256sum --check --strict
  )
  tar -xJf "/tmp/${node_archive}" -C /opt
  rm -f "/tmp/${node_archive}" /tmp/SHASUMS256.txt
fi

ln -sfn "/opt/${node_directory}/bin/node" /usr/local/bin/node
ln -sfn "/opt/${node_directory}/bin/npm" /usr/local/bin/npm
ln -sfn "/opt/${node_directory}/bin/npx" /usr/local/bin/npx
ln -sfn "/opt/${node_directory}/bin/corepack" /usr/local/bin/corepack

if ! id trackfusion >/dev/null 2>&1; then
  useradd --system --home-dir /opt/trackfusion --create-home \
    --shell /usr/sbin/nologin trackfusion
fi

install -d -o trackfusion -g trackfusion -m 0750 /opt/trackfusion/api

if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
fi
swapon --show=NAME --noheadings | grep -qx /swapfile || swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab

systemctl enable --now postgresql redis-server nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

node --version
npm --version
python3 --version
ffmpeg -version | head -n 1
redis-cli ping
pg_isready

