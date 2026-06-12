import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ApiKeyCard } from "./ApiKeyCard";

beforeEach(() => {
  global.fetch = vi.fn() as any;
});

// The secret-key warning + section render on every mount; without unmounting
// between tests, getByText would match across leftover DOM. (AFG-019)
afterEach(() => cleanup());

describe("ApiKeyCard", () => {
  it("disables Generate until at least one valid origin is provided, then calls bootstrap with allowedOrigins", async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ apiKey: "ak_live_abc" }), { status: 201 })
    );
    const onBootstrap = vi.fn().mockResolvedValue(undefined);
    render(<ApiKeyCard hasMerchant={false} onBootstrap={onBootstrap} />);
    const button = screen.getByText(/Generate API key/) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const textarea = screen.getByLabelText(/Allowed origins/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "https://shop.example.com/cart" } });
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    await waitFor(() => expect((global.fetch as any).mock.calls[0][0]).toBe("/api/merchant/bootstrap"));
    const sentBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(sentBody.allowedOrigins).toEqual(["https://shop.example.com/cart"]);
    await waitFor(() => expect(screen.getByText("ak_live_abc")).toBeTruthy());
    expect(onBootstrap).toHaveBeenCalled();
  });

  it("calls rotate when merchant exists", async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ apiKey: "ak_live_xyz" }), { status: 200 })
    );
    render(<ApiKeyCard hasMerchant={true} onBootstrap={vi.fn()} />);
    fireEvent.click(screen.getByText(/Rotate key/));
    await waitFor(() => expect((global.fetch as any).mock.calls[0][0]).toBe("/api/merchant/api-key"));
  });

  // MED-6 (2026-06-11): publishable keys are rotatable from the same card.
  it("rotates the publishable key and shows the new one", async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ publishableKey: "pk_live_new456" }), { status: 201 })
    );
    render(<ApiKeyCard hasMerchant={true} publishableKey="pk_live_demo123" onBootstrap={vi.fn()} />);
    expect(screen.getByText("pk_live_demo123")).toBeTruthy();
    fireEvent.click(screen.getByText(/Rotate publishable key/));
    await waitFor(() => expect((global.fetch as any).mock.calls[0][0]).toBe("/api/merchant/publishable-key"));
    // The route's JSON gate (CRIT-1) requires this header even on a bodyless POST.
    expect((global.fetch as any).mock.calls[0][1].headers["content-type"]).toBe("application/json");
    await waitFor(() => expect(screen.getByText("pk_live_new456")).toBeTruthy());
    expect(screen.queryByText("pk_live_demo123")).toBeNull();
  });

  // AFG-019 (2026-06-06): the publishable key is shown persistently as
  // browser-safe, alongside a "secret key — server-side only" warning.
  it("renders the publishable key as browser-safe with a secret-key warning", () => {
    render(<ApiKeyCard hasMerchant={true} publishableKey="pk_live_demo123" onBootstrap={vi.fn()} />);
    expect(screen.getByText("pk_live_demo123")).toBeTruthy();
    expect(screen.getByText(/Browser-safe/i)).toBeTruthy();
    expect(screen.getByText(/Never put your secret key in browser code/i)).toBeTruthy();
  });
});
