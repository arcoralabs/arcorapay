import { describe, expect, it } from "vitest";
import { assertTransition, isTerminalCrosschainState } from "../src/states";

describe("cross-chain state machine", () => {
  it("allows the happy path", () => {
    expect(() => assertTransition("created", "authorized")).not.toThrow();
    expect(() => assertTransition("authorized", "bridge_pending")).not.toThrow();
    expect(() => assertTransition("bridge_pending", "bridge_confirmed")).not.toThrow();
    expect(() => assertTransition("bridge_confirmed", "arc_swap_pending")).not.toThrow();
    expect(() => assertTransition("arc_swap_pending", "settle_pending")).not.toThrow();
    expect(() => assertTransition("settle_pending", "paid")).not.toThrow();
  });

  it("rejects skipping bridge verification", () => {
    expect(() => assertTransition("bridge_pending", "settle_pending"))
      .toThrow(/invalid crosschain transition/);
  });

  it("marks terminal states", () => {
    expect(isTerminalCrosschainState("paid")).toBe(true);
    expect(isTerminalCrosschainState("refunded")).toBe(true);
    expect(isTerminalCrosschainState("settle_pending")).toBe(false);
  });

  it("does not allow bridge_confirmed to expire (funds must resolve via failure paths)", () => {
    expect(() => assertTransition("bridge_confirmed", "expired"))
      .toThrow(/invalid crosschain transition/);
  });
});
