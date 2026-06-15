const targetUrl = process.env.HOME_STACK_PAGES_URL ?? "https://tmluku.github.io/Home-stack/";

const response = await fetch(targetUrl, { redirect: "follow" });
const html = await response.text();

const checks = [
  ["responds with a 2xx status", response.ok],
  ["renders the Home Stack document", html.includes("Home Stack")],
  ["serves the static Next.js app shell", html.includes("_next/static")],
  ["uses the project Pages base path", html.includes("/Home-stack/_next/")],
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
