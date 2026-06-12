/**
 * Boolean env flag parser shared by the payment compliance gates
 * (COMPLIANCE_FAIL_OPEN_FOR_PAY in checkout/authorize and crosschain/prepare).
 * Single definition so flag semantics can never drift between routes.
 */
export function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "true" || v === "1";
}
