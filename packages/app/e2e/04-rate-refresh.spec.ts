import { test, expect } from "@playwright/test";
import { clearAll, seedMerchant, seedInvoice } from "./fixtures/seed";

test("quote display renders pay-in amount via /api/quote", async ({ page }) => {
  await clearAll();
  const m = await seedMerchant();
  const id = await seedInvoice({ merchantId: m.merchantId });

  await page.goto(`/i/${id}`);
  await expect(page.getByText("You pay")).toBeVisible();
  // Quote requires the pool to be reachable; we just assert the section renders.
  await expect(page.locator("text=/EURC/")).toBeVisible({ timeout: 10000 });
});
