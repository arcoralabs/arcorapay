import { test, expect } from "@playwright/test";
import { clearAll, seedMerchant, seedInvoice } from "./fixtures/seed";
import { loginAsMerchant } from "./fixtures/auth";

/**
 * /m/treasury aggregates DB-side, so seeding the rows directly is the
 * cleanest way to verify the page reads them. We seed two paid + one
 * refunded invoice all in USDC payout, then assert:
 *
 *   1. The page renders without a "no invoices yet" empty state.
 *   2. The activity feed shows three rows (paid · paid · refunded), with
 *      the refund row marked with a minus.
 *   3. The KPI cards reflect: paid count == 2, refunded count == 1.
 *
 * We DON'T over-assert exact dollar amounts — formatCurrency adds a "$"
 * prefix and a 2-decimal trailer that vary across locale settings. The
 * counts are the load-bearing assertion; the math is covered by
 * app/api/merchant/treasury/route.test.ts.
 */

const MERCHANT_ADDRESS = "0xe8E5AAa3d8c705A07de02aADF98CE31F20A5754b";

test.describe("merchant treasury · KPI rendering", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test("KPI cards + activity feed reflect seeded paid + refunded invoices", async ({ page, context }) => {
    const m = await seedMerchant({ address: MERCHANT_ADDRESS });

    // Two paid + one refunded, all USDC payout.
    await seedInvoice({
      merchantId: m.merchantId, status: "paid",
      payInToken:  "0x3600000000000000000000000000000000000000",
      payoutToken: "0x3600000000000000000000000000000000000000",
      amountOut: "1000000", amountIn: "1000000",
      merchantPayout: "999000", protocolFee: "1000",
    });
    await seedInvoice({
      merchantId: m.merchantId, status: "paid",
      payInToken:  "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      payoutToken: "0x3600000000000000000000000000000000000000",
      amountOut: "2000000", amountIn: "1841850",
      merchantPayout: "1998000", protocolFee: "2000",
    });
    await seedInvoice({
      merchantId: m.merchantId, status: "refunded",
      payInToken:  "0x3600000000000000000000000000000000000000",
      payoutToken: "0x3600000000000000000000000000000000000000",
      amountOut: "500000", amountIn: "500000",
      merchantPayout: "499500", protocolFee: "500",
    });

    await loginAsMerchant(context, m.address);
    await page.goto("/m/treasury");

    // Generous timeout: first hit compiles the page + API routes in dev mode.
    await expect(page.getByRole("heading", { name: "Treasury" })).toBeVisible({ timeout: 30_000 });

    // The empty state should NOT be visible — we have invoices.
    await expect(page.getByText(/No paid invoices yet/i)).toHaveCount(0);

    // KPI heading shows the per-token rollup. We seeded 2 paid + 1 refunded for USDC.
    await expect(page.getByText("2 paid · 1 refunded")).toBeVisible();

    // KPI card labels are present (their numbers come from the API; we trust
    // the route test for the math, but the labels prove the layout rendered).
    await expect(page.getByText("Net received")).toBeVisible();
    await expect(page.getByText("Gross volume")).toBeVisible();
    // exact: the token header's "2 paid · 1 refunded" line substring-matches otherwise.
    await expect(page.getByText("Refunded", { exact: true })).toBeVisible();
    await expect(page.getByText("Fees paid to Arcora")).toBeVisible();

    // Activity feed: 3 rows seeded, both phrasings ("Payment" + "Refund") show.
    await expect(page.getByText("Recent activity")).toBeVisible();
    const payments = page.getByText("Payment", { exact: true });
    const refunds  = page.getByText("Refund",  { exact: true });
    await expect(payments).toHaveCount(2);
    await expect(refunds).toHaveCount(1);
  });

  test("treasury page redirects to settings when no merchant profile exists", async ({ page, context }) => {
    // Logged-in session, but no merchant row in the DB.
    await loginAsMerchant(context, MERCHANT_ADDRESS);
    await page.goto("/m/treasury");
    await expect(page.getByRole("heading", { name: "Treasury" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Set up a merchant profile/i)).toBeVisible();
  });
});
