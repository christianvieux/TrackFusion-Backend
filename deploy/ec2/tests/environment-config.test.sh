#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
reconciliation_script="${repository_root}/deploy/ec2/reconcile-environment-file.sh"
managed_file="${repository_root}/deploy/ec2/production-managed.env"
test_directory=$(mktemp -d)
source_file="${test_directory}/source.env"
candidate_file="${test_directory}/candidate.env"
second_candidate_file="${test_directory}/second-candidate.env"

cleanup() {
  rm -rf -- "${test_directory}"
}
trap cleanup EXIT

cat > "${source_file}" <<'EOF'
NODE_ENV=production
FRONTEND_URL=https://trackfusionweb.com
CORS_ALLOWED_ORIGINS=https://trackfusionweb.com
SESSION_SECRET=preserve-this-session-secret-exactly
JWT_SECRET=preserve-this-jwt-secret-exactly
JWT_SECRET_PASSWORD_RESET=preserve-this-reset-secret-exactly
DATABASE_URL=postgresql://trackfusion:preserve-this-password@127.0.0.1:5432/trackfusionweb_db
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
UNRECOGNIZED_SETTING=must-survive
EOF
cp "${source_file}" "${test_directory}/source.env.before"

bash "${reconciliation_script}" \
  "${source_file}" "${managed_file}" "${candidate_file}"

cmp "${source_file}" "${test_directory}/source.env.before"
grep -Fqx 'FRONTEND_URL=https://www.trackfusionweb.com' "${candidate_file}"
grep -Fqx 'CORS_ALLOWED_ORIGINS=https://www.trackfusionweb.com' "${candidate_file}"
grep -Fqx 'COOKIE_SECURE=true' "${candidate_file}"
grep -Fqx 'COOKIE_SAME_SITE=lax' "${candidate_file}"
grep -Fqx 'SESSION_SECRET=preserve-this-session-secret-exactly' "${candidate_file}"
grep -Fqx 'JWT_SECRET=preserve-this-jwt-secret-exactly' "${candidate_file}"
grep -Fqx 'JWT_SECRET_PASSWORD_RESET=preserve-this-reset-secret-exactly' "${candidate_file}"
grep -Fqx 'DATABASE_URL=postgresql://trackfusion:preserve-this-password@127.0.0.1:5432/trackfusionweb_db' "${candidate_file}"
grep -Fqx 'UNRECOGNIZED_SETTING=must-survive' "${candidate_file}"
if grep -Eq 'https://(trackfusionweb\.vercel\.app|trackfusionweb\.com)$' "${candidate_file}"; then
  echo "Obsolete frontend origin remains in the reconciled environment." >&2
  exit 1
fi
if [[ $(stat -c '%a' "${candidate_file}") != 600 ]]; then
  echo "Reconciled environment permissions are not 0600." >&2
  exit 1
fi

bash "${reconciliation_script}" \
  "${candidate_file}" "${managed_file}" "${second_candidate_file}"
cmp "${candidate_file}" "${second_candidate_file}"

if bash "${reconciliation_script}" \
  "${source_file}" "${managed_file}" "${candidate_file}" >/dev/null 2>&1; then
  echo "Reconciliation unexpectedly overwrote an existing candidate." >&2
  exit 1
fi

cp "${managed_file}" "${test_directory}/invalid-managed.env"
printf '%s\n' 'SESSION_SECRET=must-not-be-deployment-managed' \
  >> "${test_directory}/invalid-managed.env"
if bash "${reconciliation_script}" \
  "${source_file}" "${test_directory}/invalid-managed.env" \
  "${test_directory}/invalid-candidate.env" >/dev/null 2>&1; then
  echo "Reconciliation accepted a secret as deployment-managed configuration." >&2
  exit 1
fi

echo "Environment reconciliation checks passed"
