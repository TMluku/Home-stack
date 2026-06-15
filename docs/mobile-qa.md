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

The `Browser E2E` GitHub Actions workflow uploads a `mobile-qa-evidence` artifact for each run. It includes the mobile Chromium screenshot `mobile-price-condition-proof.png` when the responsive price-condition proof completes, plus any Playwright report files. Use that artifact as automated display evidence before running the real-device checklist below.

## Real Device Matrix

Record each real-device pass here.

| Date | Device | Browser | Network | Result | Notes |
|---|---|---|---|---|---|
| YYYY-MM-DD | iPhone / Android model | Safari / Chrome | Wi-Fi / 5G | Pass / Fail |  |

## Manual Steps

1. Open https://tmluku.github.io/Home-stack/ on the phone.
2. Confirm the first screen loads without horizontal scrolling.
3. Tap `公開URLをコピー` and confirm the success message appears.
4. Tap `URLを共有` and confirm the native share sheet opens, or that the app falls back to copying the URL.
5. Scroll to `Price Search Lab`.
6. Confirm the price-search visual image loads.
7. Tap the first inventory chip.
8. Confirm candidate cards appear in ascending effective-price order.
9. Confirm the first conditional candidate shows the price-condition details summary.
10. Open the condition details and confirm evidence rows are readable.
11. Tap the seller-page condition link and confirm it opens a seller/search page in a new tab.
12. Return to Home Stack and confirm the page still scrolls normally.
13. Rotate the phone once, if practical, and confirm no major overlap or horizontal scrolling.

## Failure Notes

When a device fails, capture:

- device and browser version
- screenshot
- failing step number
- whether the issue reproduces after reload
- whether the issue reproduces on Wi-Fi and mobile data
