#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: setup-https.sh must run as root." >&2
  exit 1
fi

certificate_email=${1:-}
domain=api.trackfusionweb.com
app_directory=/opt/trackfusion/api
config_directory=/etc/trackfusion
https_marker=/etc/nginx/trackfusionweb-api-https-enabled
certificate_directory=/etc/letsencrypt/live/${domain}
current_stage=preflight
activation_verified=false
backup_directory=

if [[ ! ${certificate_email} =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "ERROR: usage: setup-https.sh <certificate-notification-email>" >&2
  exit 1
fi

for required_file in \
  "${app_directory}/deploy/nginx/trackfusionweb-api.conf" \
  "${app_directory}/deploy/nginx/trackfusionweb-api-proxy.conf" \
  "${app_directory}/deploy/nginx/trackfusionweb-api-tls.conf" \
  "${app_directory}/deploy/ec2/certbot-renewal-hook.sh" \
  "${app_directory}/deploy/ec2/check-api-health.sh"; do
  if [[ ! -f ${required_file} ]]; then
    echo "ERROR: application release is missing ${required_file}." >&2
    exit 1
  fi
done

for command_name in apt-get curl getent install nginx openssl systemctl; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: required HTTPS setup command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

capture_path() {
  local source_path=$1
  local backup_path=$2

  install -d -m 0700 "$(dirname -- "${backup_path}")"
  if [[ -e ${source_path} || -L ${source_path} ]]; then
    cp -a -- "${source_path}" "${backup_path}"
  else
    : > "${backup_path}.absent"
  fi
}

restore_path() {
  local backup_path=$1
  local destination_path=$2

  if [[ -e ${backup_path} || -L ${backup_path} ]]; then
    rm -f -- "${destination_path}"
    cp -a -- "${backup_path}" "${destination_path}"
  elif [[ -f ${backup_path}.absent ]]; then
    rm -f -- "${destination_path}"
  fi
}

restore_configuration() {
  restore_path "${backup_directory}/nginx/snippets/trackfusionweb-api-proxy.conf" \
    /etc/nginx/snippets/trackfusionweb-api-proxy.conf
  restore_path "${backup_directory}/nginx/sites-available/trackfusionweb-api" \
    /etc/nginx/sites-available/trackfusionweb-api
  restore_path "${backup_directory}/nginx/sites-enabled/trackfusionweb-api" \
    /etc/nginx/sites-enabled/trackfusionweb-api
  restore_path "${backup_directory}/nginx/sites-available/trackfusionweb-api-tls" \
    /etc/nginx/sites-available/trackfusionweb-api-tls
  restore_path "${backup_directory}/nginx/sites-enabled/trackfusionweb-api-tls" \
    /etc/nginx/sites-enabled/trackfusionweb-api-tls
  restore_path "${backup_directory}/nginx/sites-enabled/default" \
    /etc/nginx/sites-enabled/default
  restore_path "${backup_directory}/letsencrypt/trackfusionweb-reload-nginx" \
    /etc/letsencrypt/renewal-hooks/deploy/trackfusionweb-reload-nginx
  restore_path "${backup_directory}/nginx/trackfusionweb-api-https-enabled" \
    "${https_marker}"
}

report_error() {
  local status=$?
  local line_number=$1
  trap - ERR
  if [[ ${activation_verified} == true ]]; then
    echo "ERROR: HTTPS is active, but post-activation verification failed during '${current_stage}' at line ${line_number} (exit ${status})." >&2
    echo "The working TLS listener was left in place; investigate before the next renewal." >&2
  else
    if [[ -n ${backup_directory} && -d ${backup_directory} ]]; then
      restore_configuration
      if nginx -t; then
        systemctl reload nginx || true
      else
        echo "ERROR: the preserved Nginx configuration also failed validation; Nginx was not reloaded." >&2
      fi
    fi
    echo "ERROR: HTTPS setup failed during '${current_stage}' at line ${line_number} (exit ${status})." >&2
    echo "The pre-activation Nginx files were restored." >&2
  fi
  if [[ -n ${backup_directory} && -d ${backup_directory} ]]; then
    rm -rf -- "${backup_directory}"
  fi
  exit "${status}"
}
trap 'report_error "${LINENO}"' ERR

current_stage=dns-verification
metadata_token=$(curl -fsS --connect-timeout 2 --max-time 5 \
  --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
  http://169.254.169.254/latest/api/token)
public_ip=$(curl -fsS --connect-timeout 2 --max-time 5 \
  --header "X-aws-ec2-metadata-token: ${metadata_token}" \
  http://169.254.169.254/latest/meta-data/public-ipv4)
mapfile -t resolved_addresses < <(
  getent ahostsv4 "${domain}" | awk '{ print $1 }' | sort -u
)
dns_matches_instance=false
for resolved_address in "${resolved_addresses[@]}"; do
  if [[ ${resolved_address} == "${public_ip}" ]]; then
    dns_matches_instance=true
    break
  fi
done
if [[ ${dns_matches_instance} != true ]]; then
  echo "ERROR: ${domain} does not resolve to this instance's public address (${public_ip})." >&2
  printf 'Resolved IPv4 addresses: %s\n' "${resolved_addresses[*]:-none}" >&2
  exit 1
fi

current_stage=certbot-installation
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends certbot

if ! command -v certbot >/dev/null 2>&1; then
  echo "ERROR: Certbot installation did not provide the certbot command." >&2
  exit 1
fi

current_stage=http-challenge-configuration
install -d -o root -g root -m 0755 \
  /var/www/letsencrypt/.well-known/acme-challenge \
  /etc/nginx/snippets \
  /etc/nginx/sites-available \
  /etc/nginx/sites-enabled
backup_directory=$(mktemp -d /tmp/trackfusionweb-https.XXXXXX)
chmod 0700 "${backup_directory}"
capture_path /etc/nginx/snippets/trackfusionweb-api-proxy.conf \
  "${backup_directory}/nginx/snippets/trackfusionweb-api-proxy.conf"
capture_path /etc/nginx/sites-available/trackfusionweb-api \
  "${backup_directory}/nginx/sites-available/trackfusionweb-api"
capture_path /etc/nginx/sites-enabled/trackfusionweb-api \
  "${backup_directory}/nginx/sites-enabled/trackfusionweb-api"
capture_path /etc/nginx/sites-available/trackfusionweb-api-tls \
  "${backup_directory}/nginx/sites-available/trackfusionweb-api-tls"
capture_path /etc/nginx/sites-enabled/trackfusionweb-api-tls \
  "${backup_directory}/nginx/sites-enabled/trackfusionweb-api-tls"
capture_path /etc/nginx/sites-enabled/default \
  "${backup_directory}/nginx/sites-enabled/default"
capture_path /etc/letsencrypt/renewal-hooks/deploy/trackfusionweb-reload-nginx \
  "${backup_directory}/letsencrypt/trackfusionweb-reload-nginx"
capture_path "${https_marker}" \
  "${backup_directory}/nginx/trackfusionweb-api-https-enabled"
install -o root -g root -m 0644 \
  "${app_directory}/deploy/nginx/trackfusionweb-api-proxy.conf" \
  /etc/nginx/snippets/trackfusionweb-api-proxy.conf
install -o root -g root -m 0644 \
  "${app_directory}/deploy/nginx/trackfusionweb-api.conf" \
  /etc/nginx/sites-available/trackfusionweb-api
ln -sfn /etc/nginx/sites-available/trackfusionweb-api \
  /etc/nginx/sites-enabled/trackfusionweb-api
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

current_stage=certificate-issuance
if [[ ! -s ${certificate_directory}/fullchain.pem || ! -s ${certificate_directory}/privkey.pem ]]; then
  certbot certonly \
    --non-interactive \
    --agree-tos \
    --email "${certificate_email}" \
    --cert-name "${domain}" \
    --key-type ecdsa \
    --webroot \
    --webroot-path /var/www/letsencrypt \
    --domain "${domain}"
fi

openssl x509 -in "${certificate_directory}/fullchain.pem" \
  -noout -checkhost "${domain}"

current_stage=https-activation
install -o root -g root -m 0644 \
  "${app_directory}/deploy/nginx/trackfusionweb-api-tls.conf" \
  /etc/nginx/sites-available/trackfusionweb-api-tls
ln -sfn /etc/nginx/sites-available/trackfusionweb-api-tls \
  /etc/nginx/sites-enabled/trackfusionweb-api-tls
install -d -o root -g root -m 0755 \
  /etc/letsencrypt/renewal-hooks/deploy
install -o root -g root -m 0755 \
  "${app_directory}/deploy/ec2/certbot-renewal-hook.sh" \
  /etc/letsencrypt/renewal-hooks/deploy/trackfusionweb-reload-nginx

nginx -t
systemctl reload nginx
install -d -o root -g root -m 0700 "${config_directory}"
install -o root -g root -m 0644 /dev/null "${https_marker}"

current_stage=https-health-check
bash "${app_directory}/deploy/ec2/check-api-health.sh" 30
activation_verified=true

current_stage=renewal-configuration
systemctl enable --now certbot.timer
systemctl is-enabled --quiet certbot.timer
systemctl is-active --quiet certbot.timer
certbot renew --dry-run --cert-name "${domain}"

trap - ERR
rm -rf -- "${backup_directory}"
echo "HTTPS activation and Certbot renewal verification completed successfully."
