import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts", "check-real-device-qa.mjs");
const browserE2eWorkflowUrl = "https://github.com/TMluku/Home-stack/actions/workflows/e2e.yml";

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
        `| 2026-06-16 | Pixel 8 | Chrome | 5G | Pass | https://tmluku.github.io/Home-stack/ / Browser E2E: ${browserE2eWorkflowUrl} / mobile-qa-evidence / mobile-price-condition-proof.png / mobile-price-condition-proof.json / 実機スクリーンショット: phone-price-proof.png |`,
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
        "| 2026-06-16 | iPhone 15 | Safari | Wi-Fi | Pass | https://tmluku.github.io/Home-stack/ / Browser E2E: https://github.com/TMluku/Home-stack/actions/runs/27592318017 / mobile-qa-evidence / mobile-price-condition-proof.png / mobile-price-condition-proof.json / real-device screenshot: iphone-price-proof.png |",
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
});
