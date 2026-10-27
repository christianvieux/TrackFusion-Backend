#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: configure-app.sh must run as root." >&2
  exit 1
fi

app_directory=/opt/trackfusion/api
config_directory=/etc/trackfusion
secrets_file="${config_directory}/secrets.env"
environment_file="${config_directory}/.env"
current_stage=preflight

report_error() {
  local status=$?
  local line_number=$1
  trap - ERR
  echo "ERROR: application configuration failed during '${current_stage}' at line ${line_number} (exit ${status})." >&2
  exit "${status}"
}
trap 'report_error "${LINENO}"' ERR

for command_name in \
  createdb curl grep nginx npm pg_isready psql python3 redis-cli runuser systemctl systemd-run; do
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
  "${app_directory}/scripts/validateEnvironment.js" \
  "${app_directory}/deploy/systemd/trackfusionweb-api.service" \
  "${app_directory}/deploy/nginx/trackfusionweb-api.conf" \
  "${app_directory}/deploy/nginx/trackfusionweb-api-proxy.conf" \
  "${app_directory}/deploy/nginx/trackfusionweb-api-tls.conf" \
  "${app_directory}/deploy/ec2/check-api-health.sh"; do
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

current_stage=environment-permissions
install -d -o root -g root -m 0700 "${config_directory}"
install -d -o trackfusion -g trackfusion -m 0750 "${app_directory}/uploads/temp"

if [[ ! -f ${environment_file} || -L ${environment_file} ]]; then
  echo "ERROR: the reconciled production environment must be a regular file: ${environment_file}" >&2
  exit 1
fi
chown root:root "${environment_file}"
chmod 0600 "${environment_file}"

# secrets.env is retained as a protected recovery artifact for installations
# created by older releases. The application and deployment commands use .env.
if [[ -e ${secrets_file} ]]; then
  if [[ ! -f ${secrets_file} || -L ${secrets_file} ]]; then
    echo "ERROR: ${secrets_file} must be a regular file when present." >&2
    exit 1
  fi
  chown root:root "${secrets_file}"
  chmod 0600 "${secrets_file}"
fi

current_stage=database-credential-validation
database_password=$(
  /usr/bin/env -i /usr/local/bin/node \
    --env-file="${environment_file}" \
    --input-type=module \
    --eval '
      const value = process.env.DATABASE_URL;
      if (!value) throw new Error("DATABASE_URL is missing from the production environment");
      const url = new URL(value);
      const localHosts = new Set(["127.0.0.1", "localhost"]);
      if (!["postgres:", "postgresql:"].includes(url.protocol) ||
          url.username !== "trackfusion" ||
          !url.password ||
          !localHosts.has(url.hostname) ||
          (url.port && url.port !== "5432") ||
          url.pathname !== "/trackfusionweb_db") {
        throw new Error("DATABASE_URL must identify the local trackfusion production database");
      }
      process.stdout.write(decodeURIComponent(url.password));
    '
)

current_stage=database-access
role_exists=$(runuser -u postgres -- psql --dbname=postgres --tuples-only --no-align \
  --command="SELECT 1 FROM pg_roles WHERE rolname = 'trackfusion'")
if [[ ${role_exists} != 1 ]]; then
  # Pass the password through the child environment instead of SQL arguments or logs.
  export DATABASE_PASSWORD=${database_password}
  runuser --preserve-environment -u postgres -- psql --dbname=postgres \
    --set=ON_ERROR_STOP=1 <<'SQL'
\getenv db_password DATABASE_PASSWORD
SELECT format('CREATE ROLE trackfusion WITH LOGIN PASSWORD %L', :'db_password') \gexec
SQL
  export -n DATABASE_PASSWORD
fi

database_exists=$(runuser -u postgres -- psql --dbname=postgres --tuples-only --no-align \
  --command="SELECT 1 FROM pg_database WHERE datname = 'trackfusionweb_db'")
if [[ ${database_exists} != 1 ]]; then
  runuser -u postgres -- createdb --owner=trackfusion trackfusionweb_db
fi

export PGPASSWORD=${database_password}
if ! runuser --preserve-environment -u trackfusion -- psql \
  --host=127.0.0.1 --username=trackfusion --dbname=trackfusionweb_db \
  --tuples-only --no-align --command='SELECT 1' | grep -qx 1; then
  unset PGPASSWORD
  echo "ERROR: the preserved database credential cannot connect as the trackfusion role." >&2
  exit 1
fi
unset PGPASSWORD
unset database_password

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

run_with_production_environment() {
  local unit_name="trackfusion-configure-$$-${RANDOM}"
  systemd-run --quiet --wait --pipe --collect \
    --unit="${unit_name}" \
    --uid=trackfusion \
    --gid=trackfusion \
    --working-directory="${app_directory}" \
    --property="EnvironmentFile=${environment_file}" \
    "$@"
}

current_stage=environment-validation
run_with_production_environment \
  /usr/local/bin/node "${app_directory}/scripts/validateEnvironment.js"

current_stage=database-initialization
run_with_production_environment \
  /usr/local/bin/node "${app_directory}/scripts/initDatabase.js"
run_with_production_environment \
  /usr/local/bin/node "${app_directory}/scripts/verifyDatabase.js"

current_stage=service-configuration
install -o root -g root -m 0644 \
  "${app_directory}/deploy/systemd/trackfusionweb-api.service" \
  /etc/systemd/system/trackfusionweb-api.service
install -d -o root -g root -m 0755 /etc/nginx/snippets
install -o root -g root -m 0644 \
  "${app_directory}/deploy/nginx/trackfusionweb-api-proxy.conf" \
  /etc/nginx/snippets/trackfusionweb-api-proxy.conf
install -o root -g root -m 0644 \
  "${app_directory}/deploy/nginx/trackfusionweb-api.conf" \
  /etc/nginx/sites-available/trackfusionweb-api
ln -sfn /etc/nginx/sites-available/trackfusionweb-api \
  /etc/nginx/sites-enabled/trackfusionweb-api
rm -f /etc/nginx/sites-enabled/default

if [[ -f /etc/nginx/trackfusionweb-api-https-enabled ]]; then
  for certificate_file in \
    /etc/letsencrypt/live/api.trackfusionweb.com/fullchain.pem \
    /etc/letsencrypt/live/api.trackfusionweb.com/privkey.pem; do
    if [[ ! -s ${certificate_file} ]]; then
      echo "ERROR: HTTPS is marked active, but ${certificate_file} is missing." >&2
      exit 1
    fi
  done
  install -o root -g root -m 0644 \
    "${app_directory}/deploy/nginx/trackfusionweb-api-tls.conf" \
    /etc/nginx/sites-available/trackfusionweb-api-tls
  ln -sfn /etc/nginx/sites-available/trackfusionweb-api-tls \
    /etc/nginx/sites-enabled/trackfusionweb-api-tls
fi

nginx -t
systemctl daemon-reload
systemctl enable trackfusionweb-api >/dev/null
systemctl restart trackfusionweb-api
systemctl reload nginx

current_stage=health-check
if ! bash "${app_directory}/deploy/ec2/check-api-health.sh" 30; then
  systemctl status trackfusionweb-api --no-pager >&2 || true
  journalctl -u trackfusionweb-api -n 100 --no-pager >&2 || true
  echo "ERROR: the API did not pass its direct and Nginx health checks." >&2
  exit 1
fi

trap - ERR
echo "Application configuration and health verification completed successfully."
