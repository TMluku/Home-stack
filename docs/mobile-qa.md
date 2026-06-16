# Mobile QA Checklist

Use this checklist when validating the published GitHub Pages build on a real smartphone.

Published app: https://tmluku.github.io/Home-stack/

## Automated Coverage

Before manual QA, confirm these gates are green:

- `pnpm.cmd run check`
- `pnpm.cmd run build`
- `pnpm.cmd run build:pages`
- `pnpm.cmd run check:pages`
- `pnpm.cmd run test:e2e`
- `pnpm.cmd run test:e2e:browser`
- `pnpm.cmd run check:mobile-qa-evidence`
- GitHub Actions: `CI`, `Browser E2E`, `Publish GitHub Pages Branch`, and `pages build and deployment`

`test:e2e:browser` covers the price-search flow in mobile and desktop Chromium, including:

- price-search image renders
- inventory chip opens ranked candidates
- effective-price proof cards render
- condition-required cards expose evidence and seller-page links
- static URL-scan demo cards expose condition banners that jump to proof details
- no horizontal overflow at mobile width

The `Browser E2E` GitHub Actions workflow uploads a `mobile-qa-evidence` artifact for each run. It includes:

- `mobile-price-condition-proof.png`: full-page mobile Chromium screenshot
- `mobile-price-condition-proof.json`: captured URL, expected published Pages URL, Browser E2E workflow link, viewport, overflow metrics, hero visual/QR metrics, QA checklist count, condition badges, condition quick-read rows, condition adoption risk strip, condition guardrails, condition action note, deduction confirmation checklist, condition audit grid, condition memo copy action, condition-banner anchor resolution, accessible condition-banner detail labels, condition-summary rows, price-breakdown rows, price-verification lanes, condition fallback recompare price, comparison-card fallback recompare price, seller link, and the assertions covered by the automated pass
- Playwright report files, when generated

Use that artifact as automated display evidence before running the real-device checklist below.

Run `pnpm.cmd run check:mobile-qa-evidence` after `pnpm.cmd run test:e2e:browser` to confirm the screenshot and metrics JSON exist, the captured URL is tied to the expected published Pages URL or local static preview, the Browser E2E workflow link is present, the mobile viewport has no horizontal overflow, the hero visual and public QR loaded, the real-device QA checklist is present, the condition quick-read rows, condition adoption risk strip, condition guardrails, condition action note, deduction confirmation checklist, condition audit grid, condition memo copy action, price-verification lanes, condition summary, accessible condition detail links, fallback recompare price, comparison-card fallback recompare price, decision rows, and detail rows are open, and the seller/search link is present.

Automated evidence is not a substitute for the real-device rows below. Treat the objective as incomplete until at least one physical phone/browser pass is recorded with the published URL.

After a physical phone pass is recorded, run `pnpm.cmd run check:real-device-qa`. It fails while the matrix only contains placeholder rows, and passes when at least one non-placeholder `Pass` row includes the tested Pages URL, `mobile-qa-evidence` notes, `condition audit grid`, and a real-phone screenshot note.

## Real Device Matrix

Record each real-device pass here.

| Date | Device | Browser | Network | Result | Notes |
|---|---|---|---|---|---|
| YYYY-MM-DD | iPhone / Android model | Safari / Chrome | Wi-Fi / 5G | Pass / Fail | Tested URL: https://tmluku.github.io/Home-stack/ / Browser E2E: https://github.com/TMluku/Home-stack/actions/workflows/e2e.yml / mobile-qa-evidence / mobile-price-condition-proof.png / mobile-price-condition-proof.json / 条件確認メモ / condition audit grid / 実機スクリーンショット: phone-price-proof.png |

The published app hero includes `QA記録をコピー`. Use it on the tested phone to copy a matrix row, paste it here, then replace the device, browser, network, result, and evidence placeholders with the real values. The copied memo includes the published URL, the Browser E2E workflow URL, the `mobile-qa-evidence` artifact name, the expected `mobile-price-condition-proof.png` / `mobile-price-condition-proof.json` evidence filenames, `条件確認メモ`, `condition audit grid`, and a real-phone screenshot filename placeholder. You may replace the Browser E2E workflow URL with the concrete `https://github.com/TMluku/Home-stack/actions/runs/...` run URL used for the artifact. Replace the screenshot placeholder with a phone screenshot note such as `実機スクリーンショット: phone-price-proof.png`; automated evidence alone does not satisfy the release gate.

Current status: automated mobile Chromium coverage is available from GitHub Actions, but no physical phone pass is recorded in this file yet.

## Manual Steps

1. Open https://tmluku.github.io/Home-stack/ on the phone.
2. Confirm the first screen loads without horizontal scrolling.
3. If opening from a desktop screen, scan the hero QR code and confirm it opens the same published Pages URL on the phone.
4. Tap `公開URLをコピー` and confirm the success message appears.
5. Tap `URLを共有` and confirm the native share sheet opens, or that the app falls back to copying the URL.
6. Tap `QA記録をコピー`, paste the row into the matrix above, and replace placeholder values after the test.
7. Scroll to `Price Search Lab`.
8. Confirm the price-search visual image loads.
9. Tap the first inventory chip.
10. Confirm candidate cards appear in ascending effective-price order.
11. Confirm the first conditional candidate shows the price-condition details summary.
12. Open the condition details and confirm the short condition summary, `条件価格の採用判定` bar, condition action note, `控除してよい条件` checklist, `条件成立チェック` / condition audit grid, fallback recompare price, decision rows, and evidence rows are readable, with condition labels such as `購入条件あり`, `送料条件あり`, `ポイント条件あり`, or `クーポン条件あり` visible when they apply.
13. Tap the seller-page condition link and confirm it opens a seller/search page in a new tab.
14. Paste `https://example.com/demo-condition-item` into `商品ページURL`.
15. Tap `ライブ価格を取得`.
16. Confirm the URL-scan result shows a `条件あり` banner, that the link clearly opens condition details, and that tapping it jumps to the proof details for the same result.
17. Return to Home Stack and confirm the page still scrolls normally.
18. Rotate the phone once, if practical, and confirm no major overlap or horizontal scrolling.

## Evidence To Attach

For a pass, keep enough evidence to reconstruct what was checked:

- GitHub Actions run URL for `Browser E2E`
- `mobile-qa-evidence` artifact name
- `mobile-price-condition-proof.png` screenshot filename
- `mobile-price-condition-proof.json` metrics filename
- phone screenshot showing the price-condition proof
- phone screenshot showing the URL-scan condition proof, when URL scan was changed
- published URL tested
- any browser/device accessibility setting that changes layout, such as text scaling

## Failure Notes

When a device fails, capture:

- device and browser version
- screenshot
- failing step number
- whether the issue reproduces after reload
- whether the issue reproduces on Wi-Fi and mobile data
