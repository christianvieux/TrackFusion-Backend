#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
reconciliation_script="${repository_root}/deploy/ec2/reconcile-production-environment.sh"
managed_file="${repository_root}/deploy/ec2/production-managed.env"
test_directory=$(mktemp -d)
source_file="${test_directory}/source.env"
selector_file="${test_directory}/secret-source"
mock_directory="${test_directory}/bin"
mock_mode_file="${mock_directory}/mode"
aws_call_log="${test_directory}/aws-call.log"
fake_session='session-secret-00000000000000000000000000000000'
fake_jwt='jwt-secret-0000000000000000000000000000000000'
fake_database='postgresql://trackfusion:fake-password@127.0.0.1:5432/trackfusionweb_db'
fake_resend='re_fake_value_that_must_not_be_logged'

cleanup() {
  rm -rf -- "${test_directory}"
}
trap cleanup EXIT

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

install -d -m 0700 "${mock_directory}"
cat > "${source_file}" <<'EOF'
NODE_ENV=production
HOST=127.0.0.1
PORT=8081
REQUEST_BODY_LIMIT=1mb
AWS_REGION=us-east-1
AWS_S3_BUCKET=trackfusionweb-test-bucket
FRONTEND_URL=https://old.example
CORS_ALLOWED_ORIGINS=https://old.example
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
STORAGE_PROVIDER=aws-s3
EMAIL_PROVIDER=resend
EMAIL_DELIVERY_ENABLED=true
EMAIL_VALIDATE_MX=false
REDIS_URL=redis://127.0.0.1:6379
PYTHON_EXECUTABLE=/opt/trackfusion/api/venv/bin/python
AUDIO_MAX_LENGTH=900
AUDIO_MAX_FILE_SIZE=300
IMAGE_MAX_FILE_SIZE=50
ALLOWED_AUDIO_TYPES=audio/mpeg,audio/wav
ALLOWED_IMAGE_TYPES=image/jpeg,image/png
EXPOSE_OTP_IN_DEVELOPMENT=false
EXPOSE_RESET_TOKEN_IN_DEVELOPMENT=false
SESSION_SECRET=legacy-session-secret-that-must-be-replaced
JWT_SECRET=legacy-jwt-secret-that-must-be-replaced
DATABASE_URL=postgresql://trackfusion:legacy@127.0.0.1:5432/trackfusionweb_db
RESEND_API_KEY=legacy-resend-key
INSTANCE_SETTING=preserve-this
EOF
cp "${source_file}" "${test_directory}/source.before"

cat > "${mock_directory}/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mock_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mode=$(<"${mock_directory}/mode")
printf '%s\n' "$*" >> "${mock_directory}/../aws-call.log"

if [[ -n ${AWS_ACCESS_KEY_ID:-} || -n ${AWS_SECRET_ACCESS_KEY:-} || -n ${AWS_PROFILE:-} ]]; then
  echo "static AWS credentials reached the mock" >&2
  exit 90
fi
if [[ ${AWS_SHARED_CREDENTIALS_FILE:-} != /dev/null || ${AWS_CONFIG_FILE:-} != /dev/null ]]; then
  echo "shared AWS credential files were not disabled" >&2
  exit 91
fi

case ${mode} in
  success)
    cat <<'JSON'
{
  "Parameters": [
    {"Name":"/trackfusionweb/production/api/SESSION_SECRET","Type":"SecureString","Value":"session-secret-00000000000000000000000000000000","DataType":"text"},
    {"Name":"/trackfusionweb/production/api/JWT_SECRET","Type":"SecureString","Value":"jwt-secret-0000000000000000000000000000000000","DataType":"text"},
    {"Name":"/trackfusionweb/production/api/DATABASE_URL","Type":"SecureString","Value":"postgresql://trackfusion:fake-password@127.0.0.1:5432/trackfusionweb_db","DataType":"text"},
    {"Name":"/trackfusionweb/production/api/RESEND_API_KEY","Type":"SecureString","Value":"re_fake_value_that_must_not_be_logged","DataType":"text"}
  ],
  "InvalidParameters": []
}
JSON
    ;;
  missing)
    cat <<'JSON'
{
  "Parameters": [
    {"Name":"/trackfusionweb/production/api/SESSION_SECRET","Type":"SecureString","Value":"session-secret-00000000000000000000000000000000"}
  ],
  "InvalidParameters": ["/trackfusionweb/production/api/JWT_SECRET"]
}
JSON
    ;;
  access-failure)
    echo "AccessDeniedException fake-secret-must-stay-hidden" >&2
    exit 45
    ;;
  kms-failure)
    echo "KMSAccessDeniedException fake-kms-value-must-stay-hidden" >&2
    exit 46
    ;;
  fail-if-called)
    echo "AWS must not be called before activation" >&2
    exit 47
    ;;
  *) exit 48 ;;
esac
EOF
chmod 0755 "${mock_directory}/aws"

activate_parameter_store() {
  printf '%s\n' 'ssm-parameter-store' > "${selector_file}"
  chmod 0600 "${selector_file}"
}

assert_no_secret_leak() {
  local log_file=$1
  for value in \
    "${fake_session}" \
    "${fake_jwt}" \
    "${fake_database}" \
    "${fake_resend}" \
    fake-secret-must-stay-hidden \
    fake-kms-value-must-stay-hidden; do
    if grep -Fq -- "${value}" "${log_file}"; then
      fail "secret material appeared in reconciliation output"
    fi
  done
}

test_legacy_source_stays_aws_independent() {
  local destination="${test_directory}/legacy.env"
  local log="${test_directory}/legacy.log"
  printf '%s\n' 'fail-if-called' > "${mock_mode_file}"
  rm -f -- "${selector_file}" "${aws_call_log}"

  PATH="${mock_directory}:${PATH}" bash "${reconciliation_script}" \
    "${source_file}" "${managed_file}" "${destination}" "${selector_file}" \
    >"${log}" 2>&1

  grep -Fqx 'SESSION_SECRET=legacy-session-secret-that-must-be-replaced' \
    "${destination}" || fail "legacy deployment did not preserve its current secret"
  [[ ! -e ${aws_call_log} ]] || fail "legacy deployment contacted AWS"
  cmp "${source_file}" "${test_directory}/source.before" || \
    fail "legacy reconciliation changed its source environment"
}

test_successful_parameter_reconciliation_is_atomic_and_repeatable() {
  local destination="${test_directory}/parameter-store.env"
  local repeated="${test_directory}/parameter-store-repeated.env"
  local log="${test_directory}/success.log"
  printf '%s\n' 'success' > "${mock_mode_file}"
  : > "${aws_call_log}"
  activate_parameter_store

  PATH="${mock_directory}:${PATH}" bash "${reconciliation_script}" \
    "${source_file}" "${managed_file}" "${destination}" "${selector_file}" \
    >"${log}" 2>&1

  [[ $(stat -c '%a' "${destination}") == 600 ]] || \
    fail "Parameter Store candidate permissions are not 0600"
  grep -Fqx 'INSTANCE_SETTING=preserve-this' "${destination}" || \
    fail "instance-specific nonsecret configuration was not preserved"
  grep -Fqx "SESSION_SECRET='${fake_session}'" "${destination}" || \
    fail "approved session parameter was not installed"
  grep -Fqx "RESEND_API_KEY='${fake_resend}'" "${destination}" || \
    fail "approved email parameter was not installed"
  if grep -Fq 'legacy-' "${destination}"; then
    fail "legacy secret material survived the authoritative merge"
  fi
  node --env-file="${destination}" \
    "${repository_root}/scripts/validateEnvironment.js" --local-only \
    >/dev/null
  cmp "${source_file}" "${test_directory}/source.before" || \
    fail "Parameter Store reconciliation changed its source environment"
  assert_no_secret_leak "${log}"

  grep -Fq -- '--with-decryption' "${aws_call_log}" || \
    fail "Parameter Store retrieval did not request decryption"
  for key in SESSION_SECRET JWT_SECRET DATABASE_URL RESEND_API_KEY; do
    grep -Fq -- "/trackfusionweb/production/api/${key}" "${aws_call_log}" || \
      fail "Parameter Store retrieval omitted ${key}"
  done

  PATH="${mock_directory}:${PATH}" bash "${reconciliation_script}" \
    "${destination}" "${managed_file}" "${repeated}" "${selector_file}" \
    >>"${log}" 2>&1
  cmp "${destination}" "${repeated}" || \
    fail "repeated Parameter Store reconciliation was not idempotent"

  if PATH="${mock_directory}:${PATH}" bash "${reconciliation_script}" \
    "${source_file}" "${managed_file}" "${destination}" "${selector_file}" \
    >>"${log}" 2>&1; then
    fail "reconciliation overwrote an existing destination"
  fi
  grep -Fqx "SESSION_SECRET='${fake_session}'" "${destination}" || \
    fail "failed overwrite protection changed the candidate"
}

test_failures_leave_configuration_unchanged() {
  local mode destination log
  activate_parameter_store
  for mode in missing access-failure kms-failure; do
    destination="${test_directory}/${mode}.env"
    log="${test_directory}/${mode}.log"
    printf '%s\n' "${mode}" > "${mock_mode_file}"
    if PATH="${mock_directory}:${PATH}" bash "${reconciliation_script}" \
      "${source_file}" "${managed_file}" "${destination}" "${selector_file}" \
      >"${log}" 2>&1; then
      fail "${mode} reconciliation unexpectedly succeeded"
    fi
    [[ ! -e ${destination} ]] || \
      fail "${mode} reconciliation installed a partial destination"
    cmp "${source_file}" "${test_directory}/source.before" || \
      fail "${mode} reconciliation changed the source environment"
    assert_no_secret_leak "${log}"
  done
}

test_legacy_source_stays_aws_independent
test_successful_parameter_reconciliation_is_atomic_and_repeatable
test_failures_leave_configuration_unchanged

echo "Parameter Store reconciliation checks passed"
