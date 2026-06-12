/** @vitest-environment happy-dom */
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CrossChainPayButton } from "./CrossChainPayButton";

const mocks = vi.hoisted(() => ({
  writeContractAsync: vi.fn(),
  switchChainAsync: vi.fn(),
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x" + "a".repeat(40), isConnected: true }),
  useChainId: () => 84532,
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: mocks.writeContractAsync }),
  usePublicClient: () => ({
    readContract: mocks.readContract,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const INVOICE_ID = "0x" + "1".repeat(64);
const INTENT_ID = "0f0e0d0c-0b0a-4f9e-8d7c-6b5a49382716";
const BURN_TX = "0x" + "b".repeat(64);
const SETTLE_TX = "0x" + "c".repeat(64);
const STATUS_URL = `/api/checkout/crosschain/status/${INTENT_ID}`;
const STASH_KEY = `arcora.ccburn.${INVOICE_ID}`;

const PREPARE_OK = {
  intentId: INTENT_ID,
  depositForBurn: {
    amount: "5000000",
    burnToken: "0x" + "5".repeat(40),
    tokenMessenger: "0x" + "3".repeat(40),
    destinationDomain: 30,
    mintRecipient: "0x" + "9".repeat(64),
    maxFee: "0",
    finalityThreshold: 2000,
  },
};

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function seedStash() {
  localStorage.setItem(
    STASH_KEY,
    JSON.stringify({ intentId: INTENT_ID, burnTxHash: BURN_TX, sourceChainId: 84532, createdAt: Date.now() }),
  );
}

// pollIntervalMs/slowPollIntervalMs are the component's documented test seam:
// production defaults are 5000/15000ms; tests shrink them so the settlement
// poll loop spins on real timers without fake-timer plumbing.
function renderButton(overrides: Partial<Parameters<typeof CrossChainPayButton>[0]> = {}) {
  const onPaid = vi.fn();
  const onFailed = vi.fn();
  render(
    <CrossChainPayButton
      invoiceId={INVOICE_ID}
      sourceChainId={84532}
      onPaid={onPaid}
      onFailed={onFailed}
      pollIntervalMs={1}
      slowPollIntervalMs={1}
      {...overrides}
    />,
  );
  return { onPaid, onFailed };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CrossChainPayButton", () => {
  it("renders source chain and bridge action", () => {
    renderButton();
    expect(screen.getByRole("button").textContent).toMatch(/Bridge USDC from Base/i);
  });

  it("happy path: prepare 201 → burn → submit 202 → poll paid → onPaid, stash cleared", async () => {
    mocks.readContract.mockResolvedValue(10n ** 12n); // ample allowance — skip approve
    mocks.writeContractAsync.mockResolvedValue(BURN_TX);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });

    let statusCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/prepare")) return res(201, PREPARE_OK);
      if (url.includes("/submit")) return res(202, { intentId: INTENT_ID, statusUrl: STATUS_URL });
      if (url.includes("/status/")) {
        statusCalls += 1;
        return statusCalls < 2
          ? res(200, { status: "bridge_pending" })
          : res(200, { status: "paid", settleTxHash: SETTLE_TX });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onPaid, onFailed } = renderButton();
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(SETTLE_TX));
    expect(onFailed).not.toHaveBeenCalled();
    // Stash is cleared on terminal status — a later visit starts fresh.
    expect(localStorage.getItem(STASH_KEY)).toBeNull();
  });

  it("resume path: stash present → prepare never called, submit 409 intent_not_submittable → polls statusUrl → onPaid", async () => {
    seedStash();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/submit")) return res(409, { error: "intent_not_submittable", status: "bridge_pending" });
      if (url.includes("/status/")) return res(200, { status: "paid", settleTxHash: SETTLE_TX });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onPaid, onFailed } = renderButton();
    // Mount effect detected the stash: idle label offers resume, not a burn.
    expect(screen.getByRole("button").textContent).toMatch(/Resume payment/i);

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(SETTLE_TX));

    // CRITICAL: with a stash, the prepare→burn path must be unreachable.
    const prepareCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/prepare"));
    expect(prepareCalls).toHaveLength(0);
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    // 409 intent_not_submittable resolved via the derived status URL.
    const statusCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes(STATUS_URL));
    expect(statusCalls.length).toBeGreaterThan(0);
    expect(onFailed).not.toHaveBeenCalled();
    expect(localStorage.getItem(STASH_KEY)).toBeNull();
  });

  it("prepare 202 review → blocked banner with ticket, no burn attempted, onFailed not called", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/prepare")) return res(202, { decision: "review", ticketId: "TCK-42" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onPaid, onFailed } = renderButton();
    fireEvent.click(screen.getByRole("button"));

    await screen.findByText(/Compliance review required/i);
    expect(screen.getByText(/TCK-42/)).toBeTruthy();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(onPaid).not.toHaveBeenCalled();
    // Blocked state keeps the pay path closed.
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("prepare 403 reject → reject banner, pay path blocked", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/prepare")) return res(403, { decision: "reject" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onFailed } = renderButton();
    fireEvent.click(screen.getByRole("button"));

    await screen.findByText(/This wallet can('|’|&apos;)?t be used for this payment/i);
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("binding invalidated: submit 400 burn_tx_wrong_amount on resume → stash kept, persistent error with burn hash", async () => {
    seedStash();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/submit")) return res(400, { error: "burn_tx_wrong_amount" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onPaid } = renderButton();
    fireEvent.click(screen.getByRole("button"));

    await screen.findByText(/could not be matched to this payment/i);
    // The persistent error must carry the burn hash for support escalation.
    expect(screen.getByText(BURN_TX)).toBeTruthy();
    // The stash is the only client pointer to the stranded burn — never clear it here.
    expect(localStorage.getItem(STASH_KEY)).not.toBeNull();
    expect(onPaid).not.toHaveBeenCalled();
    // prepare→burn stays blocked while the binding error is showing.
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("poll horizon reached → non-failing still_processing state, no onFailed", async () => {
    seedStash();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/submit")) return res(202, { intentId: INTENT_ID, statusUrl: STATUS_URL });
      if (url.includes("/status/")) return res(200, { status: "bridge_pending" }); // never terminal
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onPaid, onFailed } = renderButton();
    fireEvent.click(screen.getByRole("button"));

    await screen.findByText(/Bridging can take up to/i, undefined, { timeout: 5000 });
    expect(screen.getByRole("button").textContent).toMatch(/Payment still processing/i);
    expect(onFailed).not.toHaveBeenCalled();
    expect(onPaid).not.toHaveBeenCalled();
    // Not terminal — the stash must survive so a reload can still resume.
    expect(localStorage.getItem(STASH_KEY)).not.toBeNull();
  });
});
