#!/usr/bin/env bash
set -euo pipefail

domain=${1:-api.trackfusionweb.com}
warning_days=${2:-30}

if [[ ! ${domain} =~ ^[a-zA-Z0-9.-]+$ ]]; then
  echo "ERROR: domain contains unsupported characters." >&2
  exit 1
fi
if [[ ! ${warning_days} =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: warning days must be a positive integer." >&2
  exit 1
fi

for command_name in openssl timeout; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: required certificate-check command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

certificate_file=$(mktemp /tmp/trackfusionweb-certificate.XXXXXX)
cleanup() {
  rm -f -- "${certificate_file}"
}
trap cleanup EXIT

if ! timeout 20 openssl s_client \
  -connect "${domain}:443" \
  -servername "${domain}" \
  -verify_hostname "${domain}" \
  -verify_return_error \
  </dev/null 2>/dev/null \
  | openssl x509 -outform PEM > "${certificate_file}"; then
  echo "ERROR: could not retrieve and verify the TLS certificate for ${domain}." >&2
  exit 1
fi

warning_seconds=$((warning_days * 86400))
expiry=$(openssl x509 -in "${certificate_file}" -noout -enddate | cut -d= -f2-)

if ! openssl x509 -in "${certificate_file}" -noout -checkend "${warning_seconds}"; then
  echo "ERROR: ${domain} certificate expires within ${warning_days} days (${expiry})." >&2
  exit 1
fi

echo "${domain} certificate is valid for more than ${warning_days} days (expires ${expiry})."
