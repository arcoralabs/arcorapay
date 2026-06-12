import { test, expect } from "@playwright/test";
import { clearAll, seedMerchant, seedInvoice } from "./fixtures/seed";

test("happy path: invoice page renders with amount and CTAs", async ({ page }) => {
  await clearAll();
  const m = await seedMerchant();
  const id = await seedInvoice({ merchantId: m.merchantId });

  await page.goto(`/i/${id}`);
  await expect(page.getByText("$49.99")).toBeVisible();
  await expect(page.getByText("EURC")).toBeVisible();
  await expect(page.getByText(/Pay with mobile wallet/i)).toBeVisible();
});
