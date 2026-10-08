#!/bin/bash
# Runs as root on the instance after each code update (deploy.sh → SSM → wordlight-update, then this script).
# Owns the Caddy configuration so it can change without replacing the instance.
#  • key_type rsa2048: an RSA certificate chains to ISRG Root X1 (Let's Encrypt), the most widely trusted chain.
#    (Added while diagnosing curl error 60 on the Vega Virtual Device, 2026-10-08. The actual cause there turned out
#    to be the VVD's clock running 7 h 22 min slow, so a certificate issued hours earlier looked "not yet valid".
#    RSA is kept for broad device compatibility; it wasn't the fix.)
set -euo pipefail
HOST="$(sed 's#https://##' /opt/wordlight/host)"
cat > /etc/caddy.json.Caddyfile <<CADDY
{
  key_type rsa2048
}
$HOST {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
CADDY
leaf_key() { echo | timeout 5 openssl s_client -connect 127.0.0.1:443 -servername "$HOST" 2>/dev/null | openssl x509 -noout -text 2>/dev/null | grep -m1 'Public Key Algorithm' | sed 's/.*: //'; }
KEY="$(leaf_key || true)"
if [ "$KEY" != rsaEncryption ]; then
  echo "served key: ${KEY:-none} → requesting an RSA certificate"
  systemctl stop caddy
  # remove the stored certificate for this host (Caddy keeps it in its data dir; location depends on HOME/XDG)
  find / -xdev -type d -path '*/certificates/*' -name "$HOST" -prune -exec rm -rf {} + 2>/dev/null || true
  systemctl start caddy
  for i in $(seq 30); do sleep 3; KEY="$(leaf_key || true)"; [ "$KEY" = rsaEncryption ] && break; done
else systemctl reload caddy 2>/dev/null || systemctl restart caddy; fi
echo "served key: ${KEY:-none}"
echo | timeout 5 openssl s_client -connect 127.0.0.1:443 -servername "$HOST" -showcerts 2>/dev/null | grep -E '^ *[0-9] s:|^ *i:' || true
