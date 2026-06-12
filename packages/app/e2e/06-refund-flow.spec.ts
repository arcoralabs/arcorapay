import { test, expect } from "@playwright/test";
import { clearAll, seedMerchant, seedInvoice } from "./fixtures/seed";
import { loginAsMerchant } from "./fixtures/auth";

/**
 * Dashboard refund-button visibility + status-badge-after-refund. We don't
 * exercise the on-chain refund signature (that's a wallet-driven flow that
 * needs a forked-chain harness, out of scope for this suite). We DO assert
 * that:
 *
 *   1. A `paid` invoice surfaces the Refund button on the dashboard list.
 *   2. A `refunded` invoice surfaces the "Refunded" status pill and no
 *      Refund button.
 *   3. A `created` invoice surfaces neither.
 *
 * That's the contract between the indexer (which writes the status) and the
 * dashboard UI (which reacts to it). The chain↔DB bridge is covered
 * separately by 03-already-paid.spec.ts and the treasury route test.
 */

const MERCHANT_ADDRESS = "0xe8E5AAa3d8c705A07de02aADF98CE31F20A5754b";

test.describe("merchant dashboard · refund visibility", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test("paid invoice shows Refund button; refunded invoice shows status pill", async ({ page, context }) => {
    const m = await seedMerchant({ address: MERCHANT_ADDRESS });

    // One paid, one refunded, one created — three rows the table should render.
    const paidInvoice = await seedInvoice({
      merchantId: m.merchantId,
      status: "paid",
      payInToken:  "0x3600000000000000000000000000000000000000", // USDC
      payoutToken: "0x3600000000000000000000000000000000000000", // USDC same-token
      amountOut:        "1000000",
      amountIn:         "1000000",
      merchantPayout:   "999000",
      protocolFee:      "1000",
    });
    const refundedInvoice = await seedInvoice({
      merchantId: m.merchantId,
      status: "refunded",
      payInToken:  "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", // EURC
      payoutToken: "0x3600000000000000000000000000000000000000", // USDC
      amountOut:        "1000000",
      amountIn:         "920925",
      merchantPayout:   "999000",
      protocolFee:      "1000",
    });
    const createdInvoice = await seedInvoice({
      merchantId: m.merchantId,
      status: "created",
    });

    await loginAsMerchant(context, m.address);
    await page.goto("/m/dashboard");

    // Wait for the dashboard to fetch /api/merchant and render the table.
    // Generous timeout: first hit compiles the page + API route in dev mode.
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 30_000 });

    const paidRow     = page.locator("tr", { hasText: paidInvoice.slice(0, 10) });
    const refundedRow = page.locator("tr", { hasText: refundedInvoice.slice(0, 10) });
    const createdRow  = page.locator("tr", { hasText: createdInvoice.slice(0, 10) });

    // Paid row: Refund button visible, status pill = "Paid".
    await expect(paidRow.getByRole("button", { name: /^Refund$/ })).toBeVisible();
    await expect(paidRow).toContainText("Paid");

    // Refunded row: no Refund button, status pill = "Refunded".
    await expect(refundedRow.getByRole("button", { name: /^Refund$/ })).toHaveCount(0);
    await expect(refundedRow).toContainText("Refunded");

    // Created row: no Refund button, status pill = "Pending".
    await expect(createdRow.getByRole("button", { name: /^Refund$/ })).toHaveCount(0);
    await expect(createdRow).toContainText("Pending");
  });
});
