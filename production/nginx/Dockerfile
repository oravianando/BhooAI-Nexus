# BhooAI Nexus nginx - reverse proxy with self-signed cert bootstrap.
FROM nginx:alpine

# openssl is used by docker-entrypoint.d/10-ensure-certs.sh to generate the
# bootstrap cert on first start (real Let's Encrypt certs replace it later).
RUN apk add --no-cache openssl
