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
- GitHub Actions: `CI`, `Browser E2E`, `Publish GitHub Pages Branch`, and `pages build and deployment`

`test:e2e:browser` covers the price-search flow in mobile and desktop Chromium, including:

- price-search image renders
- inventory chip opens ranked candidates
- effective-price proof cards render
- condition-required cards expose evidence and seller-page links
- no horizontal overflow at mobile width

The `Browser E2E` GitHub Actions workflow uploads a `mobile-qa-evidence` artifact for each run. It includes:

- `mobile-price-condition-proof.png`: full-page mobile Chromium screenshot
- `mobile-price-condition-proof.json`: captured URL, viewport, overflow metrics, condition badges, price-breakdown rows, seller link, and the assertions covered by the automated pass
- Playwright report files, when generated

Use that artifact as automated display evidence before running the real-device checklist below.

Automated evidence is not a substitute for the real-device rows below. Treat the objective as incomplete until at least one physical phone/browser pass is recorded with the published URL.

## Real Device Matrix

Record each real-device pass here.

| Date | Device | Browser | Network | Result | Notes |
|---|---|---|---|---|---|
| YYYY-MM-DD | iPhone / Android model | Safari / Chrome | Wi-Fi / 5G | Pass / Fail |  |

Current status: automated mobile Chromium coverage is available from GitHub Actions, but no physical phone pass is recorded in this file yet.

## Manual Steps

1. Open https://tmluku.github.io/Home-stack/ on the phone.
2. Confirm the first screen loads without horizontal scrolling.
3. If opening from a desktop screen, scan the hero QR code and confirm it opens the same published Pages URL on the phone.
4. Tap `公開URLをコピー` and confirm the success message appears.
5. Tap `URLを共有` and confirm the native share sheet opens, or that the app falls back to copying the URL.
6. Scroll to `Price Search Lab`.
7. Confirm the price-search visual image loads.
8. Tap the first inventory chip.
9. Confirm candidate cards appear in ascending effective-price order.
10. Confirm the first conditional candidate shows the price-condition details summary.
11. Open the condition details and confirm evidence rows are readable, with condition labels such as `購入条件あり`, `送料条件あり`, `ポイント条件あり`, or `クーポン条件あり` visible when they apply.
12. Tap the seller-page condition link and confirm it opens a seller/search page in a new tab.
13. Return to Home Stack and confirm the page still scrolls normally.
14. Rotate the phone once, if practical, and confirm no major overlap or horizontal scrolling.

## Evidence To Attach

For a pass, keep enough evidence to reconstruct what was checked:

- GitHub Actions run URL for `Browser E2E`
- `mobile-qa-evidence` artifact name
- `mobile-price-condition-proof.png` screenshot filename
- `mobile-price-condition-proof.json` metrics filename
- phone screenshot showing the price-condition proof
- published URL tested
- any browser/device accessibility setting that changes layout, such as text scaling

## Failure Notes

When a device fails, capture:

- device and browser version
- screenshot
- failing step number
- whether the issue reproduces after reload
- whether the issue reproduces on Wi-Fi and mobile data
