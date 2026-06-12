import { describe, expect, it, vi } from "vitest";
import { processCrosschainPayment } from "./crosschain-worker";
import type { CrosschainPaymentRow, CrosschainWorkerDeps } from "./crosschain-types";

const baseRow: CrosschainPaymentRow = {
  id: "intent-1",
  invoice_id: "0x" + "1".repeat(64),
  payer: "0x" + "a".repeat(40),
  source_chain_id: 84532,
  source_domain: 6,
  source_token: "0x" + "2".repeat(40),
  source_amount: "5000000",
  destination_chain_id: 5042002,
  destination_domain: 30,
  destination_token: "0x3600000000000000000000000000000000000000",
  payout_token: "0x3600000000000000000000000000000000000000",
  amount_out_min: "5000000",
  mint_recipient: "0x" + "0".repeat(24) + "c".repeat(40),
  status: "bridge_pending",
  burn_tx_hash: "0x" + "b".repeat(64),
  burn_submitted_at: null,
  cctp_message: null,
  cctp_attestation: null,
  bridge_receive_tx_hash: null,
  bridge_amount_received: null,
  arc_swap_tx_hash: null,
  arc_swap_amount_out: null,
  settle_tx_hash: null,
  attempts: 1,
  last_error: null,
};

function deps(): CrosschainWorkerDeps {
  return {
    fetchAttestation: vi.fn(async () => ({ message: "0x1234" as const, attestation: "0xabcd" as const })),
    receiveMessage: vi.fn(async () => ({
      txHash: ("0x" + "3".repeat(64)) as `0x${string}`,
      amountReceived: 5_000_000n,
    })),
    swapOnArc: vi.fn(async () => ({ amountOut: 5_000_000n, txHash: ("0x" + "4".repeat(64)) as `0x${string}` })),
    settleOnArc: vi.fn(async () => ("0x" + "5".repeat(64)) as `0x${string}`),
    refundOnArc: vi.fn(async () => ("0x" + "6".repeat(64)) as `0x${string}`),
    mark: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
}

describe("processCrosschainPayment", () => {
  it("moves bridge_pending through receiveMessage and settle for USDC payout", async () => {
    const d = deps();
    await processCrosschainPayment(baseRow, d);

    expect(d.fetchAttestation).toHaveBeenCalled();
    expect(d.receiveMessage).toHaveBeenCalled();
    expect(d.swapOnArc).not.toHaveBeenCalled();
    expect(d.settleOnArc).toHaveBeenCalledWith(expect.objectContaining({
      grossPayout: 5_000_000n,
      swapTxHash: "0x" + "3".repeat(64),
    }));
  });

  it("uses Arc swap before settle for EURC payout", async () => {
    const d = deps();
    await processCrosschainPayment({
      ...baseRow,
      payout_token: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    }, d);

    expect(d.swapOnArc).toHaveBeenCalled();
    expect(d.settleOnArc).toHaveBeenCalledWith(expect.objectContaining({
      grossPayout: 5_000_000n,
      swapTxHash: "0x" + "4".repeat(64),
    }));
  });

  it("refunds bridged Arc USDC to the payer when the received amount is below the invoice minimum", async () => {
    const d = deps();
    vi.mocked(d.receiveMessage).mockResolvedValue({
      txHash: ("0x" + "3".repeat(64)) as `0x${string}`,
      amountReceived: 4_900_000n,
    });

    await processCrosschainPayment(baseRow, d);

    expect(d.refundOnArc).toHaveBeenCalledWith(expect.objectContaining({
      amount: 4_900_000n,
      token: baseRow.destination_token,
    }));
    expect(d.mark).toHaveBeenCalledWith(baseRow.id, expect.objectContaining({
      status: "refunded",
      refund_tx_hash: "0x" + "6".repeat(64),
    }));
    expect(d.settleOnArc).not.toHaveBeenCalled();
  });

  it("re-marks bridge_pending with a future next_attempt when the attestation is not ready", async () => {
    const d = deps();
    vi.mocked(d.fetchAttestation).mockResolvedValue(null);
    const before = Date.now();

    await processCrosschainPayment(baseRow, d);

    expect(d.receiveMessage).not.toHaveBeenCalled();
    expect(d.mark).toHaveBeenCalledTimes(1);
    expect(d.mark).toHaveBeenCalledWith(baseRow.id, expect.objectContaining({
      status: "bridge_pending",
      attempts: 0, // polling is waiting, not failing — never burns retry budget
    }));
    const values = vi.mocked(d.mark).mock.calls[0]![1] as { next_attempt: Date };
    expect(values.next_attempt).toBeInstanceOf(Date);
    expect(values.next_attempt.getTime()).toBeGreaterThan(before);
    expect(d.fail).not.toHaveBeenCalled();
  });

  it("fails terminally when the attestation is still missing past the wall-clock deadline", async () => {
    const d = deps();
    vi.mocked(d.fetchAttestation).mockResolvedValue(null);
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

    await processCrosschainPayment({ ...baseRow, burn_submitted_at: threeHoursAgo }, d);

    expect(d.fail).toHaveBeenCalledWith(baseRow.id, "bridge_failed", "attestation_deadline_exceeded");
    expect(d.mark).not.toHaveBeenCalled();
    expect(d.receiveMessage).not.toHaveBeenCalled();
  });

  it("expires a stuck row even when burn_submitted_at is null", async () => {
    const d = deps();
    vi.mocked(d.fetchAttestation).mockResolvedValue(null);
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

    await processCrosschainPayment({
      ...baseRow,
      burn_submitted_at: null,
      created_at: threeHoursAgo,
    }, d);

    expect(d.fail).toHaveBeenCalledWith(baseRow.id, "bridge_failed", "attestation_deadline_exceeded");
    expect(d.mark).not.toHaveBeenCalled();
    expect(d.receiveMessage).not.toHaveBeenCalled();
  });

  it("rejects a mint far below source_amount", async () => {
    const d = deps();
    vi.mocked(d.receiveMessage).mockResolvedValue({
      txHash: ("0x" + "3".repeat(64)) as `0x${string}`,
      amountReceived: 1n,
    });

    await processCrosschainPayment({ ...baseRow, source_amount: "100000000" }, d);

    expect(d.fail).toHaveBeenCalledWith(
      baseRow.id,
      "bridge_failed",
      expect.stringContaining("mint_amount_mismatch"),
    );
    expect(d.refundOnArc).not.toHaveBeenCalled();
    expect(d.settleOnArc).not.toHaveBeenCalled();
    expect(d.mark).not.toHaveBeenCalledWith(baseRow.id, expect.objectContaining({ status: "paid" }));
  });

  it("processes normally past the deadline when the attestation IS available (deadline only applies while waiting)", async () => {
    const d = deps();
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

    await processCrosschainPayment({ ...baseRow, burn_submitted_at: threeHoursAgo }, d);

    expect(d.fail).not.toHaveBeenCalled();
    expect(d.receiveMessage).toHaveBeenCalled();
    expect(d.settleOnArc).toHaveBeenCalledWith(expect.objectContaining({
      grossPayout: 5_000_000n,
    }));
    expect(d.mark).toHaveBeenCalledWith(baseRow.id, expect.objectContaining({ status: "paid" }));
  });

  it("fails with settle_failed when settleOnArc throws", async () => {
    const d = deps();
    vi.mocked(d.settleOnArc).mockRejectedValue(new Error("gateway_reverted"));

    await processCrosschainPayment({
      ...baseRow,
      status: "settle_pending",
      bridge_receive_tx_hash: "0x" + "3".repeat(64),
      bridge_amount_received: "5000000",
    }, d);

    expect(d.fail).toHaveBeenCalledWith(
      baseRow.id,
      "settle_failed",
      expect.stringContaining("gateway_reverted"),
    );
    expect(d.mark).not.toHaveBeenCalledWith(baseRow.id, expect.objectContaining({ status: "paid" }));
  });

  it("does not re-swap when a prior attempt already recorded the Arc swap", async () => {
    const d = deps();

    await processCrosschainPayment({
      ...baseRow,
      payout_token: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      status: "settle_pending",
      bridge_receive_tx_hash: "0x" + "3".repeat(64),
      bridge_amount_received: "5000000",
      arc_swap_tx_hash: "0x" + "9".repeat(64),
      arc_swap_amount_out: "5100000",
    }, d);

    expect(d.swapOnArc).not.toHaveBeenCalled();
    expect(d.settleOnArc).toHaveBeenCalledWith(expect.objectContaining({
      grossPayout: 5_100_000n,
      swapTxHash: "0x" + "9".repeat(64),
    }));
  });

  it("fails with arc_swap_failed and never auto-refunds after a post-swap shortfall", async () => {
    const d = deps();
    vi.mocked(d.swapOnArc).mockResolvedValue({
      amountOut: 4_800_000n,
      txHash: ("0x" + "4".repeat(64)) as `0x${string}`,
    });

    await processCrosschainPayment({
      ...baseRow,
      payout_token: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    }, d);

    expect(d.fail).toHaveBeenCalledWith(
      baseRow.id,
      "arc_swap_failed",
      expect.stringContaining("shortfall"),
    );
    expect(d.refundOnArc).not.toHaveBeenCalled();
    expect(d.settleOnArc).not.toHaveBeenCalled();
  });
});
