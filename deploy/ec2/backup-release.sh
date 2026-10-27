#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: backup-release.sh must run as root." >&2
  exit 1
fi

release_id=${1:-}
if [[ ! ${release_id} =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: a 40-character lowercase Git commit SHA is required." >&2
  exit 1
fi

app_directory=/opt/trackfusion/api
config_directory=/etc/trackfusion
backup_root=/var/backups/trackfusionweb-api
database_name=trackfusionweb_db
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_name="${timestamp}-${release_id}"
backup_directory="${backup_root}/${backup_name}"
partial_directory="${backup_root}/.${backup_name}.partial"

for command_name in date df du pg_dump pg_restore psql rsync runuser tar; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: required backup command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

if [[ ! -d ${app_directory} ]]; then
  echo "ERROR: the current application directory does not exist." >&2
  exit 1
fi
if [[ ! -f ${config_directory}/.env && ! -f ${config_directory}/api.env ]]; then
  echo "ERROR: production configuration is incomplete; refusing to deploy without backing it up." >&2
  exit 1
fi
if [[ -L ${config_directory}/.env || -L ${config_directory}/api.env ]]; then
  echo "ERROR: production environment files must not be symbolic links." >&2
  exit 1
fi
database_exists=$(runuser -u postgres -- psql --dbname=postgres --tuples-only --no-align \
  --command="SELECT 1 FROM pg_database WHERE datname = '${database_name}'")
if [[ ${database_exists} != 1 ]]; then
  echo "ERROR: production database ${database_name} was not found." >&2
  exit 1
fi

umask 077
install -d -o root -g root -m 0700 "${backup_root}"

source_bytes=$(du -sb "${app_directory}" "${config_directory}" | awk '{ total += $1 } END { print total }')
database_bytes=$(runuser -u postgres -- psql --dbname=postgres --tuples-only --no-align \
  --command="SELECT pg_database_size('${database_name}')")
available_bytes=$(df --output=avail -B1 "${backup_root}" | tail -n 1 | tr -d ' ')

if [[ ! ${source_bytes} =~ ^[0-9]+$ || ! ${database_bytes} =~ ^[0-9]+$ || ! ${available_bytes} =~ ^[0-9]+$ ]]; then
  echo "ERROR: unable to determine backup space requirements." >&2
  exit 1
fi

# Allow room for the release, database dump, uploads, and backup overhead.
required_bytes=$((source_bytes + database_bytes + 268435456))
if (( available_bytes < required_bytes )); then
  echo "ERROR: insufficient free disk space for a complete pre-deployment backup." >&2
  exit 1
fi

if [[ -e ${backup_directory} || -e ${partial_directory} ]]; then
  echo "ERROR: backup destination already exists: ${backup_name}" >&2
  exit 1
fi

cleanup_partial_backup() {
  rm -rf -- "${partial_directory}"
}
trap cleanup_partial_backup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

install -d -o root -g root -m 0700 \
  "${partial_directory}" \
  "${partial_directory}/release" \
  "${partial_directory}/config" \
  "${partial_directory}/host/systemd" \
  "${partial_directory}/host/nginx/snippets" \
  "${partial_directory}/host/nginx/sites-available" \
  "${partial_directory}/host/nginx/sites-enabled"

echo "Creating a protected backup of the current application release." >&2
rsync -a --delete --exclude='uploads/' \
  "${app_directory}/" "${partial_directory}/release/"

if [[ -d ${app_directory}/uploads ]]; then
  echo "Archiving local uploads separately so deployment never overwrites them." >&2
  tar --numeric-owner --one-file-system -czf "${partial_directory}/uploads.tar.gz" \
    -C "${app_directory}" uploads
fi

rsync -a --delete "${config_directory}/" "${partial_directory}/config/"

capture_path() {
  local source_path=$1
  local destination_path=$2

  if [[ -e ${source_path} || -L ${source_path} ]]; then
    cp -a -- "${source_path}" "${destination_path}"
  else
    : > "${destination_path}.absent"
  fi
}

capture_path /etc/systemd/system/trackfusionweb-api.service \
  "${partial_directory}/host/systemd/trackfusionweb-api.service"
capture_path /etc/nginx/sites-available/trackfusionweb-api \
  "${partial_directory}/host/nginx/sites-available/trackfusionweb-api"
capture_path /etc/nginx/sites-enabled/trackfusionweb-api \
  "${partial_directory}/host/nginx/sites-enabled/trackfusionweb-api"
capture_path /etc/nginx/snippets/trackfusionweb-api-proxy.conf \
  "${partial_directory}/host/nginx/snippets/trackfusionweb-api-proxy.conf"
capture_path /etc/nginx/sites-available/trackfusionweb-api-tls \
  "${partial_directory}/host/nginx/sites-available/trackfusionweb-api-tls"
capture_path /etc/nginx/sites-enabled/trackfusionweb-api-tls \
  "${partial_directory}/host/nginx/sites-enabled/trackfusionweb-api-tls"
capture_path /etc/nginx/trackfusionweb-api-https-enabled \
  "${partial_directory}/host/nginx/trackfusionweb-api-https-enabled"
capture_path /etc/nginx/sites-enabled/default \
  "${partial_directory}/host/nginx/sites-enabled/default"

echo "Creating a consistent PostgreSQL backup." >&2
runuser -u postgres -- pg_dump --format=custom --create --dbname="${database_name}" \
  > "${partial_directory}/postgresql.dump"
pg_restore --list "${partial_directory}/postgresql.dump" >/dev/null

cat > "${partial_directory}/MANIFEST.txt" <<EOF
Created before deployment target: ${release_id}
Created (UTC): ${timestamp}
Database: ${database_name}

The release, production configuration, host service files, local uploads, and a
consistent PostgreSQL dump were captured before deployment. Automatic rollback
does not restore the database dump or uploads because doing so could erase data
written after this backup. Review those restores separately if ever required.
EOF

mv -- "${partial_directory}" "${backup_directory}"
trap - EXIT

# This is the only stdout output; deploy-release.sh captures it as the backup path.
printf '%s\n' "${backup_directory}"
