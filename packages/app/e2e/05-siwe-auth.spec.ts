import { test, expect } from "@playwright/test";

test("login page renders SIWE entrypoint", async ({ page }) => {
  await page.goto("/m/login");
  await expect(page.getByRole("heading", { name: "Merchant sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect/ })).toBeVisible();
});
