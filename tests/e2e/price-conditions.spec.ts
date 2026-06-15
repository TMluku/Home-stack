import { expect, test } from "@playwright/test";

test("shows ranked price candidates with condition evidence and visual asset", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".price-insight-visual img")).toHaveAttribute("src", /price-insight-visual\.png/);
  await expect(page.getByAltText("Home Stack GitHub Pages 公開URLのQRコード")).toHaveAttribute("src", /pages-qr\.svg/);
  await expect(page.getByLabel("実機スマホQA確認ポイント").locator("li")).toHaveCount(3);
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
  await expect(conditionalProof.locator(".effective-proof__badge").first()).toBeVisible();
  await expect(conditionalProof.locator(".effective-proof__badges")).toContainText("購入条件あり");
  await expect(conditionalProof.locator(".effective-proof__badges")).toContainText("クーポン条件あり");
  await expect(conditionalProof.locator("details")).toHaveAttribute("open", "");
  await expect(conditionalProof).toContainText("販売ページで条件を見る");
  await expect(conditionalProof).toContainText("購入条件:");
  await expect(conditionalProof).toContainText("クーポン条件:");
  await expect(conditionalProof.locator(".effective-proof__breakdown")).toHaveAttribute("aria-label", "実質価格の計算内訳");
  await expect(conditionalProof.locator(".effective-proof__breakdown-item")).toHaveCount(5);
  await expect(conditionalProof.locator(".effective-proof__breakdown-item--total")).toContainText("実質価格");
  await expect(conditionalProof.locator(".effective-proof__formula")).toContainText(/表示.*送料.*ポイント.*クーポン.*実質/);
  await expect(conditionalProof.locator(".effective-proof__notice")).toContainText("条件成立時の見込み");
  await expect(conditionalProof.locator(".effective-proof__checklist")).toContainText("数量・定期・初回条件");
  await expect(conditionalProof.locator(".effective-proof__checklist")).toContainText("対象者・併用可否");
  await expect(conditionalProof.locator(".effective-proof__details li")).toHaveCount(6);
  const conditionLink = conditionalProof.getByRole("link", { name: "販売ページで条件を見る" });
  await expect(conditionLink).toHaveAttribute("href", /^https?:\/\//);
  await expect(conditionLink).toHaveAttribute("target", "_blank");
  await expect(conditionLink).toHaveAttribute("rel", /noreferrer/);

  await expect(page.locator(".effective-proof").filter({ hasText: "購入条件あり" })).not.toHaveCount(0);
});

test("keeps offer cards sorted by effective price while filtering by conditions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "価格順リストを見る" }).click();

  const prices = await page
    .locator(".offer-card__price")
    .evaluateAll((nodes) =>
      nodes.map((node) => Number((node.textContent ?? "").replace(/[^\d]/g, ""))).filter((price) => Number.isFinite(price)),
    );
  expect(prices.length).toBeGreaterThan(1);
  expect(prices).toEqual([...prices].sort((a, b) => a - b));

  await page.getByRole("button", { name: "条件なし" }).click();
  await expect(page.locator(".offer-card")).not.toHaveCount(0);
  await expect(page.locator(".offer-card__label--conditions")).toHaveCount(0);
  await expect(page.locator(".offer-card__label--plain").first()).toContainText("条件なし");

  await page.getByRole("button", { name: "条件あり" }).click();
  await expect(page.locator(".offer-card")).not.toHaveCount(0);
  await expect(page.locator(".offer-card__label--plain")).toHaveCount(0);
  await expect(page.locator(".offer-card__label--conditions").first()).toContainText("条件あり");
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
