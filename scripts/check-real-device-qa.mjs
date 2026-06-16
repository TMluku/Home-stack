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
const evaluations = qaRows.map(([date, device, browser, network, result, notes]) => {
  const issues = [];
  const hasPlaceholders = [device, browser, network, result, notes].some((cell) =>
    /端末名|ブラウザ名|Wi-Fi \/ 5G|Pass \/ Fail|placeholder|記入|YYYY/i.test(cell),
  );
  const hasPass = /^pass$/i.test(result);
  const hasPublishedUrl = /https:\/\/tmluku\.github\.io\/Home-stack\//.test(notes);
  const hasBrowserE2eEvidenceUrl = notes.includes(expectedBrowserE2eWorkflowUrl) || browserE2eRunUrlPattern.test(notes);
  const hasAutomatedEvidence = /mobile-qa-evidence|mobile-price-condition-proof/i.test(notes);
  const hasEvidenceFiles = /mobile-price-condition-proof\.png/i.test(notes) && /mobile-price-condition-proof\.json/i.test(notes);
  const hasConditionAuditGrid = /条件成立チェック|condition audit grid/i.test(notes);
  const hasConditionActionNote = /条件確認メモ|condition action note/i.test(notes);
  const hasConditionImpactRows = /条件別の戻し額|condition impact|per-condition fallback/i.test(notes);
  const hasRealDeviceScreenshot =
    /(?:phone|real[- ]?device|実機|スマホ|端末).{0,40}(?:screenshot|screen shot|スクリーンショット|画面)|(?:screenshot|screen shot|スクリーンショット|画面).{0,40}(?:phone|real[- ]?device|実機|スマホ|端末)/i.test(
      notes,
    );
  if (!date) issues.push("dated QA row");
  if (hasPlaceholders) issues.push("replace placeholder device/browser/network/result/notes");
  if (!hasPass) issues.push("Result `Pass`");
  if (!hasPublishedUrl) issues.push("tested published Pages URL");
  if (!hasBrowserE2eEvidenceUrl) issues.push("Browser E2E workflow or run URL");
  if (!hasAutomatedEvidence) issues.push("mobile-qa-evidence note");
  if (!hasEvidenceFiles) issues.push("mobile-price-condition-proof.png and mobile-price-condition-proof.json");
  if (!hasConditionAuditGrid) issues.push("condition audit grid");
  if (!hasConditionActionNote) issues.push("譚｡莉ｶ遒ｺ隱阪Γ繝｢ / condition action note");
  if (!hasConditionImpactRows) issues.push("条件別の戻し額 / condition impact rows");
  if (!hasRealDeviceScreenshot) issues.push("real-phone screenshot note");

  return { cells: [date, device, browser, network, result, notes], issues };
});
const passes = evaluations.filter(({ issues }) => issues.length === 0);

if (passes.length === 0) {
  const rowDiagnostics = evaluations
    .slice(-5)
    .map(({ cells, issues }) => {
      const [date, device, browser, network, result] = cells;
      return `- ${date} ${device} ${browser} ${network} ${result}: missing ${issues.join("; ")}`;
    })
    .join("\n");
  console.error(
    [
      `FAIL ${qaFile}: no real-device GitHub Pages QA pass is recorded.`,
      "Add a non-placeholder matrix row with Result `Pass`, the tested published URL, Browser E2E workflow or run URL, `mobile-qa-evidence` notes, mobile evidence filenames, `条件確認メモ`, and a real-phone screenshot note.",
      "The row notes must also mention `condition audit grid` and `条件別の戻し額` after checking the condition成立 audit grid and per-condition fallback rows on the phone.",
      rowDiagnostics ? `Checked dated rows:\n${rowDiagnostics}` : "No dated QA rows were found in the matrix.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`PASS ${qaFile}: ${passes.length} real-device GitHub Pages QA pass row(s) recorded.`);
