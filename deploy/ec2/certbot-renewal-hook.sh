#!/usr/bin/env bash
set -euo pipefail

# Certbot runs deploy hooks only after it has successfully renewed a certificate.
# Validate the complete configuration before asking Nginx to adopt the new files.
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
