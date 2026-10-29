#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
test_directory=$(mktemp -d)
release_id=$(printf '%s' "${test_directory}" | sha256sum | cut -c1-40)
staging_directory="/tmp/trackfusionweb-${release_id}"

cleanup() {
  rm -rf -- "${test_directory}" "${staging_directory}"
}
trap cleanup EXIT

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

test_preflight_rejects_missing_email_secret() {
  local fixture_root="${test_directory}/preflight"
  local config_directory="${fixture_root}/config"
  local command_directory="${fixture_root}/bin"
  local systemctl_log="${fixture_root}/systemctl.log"
  local deployment_log="${fixture_root}/deployment.log"
  local node_executable
  node_executable=$(command -v node)

  install -d \
    "${config_directory}" \
    "${command_directory}" \
    "${staging_directory}/deploy/ec2" \
    "${staging_directory}/deploy/systemd" \
    "${staging_directory}/scripts" \
    "${staging_directory}/utils"

  cp "${repository_root}/package.json" "${staging_directory}/package.json"
  cp "${repository_root}/scripts/validateEnvironment.js" \
    "${staging_directory}/scripts/validateEnvironment.js"
  cp "${repository_root}/utils/loadEnv.js" \
    "${staging_directory}/utils/loadEnv.js"
  cp "${repository_root}/deploy/ec2/reconcile-environment-file.sh" \
    "${staging_directory}/deploy/ec2/reconcile-environment-file.sh"

  touch \
    "${staging_directory}/package-lock.json" \
    "${staging_directory}/requirements.txt" \
    "${staging_directory}/deploy/ec2/backup-release.sh" \
    "${staging_directory}/deploy/ec2/configure-app.sh" \
    "${staging_directory}/deploy/ec2/prune-release-backups.sh" \
    "${staging_directory}/deploy/ec2/rollback-release.sh" \
    "${staging_directory}/deploy/systemd/trackfusionweb-api.service"

  cat > "${staging_directory}/deploy/ec2/check-api-health.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod 0755 "${staging_directory}/deploy/ec2/check-api-health.sh"

  cat > "${staging_directory}/deploy/ec2/production-managed.env" <<'EOF'
FRONTEND_URL=https://www.trackfusionweb.com
CORS_ALLOWED_ORIGINS=https://www.trackfusionweb.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
STORAGE_PROVIDER=aws-s3
EMAIL_PROVIDER=resend
EMAIL_DELIVERY_ENABLED=true
EOF

  cat > "${config_directory}/.env" <<'EOF'
NODE_ENV=production
HOST=127.0.0.1
PORT=8081
REQUEST_BODY_LIMIT=1mb
FRONTEND_URL=https://trackfusionweb.com
CORS_ALLOWED_ORIGINS=https://trackfusionweb.com
SESSION_SECRET=preserve-session-secret-00000000000000000000
JWT_SECRET=preserve-jwt-secret-00000000000000000000000
DATABASE_URL=postgresql://trackfusion:preserve-password@127.0.0.1:5432/trackfusionweb_db
REDIS_URL=redis://127.0.0.1:6379
PYTHON_EXECUTABLE=/opt/trackfusion/api/venv/bin/python
AWS_REGION=us-east-1
AWS_S3_BUCKET=trackfusionweb-test-bucket
AUDIO_MAX_LENGTH=900
AUDIO_MAX_FILE_SIZE=300
IMAGE_MAX_FILE_SIZE=50
ALLOWED_AUDIO_TYPES=audio/mpeg,audio/wav
ALLOWED_IMAGE_TYPES=image/jpeg,image/png
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
EMAIL_DELIVERY_ENABLED=false
EMAIL_VALIDATE_MX=false
EXPOSE_OTP_IN_DEVELOPMENT=false
EXPOSE_RESET_TOKEN_IN_DEVELOPMENT=false
UNKNOWN_INSTANCE_SETTING=preserve-me
EOF
  cp "${config_directory}/.env" "${fixture_root}/environment.before"

  cat > "${command_directory}/systemctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${SYSTEMCTL_LOG}"
exit 0
EOF
  chmod 0755 "${command_directory}/systemctl"

  sed \
    -e 's/if \[\[ ${EUID} -ne 0 \]\]; then/if false; then/' \
    -e "s|config_directory=/etc/trackfusion|config_directory=${config_directory}|" \
    -e "s|/usr/local/bin/node|${node_executable}|" \
    "${repository_root}/deploy/ec2/deploy-release.sh" \
    > "${staging_directory}/deploy/ec2/deploy-release.sh"
  chmod 0755 "${staging_directory}/deploy/ec2/deploy-release.sh"

  if PATH="${command_directory}:${PATH}" SYSTEMCTL_LOG="${systemctl_log}" \
    bash "${staging_directory}/deploy/ec2/deploy-release.sh" \
      "${staging_directory}" "${release_id}" \
      >"${deployment_log}" 2>&1; then
    fail "deployment preflight accepted a missing Resend API key"
  fi

  if ! grep -Fq 'RESEND_API_KEY is required when email delivery is enabled' "${deployment_log}"; then
    sed -n '1,80p' "${deployment_log}" >&2
    fail "deployment preflight did not report the missing Resend API key"
  fi
  if grep -Eq '(^|[[:space:]])stop([[:space:]]|$)' "${systemctl_log}"; then
    fail "deployment stopped the service before rejecting invalid configuration"
  fi
  cmp "${config_directory}/.env" "${fixture_root}/environment.before" || \
    fail "failed preflight changed the persistent environment"
}

test_rollback_restores_release_and_configuration() {
  local fixture_root="${test_directory}/rollback"
  local backup_root="${fixture_root}/backups"
  local app_directory="${fixture_root}/app"
  local config_directory="${fixture_root}/etc/trackfusion"
  local command_directory="${fixture_root}/bin"
  local script_directory="${fixture_root}/scripts"
  local backup_directory="${backup_root}/20261026T120000Z-${release_id}"

  install -d \
    "${app_directory}/uploads" \
    "${config_directory}" \
    "${command_directory}" \
    "${script_directory}" \
    "${backup_directory}/release" \
    "${backup_directory}/config" \
    "${backup_directory}/host/systemd" \
    "${backup_directory}/host/nginx/snippets" \
    "${backup_directory}/host/nginx/sites-available" \
    "${backup_directory}/host/nginx/sites-enabled"

  printf '%s\n' 'new-release-that-must-be-replaced' > "${app_directory}/version.txt"
  printf '%s\n' 'remove-on-rollback' > "${app_directory}/new-only.txt"
  printf '%s\n' 'preserve-upload' > "${app_directory}/uploads/persistent.txt"
  printf '%s\n' 'new-environment-that-must-be-replaced' > "${config_directory}/.env"
  printf '%s\n' 'new-only-setting' > "${config_directory}/new-only.env"

  printf '%s\n' 'old-release' > "${backup_directory}/release/version.txt"
  printf '%s\n' 'old-environment' > "${backup_directory}/config/.env"
  printf '%s\n' 'preserved-recovery-secret' \
    > "${backup_directory}/config/secrets.env"
  touch "${backup_directory}/postgresql.dump"

  touch \
    "${backup_directory}/host/systemd/trackfusionweb-api.service.absent" \
    "${backup_directory}/host/nginx/snippets/trackfusionweb-api-proxy.conf.absent" \
    "${backup_directory}/host/nginx/sites-available/trackfusionweb-api.absent" \
    "${backup_directory}/host/nginx/sites-available/trackfusionweb-api-tls.absent" \
    "${backup_directory}/host/nginx/sites-enabled/trackfusionweb-api.absent" \
    "${backup_directory}/host/nginx/sites-enabled/trackfusionweb-api-tls.absent" \
    "${backup_directory}/host/nginx/trackfusionweb-api-https-enabled.absent" \
    "${backup_directory}/host/nginx/sites-enabled/default.absent"

  cat > "${script_directory}/check-api-health.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod 0755 "${script_directory}/check-api-health.sh"

  cat > "${command_directory}/systemctl" <<'EOF'
#!/usr/bin/env bash
if [[ ${1:-} == is-active ]]; then
  exit 1
fi
exit 0
EOF
  cat > "${command_directory}/nginx" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "${command_directory}/chown" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod 0755 \
    "${command_directory}/systemctl" \
    "${command_directory}/nginx" \
    "${command_directory}/chown"

  sed \
    -e 's/if \[\[ ${EUID} -ne 0 \]\]; then/if false; then/' \
    -e "s|backup_root=/var/backups/trackfusionweb-api|backup_root=${backup_root}|" \
    -e "s|app_directory=/opt/trackfusion/api|app_directory=${app_directory}|" \
    -e "s|config_directory=/etc/trackfusion|config_directory=${config_directory}|" \
    -e "s|/etc/systemd|${fixture_root}/etc/systemd|g" \
    -e "s|/etc/nginx|${fixture_root}/etc/nginx|g" \
    -e 's/install -o root -g root -m 0755/install -m 0755/' \
    -e 's/install -d -o trackfusion -g trackfusion -m 0750/install -d -m 0750/' \
    -e 's/install -d -o root -g root -m 0700/install -d -m 0700/' \
    -e 's/install -d -o root -g root -m 0755/install -d -m 0755/' \
    "${repository_root}/deploy/ec2/rollback-release.sh" \
    > "${script_directory}/rollback-release.sh"
  chmod 0755 "${script_directory}/rollback-release.sh"

  PATH="${command_directory}:${PATH}" \
    bash "${script_directory}/rollback-release.sh" "${backup_directory}"

  grep -Fqx 'old-release' "${app_directory}/version.txt" || \
    fail "rollback did not restore the previous application release"
  [[ ! -e ${app_directory}/new-only.txt ]] || \
    fail "rollback retained a file from the failed release"
  grep -Fqx 'preserve-upload' "${app_directory}/uploads/persistent.txt" || \
    fail "rollback changed persistent uploads"
  grep -Fqx 'old-environment' "${config_directory}/.env" || \
    fail "rollback did not restore the previous environment"
  grep -Fqx 'preserved-recovery-secret' "${config_directory}/secrets.env" || \
    fail "rollback did not restore the protected recovery file"
  [[ ! -e ${config_directory}/new-only.env ]] || \
    fail "rollback retained configuration from the failed deployment"
}

test_preflight_rejects_missing_email_secret
test_rollback_restores_release_and_configuration

echo "Deployment safety checks passed"
