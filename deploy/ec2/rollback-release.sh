#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: rollback-release.sh must run as root." >&2
  exit 1
fi

backup_root=/var/backups/trackfusionweb-api
app_directory=/opt/trackfusion/api
config_directory=/etc/trackfusion
service_name=trackfusionweb-api
requested_backup=${1:-}

if [[ -z ${requested_backup} ]]; then
  echo "ERROR: a backup directory is required for rollback." >&2
  exit 1
fi

backup_directory=$(realpath -e "${requested_backup}")
case "${backup_directory}" in
  "${backup_root}"/*) ;;
  *)
    echo "ERROR: rollback source must be inside ${backup_root}." >&2
    exit 1
    ;;
esac

backup_name=$(basename "${backup_directory}")
if [[ ! ${backup_name} =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}$ ]]; then
  echo "ERROR: rollback source is not a recognized release backup." >&2
  exit 1
fi

for required_path in \
  "${backup_directory}/release" \
  "${backup_directory}/config/secrets.env" \
  "${backup_directory}/config/api.env" \
  "${backup_directory}/postgresql.dump"; do
  if [[ ! -e ${required_path} ]]; then
    echo "ERROR: rollback backup is incomplete: ${required_path}" >&2
    exit 1
  fi
done

for command_name in curl nginx rsync systemctl; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: required rollback command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

restore_path() {
  local source_path=$1
  local destination_path=$2

  if [[ -e ${source_path} || -L ${source_path} ]]; then
    rm -f -- "${destination_path}"
    cp -a -- "${source_path}" "${destination_path}"
  elif [[ -f ${source_path}.absent ]]; then
    rm -f -- "${destination_path}"
  else
    echo "ERROR: host configuration backup is incomplete: ${source_path}" >&2
    return 1
  fi
}

echo "Restoring the previously working application release." >&2
systemctl stop "${service_name}" 2>/dev/null || true
if systemctl is-active --quiet "${service_name}"; then
  echo "ERROR: the API service could not be stopped safely for rollback." >&2
  exit 1
fi
install -d -o trackfusion -g trackfusion -m 0750 "${app_directory}"
rsync -a --delete --exclude='uploads/' \
  "${backup_directory}/release/" "${app_directory}/"

echo "Restoring production configuration and service definitions." >&2
install -d -o root -g root -m 0700 "${config_directory}"
rsync -a --delete "${backup_directory}/config/" "${config_directory}/"
restore_path "${backup_directory}/host/systemd/trackfusionweb-api.service" \
  /etc/systemd/system/trackfusionweb-api.service
restore_path "${backup_directory}/host/nginx/sites-available/trackfusionweb-api" \
  /etc/nginx/sites-available/trackfusionweb-api
restore_path "${backup_directory}/host/nginx/sites-enabled/trackfusionweb-api" \
  /etc/nginx/sites-enabled/trackfusionweb-api
restore_path "${backup_directory}/host/nginx/sites-enabled/default" \
  /etc/nginx/sites-enabled/default

chown -R trackfusion:trackfusion "${app_directory}"
chown -R root:root "${config_directory}"
chmod 0700 "${config_directory}"
chmod 0600 "${config_directory}/secrets.env" "${config_directory}/api.env"

nginx -t
systemctl daemon-reload
systemctl enable "${service_name}" >/dev/null
systemctl restart "${service_name}"
systemctl reload nginx

for attempt in {1..30}; do
  if curl -fsS --connect-timeout 2 --max-time 5 \
    http://127.0.0.1:8081/health >/dev/null \
    && curl -fsS --connect-timeout 2 --max-time 5 \
      http://127.0.0.1/health >/dev/null; then
    echo "Rollback health checks passed." >&2
    exit 0
  fi
  sleep 1
done

systemctl status "${service_name}" --no-pager >&2 || true
journalctl -u "${service_name}" -n 100 --no-pager >&2 || true
echo "ERROR: rollback completed on disk, but the previous release is not healthy." >&2
echo "The PostgreSQL recovery dump remains at ${backup_directory}/postgresql.dump; it was not restored automatically." >&2
exit 1
