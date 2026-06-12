ui      = false
api_addr = "http://127.0.0.1:8200"

storage "file" {
  path = "/var/lib/vault/data"
}

listener "tcp" {
  # Loopback-only: tls_disable is acceptable today because the listener binds
  # to 127.0.0.1 and only the relayer (also on the box) hits it. The VPS is
  # multi-tenant (another tenant), so any future change that either
  # broadens the bind address, adds another tenant with Vault network reach,
  # or moves the relayer off-box MUST flip tls_disable=0 and provide
  # tls_cert_file + tls_key_file. Mainnet T-0 review item (audit #35).
  address     = "127.0.0.1:8200"
  tls_disable = 1
}

# secp256k1 plugin loaded post-install (see ops/vault/README.md).
plugin_directory = "/etc/vault.d/plugins"
