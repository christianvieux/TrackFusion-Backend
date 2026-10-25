#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: configure-app.sh must run as root." >&2
  exit 1
fi

app_directory=/opt/trackfusion/api
config_directory=/etc/trackfusion
secrets_file="${config_directory}/secrets.env"
environment_file="${config_directory}/api.env"
temporary_environment=
current_stage=preflight

report_error() {
  local status=$?
  local line_number=$1
  trap - ERR
  if [[ -n ${temporary_environment} ]]; then
    rm -f -- "${temporary_environment}"
  fi
  echo "ERROR: application configuration failed during '${current_stage}' at line ${line_number} (exit ${status})." >&2
  exit "${status}"
}
trap 'report_error "${LINENO}"' ERR

for command_name in \
  createdb curl grep nginx npm openssl pg_isready psql python3 redis-cli runuser systemctl; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: required installation command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

if ! id trackfusion >/dev/null 2>&1; then
  echo "ERROR: the trackfusion service account is missing; run bootstrap-host.sh first." >&2
  exit 1
fi
for required_file in \
  "${app_directory}/package-lock.json" \
  "${app_directory}/requirements.txt" \
  "${app_directory}/scripts/initDatabase.js" \
  "${app_directory}/scripts/verifyDatabase.js" \
  "${app_directory}/deploy/systemd/trackfusionweb-api.service" \
  "${app_directory}/deploy/nginx/trackfusionweb-api.conf"; do
  if [[ ! -f ${required_file} ]]; then
    echo "ERROR: application release is incomplete: ${required_file}" >&2
    exit 1
  fi
done

if ! pg_isready >/dev/null; then
  echo "ERROR: PostgreSQL is not accepting local connections." >&2
  exit 1
fi
if [[ $(redis-cli ping) != PONG ]]; then
  echo "ERROR: Redis is not accepting local connections." >&2
  exit 1
fi

current_stage=secret-validation
install -d -o root -g root -m 0700 "${config_directory}"
install -d -o trackfusion -g trackfusion -m 0750 "${app_directory}/uploads/temp"

if [[ ! -f ${secrets_file} ]]; then
  umask 077
  {
    printf 'DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'JWT_SECRET_PASSWORD_RESET=%s\n' "$(openssl rand -hex 32)"
  } > "${secrets_file}"
fi
chown root:root "${secrets_file}"
chmod 0600 "${secrets_file}"

# This root-owned file contains only shell assignments generated on this host.
# shellcheck disable=SC1090
source "${secrets_file}"

for secret_name in DB_PASSWORD SESSION_SECRET JWT_SECRET JWT_SECRET_PASSWORD_RESET; do
  if [[ -z ${!secret_name:-} ]]; then
    echo "ERROR: required production secret is missing: ${secret_name}" >&2
    exit 1
  fi
done
if [[ ! ${DB_PASSWORD} =~ ^[0-9a-f]{64}$ ]]; then
  echo "ERROR: DB_PASSWORD must remain a 64-character hexadecimal secret." >&2
  exit 1
fi

current_stage=database-access
role_exists=$(runuser -u postgres -- psql --dbname=postgres --tuples-only --no-align \
  --command="SELECT 1 FROM pg_roles WHERE rolname = 'trackfusion'")
if [[ ${role_exists} != 1 ]]; then
  # Pass the password through the child environment instead of SQL arguments or logs.
  export DB_PASSWORD
  runuser --preserve-environment -u postgres -- psql --dbname=postgres \
    --set=ON_ERROR_STOP=1 <<'SQL'
\getenv db_password DB_PASSWORD
SELECT format('CREATE ROLE trackfusion WITH LOGIN PASSWORD %L', :'db_password') \gexec
SQL
  export -n DB_PASSWORD
fi

database_exists=$(runuser -u postgres -- psql --dbname=postgres --tuples-only --no-align \
  --command="SELECT 1 FROM pg_database WHERE datname = 'trackfusionweb_db'")
if [[ ${database_exists} != 1 ]]; then
  runuser -u postgres -- createdb --owner=trackfusion trackfusionweb_db
fi

export PGPASSWORD=${DB_PASSWORD}
if ! runuser --preserve-environment -u trackfusion -- psql \
  --host=127.0.0.1 --username=trackfusion --dbname=trackfusionweb_db \
  --tuples-only --no-align --command='SELECT 1' | grep -qx 1; then
  unset PGPASSWORD
  echo "ERROR: the preserved database credential cannot connect as the trackfusion role." >&2
  exit 1
fi
unset PGPASSWORD

current_stage=environment-configuration
umask 077
temporary_environment=$(mktemp "${config_directory}/api.env.XXXXXX")
{
  printf '%s\n' \
    'NODE_ENV=production' \
    'HOST=127.0.0.1' \
    'PORT=8081' \
    'REQUEST_BODY_LIMIT=1mb' \
    'FRONTEND_URL=https://trackfusionweb.vercel.app' \
    'CORS_ALLOWED_ORIGINS=https://trackfusionweb.vercel.app' \
    "SESSION_SECRET=${SESSION_SECRET}" \
    "JWT_SECRET=${JWT_SECRET}" \
    "JWT_SECRET_PASSWORD_RESET=${JWT_SECRET_PASSWORD_RESET}" \
    "DATABASE_URL=postgresql://trackfusion:${DB_PASSWORD}@127.0.0.1:5432/trackfusionweb_db" \
    'REDIS_URL=redis://127.0.0.1:6379' \
    'PYTHON_EXECUTABLE=/opt/trackfusion/api/venv/bin/python' \
    'AWS_REGION=us-east-1' \
    'AWS_S3_BUCKET=trackfusionweb-audio.s3bucket-020457827871-us-east-1-an' \
    'COOKIE_SECURE=true' \
    'COOKIE_SAME_SITE=none' \
    'EMAIL_DELIVERY_ENABLED=false' \
    'EMAIL_VALIDATE_MX=false' \
    'EXPOSE_OTP_IN_DEVELOPMENT=false' \
    'EXPOSE_RESET_TOKEN_IN_DEVELOPMENT=false' \
    'AUDIO_MAX_LENGTH=900' \
    'AUDIO_MAX_FILE_SIZE=300' \
    'IMAGE_MAX_FILE_SIZE=50' \
    'ALLOWED_AUDIO_TYPES=audio/mp3,audio/wav,audio/wave,audio/mpeg,audio/ogg,audio/x-wav,audio/x-m4a,audio/aac' \
    'ALLOWED_IMAGE_TYPES=image/jpeg,image/jpg,image/png,image/heic,image/heif'
} > "${temporary_environment}"
chown root:root "${temporary_environment}"
chmod 0600 "${temporary_environment}"
mv -f -- "${temporary_environment}" "${environment_file}"
temporary_environment=

current_stage=dependency-installation
if systemctl cat trackfusionweb-api >/dev/null 2>&1; then
  systemctl stop trackfusionweb-api
fi
chown -R trackfusion:trackfusion "${app_directory}"
runuser -u trackfusion -- /usr/bin/python3 -m venv --clear "${app_directory}/venv"
runuser -u trackfusion -- "${app_directory}/venv/bin/pip" install \
  --disable-pip-version-check --no-cache-dir -r "${app_directory}/requirements.txt"
runuser -u trackfusion -- /usr/local/bin/npm ci --omit=dev \
  --prefix "${app_directory}" --no-audit --no-fund

current_stage=database-initialization
set -a
# shellcheck disable=SC1090
source "${environment_file}"
set +a
runuser --preserve-environment -u trackfusion -- \
  /usr/local/bin/node "${app_directory}/scripts/initDatabase.js"
runuser --preserve-environment -u trackfusion -- \
  /usr/local/bin/node "${app_directory}/scripts/verifyDatabase.js"

current_stage=service-configuration
install -o root -g root -m 0644 \
  "${app_directory}/deploy/systemd/trackfusionweb-api.service" \
  /etc/systemd/system/trackfusionweb-api.service
install -o root -g root -m 0644 \
  "${app_directory}/deploy/nginx/trackfusionweb-api.conf" \
  /etc/nginx/sites-available/trackfusionweb-api
ln -sfn /etc/nginx/sites-available/trackfusionweb-api \
  /etc/nginx/sites-enabled/trackfusionweb-api
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl daemon-reload
systemctl enable trackfusionweb-api >/dev/null
systemctl restart trackfusionweb-api
systemctl reload nginx

current_stage=health-check
for attempt in {1..30}; do
  if curl -fsS --connect-timeout 2 --max-time 5 \
    http://127.0.0.1:8081/health >/dev/null; then
    break
  fi
  if [[ ${attempt} -eq 30 ]]; then
    systemctl status trackfusionweb-api --no-pager >&2 || true
    journalctl -u trackfusionweb-api -n 100 --no-pager >&2 || true
    echo "ERROR: the API did not become healthy within 30 seconds." >&2
    exit 1
  fi
  sleep 1
done
if ! curl -fsS --connect-timeout 2 --max-time 5 \
  http://127.0.0.1/health >/dev/null; then
  echo "ERROR: Nginx could not reach the healthy API." >&2
  exit 1
fi

trap - ERR
echo "Application configuration and health verification completed successfully."
