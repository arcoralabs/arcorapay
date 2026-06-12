/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SuccessScreen, ExpiredScreen } from "./StatusScreens";

beforeEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "http://localhost/" },
  });
});

afterEach(() => {
  cleanup();
});

describe("SuccessScreen — audit H1 client-side allowlist", () => {
  it("shows the redirect countdown when successUrl origin is in the allowlist", () => {
    render(
      <SuccessScreen
        successUrl="https://shop.example.com/order/123"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.getByText(/Redirecting to merchant/)).toBeTruthy();
  });

  it("renders fallback (no auto-redirect) when successUrl origin is NOT in allowlist", () => {
    render(
      <SuccessScreen
        successUrl="https://attacker.example.com/?x=1"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.queryByText(/Redirecting to merchant/)).toBeNull();
    expect(screen.getByText(/can't safely return you to the merchant/i)).toBeTruthy();
    // Critical: no redirect happened.
    expect(window.location.href).toBe("http://localhost/");
  });

  it("renders fallback when allowlist is empty", () => {
    render(
      <SuccessScreen
        successUrl="https://shop.example.com/ok"
        allowedOrigins={[]}
      />
    );
    expect(screen.queryByText(/Redirecting to merchant/)).toBeNull();
  });
});

describe("ExpiredScreen — audit H1 client-side allowlist", () => {
  it("renders the Return-to-merchant link when cancelUrl origin is allowed", () => {
    render(
      <ExpiredScreen
        cancelUrl="https://shop.example.com/cart"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.getByText(/Return to merchant/)).toBeTruthy();
  });

  it("hides the Return-to-merchant link when cancelUrl origin is NOT allowed", () => {
    render(
      <ExpiredScreen
        cancelUrl="https://attacker.example.com/cart"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.queryByText(/Return to merchant/)).toBeNull();
  });

  it("hides the Return-to-merchant link when no cancelUrl is given", () => {
    render(<ExpiredScreen allowedOrigins={["https://shop.example.com"]} />);
    expect(screen.queryByText(/Return to merchant/)).toBeNull();
  });
});

describe("ExpiredScreen variants — distinct terminal copy per status", () => {
  it("defaults to the expired variant when no variant is given", () => {
    render(<ExpiredScreen allowedOrigins={[]} />);
    expect(screen.getByText("Invoice expired")).toBeTruthy();
    expect(screen.getByText(/request a new invoice/i)).toBeTruthy();
  });

  it('variant="failed" renders failed copy — not "Invoice expired"', () => {
    render(<ExpiredScreen variant="failed" allowedOrigins={[]} />);
    expect(screen.getByText("Payment failed")).toBeTruthy();
    expect(screen.getByText(/could not be completed/i)).toBeTruthy();
    expect(screen.queryByText("Invoice expired")).toBeNull();
  });

  it('variant="refunded" renders refunded copy — not "Invoice expired"', () => {
    render(<ExpiredScreen variant="refunded" allowedOrigins={[]} />);
    expect(screen.getByText("Invoice refunded")).toBeTruthy();
    expect(screen.getByText(/returned to the payer/i)).toBeTruthy();
    expect(screen.queryByText("Invoice expired")).toBeNull();
  });

  it('variant="failed" keeps the allowlist-gated return link (allowed origin shows it)', () => {
    render(
      <ExpiredScreen
        variant="failed"
        cancelUrl="https://shop.example.com/cart"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.getByText(/Return to merchant/)).toBeTruthy();
  });

  it('variant="failed" still hides the return link for non-allowlisted origins', () => {
    render(
      <ExpiredScreen
        variant="failed"
        cancelUrl="https://attacker.example.com/cart"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.queryByText(/Return to merchant/)).toBeNull();
  });

  it('variant="refunded" keeps the allowlist-gated return link (allowed origin shows it)', () => {
    render(
      <ExpiredScreen
        variant="refunded"
        cancelUrl="https://shop.example.com/cart"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.getByText(/Return to merchant/)).toBeTruthy();
  });

  it('variant="refunded" still hides the return link for non-allowlisted origins', () => {
    render(
      <ExpiredScreen
        variant="refunded"
        cancelUrl="https://attacker.example.com/cart"
        allowedOrigins={["https://shop.example.com"]}
      />
    );
    expect(screen.queryByText(/Return to merchant/)).toBeNull();
  });
});
