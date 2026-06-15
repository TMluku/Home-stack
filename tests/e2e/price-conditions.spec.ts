import { expect, test } from "@playwright/test";

test("shows ranked price candidates with condition evidence and visual asset", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".price-insight-visual img")).toHaveAttribute("src", /price-insight-visual\.png/);

  await page.locator(".inventory-search-chips .chip").first().click();

  await expect(page.locator(".market-card")).toHaveCount(5);
  await expect(page.locator(".effective-proof")).toHaveCount(2);

  const conditionalProof = page.locator(".effective-proof").filter({ hasText: "価格条件を確認" }).first();
  await expect(conditionalProof.locator("details")).toHaveAttribute("open", "");
  await expect(conditionalProof).toContainText("販売ページで条件を見る");
  await expect(conditionalProof.locator("li")).toHaveCount(6);

  const unconditionalProof = page.locator(".effective-proof").filter({ hasText: "価格根拠を確認" }).first();
  await expect(unconditionalProof.locator("details")).not.toHaveAttribute("open", "");
});

test("keeps the price condition proof usable on mobile width", async ({ page }) => {
  await page.goto("/");
  await page.locator(".inventory-search-chips .chip").first().click();

  const metrics = await page.evaluate(() => ({
    bodyWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    overflowCount: [...document.querySelectorAll("body *")]
      .filter((element) => !(element instanceof HTMLElement && element.classList.contains("visually-hidden")))
      .filter((element) => element.tagName !== "INPUT")
      .filter((element) => element.scrollWidth > element.clientWidth + 2).length,
  }));

  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.overflowCount).toBe(0);
  await expect(page.locator(".effective-proof__details").first()).toBeVisible();
});
