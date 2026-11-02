# Production secrets migration and operation

Status: migration and activation completed on 2026-10-30.

Production now uses Parameter Store as the secret authority. The root-owned
mode-`0600` `/etc/trackfusion/secret-source` contains
`ssm-parameter-store`. The code retains `legacy-environment` behavior when the
selector is absent or explicitly changed for controlled recovery, but current
production does not use that path. There is no automatic fallback after
Parameter Store is selected.

The four production values were migrated to standard SSM `SecureString`
parameters encrypted by the dedicated customer-managed KMS key.
[Production workflow #83](https://github.com/christianvieux/trackfusionweb-api/actions/runs/41111906519)
then completed successfully with a no-change Terraform plan, production
deployment, and public HTTPS check; the application was confirmed working
afterward.

Production has exactly three configuration owners:

- four secrets come from SecureString parameters below
  `/trackfusionweb/production/api/`;
- nonsecrets come from the repository-managed
  `deploy/ec2/production-managed.env` plus preserved instance-specific
  nonsecrets; and
- local development continues to use ignored `.env` files and Compose.

The generated `/etc/trackfusion/.env` is the runtime projection of those
sources. It is root-owned and mode `0600`; it is not an authoring source.

Sections 1-6 record the completed migration and remain useful for audited host
recovery or replacement. They are not pending setup tasks. Sections 7-9 contain
the continuing rollback, retirement, and secret-change guidance.

## 1. Establish GitHub protections

Completed 2026-10-30: the `production-plan`, `production-infrastructure`, and
`production` environments were configured as described in
[`deployment-orchestration.md`](deployment-orchestration.md#historical-one-time-github-setup).
For future recovery or reconfiguration, do not proceed if the workflow
preflight fails. A changed Terraform plan must
receive explicit manual approval from the configured required reviewer. In the
solo-maintainer model, the deployment initiator approves their own deployment;
this is an authorization checkpoint, not independent peer review.

## 2. Bootstrap AWS IAM and KMS

Completed 2026-10-30: the AWS bootstrap established:

- the production-parameter customer-managed KMS key;
- exact `ssm:GetParameters` access for the EC2 role;
- decrypt access through SSM for the four exact `PARAMETER_ARN` contexts; and
- the explicit deny that prevents the EC2 role from decrypting a Parameter
  Store value with any other KMS key.

Do not use the ordinary apply role for IAM/KMS bootstrap and do not reuse a
saved plan from an earlier commit. Record the nonsensitive Terraform output
`production_parameter_kms_key_arn` for parameter creation.

AWS CLI v2 was available and verified on the production host before activation.
Continue to verify its presence and version on a replacement host. The
deployment fetch runs with static credential
variables and shared credential files disabled, so it can use only the EC2
instance role. Installing or upgrading the CLI on the host is a separately
authorized host-maintenance action.

## 3. Create the four real SecureStrings

The migration created only these standard parameters in `us-east-1`:

- `/trackfusionweb/production/api/SESSION_SECRET`
- `/trackfusionweb/production/api/JWT_SECRET`
- `/trackfusionweb/production/api/DATABASE_URL`
- `/trackfusionweb/production/api/RESEND_API_KEY`

Use an administrator role narrowly authorized to create these parameters and
encrypt with the dedicated key. The GitHub application-deploy role must not
receive this permission. AWS requires `SecureString` plus `--key-id` to select
a customer-managed key; omitting the key selects the less isolated AWS-managed
SSM key. See the
[AWS SecureString creation guidance](https://docs.aws.amazon.com/systems-manager/latest/userguide/param-create-cli.html).

The following procedure is retained for audited recovery or recreation. Never
place a value in a command argument. On a trusted, non-recorded terminal, with
shell tracing and AWS CLI history disabled, use protected temporary files:

```bash
set -euo pipefail
set +x
umask 077
parameter_input_directory=$(mktemp -d)
parameter_key_arn='<production_parameter_kms_key_arn output>'
cleanup_parameter_inputs() {
  local input_file
  if [[ -n ${parameter_input_directory:-} && -d ${parameter_input_directory} ]]; then
    for input_file in "${parameter_input_directory}"/*; do
      if [[ -f ${input_file} || -L ${input_file} ]]; then
        rm -f -- "${input_file}"
      fi
    done
    rmdir -- "${parameter_input_directory}"
  fi
}
trap cleanup_parameter_inputs EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for parameter_key in SESSION_SECRET JWT_SECRET DATABASE_URL RESEND_API_KEY; do
  IFS= read -r -s -p "Enter ${parameter_key}: " parameter_value
  printf '\n'
  printf '%s' "${parameter_value}" > "${parameter_input_directory}/${parameter_key}"
  unset parameter_value
  aws ssm put-parameter \
    --region us-east-1 \
    --name "/trackfusionweb/production/api/${parameter_key}" \
    --type SecureString \
    --tier Standard \
    --key-id "${parameter_key_arn}" \
    --value "file://${parameter_input_directory}/${parameter_key}" \
    --no-overwrite \
    --no-cli-pager \
    > "${parameter_input_directory}/${parameter_key}.result.json"
done

unset parameter_key_arn parameter_key
cleanup_parameter_inputs
trap - EXIT HUP INT TERM
unset parameter_input_directory
```

The values must be nonempty single-line values without an apostrophe;
`SESSION_SECRET` and `JWT_SECRET` must be at least 32 characters. `DATABASE_URL`
must retain the existing local `trackfusion` database identity. Initial
migration copies the already-authorized production credentials; it does not
rotate them or use placeholders. Obtain them only through the approved secret
handoff, never by pasting them into chat, tickets, shell commands, or logs.

## 4. Verify EC2 access without values

First use operator metadata access to verify that all four parameters report
`Type=SecureString` and the exact dedicated KMS key ID. Do not request or print
their values during this metadata check.

```bash
for parameter_key in SESSION_SECRET JWT_SECRET DATABASE_URL RESEND_API_KEY; do
  aws ssm describe-parameters \
    --region us-east-1 \
    --parameter-filters \
      "Key=Name,Option=Equals,Values=/trackfusionweb/production/api/${parameter_key}" \
    --query 'Parameters[].{Name:Name,Type:Type,KeyId:KeyId}' \
    --output json \
    --no-cli-pager
done
unset parameter_key
```

Then use an authorized Session Manager shell on the EC2 instance to make one
allowlisted retrieval while projecting only names and types:

```bash
sudo env -i \
  PATH=/usr/local/bin:/usr/bin:/bin \
  AWS_REGION=us-east-1 \
  AWS_DEFAULT_REGION=us-east-1 \
  AWS_EC2_METADATA_DISABLED=false \
  AWS_SHARED_CREDENTIALS_FILE=/dev/null \
  AWS_CONFIG_FILE=/dev/null \
  AWS_PAGER= \
  aws ssm get-parameters \
    --names \
      /trackfusionweb/production/api/SESSION_SECRET \
      /trackfusionweb/production/api/JWT_SECRET \
      /trackfusionweb/production/api/DATABASE_URL \
      /trackfusionweb/production/api/RESEND_API_KEY \
    --with-decryption \
    --query '{Count:length(Parameters),Invalid:InvalidParameters,Names:Parameters[].Name,Types:Parameters[].Type}' \
    --output json \
    --no-cli-pager
```

Success proves that the instance role can retrieve all four. The explicit KMS
deny, scoped to calls through SSM, makes successful Parameter Store decryption
impossible for a parameter encrypted under a different key. Parameter Store
supplies each parameter ARN as KMS encryption context; AWS documents the
`PARAMETER_ARN` behavior in
[SecureString KMS encryption](https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html).

## 5. Perform the controlled cutover

The completed cutover confirmed that `AWS_SECRETS_ARN` was absent from the host
environment because the reconciler rejects that competing source. It then
selected Parameter Store without changing the running service:

```bash
printf '%s\n' 'ssm-parameter-store' | \
  sudo install -o root -g root -m 0600 /dev/stdin /etc/trackfusion/secret-source
```

The protected workflow was dispatched from the approved `main` commit. Current
deployments now:

1. retrieves the four exact names once using the EC2 role;
2. rejects missing, duplicate, unexpected, non-SecureString, empty, or unsafe
   values without printing them;
3. replaces only those four keys in a protected candidate;
4. validates the complete candidate before stopping the service;
5. backs up the working release and environment;
6. atomically installs the root-owned mode-`0600` generated environment; and
7. retains the existing application installation, health check, and rollback
   sequence.

Retrieval or preflight validation failure leaves the running environment
unchanged. After selection, failure never falls back to legacy values.

## 6. Validate after cutover

Workflow #83, its SSM deployment command, and its public HTTPS check passed on
2026-10-30, and the application was confirmed working afterward. For future
deployments, require those checks to pass. On the host, inspect metadata only:

```bash
sudo stat -c '%U:%G %a %n' /etc/trackfusion/.env /etc/trackfusion/secret-source
sudo grep -Ec '^(SESSION_SECRET|JWT_SECRET|DATABASE_URL|RESEND_API_KEY)=' \
  /etc/trackfusion/.env
```

Expected ownership/mode is `root:root 600`, and the key count is `4`. Do not
`cat`, diff, archive, or upload the generated file. Confirm registration email,
session creation, database access, storage, and background processing through
normal behavior without logging credentials.

## 7. Roll back and recover

Historical pre-cutover recovery guidance: before the completed cutover,
canceling the selection would have been explicit:

```bash
printf '%s\n' 'legacy-environment' | \
  sudo install -o root -g root -m 0600 /dev/stdin /etc/trackfusion/secret-source
```

Do not execute this selector change on current production. Returning current
production to `legacy-environment` requires a separately approved recovery
procedure.

For future deployments, signals handled after installation begins and failed
health checks invoke the existing release rollback, including restoration of the
previous environment. A rollback backup captures the selector as well as the
environment. If automated rollback fails, use the exact protected backup path
reported by the deployment with `rollback-release.sh`; never copy its
environment into an unprotected location.

Release backups under `/var/backups/trackfusionweb-api` are root-only and retain
the last known-good plaintext runtime environment and database dump. Successful
deployments keep the newest three. Review and securely remove obsolete backups
after the rollback window; a host with no later successful deployments will not
prune them automatically.

## 8. Retire legacy sources after the rollback window

Application-loader retirement was completed after stable production operation:

- the unused Secrets Manager loader and SDK dependency were removed in a
  reviewed application change;
- Parameter Store reconciliation continues to reject `AWS_SECRETS_ARN`; and
- the selector remains `ssm-parameter-store` so authority stays explicit.

Secure removal of obsolete compatibility files and expired backups remains a
separately authorized host operation. Do not remove recovery material as part
of an application deployment.

## 9. Manage future secret changes

Use the same protected-file input procedure and `put-parameter --overwrite` to
create a new Parameter Store version, then run the protected deployment. The
new value is not active until reconciliation, validation, atomic installation,
and health checks succeed. To revert, write the prior approved value as another
new version and deploy again; the EC2 role intentionally cannot read parameter
history.

Coordinate signing-secret changes with session/token invalidation expectations.
Coordinate `RESEND_API_KEY` replacement with provider revocation. Do not rotate
`DATABASE_URL` through this procedure alone: changing the parameter does not
change the local PostgreSQL role password, so database rotation requires a
separately reviewed transactional runbook with rollback.

Parameter Store does not automatically rotate these values. If automatic
rotation, cross-account access, or service-managed database rotation becomes a
requirement, reassess the selected service rather than adding a second active
secret source. AWS describes that limitation in the
[Parameter Store reference](https://docs.aws.amazon.com/systems-manager/latest/userguide/what-is-a-parameter.html).
