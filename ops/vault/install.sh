#!/usr/bin/env bash
# Vault installer for the Arcora relayer key. Run on the VPS as root.
# Idempotent: re-running is safe (skips already-installed bits).
set -euo pipefail

VAULT_VERSION="${VAULT_VERSION:-1.18.2}"
ARCH="$(dpkg --print-architecture)"

if ! command -v vault >/dev/null 2>&1; then
  echo "[install] downloading vault ${VAULT_VERSION}_linux_${ARCH}…"
  curl -fsSL -o /tmp/vault.zip "https://releases.hashicorp.com/vault/${VAULT_VERSION}/vault_${VAULT_VERSION}_linux_${ARCH}.zip"
  unzip -o /tmp/vault.zip -d /usr/local/bin
  chmod +x /usr/local/bin/vault
  rm -f /tmp/vault.zip
fi

if ! id vault >/dev/null 2>&1; then
  useradd --system --home /etc/vault.d --shell /bin/false vault
fi

mkdir -p /etc/vault.d /etc/vault.d/plugins /var/lib/vault/data
cp ops/vault/config.hcl       /etc/vault.d/config.hcl
cp ops/vault/policy-relayer.hcl /etc/vault.d/policy-relayer.hcl
chown -R vault:vault /etc/vault.d /var/lib/vault
chmod 640 /etc/vault.d/config.hcl

cp ops/vault/vault.service /etc/systemd/system/vault.service
systemctl daemon-reload
systemctl enable vault.service
systemctl start vault.service

# Allow root to use the API
echo 'export VAULT_ADDR="http://127.0.0.1:8200"' >> /root/.bashrc

echo
echo "[install] Vault installed and started."
echo "Next steps (interactive — see ops/vault/README.md):"
echo "  1. vault operator init -key-shares=3 -key-threshold=2  # save the keys offline"
echo "  2. vault operator unseal  # twice with two different unseal keys"
echo "  3. vault secrets enable -version=2 -path=secret kv  # KV-v2 for the relayer key"
echo "  4. vault kv put secret/relayer-v10 privateKey=0x<32-byte-hex>"
echo "  5. vault auth enable approle"
echo "  6. vault write auth/approle/role/relayer secret_id_ttl=24h token_ttl=2h policies=relayer"
echo "  7. vault policy write relayer /etc/vault.d/policy-relayer.hcl"
