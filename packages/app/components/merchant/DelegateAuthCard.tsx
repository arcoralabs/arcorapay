"use client";

import { useAccount, useWriteContract, useReadContract, usePublicClient } from "wagmi";
import { parseAbi, type Address } from "viem";
import { useState } from "react";
import { toast } from "sonner";

// Bit-flag delegate rights + 3-arg authorizeDelegate (custody-escrow gateway surface).
const GW_ABI = parseAbi([
  "function authorizeDelegate(address delegate, uint64 expiresAt, uint8 rights) external",
  "function delegates(address merchant, address delegate) view returns (uint64 expiresAt, uint8 rights)",
  "function registerMerchant(address payoutAddress, address payoutToken) external",
  "function merchants(address) view returns (address payoutAddress, address payoutToken, bool active)",
]);

// Bit-flag rights (from ArcFXGateway.sol):
//   RIGHT_CREATE_INVOICE = 1 << 0  (= 0x01)
//   RIGHT_REFUND         = 1 << 1  (= 0x02)
// Server delegate that submits createInvoiceFor needs CREATE_INVOICE.
const RIGHT_CREATE_INVOICE = 1;

export function DelegateAuthCard({ serverWalletAddress }: { serverWalletAddress: string | null }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<"register" | "authorize" | null>(null);
  // Active custody-escrow gateway. Source-of-truth env: NEXT_PUBLIC_GATEWAY_ADDRESS.
  const gateway = (process.env.NEXT_PUBLIC_GATEWAY_ADDRESS ?? "") as Address;
  const usdc = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;

  const { data: merchantInfo } = useReadContract({
    address: gateway,
    abi: GW_ABI,
    functionName: "merchants",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: delegateInfo } = useReadContract({
    address: gateway,
    abi: GW_ABI,
    functionName: "delegates",
    args: address && serverWalletAddress ? [address, serverWalletAddress as Address] : undefined,
    query: { enabled: !!address && !!serverWalletAddress },
  });

  const isRegistered = merchantInfo?.[2] ?? false;
  const expiresAt = delegateInfo?.[0] ?? 0n;
  const rights = delegateInfo?.[1] ?? 0;
  const isAuthorized =
    expiresAt > BigInt(Math.floor(Date.now() / 1000)) &&
    (rights & RIGHT_CREATE_INVOICE) === RIGHT_CREATE_INVOICE;

  async function register() {
    if (!address) return;
    setBusy("register");
    try {
      const hash = await writeContractAsync({
        address: gateway,
        abi: GW_ABI,
        functionName: "registerMerchant",
        args: [address, usdc],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      toast.success("Registered as merchant on-chain");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e));
    }
    finally { setBusy(null); }
  }

  async function authorize() {
    if (!serverWalletAddress) return;
    setBusy("authorize");
    try {
      const hash = await writeContractAsync({
        address: gateway,
        abi: GW_ABI,
        functionName: "authorizeDelegate",
        args: [serverWalletAddress as Address, BigInt("18446744073709551615"), RIGHT_CREATE_INVOICE],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      toast.success("Server delegate authorized (CREATE_INVOICE right)");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e));
    }
    finally { setBusy(null); }
  }

  return (
    <section className="card p-[22px]">
      <h3 className="text-base font-semibold m-0">Delegate authorization</h3>
      <p className="lead text-[13px] mt-1 mb-4">
        Authorize Arcora&apos;s server wallet to settle invoices on your behalf — required before going live.
      </p>
      <div className="space-y-4 text-sm">
        <div className="field flex items-center justify-between gap-3 px-3.5 py-3">
          <span className="text-[13px] text-[var(--fg-2)]">Merchant registered on-chain</span>
          <span className={isRegistered ? "tagchip tagchip--ok" : "tagchip tagchip--mut"}>
            {isRegistered && <span className="dot dot--live" />}
            {isRegistered ? "Yes" : "Not yet"}
          </span>
        </div>
        {!isRegistered && (
          <button type="button" onClick={register} disabled={busy === "register"} className="pill pill--acc pill--sm">
            {busy === "register" ? "Confirming…" : "Register on-chain"}
          </button>
        )}
        {isRegistered && (
          <>
            <div className="field flex items-center justify-between gap-3 px-3.5 py-3">
              <div>
                <div className="text-[13px] text-[var(--fg-2)]">Server delegate authorized</div>
                {serverWalletAddress && (
                  <div className="mono text-[10.5px] text-[var(--fg-3)] mt-0.5">
                    {serverWalletAddress.slice(0, 8)}…{serverWalletAddress.slice(-5)} · CREATE_INVOICE
                  </div>
                )}
              </div>
              <span className={isAuthorized ? "tagchip tagchip--ok" : "tagchip tagchip--mut"}>
                {isAuthorized && <span className="dot dot--live" />}
                {isAuthorized ? "authorized" : "Not yet"}
              </span>
            </div>
            <p className="text-[13px] text-[var(--fg-3)]">
              Authorizing the server delegate lets us submit invoices on your behalf.
              You retain full control — revoke any time.
            </p>
            {!isAuthorized && (
              <button type="button" onClick={authorize} disabled={busy === "authorize" || !serverWalletAddress} className="pill pill--acc pill--sm">
                {busy === "authorize" ? "Confirming…" : "Authorize delegate"}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
