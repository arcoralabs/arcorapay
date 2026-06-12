# Rotation-operator policy — least-privilege grant for the daily AppRole
# secret_id rotation cron. Audit 2026-05-13 follow-up: the cron previously
# used /root/.vault-token (root token, full Vault access). This policy is
# scoped to the single endpoint the rotation actually needs.
#
# Apply on prod:
#   vault policy write rotation-operator ops/vault/policy-rotation-operator.hcl
#   vault token create -policy=rotation-operator -display-name=cron-rotation \
#     -orphan -ttl=8760h -renewable=true -field=token > /etc/arcora/rotation-operator.token
#   chmod 600 /etc/arcora/rotation-operator.token
#   # Update cron to source from the new token file (see ops/vault/secret-id-rotation.sh).
path "auth/approle/role/relayer/secret-id" {
  capabilities = ["update"]
}
