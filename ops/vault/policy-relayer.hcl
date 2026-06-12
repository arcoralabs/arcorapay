# Relayer access policy — KV-v2 read of the relayer private key only.
# The runtime (ops/relayer/vault-signer.ts) reads `secret/data/relayer-v10`
# and AppRole-logs in with VAULT_ROLE_ID + VAULT_SECRET_ID.
path "secret/data/relayer-v10" {
  capabilities = ["read"]
}

# Plan 11 (mainnet T-0): when the relayer moves to a Vault transit secp256k1
# signer or an HSM, swap the grant above for `transit/sign/relayer-v10`
# (update) + `transit/keys/relayer-v10` (read).
