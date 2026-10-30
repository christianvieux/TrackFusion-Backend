#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

source_file=${1:-}
managed_file=${2:-}
destination_file=${3:-}
selector_file=${4:-/etc/trackfusion/secret-source}

if [[ -z ${source_file} || -z ${managed_file} || -z ${destination_file} ]]; then
  echo "ERROR: usage: reconcile-production-environment.sh <source-environment> <managed-settings> <destination-environment> [secret-source-selector]" >&2
  exit 1
fi

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "${script_directory}/../.." && pwd)
base_reconciliation="${script_directory}/reconcile-environment-file.sh"
parameter_helper="${repository_root}/scripts/productionParameters.js"

for required_file in \
  "${source_file}" \
  "${managed_file}" \
  "${base_reconciliation}" \
  "${parameter_helper}"; do
  if [[ ! -f ${required_file} || -L ${required_file} ]]; then
    echo "ERROR: production reconciliation input must be a regular file: ${required_file}" >&2
    exit 1
  fi
done
if [[ -e ${destination_file} || -L ${destination_file} ]]; then
  echo "ERROR: refusing to overwrite the destination environment: ${destination_file}" >&2
  exit 1
fi

secret_source=legacy-environment
if [[ -e ${selector_file} || -L ${selector_file} ]]; then
  if [[ ! -f ${selector_file} || -L ${selector_file} ]]; then
    echo "ERROR: the production secret-source selector must be a regular file." >&2
    exit 1
  fi
  if [[ $(stat -c '%u' "${selector_file}") != "${EUID}" ]] || \
     [[ $(stat -c '%a' "${selector_file}") != 600 ]]; then
    echo "ERROR: the production secret-source selector must be owned by the deployment user with mode 0600." >&2
    exit 1
  fi
  mapfile -t selector_lines < "${selector_file}"
  if [[ ${#selector_lines[@]} -ne 1 || -z ${selector_lines[0]} ]]; then
    echo "ERROR: the production secret-source selector must contain exactly one nonempty line." >&2
    exit 1
  fi
  secret_source=${selector_lines[0]}
fi

case ${secret_source} in
  legacy-environment)
    bash "${base_reconciliation}" \
      "${source_file}" "${managed_file}" "${destination_file}"
    echo "Production configuration reconciled with the inactive legacy secret source." >&2
    exit 0
    ;;
  ssm-parameter-store) ;;
  *)
    echo "ERROR: the production secret-source selector is invalid." >&2
    exit 1
    ;;
esac

node_executable=/usr/local/bin/node
if [[ ! -x ${node_executable} ]]; then
  node_executable=$(command -v node || true)
fi
aws_executable=$(command -v aws || true)
if [[ -z ${node_executable} || -z ${aws_executable} ]]; then
  echo "ERROR: Parameter Store reconciliation requires Node.js and the AWS CLI." >&2
  exit 1
fi

destination_directory=$(dirname -- "${destination_file}")
working_directory=$(mktemp -d "${destination_directory}/.parameter-store.XXXXXX")
chmod 0700 "${working_directory}"
managed_candidate="${working_directory}/managed.env"
parameter_response="${working_directory}/parameters.json"
parameter_error="${working_directory}/aws-error.log"

cleanup() {
  rm -rf -- "${working_directory}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

bash "${base_reconciliation}" \
  "${source_file}" "${managed_file}" "${managed_candidate}"
aws_region=$("${node_executable}" "${parameter_helper}" region "${managed_candidate}")

parameter_names=(
  /trackfusionweb/production/api/SESSION_SECRET
  /trackfusionweb/production/api/JWT_SECRET
  /trackfusionweb/production/api/DATABASE_URL
  /trackfusionweb/production/api/RESEND_API_KEY
)

set +e
/usr/bin/env -i \
  PATH=/usr/local/bin:/usr/bin:/bin \
  AWS_REGION="${aws_region}" \
  AWS_DEFAULT_REGION="${aws_region}" \
  AWS_EC2_METADATA_DISABLED=false \
  AWS_SHARED_CREDENTIALS_FILE=/dev/null \
  AWS_CONFIG_FILE=/dev/null \
  AWS_CLI_AUTO_PROMPT=off \
  AWS_PAGER= \
  "${aws_executable}" ssm get-parameters \
    --names "${parameter_names[@]}" \
    --with-decryption \
    --output json \
    --no-cli-pager \
    > "${parameter_response}" 2> "${parameter_error}"
aws_status=$?
set -e
if (( aws_status != 0 )); then
  echo "ERROR: production Parameter Store retrieval failed; the existing runtime configuration was not changed." >&2
  exit 1
fi

"${node_executable}" "${parameter_helper}" merge \
  "${managed_candidate}" "${parameter_response}" "${destination_file}"
if [[ $(stat -c '%a' "${destination_file}") != 600 ]]; then
  echo "ERROR: the reconciled production environment is not protected with mode 0600." >&2
  exit 1
fi

echo "Production configuration reconciled from the approved Parameter Store allowlist." >&2
