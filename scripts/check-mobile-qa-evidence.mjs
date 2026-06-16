import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] ?? "test-results";
const expectedPagesUrl = "https://tmluku.github.io/Home-stack/";
const expectedBrowserE2eWorkflowUrl = "https://github.com/TMluku/Home-stack/actions/workflows/e2e.yml";
const expectedAssertions = [
  "document width fits viewport",
  "no mobile horizontal overflow candidates",
  "price-search visual asset renders on mobile",
  "price-search visual caption explains condition comparison",
  "public Pages QR renders on mobile",
  "real-device QA checklist is present on the hero",
  "effective price proof details are visible",
  "condition price quick-read remains visible",
  "condition adoption risk strip is visible",
  "condition guardrails show verification target and fallback price",
  "condition impact rows show per-condition fallback amounts",
  "condition action note explains seller-page checks",
  "condition confirmation checklist states when deductions may apply",
  "condition audit grid shows amount target deadline stacking and fallback checks",
  "condition evidence remains readable on mobile width",
  "condition fallback recompare price is visible",
  "condition memo copy action is visible on mobile",
  "comparison card fallback recompare price is visible",
  "condition decision rows show confirm and reject guidance",
  "static URL scan condition banner jumps to proof details",
  "all condition banners resolve to open proof details",
  "condition banners expose accessible detail labels",
  "primary mobile tap targets are at least 40 CSS pixels",
];

const files = await listFiles(root).catch(() => []);
const jsonFiles = files.filter((file) => file.endsWith("mobile-price-condition-proof.json"));
const pngFiles = files.filter((file) => file.endsWith("mobile-price-condition-proof.png"));
const failures = [];

if (jsonFiles.length === 0) failures.push(`missing mobile-price-condition-proof.json under ${root}`);
if (pngFiles.length === 0) failures.push(`missing mobile-price-condition-proof.png under ${root}`);

for (const file of jsonFiles) {
  const payload = await readJson(file);
  if (!payload) {
    failures.push(`${file}: invalid JSON`);
    continue;
  }

  if (!payload.url || typeof payload.url !== "string") failures.push(`${file}: missing captured url`);
  if (payload.expectedPagesUrl !== expectedPagesUrl) failures.push(`${file}: missing expected published Pages URL`);
  if (!String(payload.url ?? "").startsWith(expectedPagesUrl) && !String(payload.url ?? "").startsWith("http://127.0.0.1:")) {
    failures.push(`${file}: captured url is not the published Pages URL or local static preview`);
  }
  if (!payload.viewport || payload.viewport.width < 360 || payload.viewport.height < 600) {
    failures.push(`${file}: viewport is missing or too small`);
  }
  if (!payload.metrics || payload.metrics.bodyWidth > payload.metrics.viewportWidth || payload.metrics.overflowCount !== 0) {
    failures.push(`${file}: mobile overflow metrics failed`);
  }

  const heroAssets = payload.heroAssetSummary ?? {};
  const visual = heroAssets.visual ?? {};
  if (!String(visual.src ?? "").includes("price-insight-visual.png")) failures.push(`${file}: missing price-search visual src`);
  if (visual.complete !== true) failures.push(`${file}: price-search visual was not fully loaded`);
  if (visual.naturalWidth !== 1693 || visual.naturalHeight !== 929) {
    failures.push(`${file}: unexpected price-search visual dimensions`);
  }
  if (visual.renderedWidth < 250 || visual.renderedHeight < 130) {
    failures.push(`${file}: rendered price-search visual is too small`);
  }
  if (!String(heroAssets.visualCaption ?? "").includes("条件込み価格")) failures.push(`${file}: missing price-search visual caption`);
  if (!Array.isArray(heroAssets.visualLegendItems) || heroAssets.visualLegendItems.length !== 3) {
    failures.push(`${file}: expected three price-search visual legend items`);
  }
  const visualLegendText = Array.isArray(heroAssets.visualLegendItems) ? heroAssets.visualLegendItems.join(" ") : "";
  if (!visualLegendText.includes("条件込み") || !visualLegendText.includes("戻し価格") || !visualLegendText.includes("証跡")) {
    failures.push(`${file}: missing price-search visual legend labels`);
  }

  const qr = heroAssets.qr ?? {};
  if (!String(qr.src ?? "").includes("pages-qr.svg")) failures.push(`${file}: missing public Pages QR src`);
  if (qr.complete !== true) failures.push(`${file}: public Pages QR was not fully loaded`);
  if (qr.naturalWidth < 120 || qr.naturalHeight < 120) failures.push(`${file}: public Pages QR natural dimensions are too small`);
  if (qr.renderedWidth < 80 || qr.renderedHeight < 80) failures.push(`${file}: rendered public Pages QR is too small`);
  if (heroAssets.qaPointCount !== 3) failures.push(`${file}: expected three real-device QA checklist points`);

  const qaTemplate = payload.qaTemplateSummary ?? {};
  const qaTemplateText = String(qaTemplate.text ?? "");
  if (qaTemplate.browserE2eHref !== expectedBrowserE2eWorkflowUrl) failures.push(`${file}: missing Browser E2E workflow link`);
  if (!qaTemplateText.includes(expectedPagesUrl)) failures.push(`${file}: QA template does not include published Pages URL`);
  if (!qaTemplateText.includes("mobile-qa-evidence")) failures.push(`${file}: QA template does not mention mobile-qa-evidence`);
  if (!qaTemplateText.includes("condition audit grid")) failures.push(`${file}: QA template does not mention condition audit grid`);
  if (!qaTemplateText.includes("条件別の戻し額")) failures.push(`${file}: QA template does not mention per-condition fallback rows`);
  if (!qaTemplateText.includes("実機スクリーンショット"))
    failures.push(`${file}: QA template does not mention real-phone screenshot notes`);
  if (!qaTemplateText.includes("mobile-price-condition-proof.png") || !qaTemplateText.includes("mobile-price-condition-proof.json")) {
    failures.push(`${file}: QA template does not mention expected mobile evidence files`);
  }

  const summary = payload.conditionSummary ?? {};
  const candidateConditionSummary = payload.candidateConditionSummary ?? {};
  if (!String(candidateConditionSummary.bannerText ?? "").includes("条件あり")) {
    failures.push(`${file}: missing candidate condition banner`);
  }
  if (!String(candidateConditionSummary.bannerHref ?? "").startsWith("#candidate-conditions-")) {
    failures.push(`${file}: missing candidate condition proof anchor`);
  }
  if (!Array.isArray(candidateConditionSummary.badges) || candidateConditionSummary.badges.length === 0) {
    failures.push(`${file}: missing candidate condition badges`);
  }
  if (candidateConditionSummary.detailsOpen !== true) failures.push(`${file}: candidate condition details were not open`);
  if (!isHttpUrl(candidateConditionSummary.sellerLink)) failures.push(`${file}: missing candidate seller/search link`);

  if (!Array.isArray(summary.badges) || summary.badges.length === 0) failures.push(`${file}: missing condition badges`);
  if (!Array.isArray(summary.quickReadItems) || summary.quickReadItems.length !== 4) {
    failures.push(`${file}: expected four condition-price quick-read items`);
  }
  const quickReadText = Array.isArray(summary.quickReadItems) ? summary.quickReadItems.join(" ") : "";
  if (!quickReadText.includes("条件価格") || !quickReadText.includes("条件なし")) {
    failures.push(`${file}: missing condition-price quick-read comparison labels`);
  }
  if (!quickReadText.includes("控除合計") || !quickReadText.includes("要確認")) {
    failures.push(`${file}: missing condition-price quick-read deduction or decision labels`);
  }
  if (!Array.isArray(summary.riskItems) || summary.riskItems.length !== 3) {
    failures.push(`${file}: expected three condition adoption risk items`);
  }
  const riskText = Array.isArray(summary.riskItems) ? summary.riskItems.join(" ") : "";
  if (!riskText.includes("採用判定") || !riskText.includes("販売ページ確認後に採用")) {
    failures.push(`${file}: missing condition adoption decision text`);
  }
  if (!riskText.includes("確認漏れ時") || !riskText.includes("控除候補")) {
    failures.push(`${file}: missing condition adoption fallback or deduction text`);
  }
  if (!Array.isArray(summary.guardrailItems) || summary.guardrailItems.length !== 3) {
    failures.push(`${file}: expected three condition guardrail items`);
  }
  const guardrailText = Array.isArray(summary.guardrailItems) ? summary.guardrailItems.join(" ") : "";
  if (!guardrailText.includes("確認先") || !guardrailText.includes("販売ページ")) {
    failures.push(`${file}: missing condition guardrail verification target`);
  }
  if (!guardrailText.includes("根拠") || !guardrailText.includes("未成立時")) {
    failures.push(`${file}: missing condition guardrail evidence or fallback labels`);
  }
  if (!Array.isArray(summary.impactItems) || summary.impactItems.length === 0) {
    failures.push(`${file}: missing condition impact rows`);
  }
  const impactText = Array.isArray(summary.impactItems) ? summary.impactItems.join(" ") : "";
  if (!impactText.includes("戻す") || !impactText.includes("再比較")) {
    failures.push(`${file}: missing per-condition fallback amount text`);
  }
  const actionNoteText = String(summary.actionNoteText ?? "");
  if (!actionNoteText.includes("販売ページ") || !actionNoteText.includes("条件なし価格で再比較")) {
    failures.push(`${file}: missing condition action note`);
  }
  if (!Array.isArray(summary.confirmationItems) || summary.confirmationItems.length !== 3) {
    failures.push(`${file}: expected three condition confirmation items`);
  }
  const confirmationText = Array.isArray(summary.confirmationItems) ? summary.confirmationItems.join(" ") : "";
  if (
    !confirmationText.includes("金額・送料と一致") ||
    !confirmationText.includes("対象者・期間・併用可否") ||
    !confirmationText.includes("戻し価格で再比較")
  ) {
    failures.push(`${file}: missing condition confirmation checklist text`);
  }
  if (!Array.isArray(summary.auditItems) || summary.auditItems.length !== 5) {
    failures.push(`${file}: expected five condition audit items`);
  }
  const auditText = Array.isArray(summary.auditItems) ? summary.auditItems.join(" ") : "";
  if (
    !auditText.includes("金額") ||
    !auditText.includes("対象") ||
    !auditText.includes("期限") ||
    !auditText.includes("併用") ||
    !auditText.includes("不成立")
  ) {
    failures.push(`${file}: missing condition audit grid labels`);
  }
  if (!Array.isArray(summary.breakdownItems) || summary.breakdownItems.length !== 5) {
    failures.push(`${file}: expected five price-breakdown rows`);
  }
  if (!summary.breakdownItems?.some((item) => String(item).includes("実質価格"))) failures.push(`${file}: missing effective-price row`);
  if (!Array.isArray(summary.laneItems) || summary.laneItems.length !== 3)
    failures.push(`${file}: expected three price-verification lanes`);
  if (!summary.laneItems?.some((item) => String(item).includes("採用価格"))) failures.push(`${file}: missing adopted-price lane`);
  if (!summary.laneItems?.some((item) => String(item).includes("控除"))) failures.push(`${file}: missing deduction lane`);
  if (!summary.laneItems?.some((item) => String(item).includes("戻し価格"))) failures.push(`${file}: missing fallback-price lane`);
  if (!Array.isArray(summary.summaryItems) || summary.summaryItems.length === 0) {
    failures.push(`${file}: missing condition summary items`);
  }
  if (!summary.summaryItems?.some((item) => String(item).includes("見る")))
    failures.push(`${file}: missing actionable condition summary text`);
  if (!String(summary.recompareText ?? "").includes("条件不成立時") || !String(summary.recompareText ?? "").includes("再比較")) {
    failures.push(`${file}: missing condition fallback recompare price`);
  }
  if (!String(summary.copyMemoPreview ?? "").includes("Home Stack")) failures.push(`${file}: missing condition memo copy preview`);
  if (!String(summary.copyMemoButton ?? "").trim()) failures.push(`${file}: missing condition memo copy button`);
  if (!String(summary.copyMemoStatus ?? "").trim()) failures.push(`${file}: missing condition memo copy status`);
  const comparisonSummary = payload.comparisonSummary ?? {};
  if (
    !String(comparisonSummary.recompareText ?? "").includes("条件外なら") ||
    !String(comparisonSummary.recompareText ?? "").includes("再比較")
  ) {
    failures.push(`${file}: missing comparison-card fallback recompare price`);
  }
  if (!String(comparisonSummary.recompareLabel ?? "").includes("条件不成立時価格")) {
    failures.push(`${file}: missing comparison-card fallback aria label`);
  }
  if (!Array.isArray(comparisonSummary.conditionSummaryItems) || comparisonSummary.conditionSummaryItems.length === 0) {
    failures.push(`${file}: missing comparison-card compact condition summary`);
  }
  if (!Array.isArray(summary.decisionRows) || summary.decisionRows.length === 0) {
    failures.push(`${file}: missing condition decision rows`);
  }
  if (!summary.decisionRows?.some((item) => String(item).includes("控除しない") || String(item).includes("再比較"))) {
    failures.push(`${file}: missing condition reject guidance`);
  }
  if (!Array.isArray(summary.detailRows) || summary.detailRows.length === 0) failures.push(`${file}: missing condition detail rows`);
  if (summary.detailsOpen !== true) failures.push(`${file}: condition details were not open`);
  if (!isHttpUrl(summary.sellerLink)) failures.push(`${file}: missing seller/search link`);

  const liveScanSummary = payload.liveScanSummary ?? {};
  if (!String(liveScanSummary.bannerText ?? "").includes("条件あり")) failures.push(`${file}: missing live scan condition banner`);
  if (liveScanSummary.bannerHref !== "#live-conditions-0") failures.push(`${file}: missing live scan proof anchor`);
  if (!Array.isArray(liveScanSummary.badges) || liveScanSummary.badges.length === 0)
    failures.push(`${file}: missing live scan condition badges`);
  if (liveScanSummary.detailsOpen !== true) failures.push(`${file}: live scan condition details were not open`);
  if (!isHttpUrl(liveScanSummary.sellerLink)) failures.push(`${file}: missing live scan seller/search link`);

  const conditionAnchors = payload.conditionAnchorSummary;
  if (!Array.isArray(conditionAnchors) || conditionAnchors.length < 2) {
    failures.push(`${file}: missing condition banner anchor summary`);
  } else {
    for (const [index, anchor] of conditionAnchors.entries()) {
      if (!String(anchor.href ?? "").startsWith("#")) failures.push(`${file}: condition anchor ${index} is not an in-page link`);
      if (!String(anchor.ariaLabel ?? "").includes("条件ありの詳細を開く"))
        failures.push(`${file}: condition anchor ${index} is missing an accessible detail label`);
      if (anchor.targetExists !== true) failures.push(`${file}: condition anchor ${index} target is missing`);
      if (anchor.targetDetailsOpen !== true) failures.push(`${file}: condition anchor ${index} details are not open`);
    }
  }

  const tapTargets = payload.tapTargetSummary;
  if (!Array.isArray(tapTargets) || tapTargets.length < 8) {
    failures.push(`${file}: missing primary mobile tap target summary`);
  } else {
    for (const [index, target] of tapTargets.entries()) {
      if (!target || typeof target !== "object") {
        failures.push(`${file}: tap target ${index} is invalid`);
        continue;
      }
      const width = Number(target.width);
      const height = Number(target.height);
      if (width < 40 || height < 40) {
        failures.push(`${file}: tap target ${index} is too small (${width}x${height})`);
      }
    }
  }

  for (const assertion of expectedAssertions) {
    if (!payload.assertions?.includes(assertion)) failures.push(`${file}: missing assertion "${assertion}"`);
  }
}

for (const file of pngFiles) {
  const buffer = await readFile(file);
  const dimensions = readPngDimensions(buffer);
  if (!dimensions) {
    failures.push(`${file}: not a PNG image`);
    continue;
  }
  if (dimensions.width < 360 || dimensions.height < 600) {
    failures.push(`${file}: screenshot dimensions are too small (${dimensions.width}x${dimensions.height})`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log(`PASS mobile QA evidence: ${jsonFiles.length} JSON file(s), ${pngFiles.length} PNG file(s)`);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(path);
      if (entry.isFile()) return path;
      return [];
    }),
  );
  return nested.flat();
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readPngDimensions(buffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
