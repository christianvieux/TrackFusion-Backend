#!/usr/bin/env bash
set -euo pipefail

attempts=${1:-30}
domain=api.trackfusionweb.com
https_marker=/etc/nginx/trackfusionweb-api-https-enabled

if [[ ! ${attempts} =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: health-check attempts must be a positive integer." >&2
  exit 1
fi

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  direct_healthy=false
  proxy_healthy=false

  if curl -fsS --connect-timeout 2 --max-time 5 \
    http://127.0.0.1:8081/health >/dev/null; then
    direct_healthy=true
  fi

  if [[ -f ${https_marker} ]]; then
    if curl -fsS --connect-timeout 2 --max-time 5 \
      --proto '=https' --tlsv1.2 \
      --resolve "${domain}:443:127.0.0.1" \
      "https://${domain}/health" >/dev/null; then
      proxy_healthy=true
    fi
  elif curl -fsS --connect-timeout 2 --max-time 5 \
    --header "Host: ${domain}" http://127.0.0.1/health >/dev/null; then
    proxy_healthy=true
  fi

  if [[ ${direct_healthy} == true && ${proxy_healthy} == true ]]; then
    exit 0
  fi

  if (( attempt < attempts )); then
    sleep 1
  fi
done

if [[ -f ${https_marker} ]]; then
  echo "ERROR: direct or HTTPS API health check failed after ${attempts} attempts." >&2
else
  echo "ERROR: direct or bootstrap HTTP API health check failed after ${attempts} attempts." >&2
fi
exit 1
