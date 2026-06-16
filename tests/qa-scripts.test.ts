import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts", "check-real-device-qa.mjs");

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

  it("accepts a real-device pass with published URL, automated evidence, and phone screenshot note", async () => {
    await withQaFile(
      [
        "| Date | Device | Browser | Network | Result | Notes |",
        "|---|---|---|---|---|---|",
        "| 2026-06-16 | Pixel 8 | Chrome | 5G | Pass | https://tmluku.github.io/Home-stack/ / mobile-qa-evidence / 実機スクリーンショット: phone-price-proof.png |",
      ].join("\n"),
      (filePath) => {
        const result = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("PASS");
      },
    );
  });
});
