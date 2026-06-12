"use client";

import { useCallback, useEffect, useState } from "react";
import { parseAbi, type Address, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { mapChainError } from "@/lib/chain/error-mapper";
import { chainLabel } from "./ChainSelector";

// CCTP v2 TokenMessenger. NOTE: the 5th param is named hookData here but is
// destinationCaller in the submit verifier — same encoded selector/types
// (bytes32); it must stay 32 zero bytes or the submit verifier rejects.
const TOKEN_MESSENGER_ABI = parseAbi([
  "function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 hookData,uint256 maxFee,uint32 finalityThreshold)",
]);

const ERC20_ABI = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

const TERMINAL_STATUSES = [
  "paid",
  "bridge_failed",
  "arc_swap_failed",
  "settle_failed",
  "refunded",
  "expired",
];

// Settlement poll horizon: 24 fast ticks (5s default = 2 min) then slow ticks
// (15s default) for the remainder — ~30 min total before the UI degrades to
// the non-failing "still processing" state.
const POLL_FAST_TICKS = 24;
const POLL_TOTAL_TICKS = 136; // 24×5s + 112×15s ≈ 30 min at default cadence

type State =
  | "idle"
  | "preparing"
  | "switching"
  | "approving"
  | "burning"
  | "submitted"
  | "settling"
  | "still_processing"
  | "binding_error"
  | "success"
  | "failed";

interface TerminalStatus {
  status: string;
  settleTxHash?: string | null;
  error?: string | null;
}

type Blocked = { kind: "review"; ticketId?: string } | { kind: "reject" };

/**
 * Burn stash — the client-side pointer to an in-flight burn. Persisted to
 * localStorage (NOT sessionStorage: it must survive a tab close) the moment
 * the wallet returns the burn tx hash, BEFORE we wait for the receipt. If the
 * page dies anywhere after broadcast, re-running prepare→approve→burn would
 * burn the customer's USDC a second time; with the stash, the click handler
 * resumes at submit instead. Non-sensitive: the burn hash is public chain
 * data and the intentId only unlocks the trimmed anonymous status route.
 */
interface BurnStash {
  intentId: string;
  burnTxHash: Hex;
  sourceChainId: number;
  createdAt: number;
}

function stashKey(invoiceId: string): string {
  return `arcora.ccburn.${invoiceId}`;
}

// All storage access is wrapped in try/catch: localStorage throws in some
// private-browsing modes, and a stash failure must never break checkout.
function readStash(invoiceId: string): BurnStash | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(stashKey(invoiceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BurnStash> | null;
    if (
      !parsed ||
      typeof parsed.intentId !== "string" ||
      typeof parsed.burnTxHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(parsed.burnTxHash)
    ) {
      return null;
    }
    return parsed as BurnStash;
  } catch {
    return null;
  }
}

function writeStash(invoiceId: string, stash: BurnStash): void {
  try {
    window.localStorage.setItem(stashKey(invoiceId), JSON.stringify(stash));
  } catch {
    // Private mode / quota: the flow still works, it just can't resume after
    // a tab close. Nothing actionable for the customer mid-payment.
  }
}

function clearStash(invoiceId: string): void {
  try {
    window.localStorage.removeItem(stashKey(invoiceId));
  } catch {
    // ignore — see writeStash
  }
}

export function CrossChainPayButton(props: {
  invoiceId: string;
  sourceChainId: number;
  onPaid: (tx: Hex) => void;
  onFailed?: (reason: string) => void;
  /** Test seam: cadence of the first 24 settlement polls. Default 5000ms. */
  pollIntervalMs?: number;
  /** Test seam: cadence of the remaining settlement polls (and 2× this for
   *  the background poll in the still-processing state). Default 15000ms. */
  slowPollIntervalMs?: number;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: props.sourceChainId });
  const [state, setState] = useState<State>("idle");
  const [hasStash, setHasStash] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [bindingErrorHash, setBindingErrorHash] = useState<Hex | null>(null);
  const [activeStatusUrl, setActiveStatusUrl] = useState<string | null>(null);

  const pollIntervalMs = props.pollIntervalMs ?? 5_000;
  const slowPollIntervalMs = props.slowPollIntervalMs ?? 15_000;

  // Detect a stranded burn for this invoice on mount so the idle button reads
  // "Resume payment" instead of offering a fresh (double) burn.
  useEffect(() => {
    setHasStash(readStash(props.invoiceId) !== null);
  }, [props.invoiceId]);

  const handleTerminal = useCallback((terminal: TerminalStatus) => {
    // Any terminal status means the burn's fate is decided server-side — the
    // stash has done its job either way.
    clearStash(props.invoiceId);
    setHasStash(false);
    if (terminal.status === "paid" && terminal.settleTxHash) {
      setState("success");
      props.onPaid(terminal.settleTxHash as Hex);
      return;
    }
    setState("failed");
    if (terminal.status === "refunded") {
      // Mirrors PayButton's refunded copy: the customer's money came back —
      // this must not read like a generic failure.
      const reason = "Swap failed — your funds have been returned.";
      toast.error(reason);
      props.onFailed?.(reason);
      return;
    }
    // terminal.error is a stable enumerated code from the status route
    // (never raw RPC text), safe to surface as-is.
    const reason = terminal.error ?? `cross-chain payment failed: ${terminal.status}`;
    toast.error(reason);
    props.onFailed?.(reason);
  }, [props]);

  // After the foreground poll horizon is exhausted, keep a slow background
  // poll running while the page stays open (CheckoutClient's invoice poll
  // also flips to the paid screen independently when settlement lands).
  useEffect(() => {
    if (state !== "still_processing" || !activeStatusUrl) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(activeStatusUrl);
        if (!res.ok) return;
        const body = (await res.json()) as TerminalStatus;
        if (!cancelled && TERMINAL_STATUSES.includes(body.status)) {
          handleTerminal(body);
        }
      } catch {
        // transient — keep waiting
      }
    }, slowPollIntervalMs * 2);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state, activeStatusUrl, handleTerminal, slowPollIntervalMs]);

  /** Polls until a terminal status or the ~30 min horizon; returns null on
   *  horizon so the caller can degrade to "still processing" instead of
   *  throwing into the generic failure path. Per-tick errors (network blip,
   *  bad JSON, non-2xx) consume the tick and continue — never throw mid-loop. */
  async function poll(url: string): Promise<TerminalStatus | null> {
    for (let i = 0; i < POLL_TOTAL_TICKS; i++) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const body = (await res.json()) as TerminalStatus;
          if (TERMINAL_STATUSES.includes(body.status)) {
            return body;
          }
        }
      } catch {
        // transient fetch/JSON failure — count the tick and keep polling
      }
      const interval = i < POLL_FAST_TICKS ? pollIntervalMs : slowPollIntervalMs;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return null;
  }

  async function settle(statusUrl: string): Promise<void> {
    setActiveStatusUrl(statusUrl);
    setState("settling");
    const terminal = await poll(statusUrl);
    if (!terminal) {
      // Horizon reached without a terminal status. Bridging can legitimately
      // take this long — do NOT fail the checkout or fire onFailed.
      setState("still_processing");
      return;
    }
    handleTerminal(terminal);
  }

  /** Shared by the fresh flow and the stash resume: submit the burn proof,
   *  then poll settlement. Encodes the full submit response contract. */
  async function submitAndSettle(intentId: string, burnTxHash: Hex): Promise<void> {
    setState("submitted");
    const submitRes = await fetch("/api/checkout/crosschain/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId, burnTxHash }),
    });
    const submitted = await submitRes.json().catch(() => ({}) as Record<string, unknown>);

    if (submitRes.ok && typeof submitted.statusUrl === "string") {
      await settle(submitted.statusUrl);
      return;
    }

    const code = typeof submitted.error === "string" ? submitted.error : null;

    // 409 intent_not_submittable on resume is the SUCCESS path, not a
    // failure: the original submit landed and the row already advanced past
    // "authorized". Build the status URL from the intentId and poll.
    if (submitRes.status === 409 && code === "intent_not_submittable") {
      await settle(`/api/checkout/crosschain/status/${intentId}`);
      return;
    }

    // The burn reverted on-chain: no funds left the wallet, so a fresh
    // prepare→burn flow is safe again.
    if (code === "burn_tx_reverted") {
      clearStash(props.invoiceId);
      setHasStash(false);
      setState("idle");
      toast.error(mapChainError(new Error(code)));
      return;
    }

    // Binding invalidated: burn_tx_wrong_*, burn_tx_invalid_calldata,
    // burn_tx_verification_failed, burn_tx_already_used (e.g. a cross-tab
    // re-prepare rewrote the intent before this submit). The stash is the
    // ONLY client pointer to the stranded burn — do NOT clear it. Show a
    // persistent inline error with the tx hash and keep prepare→burn blocked.
    if (code !== null && code.startsWith("burn_tx_")) {
      setBindingErrorHash(burnTxHash);
      setState("binding_error");
      return;
    }

    // Anything else (rate limit, intent_not_found, network-shaped 5xx) goes
    // through the generic retryable catch in handleClick.
    throw new Error(code ?? "submit failed");
  }

  async function handleClick() {
    // Resume guard FIRST: if a burn already exists for this invoice, the
    // prepare→switch→approve→burn path must be unreachable — re-burning
    // would take the customer's USDC twice. Resume goes straight to submit.
    const stash = readStash(props.invoiceId);
    try {
      if (stash) {
        await submitAndSettle(stash.intentId, stash.burnTxHash);
        return;
      }

      if (!address) return;
      setState("preparing");
      const prepareRes = await fetch("/api/checkout/crosschain/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId: props.invoiceId, payer: address, sourceChainId: props.sourceChainId }),
      });
      const prepare = await prepareRes.json().catch(() => ({}) as Record<string, unknown>);

      // Compliance outcomes from prepare are NOT failures — render the same
      // banners the Arc PayButton shows and keep the button blocked. Checked
      // before the !ok throw because 202 is inside the ok range.
      if (prepareRes.status === 202 || prepare?.decision === "review") {
        setState("idle");
        setBlocked({
          kind: "review",
          ticketId: typeof prepare?.ticketId === "string" ? prepare.ticketId : undefined,
        });
        return;
      }
      if (prepareRes.status === 403 || prepare?.decision === "reject") {
        setState("idle");
        setBlocked({ kind: "reject" });
        return;
      }
      if (!prepareRes.ok) throw new Error(typeof prepare?.error === "string" ? prepare.error : "prepare failed");
      // Guard: any response without a burn payload is non-proceedable —
      // surface a mapped toast instead of crashing on a TypeError below.
      if (typeof prepare?.intentId !== "string" || !prepare?.depositForBurn?.amount) {
        throw new Error("prepare returned no bridge route");
      }

      if (chainId !== props.sourceChainId) {
        setState("switching");
        await switchChainAsync({ chainId: props.sourceChainId });
      }
      if (!publicClient) throw new Error("source-chain client unavailable");

      const amount = BigInt(prepare.depositForBurn.amount);
      const burnToken = prepare.depositForBurn.burnToken as Address;
      const tokenMessenger = prepare.depositForBurn.tokenMessenger as Address;
      const allowance = await publicClient.readContract({
        address: burnToken,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, tokenMessenger],
      });

      if (allowance < amount) {
        setState("approving");
        const approvalTx = await writeContractAsync({
          chainId: props.sourceChainId,
          address: burnToken,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [tokenMessenger, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalTx });
      }

      setState("burning");
      const tx = await writeContractAsync({
        chainId: props.sourceChainId,
        address: tokenMessenger,
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [
          amount,
          prepare.depositForBurn.destinationDomain,
          prepare.depositForBurn.mintRecipient as Hex,
          burnToken,
          // destinationCaller — must stay zero or the submit verifier rejects.
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          BigInt(prepare.depositForBurn.maxFee),
          prepare.depositForBurn.finalityThreshold,
        ],
      });
      // CRITICAL: stash the burn pointer the instant the wallet returns the
      // hash — BEFORE waiting for the receipt. If the tab dies past this
      // line, the stash is what prevents a second burn on the next visit.
      writeStash(props.invoiceId, {
        intentId: prepare.intentId,
        burnTxHash: tx,
        sourceChainId: props.sourceChainId,
        createdAt: Date.now(),
      });
      setHasStash(true);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      await submitAndSettle(prepare.intentId, tx);
    } catch (e) {
      setState("failed");
      // Caught errors here include raw wallet/RPC text — map to a safe,
      // user-facing message like the Arc PayButton does (audit #12 posture).
      // Not forwarded to onFailed: a wallet rejection or transient RPC error
      // should leave the checkout retryable, mirroring PayButton's catch.
      // With a stash present, the retry resumes at submit — never re-burns.
      toast.error(mapChainError(e));
    }
  }

  const busy = ["preparing", "switching", "approving", "burning", "submitted", "settling"].includes(state);
  const label =
    blocked || state === "binding_error" ? "Unavailable" :
    state === "preparing" ? "Preparing route…" :
    state === "switching" ? "Switching network…" :
    state === "approving" ? "Approving USDC…" :
    state === "burning" ? "Confirm bridge transaction…" :
    state === "submitted" ? "Submitting bridge proof…" :
    state === "settling" ? "Waiting for Arc settlement…" :
    state === "still_processing" ? "Payment still processing…" :
    state === "success" ? "Paid ✓" :
    hasStash ? "Resume payment" :
    `Bridge USDC from ${chainLabel(props.sourceChainId)}`;

  return (
    <div className="space-y-3">
      {blocked?.kind === "review" && (
        <div className="rounded-[var(--radius-field)] border border-[color-mix(in_oklch,var(--warning)_40%,transparent)] bg-[var(--warning-bg)] p-3 flex items-start gap-2 text-xs text-[var(--fg-1)]">
          <ShieldAlert className="size-4 mt-0.5 flex-none text-[var(--warning)]" />
          <div>
            <div className="font-semibold mb-0.5">Compliance review required</div>
            We&apos;re confirming a few details before this wallet can pay. The merchant has been notified and will follow up within 24h.
            {blocked.ticketId && <div className="mono text-[10px] mt-1 opacity-70">Ref: {blocked.ticketId}</div>}
          </div>
        </div>
      )}
      {blocked?.kind === "reject" && (
        <div className="rounded-[var(--radius-field)] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[var(--danger-bg)] p-3 flex items-start gap-2 text-xs text-[var(--fg-1)]">
          <ShieldAlert className="size-4 mt-0.5 flex-none text-[var(--danger)]" />
          <div>
            <div className="font-semibold mb-0.5">This wallet can&apos;t be used for this payment</div>
            Try a different wallet or contact the merchant if you believe this is an error.
          </div>
        </div>
      )}
      {state === "binding_error" && bindingErrorHash && (
        <div className="rounded-[var(--radius-field)] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[var(--danger-bg)] p-3 flex items-start gap-2 text-xs text-[var(--fg-1)]">
          <ShieldAlert className="size-4 mt-0.5 flex-none text-[var(--danger)]" />
          <div className="min-w-0">
            <div className="font-semibold mb-0.5">Bridge transaction could not be matched to this payment.</div>
            Contact support with transaction{" "}
            <code className="mono break-all">{bindingErrorHash}</code>.
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={
          !isConnected || !address || busy || state === "success" ||
          state === "still_processing" || state === "binding_error" || blocked !== null
        }
        className="pill pill--acc w-full"
        aria-live="polite"
        aria-busy={busy || undefined}
      >
        {label}
      </button>

      {state === "still_processing" && (
        <p className="text-[12px] text-[var(--fg-2)] leading-[1.55]" role="status">
          Bridging can take up to ~20 minutes. Keep this page open; it will update automatically.
        </p>
      )}
    </div>
  );
}
