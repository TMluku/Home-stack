import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts", "check-real-device-qa.mjs");
const mobileEvidenceScriptPath = join(process.cwd(), "scripts", "check-mobile-qa-evidence.mjs");
const browserE2eWorkflowUrl = "https://github.com/TMluku/Home-stack/actions/workflows/e2e.yml";
const browserE2eWorkflowWithConditionNote = `${browserE2eWorkflowUrl} / 条件確認メモ / condition audit grid`;

async function withQaFile(markdown: string, run: (filePath: string) => void) {
  const dir = await mkdtemp(join(tmpdir(), "home-stack-real-device-qa-"));
  const filePath = join(dir, "mobile-qa.md");
  try {
    await writeFile(filePath, markdown, "utf8");
    run(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withEvidenceDir(files: Record<string, string | Buffer>, run: (dirPath: string) => void) {
  const dir = await mkdtemp(join(tmpdir(), "home-stack-mobile-evidence-"));
  try {
    await mkdir(join(dir, "mobile-chrome"), { recursive: true });
    await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(dir, "mobile-chrome", name), content)));
    run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function minimalPng(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe("real-device QA gate", () => {
  it("rejects automated-only mobile evidence without a real-phone screenshot note", async () => {
    await withQaFile(
      [
        "| Date | Device | Browser | Network | Result | Notes |",
        "|---|---|---|---|---|---|",
        "| 2026-06-16 | iPhone 15 | Safari | Wi-Fi | Pass | https://tmluku.github.io/Home-stack/ / mobile-qa-evidence / mobile-price-condition-proof.png |",
      ].join("\n"),
      (filePath) => {
        const result = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("real-phone screenshot");
      },
    );
  });

  it("rejects copied rows until the screenshot filename placeholder is replaced", async () => {
    await withQaFile(
      [
        "| Date | Device | Browser | Network | Result | Notes |",
        "|---|---|---|---|---|---|",
        "| 2026-06-16 | Pixel 8 | Chrome | 5G | Pass | https://tmluku.github.io/Home-stack/ / mobile-qa-evidence / 実機スクリーンショット: 実ファイル名を記入 |",
      ].join("\n"),
      (filePath) => {
        const result = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("real-phone screenshot");
      },
    );
  });

  it("accepts a real-device pass with published URL, automated evidence, and phone screenshot note", async () => {
    await withQaFile(
      [
        "| Date | Device | Browser | Network | Result | Notes |",
        "|---|---|---|---|---|---|",
        `| 2026-06-16 | Pixel 8 | Chrome | 5G | Pass | https://tmluku.github.io/Home-stack/ / Browser E2E: ${browserE2eWorkflowWithConditionNote} / mobile-qa-evidence / mobile-price-condition-proof.png / mobile-price-condition-proof.json / 実機スクリーンショット: phone-price-proof.png |`,
      ].join("\n"),
      (filePath) => {
        const result = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("PASS");
      },
    );
  });

  it("accepts a real-device pass with a concrete Browser E2E run URL", async () => {
    await withQaFile(
      [
        "| Date | Device | Browser | Network | Result | Notes |",
        "|---|---|---|---|---|---|",
        "| 2026-06-16 | iPhone 15 | Safari | Wi-Fi | Pass | https://tmluku.github.io/Home-stack/ / Browser E2E: https://github.com/TMluku/Home-stack/actions/runs/27592318017 / mobile-qa-evidence / mobile-price-condition-proof.png / mobile-price-condition-proof.json / condition action note / condition audit grid / real-device screenshot: iphone-price-proof.png |",
      ].join("\n"),
      (filePath) => {
        const result = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("PASS");
      },
    );
  });

  it("rejects real-device rows without Browser E2E and mobile evidence filenames", async () => {
    await withQaFile(
      [
        "| Date | Device | Browser | Network | Result | Notes |",
        "|---|---|---|---|---|---|",
        "| 2026-06-16 | Pixel 8 | Chrome | 5G | Pass | https://tmluku.github.io/Home-stack/ / mobile-qa-evidence / 実機スクリーンショット: phone-price-proof.png |",
      ].join("\n"),
      (filePath) => {
        const result = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Browser E2E workflow or run URL");
      },
    );
  });

  it("prints row-level missing evidence diagnostics", async () => {
    await withQaFile(
      [
        "| Date | Device | Browser | Network | Result | Notes |",
        "|---|---|---|---|---|---|",
        "| 2026-06-16 | Pixel 8 | Chrome | 5G | Fail | checked locally only |",
      ].join("\n"),
      (filePath) => {
        const result = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Checked dated rows");
        expect(result.stderr).toContain("Pixel 8 Chrome 5G Fail");
        expect(result.stderr).toContain("Result `Pass`");
        expect(result.stderr).toContain("tested published Pages URL");
        expect(result.stderr).toContain("Browser E2E workflow or run URL");
        expect(result.stderr).toContain("mobile-price-condition-proof.png and mobile-price-condition-proof.json");
      },
    );
  });

  it("rejects real-device rows without the condition action note check", async () => {
    await withQaFile(
      [
        "| Date | Device | Browser | Network | Result | Notes |",
        "|---|---|---|---|---|---|",
        "| 2026-06-16 | Pixel 8 | Chrome | 5G | Pass | https://tmluku.github.io/Home-stack/ / Browser E2E: https://github.com/TMluku/Home-stack/actions/workflows/e2e.yml / mobile-qa-evidence / mobile-price-condition-proof.png / mobile-price-condition-proof.json / real-device screenshot: phone-price-proof.png |",
      ].join("\n"),
      (filePath) => {
        const result = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("条件確認メモ");
      },
    );
  });

  it("rejects real-device rows without the condition audit grid check", async () => {
    await withQaFile(
      [
        "| Date | Device | Browser | Network | Result | Notes |",
        "|---|---|---|---|---|---|",
        "| 2026-06-16 | Pixel 8 | Chrome | 5G | Pass | https://tmluku.github.io/Home-stack/ / Browser E2E: https://github.com/TMluku/Home-stack/actions/workflows/e2e.yml / mobile-qa-evidence / mobile-price-condition-proof.png / mobile-price-condition-proof.json / condition action note / real-device screenshot: phone-price-proof.png |",
      ].join("\n"),
      (filePath) => {
        const result = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("condition audit grid");
      },
    );
  });
});

describe("mobile QA evidence gate", () => {
  it("rejects condition proof JSON when quick-read evidence is missing", async () => {
    await withEvidenceDir(
      {
        "mobile-price-condition-proof.png": minimalPng(390, 1200),
        "mobile-price-condition-proof.json": JSON.stringify({
          url: "http://127.0.0.1:4173/Home-stack/#candidate-conditions-demo",
          expectedPagesUrl: "https://tmluku.github.io/Home-stack/",
          viewport: { width: 390, height: 844 },
          metrics: { bodyWidth: 390, viewportWidth: 390, overflowCount: 0 },
          heroAssetSummary: {
            visual: {
              src: "/Home-stack/price-insight-visual.png",
              complete: true,
              naturalWidth: 1693,
              naturalHeight: 929,
              renderedWidth: 320,
              renderedHeight: 176,
            },
            qr: {
              src: "/Home-stack/pages-qr.svg",
              complete: true,
              naturalWidth: 128,
              naturalHeight: 128,
              renderedWidth: 96,
              renderedHeight: 96,
            },
            qaPointCount: 3,
          },
          qaTemplateSummary: {
            text: "https://tmluku.github.io/Home-stack/ mobile-qa-evidence mobile-price-condition-proof.png mobile-price-condition-proof.json 螳滓ｩ溘せ繧ｯ繝ｪ繝ｼ繝ｳ繧ｷ繝ｧ繝・ヨ",
            browserE2eHref: browserE2eWorkflowUrl,
          },
          candidateConditionSummary: {
            bannerText: "譚｡莉ｶ縺ゅｊ",
            bannerHref: "#candidate-conditions-demo",
            badges: ["譚｡莉ｶ縺ゅｊ"],
            detailsOpen: true,
            sellerLink: "https://example.com/item",
          },
          conditionSummary: {
            badges: ["譚｡莉ｶ縺ゅｊ"],
            breakdownItems: ["螳溯ｳｪ萓｡譬ｼ"],
            laneItems: ["謗｡逕ｨ萓｡譬ｼ", "謗ｧ髯､", "謌ｻ縺嶺ｾ｡譬ｼ"],
            summaryItems: ["隕九ｋ"],
            recompareText: "譚｡莉ｶ荳肴・遶区凾 蜀肴ｯ碑ｼ・",
            decisionRows: ["謗ｧ髯､縺励↑縺・"],
            detailRows: ["condition detail"],
            detailsOpen: true,
            sellerLink: "https://example.com/item",
          },
          liveScanSummary: {
            bannerText: "譚｡莉ｶ縺ゅｊ",
            bannerHref: "#live-conditions-0",
            badges: ["譚｡莉ｶ縺ゅｊ"],
            detailsOpen: true,
            sellerLink: "https://example.com/live",
          },
          assertions: [
            "document width fits viewport",
            "no mobile horizontal overflow candidates",
            "price-search visual asset renders on mobile",
            "public Pages QR renders on mobile",
            "real-device QA checklist is present on the hero",
            "effective price proof details are visible",
            "condition price quick-read remains visible",
            "condition evidence remains readable on mobile width",
            "condition fallback recompare price is visible",
            "condition decision rows show confirm and reject guidance",
            "static URL scan condition banner jumps to proof details",
          ],
        }),
      },
      (dirPath) => {
        const result = spawnSync(process.execPath, [mobileEvidenceScriptPath, dirPath], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("expected four condition-price quick-read items");
      },
    );
  });

  it("rejects condition proof JSON without condition-banner anchor evidence", async () => {
    await withEvidenceDir(
      {
        "mobile-price-condition-proof.png": minimalPng(390, 1200),
        "mobile-price-condition-proof.json": JSON.stringify({
          url: "http://127.0.0.1:4173/Home-stack/#live-conditions-0",
          expectedPagesUrl: "https://tmluku.github.io/Home-stack/",
          viewport: { width: 390, height: 844 },
          metrics: { bodyWidth: 390, viewportWidth: 390, overflowCount: 0 },
          heroAssetSummary: {
            visual: {
              src: "/Home-stack/price-insight-visual.png",
              complete: true,
              naturalWidth: 1693,
              naturalHeight: 929,
              renderedWidth: 320,
              renderedHeight: 176,
            },
            qr: {
              src: "/Home-stack/pages-qr.svg",
              complete: true,
              naturalWidth: 128,
              naturalHeight: 128,
              renderedWidth: 96,
              renderedHeight: 96,
            },
            qaPointCount: 3,
          },
          qaTemplateSummary: {
            text: "https://tmluku.github.io/Home-stack/ mobile-qa-evidence mobile-price-condition-proof.png mobile-price-condition-proof.json real-device screenshot",
            browserE2eHref: browserE2eWorkflowUrl,
          },
          candidateConditionSummary: {
            bannerText: "condition banner",
            bannerHref: "#candidate-conditions-demo",
            badges: ["condition"],
            detailsOpen: true,
            sellerLink: "https://example.com/item",
          },
          liveScanSummary: {
            bannerText: "condition banner",
            bannerHref: "#live-conditions-0",
            badges: ["condition"],
            detailsOpen: true,
            sellerLink: "https://example.com/live",
          },
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
            "condition memo copy action is visible on mobile",
            "comparison card fallback recompare price is visible",
            "condition decision rows show confirm and reject guidance",
            "static URL scan condition banner jumps to proof details",
            "all condition banners resolve to open proof details",
          ],
        }),
      },
      (dirPath) => {
        const result = spawnSync(process.execPath, [mobileEvidenceScriptPath, dirPath], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("missing condition banner anchor summary");
      },
    );
  });

  it("rejects condition proof JSON when condition-banner anchors lack accessible detail labels", async () => {
    await withEvidenceDir(
      {
        "mobile-price-condition-proof.png": minimalPng(390, 1200),
        "mobile-price-condition-proof.json": JSON.stringify({
          url: "http://127.0.0.1:4173/Home-stack/#live-conditions-0",
          expectedPagesUrl: "https://tmluku.github.io/Home-stack/",
          viewport: { width: 390, height: 844 },
          metrics: { bodyWidth: 390, viewportWidth: 390, overflowCount: 0 },
          heroAssetSummary: {
            visual: {
              src: "/Home-stack/price-insight-visual.png",
              complete: true,
              naturalWidth: 1693,
              naturalHeight: 929,
              renderedWidth: 320,
              renderedHeight: 176,
            },
            qr: {
              src: "/Home-stack/pages-qr.svg",
              complete: true,
              naturalWidth: 128,
              naturalHeight: 128,
              renderedWidth: 96,
              renderedHeight: 96,
            },
            qaPointCount: 3,
          },
          qaTemplateSummary: {
            text: "https://tmluku.github.io/Home-stack/ mobile-qa-evidence mobile-price-condition-proof.png mobile-price-condition-proof.json condition audit grid 実機スクリーンショット",
            browserE2eHref: browserE2eWorkflowUrl,
          },
          candidateConditionSummary: {
            bannerText: "条件あり",
            bannerHref: "#candidate-conditions-demo",
            badges: ["条件あり"],
            detailsOpen: true,
            sellerLink: "https://example.com/item",
          },
          liveScanSummary: {
            bannerText: "条件あり",
            bannerHref: "#live-conditions-0",
            badges: ["条件あり"],
            detailsOpen: true,
            sellerLink: "https://example.com/live",
          },
          conditionAnchorSummary: [
            { text: "条件あり", href: "#candidate-conditions-demo", ariaLabel: "", targetExists: true, targetDetailsOpen: true },
            { text: "条件あり", href: "#live-conditions-0", targetExists: true, targetDetailsOpen: true },
          ],
          assertions: [
            "document width fits viewport",
            "no mobile horizontal overflow candidates",
            "price-search visual asset renders on mobile",
            "price-search visual caption explains condition comparison",
            "public Pages QR renders on mobile",
            "real-device QA checklist is present on the hero",
            "effective price proof details are visible",
            "condition price quick-read remains visible",
            "condition guardrails show verification target and fallback price",
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
          ],
        }),
      },
      (dirPath) => {
        const result = spawnSync(process.execPath, [mobileEvidenceScriptPath, dirPath], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("accessible detail label");
      },
    );
  });
});
