import { readFile } from "node:fs/promises";

const qaFile = process.argv[2] ?? "docs/mobile-qa.md";
const expectedBrowserE2eWorkflowUrl = "https://github.com/TMluku/Home-stack/actions/workflows/e2e.yml";
const browserE2eRunUrlPattern = /https:\/\/github\.com\/TMluku\/Home-stack\/actions\/runs\/\d+/;
const markdown = await readFile(qaFile, "utf8");
const rows = markdown
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("|") && line.endsWith("|"))
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );

const qaRows = rows.filter((cells) => cells.length === 6 && /^\d{4}-\d{2}-\d{2}$/.test(cells[0]));
const passes = qaRows.filter(([date, device, browser, network, result, notes]) => {
  const hasPlaceholders = [device, browser, network, result, notes].some((cell) =>
    /端末名|ブラウザ名|Wi-Fi \/ 5G|Pass \/ Fail|placeholder|記入|YYYY/i.test(cell),
  );
  const hasPass = /^pass$/i.test(result);
  const hasPublishedUrl = /https:\/\/tmluku\.github\.io\/Home-stack\//.test(notes);
  const hasBrowserE2eEvidenceUrl = notes.includes(expectedBrowserE2eWorkflowUrl) || browserE2eRunUrlPattern.test(notes);
  const hasAutomatedEvidence = /mobile-qa-evidence|mobile-price-condition-proof/i.test(notes);
  const hasEvidenceFiles = /mobile-price-condition-proof\.png/i.test(notes) && /mobile-price-condition-proof\.json/i.test(notes);
  const hasRealDeviceScreenshot =
    /(?:phone|real[- ]?device|実機|スマホ|端末).{0,40}(?:screenshot|screen shot|スクリーンショット|画面)|(?:screenshot|screen shot|スクリーンショット|画面).{0,40}(?:phone|real[- ]?device|実機|スマホ|端末)/i.test(
      notes,
    );
  return (
    Boolean(date) &&
    !hasPlaceholders &&
    hasPass &&
    hasPublishedUrl &&
    hasBrowserE2eEvidenceUrl &&
    hasAutomatedEvidence &&
    hasEvidenceFiles &&
    hasRealDeviceScreenshot
  );
});

if (passes.length === 0) {
  console.error(
    [
      `FAIL ${qaFile}: no real-device GitHub Pages QA pass is recorded.`,
      "Add a non-placeholder matrix row with Result `Pass`, the tested published URL, Browser E2E workflow or run URL, `mobile-qa-evidence` notes, mobile evidence filenames, and a real-phone screenshot note.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`PASS ${qaFile}: ${passes.length} real-device GitHub Pages QA pass row(s) recorded.`);
