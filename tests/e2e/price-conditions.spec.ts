import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("shows ranked price candidates with condition evidence and visual asset", async ({ page }) => {
  await page.goto("/");
  const expectedPagesUrl = "https://tmluku.github.io/Home-stack/";

  const priceVisual = page.locator(".price-insight-visual img");
  await expect(priceVisual).toHaveAttribute("src", /price-insight-visual\.png/);
  await expect(priceVisual).toBeVisible();
  const visualMetrics = await priceVisual.evaluate((image) => {
    if (!(image instanceof HTMLImageElement)) return null;
    const rect = image.getBoundingClientRect();
    return {
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      renderedWidth: Math.round(rect.width),
      renderedHeight: Math.round(rect.height),
    };
  });
  expect(visualMetrics).toMatchObject({
    complete: true,
    naturalWidth: 1693,
    naturalHeight: 929,
  });
  expect(visualMetrics?.renderedWidth ?? 0).toBeGreaterThan(250);
  expect(visualMetrics?.renderedHeight ?? 0).toBeGreaterThan(130);
  await expect(page.getByAltText("Home Stack GitHub Pages 公開URLのQRコード")).toHaveAttribute("src", /pages-qr\.svg/);
  await expect(page.getByLabel("実機スマホQA確認ポイント").locator("li")).toHaveCount(3);
  await page.getByRole("button", { name: "公開URLをコピー" }).click();
  await expect(page.locator(".hero__hint")).toContainText(/公開URLをコピーしました|https:\/\/tmluku\.github\.io\/Home-stack\//);
  await page.getByRole("button", { name: "URLを共有" }).click();
  await expect(page.locator(".hero__hint")).toContainText(
    /公開URLを共有しました|共有非対応のためURLをコピーしました|共有をキャンセルしました|https:\/\/tmluku\.github\.io\/Home-stack\//,
  );
  await expect(page.locator(".hero__qa-template")).toContainText("実機QAで記録する項目");
  await expect(page.locator(".hero__qa-template")).toContainText("mobile-qa-evidence");
  await expect(page.locator(".hero__qa-template")).toContainText(expectedPagesUrl);
  await expect(page.locator(".hero__qa-template")).toContainText("実機スクリーンショット");
  await page.locator(".hero__qa-template summary").click();
  await expect(page.locator(".hero__qa-template").getByRole("link", { name: "Browser E2E" })).toHaveAttribute(
    "href",
    "https://github.com/TMluku/Home-stack/actions/workflows/e2e.yml",
  );
  await page.getByRole("button", { name: "QA記録をコピー" }).click();
  await expect(page.locator(".hero__hint")).toContainText(/実機QA記録テンプレートをコピーしました|\| .*GitHub Pages実機QA/);

  await page.locator(".inventory-search-chips .chip").first().click();

  await expect(page.locator(".market-card")).toHaveCount(5);
  await expect(page.locator(".market-summary")).toContainText("実質価格1位");
  await expect(page.locator(".market-summary")).not.toContainText("最安候補");
  const firstCardPrice = await page.locator(".market-card strong").first().innerText();
  await expect(page.locator(".market-summary div").filter({ hasText: "実質価格1位" })).toContainText(firstCardPrice);
  await expect(page.locator(".effective-proof")).toHaveCount(2);

  const conditionalProof = page.locator(".effective-proof").filter({ hasText: "価格条件を確認" }).first();
  const conditionBanner = page.locator(".market-card .condition-banner").first();
  await expect(conditionBanner).toContainText("条件あり");
  await expect(conditionBanner).toHaveAttribute("href", /#candidate-conditions-/);
  await conditionBanner.click();
  await expect(page).toHaveURL(/#candidate-conditions-/);
  await expect(conditionalProof).toBeInViewport();
  await expect(conditionalProof.locator(".effective-proof__badge").first()).toBeVisible();
  await expect(conditionalProof.locator(".effective-proof__badges")).toContainText("購入条件あり");
  await expect(conditionalProof.locator(".effective-proof__badges")).toContainText("クーポン条件あり");
  await expect(conditionalProof.locator(".effective-proof__summary")).toHaveAttribute("aria-label", "価格成立条件の要約");
  await expect(conditionalProof.locator(".effective-proof__summary")).toContainText("購入");
  await expect(conditionalProof.locator(".effective-proof__summary")).toContainText("数量・定期・初回・セット条件を見る");
  await expect(conditionalProof.locator(".effective-proof__summary")).toContainText("クーポン");
  await expect(conditionalProof.locator(".effective-proof__summary")).toContainText("取得条件・併用可否・対象者を見る");
  await expect(conditionalProof.locator("details")).toHaveAttribute("open", "");
  await expect(conditionalProof).toContainText("販売ページで条件を見る");
  await expect(conditionalProof).toContainText("購入条件:");
  await expect(conditionalProof).toContainText("クーポン条件:");
  await expect(conditionalProof.locator(".effective-proof__quick-read")).toHaveAttribute("aria-label", "条件価格の要点");
  await expect(conditionalProof.locator(".effective-proof__quick-read-item")).toHaveCount(4);
  await expect(conditionalProof.locator(".effective-proof__quick-read")).toContainText("条件価格");
  await expect(conditionalProof.locator(".effective-proof__quick-read")).toContainText("条件なし");
  await expect(conditionalProof.locator(".effective-proof__quick-read")).toContainText("控除合計");
  await expect(conditionalProof.locator(".effective-proof__quick-read")).toContainText("要確認");
  await expect(conditionalProof.locator(".effective-proof__guardrails")).toHaveAttribute("aria-label", "価格条件の確認先");
  await expect(conditionalProof.locator(".effective-proof__guardrails div")).toHaveCount(3);
  await expect(conditionalProof.locator(".effective-proof__action-note")).toHaveAttribute("aria-label", "条件確認メモ");
  await expect(conditionalProof.locator(".effective-proof__action-note")).toContainText("販売ページ");
  await expect(conditionalProof.locator(".effective-proof__action-note")).toContainText("条件なし価格で再比較");
  await expect(conditionalProof.locator(".effective-proof__confirmation")).toHaveAttribute("aria-label", "控除してよい条件");
  await expect(conditionalProof.locator(".effective-proof__confirmation li")).toHaveCount(3);
  await expect(conditionalProof.locator(".effective-proof__confirmation")).toContainText("金額・送料と一致");
  await expect(conditionalProof.locator(".effective-proof__confirmation")).toContainText("対象者・期間・併用可否");
  await expect(conditionalProof.locator(".effective-proof__confirmation")).toContainText("戻し価格で再比較");
  await expect(conditionalProof.locator(".effective-proof__guardrails")).toContainText("確認先");
  await expect(conditionalProof.locator(".effective-proof__guardrails")).toContainText("販売ページ");
  await expect(conditionalProof.locator(".effective-proof__guardrails")).toContainText("根拠");
  await expect(conditionalProof.locator(".effective-proof__guardrails")).toContainText("未成立時");
  await expect(conditionalProof.locator(".effective-proof__breakdown")).toHaveAttribute("aria-label", "実質価格の計算内訳");
  await expect(conditionalProof.locator(".effective-proof__breakdown-item")).toHaveCount(5);
  await expect(conditionalProof.locator(".effective-proof__breakdown-item--total")).toContainText("実質価格");
  await expect(conditionalProof.locator(".effective-proof__formula")).toContainText(/表示.*送料.*ポイント.*クーポン.*実質/);
  await expect(conditionalProof.locator(".effective-proof__lanes")).toHaveAttribute("aria-label", "価格判定レーン");
  await expect(conditionalProof.locator(".effective-proof__lanes div")).toHaveCount(3);
  await expect(conditionalProof.locator(".effective-proof__lanes")).toContainText("採用価格");
  await expect(conditionalProof.locator(".effective-proof__lanes")).toContainText("控除");
  await expect(conditionalProof.locator(".effective-proof__lanes")).toContainText("戻し価格");
  await expect(conditionalProof.locator(".effective-proof__recompare")).toHaveAttribute("aria-label", "条件不成立時の再比較価格");
  await expect(conditionalProof.locator(".effective-proof__recompare")).toContainText("条件不成立時");
  await expect(conditionalProof.locator(".effective-proof__recompare")).toContainText("再比較");
  await expect(conditionalProof.locator(".effective-proof__notice")).toContainText("条件成立時の見込み");
  await expect(conditionalProof.locator(".effective-proof__checklist")).toContainText("数量・定期・初回条件");
  await expect(conditionalProof.locator(".effective-proof__checklist")).toContainText("送料無料ライン・配送条件");
  await expect(conditionalProof.locator(".effective-proof__checklist")).toContainText("付与時期・利用先");
  await expect(conditionalProof.locator(".effective-proof__checklist")).toContainText("対象者・併用可否");
  await expect(conditionalProof.locator(".effective-proof__decision")).toHaveAttribute("aria-label", "販売ページで確認する条件判定");
  await expect(conditionalProof.locator(".effective-proof__decision")).toContainText("購入条件");
  await expect(conditionalProof.locator(".effective-proof__decision")).toContainText("未達なら表示価格で再比較");
  await expect(conditionalProof.locator(".effective-proof__decision")).toContainText("クーポン");
  await expect(conditionalProof.locator(".effective-proof__decision")).toContainText("未取得・対象外なら控除しない");
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

  await expect(page.locator(".comparison-breakdown").first()).toHaveAttribute("aria-label", /の実質価格内訳/);
  await expect(page.locator(".comparison-breakdown").first()).toContainText("表示");
  await expect(page.locator(".comparison-breakdown").first()).toContainText("条件差分");
  await expect(page.locator(".comparison-breakdown").first()).toContainText("実質");
  await expect(page.locator(".comparison-breakdown__adjustment--subtract").first()).toBeVisible();
  const conditionalComparisonCard = page.locator(".comparison-card").filter({ hasText: "条件あり" }).first();
  await expect(conditionalComparisonCard.locator(".comparison-recompare")).toHaveAttribute("aria-label", /条件不成立時価格/);
  await expect(conditionalComparisonCard.locator(".comparison-recompare")).toContainText("条件外なら");
  await expect(conditionalComparisonCard.locator(".comparison-recompare")).toContainText("再比較");
  await expect(conditionalComparisonCard.locator(".condition-summary--compact")).toHaveAttribute("aria-label", "価格成立条件の要約");
  await expect(conditionalComparisonCard.locator(".condition-summary--compact")).toContainText(/購入|送料|ポイント|クーポン/);
  await page.locator(".comparison-card .condition-banner").first().click();
  await expect(page.locator(".condition-details")).toBeInViewport();
  await expect(page.locator(".condition-details .condition-summary").first()).toContainText(/見る/);

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

test("links live scan condition banners to proof details on the static Pages build", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("商品ページURL").fill("https://example.com/demo-condition-item");
  await page.getByRole("button", { name: "ライブ価格を取得" }).click();

  await expect(page.locator(".live-price-card")).toHaveCount(1);
  const liveConditionBanner = page.locator(".live-price-card .condition-banner").first();
  await expect(liveConditionBanner).toContainText("条件あり");
  await expect(liveConditionBanner).toHaveAttribute("href", "#live-conditions-0");
  await liveConditionBanner.click();
  await expect(page).toHaveURL(/#live-conditions-0/);

  const liveProof = page.locator("#live-conditions-0");
  await expect(liveProof).toBeInViewport();
  await expect(liveProof.locator(".effective-proof__badges")).toContainText("購入条件あり");
  await expect(liveProof.locator(".effective-proof__details")).toHaveAttribute("open", "");
  await expect(liveProof.getByRole("link", { name: "販売ページで条件を見る" })).toHaveAttribute(
    "href",
    "https://example.com/demo-condition-item",
  );
});

test("keeps the price condition proof usable on mobile width", async ({ page }, testInfo) => {
  await page.goto("/");
  const expectedPagesUrl = "https://tmluku.github.io/Home-stack/";
  const heroAssetSummary = await page.evaluate(() => {
    const visual = document.querySelector(".price-insight-visual img");
    const qr = document.querySelector('img[alt="Home Stack GitHub Pages 公開URLのQRコード"]');
    const readImage = (image: Element | null) => {
      if (!(image instanceof HTMLImageElement)) return null;
      const rect = image.getBoundingClientRect();
      return {
        src: image.getAttribute("src"),
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        renderedWidth: Math.round(rect.width),
        renderedHeight: Math.round(rect.height),
      };
    };

    return {
      visual: readImage(visual),
      qr: readImage(qr),
      qaPointCount: document.querySelectorAll('[aria-label="実機スマホQA確認ポイント"] li').length,
    };
  });
  const qaTemplateSummary = await page.locator(".hero__qa-template").evaluate((template) => ({
    text: template.textContent?.trim() ?? "",
    browserE2eHref: template.querySelector('a[href*="actions/workflows/e2e.yml"]')?.getAttribute("href") ?? null,
  }));

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
    const candidateConditionSummary = await page
      .locator(".market-card")
      .filter({ has: page.locator(".condition-banner") })
      .first()
      .evaluate((card) => {
        const proof = card.querySelector(".effective-proof");
        return {
          bannerText: card.querySelector(".condition-banner")?.textContent?.trim() ?? null,
          bannerHref: card.querySelector(".condition-banner")?.getAttribute("href") ?? null,
          badges: [...card.querySelectorAll(".effective-proof__badge")].map((badge) => badge.textContent?.trim()).filter(Boolean),
          detailsOpen: proof?.querySelector(".effective-proof__details")?.hasAttribute("open") ?? false,
          sellerLink: proof?.querySelector(".effective-proof__details a")?.getAttribute("href") ?? null,
        };
      });
    const conditionSummary = await page
      .locator(".effective-proof")
      .first()
      .evaluate((proof) => ({
        badges: [...proof.querySelectorAll(".effective-proof__badge")].map((badge) => badge.textContent?.trim()).filter(Boolean),
        quickReadItems: [...proof.querySelectorAll(".effective-proof__quick-read-item")]
          .map((item) => item.textContent?.trim())
          .filter(Boolean),
        guardrailItems: [...proof.querySelectorAll(".effective-proof__guardrails div")]
          .map((item) => item.textContent?.trim())
          .filter(Boolean),
        actionNoteText: proof.querySelector(".effective-proof__action-note")?.textContent?.trim() ?? null,
        confirmationItems: [...proof.querySelectorAll(".effective-proof__confirmation li")]
          .map((item) => item.textContent?.trim())
          .filter(Boolean),
        breakdownItems: [...proof.querySelectorAll(".effective-proof__breakdown-item")]
          .map((item) => item.textContent?.trim())
          .filter(Boolean),
        laneItems: [...proof.querySelectorAll(".effective-proof__lanes div")].map((item) => item.textContent?.trim()).filter(Boolean),
        summaryItems: [...proof.querySelectorAll(".effective-proof__summary div")].map((item) => item.textContent?.trim()).filter(Boolean),
        recompareText: proof.querySelector(".effective-proof__recompare")?.textContent?.trim() ?? null,
        decisionRows: [...proof.querySelectorAll(".effective-proof__decision div")].map((item) => item.textContent?.trim()).filter(Boolean),
        detailRows: [...proof.querySelectorAll(".effective-proof__details li")].map((item) => item.textContent?.trim()).filter(Boolean),
        detailsOpen: proof.querySelector(".effective-proof__details")?.hasAttribute("open") ?? false,
        sellerLink: proof.querySelector(".effective-proof__details a")?.getAttribute("href") ?? null,
      }));
    await page.getByLabel("商品ページURL").fill("https://example.com/demo-condition-item");
    await page.getByRole("button", { name: "ライブ価格を取得" }).click();
    const liveConditionBanner = page.locator(".live-price-card .condition-banner").first();
    await expect(liveConditionBanner).toBeVisible();
    await liveConditionBanner.click();
    await expect(page.locator("#live-conditions-0")).toBeInViewport();
    const liveScanSummary = await page
      .locator(".live-price-card")
      .first()
      .evaluate((card) => {
        const proof = card.querySelector("#live-conditions-0");
        return {
          bannerText: card.querySelector(".condition-banner")?.textContent?.trim() ?? null,
          bannerHref: card.querySelector(".condition-banner")?.getAttribute("href") ?? null,
          badges: [...card.querySelectorAll(".effective-proof__badge")].map((badge) => badge.textContent?.trim()).filter(Boolean),
          detailsOpen: proof?.querySelector(".effective-proof__details")?.hasAttribute("open") ?? false,
          sellerLink: proof?.querySelector(".effective-proof__details a")?.getAttribute("href") ?? null,
        };
      });
    await writeFile(
      testInfo.outputPath("mobile-price-condition-proof.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          url: page.url(),
          viewport: page.viewportSize(),
          expectedPagesUrl,
          metrics,
          heroAssetSummary,
          qaTemplateSummary,
          candidateConditionSummary,
          conditionSummary,
          liveScanSummary,
          assertions: [
            "document width fits viewport",
            "no mobile horizontal overflow candidates",
            "price-search visual asset renders on mobile",
            "public Pages QR renders on mobile",
            "real-device QA checklist is present on the hero",
            "effective price proof details are visible",
            "condition price quick-read remains visible",
            "condition guardrails show verification target and fallback price",
            "condition action note explains seller-page checks",
            "condition confirmation checklist states when deductions may apply",
            "condition evidence remains readable on mobile width",
            "condition fallback recompare price is visible",
            "condition decision rows show confirm and reject guidance",
            "static URL scan condition banner jumps to proof details",
          ],
        },
        null,
        2,
      ),
    );
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("mobile-price-condition-proof.png"),
    });
  }
});
