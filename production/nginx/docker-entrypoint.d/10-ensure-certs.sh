#!/bin/sh
# Bootstrap: generate a self-signed cert if no real cert is present yet so
# nginx always starts and opens :80/:443. Replace with Let's Encrypt certs
# (fullchain.pem + privkey.pem) when ready; a reload picks them up.

set -e

if [ ! -f /etc/nginx/ssl/fullchain.pem ] || [ ! -f /etc/nginx/ssl/privkey.pem ]; then
  echo "[entrypoint] no certs found - generating self-signed bootstrap cert"
  mkdir -p /etc/nginx/ssl
  openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
    -keyout /etc/nginx/ssl/privkey.pem \
    -out /etc/nginx/ssl/fullchain.pem \
    -subj "/CN=*.bhooai.com" \
    -addext "subjectAltName=DNS:bhooai.com,DNS:admin.bhooai.com,DNS:*.bhooai.com"
fi
