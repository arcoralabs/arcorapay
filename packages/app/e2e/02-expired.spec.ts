import { test, expect } from "@playwright/test";
import { clearAll, seedMerchant, seedInvoice } from "./fixtures/seed";

test("expired invoice shows expired UX", async ({ page }) => {
  await clearAll();
  const m = await seedMerchant();
  const id = await seedInvoice({ merchantId: m.merchantId, expiresAtSecondsFromNow: -60 });

  await page.goto(`/i/${id}`);
  await expect(page.getByText("Invoice expired")).toBeVisible();
});
