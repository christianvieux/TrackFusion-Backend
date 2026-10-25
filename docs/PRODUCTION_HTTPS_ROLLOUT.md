# Production HTTPS rollout

This is the Phase B runbook for `api.trackfusionweb.com`. Phase A only prepares and validates the repository. Do not run these steps until the feature branch is reviewed and the owner explicitly approves AWS, DNS, certificate, and deployment changes.

## Preconditions

- Work from the reviewed HTTPS commit with a clean tree.
- Confirm access to the `trackfusionweb-admin` AWS profile and the EC2 SSH key.
- Confirm the GitHub `production` environment still restricts deployments to `main` and has the intended reviewer gate.
- Choose a monitored email address for Let's Encrypt expiry and incident notices.
- Keep the current API running while the stable address and DNS are prepared.

## 1. Review the stable-IP change

```bash
aws sso login --profile trackfusionweb-admin
AWS_PROFILE=trackfusionweb-admin \
  terraform -chdir=infrastructure/terraform init
AWS_PROFILE=trackfusionweb-admin \
  terraform -chdir=infrastructure/terraform plan \
  -out=production-https.tfplan
terraform -chdir=infrastructure/terraform show production-https.tfplan
```

The plan should add exactly one `aws_eip.api` and one `aws_eip_association.api`, with no changes or destroys. Stop if it proposes changing, destroying, or replacing the EC2 instance, S3 bucket, IAM identities, security group, or SSM document.

After separate approval, apply only the saved, reviewed plan:

```bash
AWS_PROFILE=trackfusionweb-admin \
  terraform -chdir=infrastructure/terraform apply production-https.tfplan
terraform -chdir=infrastructure/terraform output api_dns_a_record
```

Associating the Elastic IP releases the old temporary address. Expect a brief interruption until DNS points to the new address. The application and instance are not replaced.

AWS currently charges `$0.005` per hour for either the temporary public IPv4 address or an Elastic IP (about `$3.60` for a 30-day month). Because the Elastic IP replaces the current address, the expected steady-state incremental cost is `$0`; an allocated but idle Elastic IP is still billed.

## 2. Change only the IONOS API record

In IONOS, replace the existing record with:

| Field | Exact value |
| --- | --- |
| Type | `A` |
| Host/name | `api` |
| Value | output of `terraform -chdir=infrastructure/terraform output -raw api_public_ip` |
| TTL | `300` |

Do not modify root-domain, `www`, MX, DKIM, SPF, DMARC, or other TXT records.

Wait until public resolvers return only the Elastic IP:

```bash
getent ahostsv4 api.trackfusionweb.com
curl -fsS http://api.trackfusionweb.com/health
```

## 3. Stage the reviewed HTTPS files

The first certificate must exist before the updated GitHub deployment's mandatory public HTTPS check. Copy only the reviewed, secret-free activation files to the current host. Replace `PATH_TO_KEY` and `ELASTIC_IP` locally:

```bash
scp -i PATH_TO_KEY \
  deploy/nginx/trackfusionweb-api.conf \
  deploy/nginx/trackfusionweb-api-proxy.conf \
  deploy/nginx/trackfusionweb-api-tls.conf \
  ubuntu@ELASTIC_IP:/tmp/

scp -i PATH_TO_KEY \
  deploy/ec2/setup-https.sh \
  deploy/ec2/certbot-renewal-hook.sh \
  deploy/ec2/check-api-health.sh \
  ubuntu@ELASTIC_IP:/tmp/

ssh -i PATH_TO_KEY ubuntu@ELASTIC_IP
sudo install -o trackfusion -g trackfusion -m 0644 \
  /tmp/trackfusionweb-api.conf \
  /opt/trackfusion/api/deploy/nginx/trackfusionweb-api.conf
sudo install -o trackfusion -g trackfusion -m 0644 \
  /tmp/trackfusionweb-api-proxy.conf \
  /opt/trackfusion/api/deploy/nginx/trackfusionweb-api-proxy.conf
sudo install -o trackfusion -g trackfusion -m 0644 \
  /tmp/trackfusionweb-api-tls.conf \
  /opt/trackfusion/api/deploy/nginx/trackfusionweb-api-tls.conf
sudo install -o trackfusion -g trackfusion -m 0755 \
  /tmp/setup-https.sh /opt/trackfusion/api/deploy/ec2/setup-https.sh
sudo install -o trackfusion -g trackfusion -m 0755 \
  /tmp/certbot-renewal-hook.sh \
  /opt/trackfusion/api/deploy/ec2/certbot-renewal-hook.sh
sudo install -o trackfusion -g trackfusion -m 0755 \
  /tmp/check-api-health.sh \
  /opt/trackfusion/api/deploy/ec2/check-api-health.sh
rm -f /tmp/trackfusionweb-api.conf \
  /tmp/trackfusionweb-api-proxy.conf \
  /tmp/trackfusionweb-api-tls.conf \
  /tmp/setup-https.sh /tmp/certbot-renewal-hook.sh /tmp/check-api-health.sh
```

Compare local and remote SHA-256 values before execution if the transfer crosses any untrusted intermediary.

## 4. Issue the certificate and activate HTTPS

On EC2, replace the email value and run:

```bash
sudo bash /opt/trackfusion/api/deploy/ec2/setup-https.sh \
  tls-notices@example.com
```

The script verifies DNS, requests one ECDSA certificate with Certbot's webroot plugin, validates Nginx before each graceful reload, enables `certbot.timer`, and runs `certbot renew --dry-run`. It is safe to rerun after correcting a reported problem. Do not repeatedly request new certificate names; Let's Encrypt rate limits apply.

## 5. Verify HTTPS, renewal, and authentication

```bash
curl -fsS --proto '=https' --tlsv1.2 \
  https://api.trackfusionweb.com/health
curl -sSI http://api.trackfusionweb.com/health
sudo nginx -t
sudo systemctl status nginx trackfusionweb-api certbot.timer --no-pager
sudo certbot certificates
sudo certbot renew --dry-run --cert-name api.trackfusionweb.com
```

The HTTP response must redirect to `https://api.trackfusionweb.com/...`; HTTPS health must return `200`. In a supported browser at `https://trackfusionweb.vercel.app`, test login, `GET /auth/session`, logout, registration OTP behavior, forgot/reset password behavior, and an authenticated request. Confirm requests use credentials and cookies show `Secure`, `HttpOnly`, and `SameSite=None`.

## 6. Put the complete release on the host

After the HTTPS commit is reviewed and merged to `main`, manually run the existing **TrackFusionWeb API CI/CD** workflow. Keep the protected `production` approval gate. The deployment must pass its internal TLS health check and public HTTPS smoke checks. Confirm the weekly **TLS certificate expiry** workflow also passes when manually dispatched.

## Recovery

If Elastic IP association succeeds but DNS has not propagated, the API remains reachable at the new IP over HTTP for diagnosis; update only the IONOS `api` A record and wait for its TTL. Do not point production DNS back to an address AWS has released.

If certificate issuance fails, the script does not create the HTTPS marker, restores the prior Nginx files, and leaves HTTP serving. Check DNS, ports, Nginx, and `/var/log/letsencrypt/letsencrypt.log` before retrying.

If HTTPS activates but a later renewal dry-run fails, the script deliberately leaves the working certificate and TLS listener active. Resolve the renewal error before considering rollout complete.

If a subsequent application deployment fails, use its automatic rollback result first. For manual recovery, select the newly created backup under `/var/backups/trackfusionweb-api` and run the tracked `rollback-release.sh`. Application rollback does not delete or replace `/etc/letsencrypt`.
