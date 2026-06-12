import { test, expect } from "@playwright/test";
import { clearAll, seedMerchant, seedInvoice } from "./fixtures/seed";

test("already-paid invoice shows success", async ({ page }) => {
  await clearAll();
  const m = await seedMerchant();
  const id = await seedInvoice({ merchantId: m.merchantId, status: "paid" });

  await page.goto(`/i/${id}`);
  await expect(page.getByText(/Payment received/i)).toBeVisible();
});
