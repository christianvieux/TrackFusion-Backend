#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
migration_script="${repository_root}/deploy/ec2/migrate-environment-file.sh"
test_directory=$(mktemp -d)
legacy_file="${test_directory}/api.env"
canonical_file="${test_directory}/.env"

cleanup() {
  rm -rf -- "${test_directory}"
}
trap cleanup EXIT

cat > "${legacy_file}" <<'EOF'
NODE_ENV=production
FRONTEND_URL=https://trackfusionweb.vercel.app
CORS_ALLOWED_ORIGINS=https://trackfusionweb.com
SESSION_SECRET=preserve-this-session-secret-exactly
JWT_SECRET=preserve-this-jwt-secret-exactly
JWT_SECRET_PASSWORD_RESET=preserve-this-reset-secret-exactly
DATABASE_URL=postgresql://trackfusion:preserve-this-password@127.0.0.1:5432/trackfusionweb_db
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
UNRECOGNIZED_SETTING=must-survive
EOF
cp "${legacy_file}" "${test_directory}/api.env.before"

bash "${migration_script}" "${legacy_file}" "${canonical_file}"

cmp "${legacy_file}" "${test_directory}/api.env.before"
grep -Fqx 'FRONTEND_URL=https://www.trackfusionweb.com' "${canonical_file}"
grep -Fqx 'CORS_ALLOWED_ORIGINS=https://www.trackfusionweb.com' "${canonical_file}"
grep -Fqx 'COOKIE_SECURE=true' "${canonical_file}"
grep -Fqx 'COOKIE_SAME_SITE=lax' "${canonical_file}"
grep -Fqx 'SESSION_SECRET=preserve-this-session-secret-exactly' "${canonical_file}"
grep -Fqx 'JWT_SECRET=preserve-this-jwt-secret-exactly' "${canonical_file}"
grep -Fqx 'JWT_SECRET_PASSWORD_RESET=preserve-this-reset-secret-exactly' "${canonical_file}"
grep -Fqx 'DATABASE_URL=postgresql://trackfusion:preserve-this-password@127.0.0.1:5432/trackfusionweb_db' "${canonical_file}"
grep -Fqx 'UNRECOGNIZED_SETTING=must-survive' "${canonical_file}"
if grep -Eq 'https://(trackfusionweb\.vercel\.app|trackfusionweb\.com)$' "${canonical_file}"; then
  echo "Obsolete frontend origin remains in the migrated environment." >&2
  exit 1
fi
if [[ $(stat -c '%a' "${canonical_file}") != 600 ]]; then
  echo "Migrated environment permissions are not 0600." >&2
  exit 1
fi
if bash "${migration_script}" "${legacy_file}" "${canonical_file}" >/dev/null 2>&1; then
  echo "Migration unexpectedly overwrote an existing canonical environment." >&2
  exit 1
fi

echo "Environment migration checks passed"
