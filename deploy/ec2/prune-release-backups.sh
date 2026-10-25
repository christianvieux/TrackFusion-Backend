#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: prune-release-backups.sh must run as root." >&2
  exit 1
fi

backup_root=/var/backups/trackfusionweb-api
keep_count=${1:-3}

if [[ ! ${keep_count} =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: backup retention count must be a positive integer." >&2
  exit 1
fi

if [[ ! -d ${backup_root} ]]; then
  exit 0
fi

mapfile -t backup_names < <(
  find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | grep -E '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}$' \
    | sort -r || true
)

for ((index = keep_count; index < ${#backup_names[@]}; index += 1)); do
  backup_name=${backup_names[index]}
  if [[ ${backup_name} =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}$ ]]; then
    echo "Removing expired release backup: ${backup_name}" >&2
    rm -rf -- "${backup_root:?}/${backup_name}"
  fi
done
