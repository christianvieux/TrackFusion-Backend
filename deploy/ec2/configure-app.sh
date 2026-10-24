#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

app_directory=/opt/trackfusion/api
config_directory=/etc/trackfusion
secrets_file="${config_directory}/secrets.env"
environment_file="${config_directory}/api.env"

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

# shellcheck disable=SC1090
source "${secrets_file}"

runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c \
  "DO \$\$ BEGIN
     IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'trackfusion') THEN
       ALTER ROLE trackfusion WITH LOGIN PASSWORD '${DB_PASSWORD}';
     ELSE
       CREATE ROLE trackfusion WITH LOGIN PASSWORD '${DB_PASSWORD}';
     END IF;
   END \$\$;"

if ! runuser -u postgres -- psql -tAc \
  "SELECT 1 FROM pg_database WHERE datname = 'trackfusionweb_db'" | grep -q 1; then
  runuser -u postgres -- createdb --owner=trackfusion trackfusionweb_db
fi

umask 077
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
} > "${environment_file}"
chmod 0600 "${environment_file}" "${secrets_file}"

chown -R trackfusion:trackfusion "${app_directory}"

runuser -u trackfusion -- /usr/bin/python3 -m venv "${app_directory}/venv"
runuser -u trackfusion -- "${app_directory}/venv/bin/pip" install \
  --disable-pip-version-check --no-cache-dir -r "${app_directory}/requirements.txt"
runuser -u trackfusion -- /usr/local/bin/npm ci --omit=dev \
  --prefix "${app_directory}" --no-audit --no-fund

set -a
# shellcheck disable=SC1090
source "${environment_file}"
set +a
runuser --preserve-environment -u trackfusion -- \
  /usr/local/bin/node "${app_directory}/scripts/initDatabase.js"
runuser --preserve-environment -u trackfusion -- \
  /usr/local/bin/node "${app_directory}/scripts/verifyDatabase.js"

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
systemctl enable trackfusionweb-api
systemctl restart trackfusionweb-api
systemctl reload nginx

for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:8081/health; then
    break
  fi
  if [[ ${attempt} -eq 30 ]]; then
    journalctl -u trackfusionweb-api -n 100 --no-pager
    exit 1
  fi
  sleep 1
done
curl -fsS http://127.0.0.1/health

