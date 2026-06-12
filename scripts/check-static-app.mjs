import { readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "sw.js",
  "icon.svg",
  "docs/requirements.md",
  "docs/api.md",
  "api/local-rest-api.js",
  "core/replenishment.js",
  "data/demo-state.js",
  "data/offers.js",
  "server/api-server.mjs",
  "tests/api-server.test.mjs",
  "tests/local-rest-api.test.mjs",
  "tests/demo-state.test.mjs",
  "tests/replenishment.test.mjs",
];
const requiredSnippets = [
  ["index.html", "収納写真アップロード"],
  ["index.html", "アフィリエイト"],
  ["index.html", "手動で在庫を追加"],
  ["index.html", "Validation Metrics"],
  ["index.html", "Replenishment Queue"],
  ["index.html", "Auto Purchase Roadmap"],
  ["index.html", "Privacy & Ops"],
  ["index.html", "metric-revenue"],
  ["app.js", "serviceWorker"],
  ["app.js", "localStorage"],
  ["data/demo-state.js", "queueDecisions"],
  ["data/demo-state.js", "estimatedRevenue"],
  ["app.js", "autopilot"],
  ["core/replenishment.js", "canAutoReserve"],
  ["docs/requirements.md", "将来の自動購入"],
  ["docs/requirements.md", "広告商品への勝手なブランド変更は禁止"],
  ["docs/requirements.md", "Notion"],
  ["api/local-rest-api.js", "createLocalRestApi"],
  ["api/local-rest-api.js", "PATCH"],
  ["docs/api.md", "REST API 設計"],
  ["docs/api.md", "/inventory/:id"],
  ["package.json", "\"test\""],
  ["tests/local-rest-api.test.mjs", "POST /inventory"],
  ["docs/api.md", "テスト方針"],
  ["core/replenishment.js", "buildReplenishmentQueue"],
  ["tests/replenishment.test.mjs", "calculateDaysLeft"],
  ["docs/requirements.md", "pure domain modules"],
  ["data/demo-state.js", "createDefaultState"],
  ["data/offers.js", "baseOffers"],
  ["tests/demo-state.test.mjs", "normalizeState"],
  ["docs/requirements.md", "Demo data modules"],
  ["server/api-server.mjs", "createHomeStackServer"],
  ["server/api-server.mjs", "/api"],
  ["tests/api-server.test.mjs", "GET /api/inventory"],
  ["docs/api.md", "実行方法"],
  ["docs/requirements.md", "HTTP API server"],
  ["manifest.webmanifest", "standalone"],
  ["sw.js", "CACHE_NAME"],
];

for (const file of requiredFiles) {
  await readFile(file, "utf8");
}

for (const [file, snippet] of requiredSnippets) {
  const content = await readFile(file, "utf8");
  if (!content.includes(snippet)) {
    throw new Error(`${file} is missing required snippet: ${snippet}`);
  }
}

JSON.parse(await readFile("manifest.webmanifest", "utf8"));
console.log("Static app checks passed.");
