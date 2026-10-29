#!/usr/bin/env bash
set -Eeuo pipefail

source_file=${1:-}
managed_file=${2:-}
destination_file=${3:-}

if [[ -z ${source_file} || -z ${managed_file} || -z ${destination_file} ]]; then
  echo "ERROR: usage: reconcile-environment-file.sh <source-environment> <managed-settings> <destination-environment>" >&2
  exit 1
fi
for input_file in "${source_file}" "${managed_file}"; do
  if [[ ! -f ${input_file} || -L ${input_file} ]]; then
    echo "ERROR: environment input must be a regular file: ${input_file}" >&2
    exit 1
  fi
done
if [[ -e ${destination_file} || -L ${destination_file} ]]; then
  echo "ERROR: refusing to overwrite the destination environment: ${destination_file}" >&2
  exit 1
fi

declare -A seen_settings=()
required_settings=(
  FRONTEND_URL
  CORS_ALLOWED_ORIGINS
  COOKIE_SECURE
  COOKIE_SAME_SITE
  STORAGE_PROVIDER
  EMAIL_PROVIDER
  EMAIL_DELIVERY_ENABLED
)

while IFS= read -r line || [[ -n ${line} ]]; do
  if [[ -z ${line} || ${line} == \#* ]]; then
    continue
  fi
  if [[ ! ${line} =~ ^([A-Z][A-Z0-9_]*)=(.+)$ ]]; then
    echo "ERROR: deployment-managed settings must use KEY=value lines." >&2
    exit 1
  fi

  setting_name=${BASH_REMATCH[1]}
  case ${setting_name} in
    FRONTEND_URL|CORS_ALLOWED_ORIGINS|COOKIE_SECURE|COOKIE_SAME_SITE|STORAGE_PROVIDER|EMAIL_PROVIDER|EMAIL_DELIVERY_ENABLED) ;;
    *)
      echo "ERROR: ${setting_name} is not an approved deployment-managed setting." >&2
      exit 1
      ;;
  esac
  if [[ -n ${seen_settings[${setting_name}]+present} ]]; then
    echo "ERROR: duplicate deployment-managed setting: ${setting_name}." >&2
    exit 1
  fi
  seen_settings[${setting_name}]=present
done < "${managed_file}"

for setting_name in "${required_settings[@]}"; do
  if [[ -z ${seen_settings[${setting_name}]+present} ]]; then
    echo "ERROR: missing deployment-managed setting: ${setting_name}." >&2
    exit 1
  fi
done

destination_directory=$(dirname -- "${destination_file}")
temporary_file=$(mktemp "${destination_directory}/.env.XXXXXX")

cleanup() {
  rm -f -- "${temporary_file}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

awk -v managed_file="${managed_file}" '
  BEGIN {
    while ((getline line < managed_file) > 0) {
      if (line == "" || line ~ /^#/) continue
      separator = index(line, "=")
      key = substr(line, 1, separator - 1)
      managed[key] = line
      order[++managed_count] = key
    }
    close(managed_file)
  }
  {
    separator = index($0, "=")
    key = separator > 1 ? substr($0, 1, separator - 1) : ""
    if (key in managed) {
      if (!(key in emitted)) print managed[key]
      emitted[key] = 1
      next
    }
    print
  }
  END {
    for (index_value = 1; index_value <= managed_count; index_value++) {
      key = order[index_value]
      if (!(key in emitted)) print managed[key]
    }
  }
' "${source_file}" > "${temporary_file}"

chmod 0600 "${temporary_file}"
mv -- "${temporary_file}" "${destination_file}"
temporary_file=
trap - EXIT
