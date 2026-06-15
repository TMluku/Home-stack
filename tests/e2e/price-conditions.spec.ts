import { expect, test } from "@playwright/test";

test("shows ranked price candidates with condition evidence and visual asset", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".price-insight-visual img")).toHaveAttribute("src", /price-insight-visual\.png/);
  await page.getByRole("button", { name: "公開URLをコピー" }).click();
  await expect(page.locator(".hero__hint")).toContainText(/公開URLをコピーしました|https:\/\/tmluku\.github\.io\/Home-stack\//);
  await page.getByRole("button", { name: "URLを共有" }).click();
  await expect(page.locator(".hero__hint")).toContainText(
    /公開URLを共有しました|共有非対応のためURLをコピーしました|共有をキャンセルしました|https:\/\/tmluku\.github\.io\/Home-stack\//,
  );

  await page.locator(".inventory-search-chips .chip").first().click();

  await expect(page.locator(".market-card")).toHaveCount(5);
  await expect(page.locator(".effective-proof")).toHaveCount(2);

  const conditionalProof = page.locator(".effective-proof").filter({ hasText: "価格条件を確認" }).first();
  await expect(conditionalProof.locator(".effective-proof__badge")).toHaveCount(1);
  await expect(conditionalProof.locator("details")).toHaveAttribute("open", "");
  await expect(conditionalProof).toContainText("販売ページで条件を見る");
  await expect(conditionalProof).toContainText("送料:");
  await expect(conditionalProof).toContainText("ポイント:");
  await expect(conditionalProof.locator(".effective-proof__formula")).toContainText(/表示.*送料.*ポイント.*クーポン.*実質/);
  await expect(conditionalProof.locator(".effective-proof__notice")).toContainText("条件成立時の見込み");
  await expect(conditionalProof.locator(".effective-proof__details li")).toHaveCount(6);

  const unconditionalProof = page.locator(".effective-proof").filter({ hasText: "価格根拠を確認" }).first();
  await expect(unconditionalProof.locator("details")).not.toHaveAttribute("open", "");
  await expect(unconditionalProof.locator(".effective-proof__notice--plain")).toContainText("控除条件なし");
});

test("keeps the price condition proof usable on mobile width", async ({ page }, testInfo) => {
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

  if (testInfo.project.name === "mobile-chrome") {
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("mobile-price-condition-proof.png"),
    });
  }
});
