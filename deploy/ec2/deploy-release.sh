#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: deploy-release.sh must run as root." >&2
  exit 1
fi

requested_staging=${1:-}
release_id=${2:-}
if [[ -z ${requested_staging} || ! ${release_id} =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: usage: deploy-release.sh <staging-directory> <40-character-release-id>" >&2
  exit 1
fi

staging_directory=$(realpath -e "${requested_staging}")
expected_staging="/tmp/trackfusionweb-${release_id}"
if [[ ${staging_directory} != "${expected_staging}" ]]; then
  echo "ERROR: the release staging directory is not recognized." >&2
  exit 1
fi

app_directory=/opt/trackfusion/api
service_name=trackfusionweb-api
health_check_script="${staging_directory}/deploy/ec2/check-api-health.sh"
backup_directory=
service_stopped=false
deployment_started=false

wait_for_health() {
  bash "${health_check_script}" 30
}

for required_path in \
  "${staging_directory}/package-lock.json" \
  "${staging_directory}/requirements.txt" \
  "${staging_directory}/scripts/validateEnvironment.js" \
  "${staging_directory}/deploy/ec2/backup-release.sh" \
  "${staging_directory}/deploy/ec2/check-api-health.sh" \
  "${staging_directory}/deploy/ec2/configure-app.sh" \
  "${staging_directory}/deploy/ec2/migrate-environment-file.sh" \
  "${staging_directory}/deploy/ec2/prune-release-backups.sh" \
  "${staging_directory}/deploy/ec2/rollback-release.sh" \
  "${staging_directory}/deploy/systemd/trackfusionweb-api.service"; do
  if [[ ! -f ${required_path} ]]; then
    echo "ERROR: release is missing required file: ${required_path}" >&2
    exit 1
  fi
done

handle_exit() {
  local status=$?
  trap - EXIT

  if (( status == 0 )); then
    exit 0
  fi

  echo "ERROR: release ${release_id} failed; beginning recovery." >&2
  if [[ ${deployment_started} == true && -n ${backup_directory} ]]; then
    if bash "${staging_directory}/deploy/ec2/rollback-release.sh" "${backup_directory}"; then
      echo "The previous application release was restored successfully." >&2
    else
      echo "ERROR: automatic rollback failed. Manual recovery is required from ${backup_directory}." >&2
    fi
  elif [[ ${service_stopped} == true ]]; then
    echo "Restarting the unchanged application release." >&2
    if systemctl start "${service_name}" && wait_for_health; then
      echo "The unchanged application release is healthy." >&2
    else
      echo "ERROR: the unchanged application release did not restart cleanly." >&2
    fi
  fi

  exit "${status}"
}
trap handle_exit EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

if ! systemctl is-active --quiet "${service_name}"; then
  echo "ERROR: refusing to replace a production release that is not currently active." >&2
  exit 1
fi
if ! wait_for_health; then
  echo "ERROR: refusing to replace a production release that is not currently healthy." >&2
  exit 1
fi

echo "Stopping the API briefly to create a consistent application backup." >&2
systemctl stop "${service_name}"
service_stopped=true

backup_directory=$(bash "${staging_directory}/deploy/ec2/backup-release.sh" "${release_id}")
echo "Pre-deployment backup completed: ${backup_directory}" >&2

deployment_started=true
echo "Installing release ${release_id}." >&2
rsync -a --delete \
  --exclude='venv/' \
  --exclude='node_modules/' \
  --exclude='uploads/' \
  "${staging_directory}/" "${app_directory}/"

bash "${app_directory}/deploy/ec2/configure-app.sh"
health_check_script="${app_directory}/deploy/ec2/check-api-health.sh"

if ! wait_for_health; then
  echo "ERROR: post-installation application or Nginx health check failed." >&2
  exit 1
fi

echo "Release ${release_id} passed all health checks." >&2

# The pre-deployment backup contains the legacy file and systemd unit. Remove
# api.env only after the new unit has loaded .env and passed both health checks.
canonical_environment=/etc/trackfusion/.env
legacy_environment=/etc/trackfusion/api.env
installed_service=/etc/systemd/system/trackfusionweb-api.service
if [[ -f ${legacy_environment} ]]; then
  if [[ ! -f ${canonical_environment} ]] || \
     ! grep -Fqx 'EnvironmentFile=/etc/trackfusion/.env' "${installed_service}" || \
     [[ ! -f ${backup_directory}/config/api.env ]]; then
    echo "ERROR: refusing to finalize the environment migration without a verified canonical file and legacy backup." >&2
    exit 1
  fi
  rm -f -- "${legacy_environment}"
  echo "Production environment migration finalized; the protected release backup retains api.env for recovery." >&2
fi

if ! bash "${app_directory}/deploy/ec2/prune-release-backups.sh" 3; then
  echo "WARNING: release succeeded, but expired backups could not be pruned." >&2
fi
