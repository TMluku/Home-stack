const targetUrl = process.env.HOME_STACK_PAGES_URL ?? "https://tmluku.github.io/Home-stack/";

const response = await fetch(targetUrl, { redirect: "follow" });
const html = await response.text();
const assetUrl = new URL("price-insight-visual.png", response.url);
const assetResponse = await fetch(assetUrl, { redirect: "follow" });
const assetContentType = assetResponse.headers.get("content-type") ?? "";
const assetBuffer = assetResponse.ok ? Buffer.from(await assetResponse.arrayBuffer()) : Buffer.alloc(0);
const assetDimensions = readPngDimensions(assetBuffer);
const qrUrl = new URL("pages-qr.svg", response.url);
const qrResponse = await fetch(qrUrl, { redirect: "follow" });
const qrContentType = qrResponse.headers.get("content-type") ?? "";
const qrSvg = qrResponse.ok ? await qrResponse.text() : "";

const checks = [
  ["responds with a 2xx status", response.ok],
  ["renders the Home Stack document", html.includes("Home Stack")],
  ["serves the static Next.js app shell", html.includes("_next/static")],
  ["uses the project Pages base path", html.includes("/Home-stack/_next/")],
  ["references the price insight visual", html.includes("price-insight-visual.png")],
  ["serves the price insight visual image", assetResponse.ok && assetContentType.includes("image/")],
  ["serves the expected price insight visual dimensions", assetDimensions?.width === 1693 && assetDimensions?.height === 929],
  ["references the public Pages QR", html.includes("pages-qr.svg")],
  ["serves the public Pages QR SVG", qrResponse.ok && qrContentType.includes("image/")],
  ["serves a structured public Pages QR SVG", qrSvg.includes("<svg") && qrSvg.includes('id="qr-path"')],
  ["serves the expected public Pages QR dimensions", qrSvg.includes('width="33mm"') && qrSvg.includes('height="33mm"')],
  [
    "renders the real-device QA evidence instructions",
    html.includes("mobile-qa-evidence") && html.includes("mobile-price-condition-proof.json"),
  ],
  ["renders the condition audit grid QA cue", html.includes("condition audit grid")],
];

const failures = checks.filter(([, passed]) => !passed);

for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failures.length > 0) {
  console.error(`GitHub Pages smoke test failed for ${targetUrl}`);
  process.exit(1);
}

console.log(`GitHub Pages smoke test passed for ${targetUrl}`);

function readPngDimensions(buffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
