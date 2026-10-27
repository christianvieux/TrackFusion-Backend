#!/usr/bin/env bash
set -Eeuo pipefail

source_file=${1:-}
destination_file=${2:-}

if [[ -z ${source_file} || -z ${destination_file} ]]; then
  echo "ERROR: usage: migrate-environment-file.sh <legacy-environment> <canonical-environment>" >&2
  exit 1
fi
if [[ ! -f ${source_file} || -L ${source_file} ]]; then
  echo "ERROR: the legacy environment must be a regular file: ${source_file}" >&2
  exit 1
fi
if [[ -e ${destination_file} || -L ${destination_file} ]]; then
  echo "ERROR: refusing to overwrite the canonical environment: ${destination_file}" >&2
  exit 1
fi

destination_directory=$(dirname -- "${destination_file}")
temporary_file=$(mktemp "${destination_directory}/.env.XXXXXX")

cleanup() {
  rm -f -- "${temporary_file}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

install -m 0600 "${source_file}" "${temporary_file}"

# These are the only value changes made during the one-time migration. All
# credential values, optional settings, and unrecognized variables remain
# unchanged from the legacy configuration.
sed -i \
  -e 's|^FRONTEND_URL=https://trackfusionweb\.vercel\.app$|FRONTEND_URL=https://trackfusionweb.com|' \
  -e 's|^CORS_ALLOWED_ORIGINS=https://trackfusionweb\.vercel\.app$|CORS_ALLOWED_ORIGINS=https://trackfusionweb.com|' \
  -e 's|^COOKIE_SAME_SITE=none$|COOKIE_SAME_SITE=lax|' \
  "${temporary_file}"

for required_setting in \
  'FRONTEND_URL=https://trackfusionweb.com' \
  'CORS_ALLOWED_ORIGINS=https://trackfusionweb.com' \
  'COOKIE_SECURE=true' \
  'COOKIE_SAME_SITE=lax'; do
  if ! grep -Fqx "${required_setting}" "${temporary_file}"; then
    echo "ERROR: migrated production configuration is missing ${required_setting%%=*}." >&2
    exit 1
  fi
done
if grep -Eq '^(FRONTEND_URL|CORS_ALLOWED_ORIGINS)=.*https://trackfusionweb\.vercel\.app' "${temporary_file}"; then
  echo "ERROR: the obsolete production frontend origin remains after migration." >&2
  exit 1
fi

mv -- "${temporary_file}" "${destination_file}"
temporary_file=
trap - EXIT
