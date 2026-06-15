import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] ?? "test-results";
const expectedAssertions = [
  "document width fits viewport",
  "no mobile horizontal overflow candidates",
  "price-search visual asset renders on mobile",
  "public Pages QR renders on mobile",
  "real-device QA checklist is present on the hero",
  "effective price proof details are visible",
  "condition evidence remains readable on mobile width",
  "static URL scan condition banner jumps to proof details",
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

  const qr = heroAssets.qr ?? {};
  if (!String(qr.src ?? "").includes("pages-qr.svg")) failures.push(`${file}: missing public Pages QR src`);
  if (qr.complete !== true) failures.push(`${file}: public Pages QR was not fully loaded`);
  if (qr.naturalWidth < 120 || qr.naturalHeight < 120) failures.push(`${file}: public Pages QR natural dimensions are too small`);
  if (qr.renderedWidth < 80 || qr.renderedHeight < 80) failures.push(`${file}: rendered public Pages QR is too small`);
  if (heroAssets.qaPointCount !== 3) failures.push(`${file}: expected three real-device QA checklist points`);

  const summary = payload.conditionSummary ?? {};
  if (!Array.isArray(summary.badges) || summary.badges.length === 0) failures.push(`${file}: missing condition badges`);
  if (!Array.isArray(summary.breakdownItems) || summary.breakdownItems.length !== 5) {
    failures.push(`${file}: expected five price-breakdown rows`);
  }
  if (!summary.breakdownItems?.some((item) => String(item).includes("実質価格"))) failures.push(`${file}: missing effective-price row`);
  if (!Array.isArray(summary.summaryItems) || summary.summaryItems.length === 0) {
    failures.push(`${file}: missing condition summary items`);
  }
  if (!summary.summaryItems?.some((item) => String(item).includes("見る")))
    failures.push(`${file}: missing actionable condition summary text`);
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
