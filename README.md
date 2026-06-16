# Home Stack

Home Stack is a mobile-first MVP for managing household consumables and finding replenishment candidates before items run out.

Published app: https://tmluku.github.io/Home-stack/

Operational docs:

- `docs/mobile-qa.md` records real-device GitHub Pages QA.
- `docs/tooling.md` lists local, Pages, E2E, and cleanup commands.
- `docs/api.md` documents server API contracts for product search, direct price scans, state sync, notifications, and condition audit logs.

The MVP focuses on local validation of the product flow:

- Register demo inventory from a photo upload simulation.
- Add and adjust household inventory manually.
- Estimate days left from stock, usage, household size, children, and pets.
- Compare replenishment offers by effective price, including coupon, point, and shipping conditions.
- Show `条件あり` banners when an effective price depends on specific conditions.
- Let users open the condition details from those banners in both marketplace search cards and product URL scan cards.
- Build an approval-based replenishment queue.
- Show purchase-intent confirmation and cancellation-window status before any simulated reservation.
- Copy a shopping memo from the queue.
- Simulate auto-purchase eligibility without processing payments.
- Export and reset local demo state.

## Current MVP Boundary

Implemented:

- Client-side Next.js app with `localStorage` persistence.
- Demo offers and inventory.
- Product search route for marketplace candidates.
- Product URL price scan route.
- Queue decisions and metrics.
- Household and auto-reservation simulation settings.

Not implemented in the MVP:

- Real payments or purchase confirmation.
- Server-side user accounts or persistence on the static GitHub Pages build.
- Guaranteed retailer stock, delivery date, or final checkout price.

## Getting Started

```powershell
pnpm.cmd install
pnpm.cmd run dev
```

Open:

```text
http://localhost:3000
```

On Windows PowerShell, use `pnpm.cmd` instead of `pnpm` if script execution policy blocks `pnpm.ps1`.

## Verification

```powershell
pnpm.cmd run check
pnpm.cmd run build
pnpm.cmd run build:pages
pnpm.cmd run check:pages
pnpm.cmd run test:e2e
pnpm.cmd run test:e2e:browser
pnpm.cmd run check:mobile-qa-evidence
pnpm.cmd run check:real-device-qa
```

`check` runs:

- TypeScript typecheck
- Biome lint
- Vitest tests

`test:e2e` checks the published GitHub Pages URL and the visual asset used by the price-search UI by default. Override it with `HOME_STACK_PAGES_URL` when validating another deployment.

`test:e2e:browser` builds the static Pages export, serves it locally, and verifies the price-search flow in mobile and desktop Chromium. `check:mobile-qa-evidence` validates the generated screenshot and metrics JSON, including the hero visual, public QR, published Pages URL, Browser E2E workflow link, QA checklist, mobile overflow metrics, candidate condition-banner anchors, condition action note, deduction confirmation checklist, price-verification lanes, and price-condition proof details before those files are used for manual QA. Install the browser once with:

```powershell
pnpm.cmd exec playwright install chromium
```

`check:real-device-qa` is a manual release gate. It intentionally fails until `docs/mobile-qa.md` contains a non-placeholder real-phone `Pass` row with the tested Pages URL, `mobile-qa-evidence` notes, `条件確認メモ`, and a real-phone screenshot note.

Manual smartphone QA for Pages:

- Open `https://tmluku.github.io/Home-stack/` on a real phone.
- Or scan the hero QR code from another device to open the published Pages URL.
- On the hero, use `公開URLをコピー` or `URLを共有` to send the Pages URL to the device/browser used for real-device QA.
- Tap `QA記録をコピー` on the hero and paste the generated row into the real-device matrix in `docs/mobile-qa.md`; the copied memo includes the public URL, Browser E2E workflow URL, `mobile-qa-evidence` artifact name, expected evidence filenames, `条件確認メモ`, and a real-phone screenshot filename placeholder.
- Confirm the price-search visual loads.
- Tap an inventory chip and confirm candidates appear in price order.
- Confirm condition-required cards show `条件価格の要点`, `価格条件の確認先`, `条件確認メモ`, `控除してよい条件`, `価格成立条件の要約`, concrete condition badges such as `購入条件あり` or `クーポン条件あり`, the fallback recompare price when conditions do not apply, the condition decision rows for what to confirm/reject on the seller page, evidence rows, and a link to the seller page without horizontal scrolling.
- Open `価格順リストを見る` and confirm comparison cards show a compact condition summary before the detailed condition rows.
- Paste `https://example.com/demo-condition-item` into `商品ページURL`, tap `ライブ価格を取得`, then confirm the URL-scan `条件あり` banner jumps to the same style of price-condition proof.

Record real-device passes in `docs/mobile-qa.md`.

Remove generated build, preview, log, dependency, and local server-state artifacts with:

```powershell
pnpm.cmd run clean:generated
```

## GitHub Pages

The repository publishes GitHub Pages from the `gh-pages` branch with `.github/workflows/pages-branch.yml`.

- CI builds the normal Next.js app.
- Pages branch publishing runs `pnpm run check`, runs `pnpm run build:pages`, and publishes the static `out/` directory to `gh-pages`.
- Browser E2E runs separately in `.github/workflows/e2e.yml` against the same static Pages export.
- Workflows run on Node 24-compatible action versions.
- The Pages build uses `/Home-stack` as the base path.
- The workflow adds `out/.nojekyll` so GitHub Pages serves the Next.js `_next/` assets.
- Because GitHub Pages is static hosting, product search and URL price scan fall back to local demo candidates, JAN lookup, effective-price proof cards, and external marketplace/search links until a server API is connected.
- `pnpm run check:pages` reports whether `main`, `gh-pages`, the public Pages URL, and optional GitHub API Pages settings look ready.
- If `https://tmluku.github.io/Home-stack/` still returns 404 after `gh-pages` is published, confirm that repository Settings > Pages is enabled. Private repositories may require a paid GitHub plan or a visibility change before Pages can be created.

## Release And Operations Checklist

Use this checklist when changing price extraction, condition labels, static Pages behavior, or visual UI assets.

1. Run local gates:

   ```powershell
   pnpm.cmd run check
   pnpm.cmd run build
   pnpm.cmd run build:pages
   pnpm.cmd run check:pages
   pnpm.cmd run test:e2e
   pnpm.cmd run test:e2e:browser
   pnpm.cmd run check:mobile-qa-evidence
   ```

2. Publish through `main`; `.github/workflows/pages-branch.yml` updates `gh-pages` automatically.
3. Confirm GitHub Actions are green: `CI`, `Browser E2E`, `Publish GitHub Pages Branch`, and `pages-build-deployment`.
4. Download the `mobile-qa-evidence` artifact from the latest `Browser E2E` run and inspect `mobile-price-condition-proof.png` plus `mobile-price-condition-proof.json`; the JSON should include the published Pages URL, Browser E2E workflow link, hero visual/QR metrics, mobile overflow metrics, candidate condition-banner anchors, condition-price quick-read items, condition guardrails, condition action note, deduction confirmation checklist, price-verification lanes, condition summaries, and condition-proof rows.
5. Confirm the public app responds at `https://tmluku.github.io/Home-stack/`.
6. For UI or price-condition changes, complete the real-device checklist in `docs/mobile-qa.md`; use the hero `QA記録をコピー` button to seed the matrix row, then replace the device/browser/result placeholders.
7. Run the manual real-device gate after recording the phone pass:

   ```powershell
   pnpm.cmd run check:real-device-qa
   ```

8. Clean local generated artifacts before committing unrelated follow-up work:

   ```powershell
   pnpm.cmd run clean:generated
   ```

Price-condition operation notes:

- Product candidates must stay sorted by `effectivePriceQuote.effectivePrice` when available, then raw price.
- If points, coupons, free shipping, campaign windows, membership, threshold text, login/app eligibility, first-order pricing, subscription pricing, multipack pricing, or case pricing affect the displayed effective price, the candidate should expose `conditionLabels` and evidence.
- Do not treat ambiguous copy such as "最大", "up to", "eligible only", login-only rewards, app-only coupons, point multipliers, threshold coupons, free-shipping thresholds, first-order discounts, subscription offers, or pack component prices as guaranteed discounts without preserving a condition label.
- Structured, official API, or marketplace HTML reward fields that contain date-like strings such as `valid through 2026-06-20` or `expires 2026-06-20` should become condition evidence, not `2026円` point/coupon deductions.
- Official API reward fields with percentage strings such as `10%` should be treated as reward rates, not `10円` amounts.
- Text price extraction should skip unit prices, tax-excluded prices, reference/list prices, unavailable or sold-out prices, and pack component prices such as `80円 x 12本` when a total price is present.
- Direct URL text extraction should skip coupon-code or promo-code applied prices as the base item price, then expose `クーポン条件あり` so the seller page can confirm code entry, eligibility, and stackability.
- Official API reward amounts that are implausibly large versus the item price, such as points over 35% of price or coupons over 60% of price, should become condition evidence instead of guaranteed deductions.
- Official marketplace API records with machine-readable unavailable states such as `availability: 0`, `inStock: false`, `OutOfStock`, `out_of_stock`, `soldOut`, `unavailable`, preorder, or discontinued should be excluded before price ranking so stale cheap offers do not become the displayed best price.
- Direct URL scans should prefer structured JSON-LD, meta tags, embedded JSON, data attributes, Amazon price spans, then broad page text.
- Direct URL and Amazon-style price scans should ignore unavailable machine states such as `out_of_stock`, `soldout`, preorder, or discontinued before falling back to the next current offer price.
- Direct URL scans and marketplace HTML parsing should skip payment/COD/cash-on-delivery fee amounts as item prices, even when the fee label appears after the amount.
- Amazon-style price scans and marketplace HTML parsing should skip `coupon applied`, `discount after clip`, clipped-coupon, promo, or discount-applied price blocks as the base item price, then preserve coupon-condition evidence for seller-page confirmation.
- Official marketplace API reward records with `coupon applied`, clipped-coupon, promo, or discount-applied copy should keep coupon amounts as conditions instead of guaranteed deductions.

## Optional Marketplace API Keys

The app can search marketplace candidates without credentials by attempting public HTML extraction, but official APIs are preferred when available.

```powershell
$env:RAKUTEN_APPLICATION_ID="..."
$env:YAHOO_SHOPPING_APP_ID="..."
pnpm.cmd run dev
```

## Optional Server State Store

When the app runs as a Next.js server, account sync payloads can be saved through the POST-only state routes:

- `POST /api/account/resolve`
- `POST /api/account/session`
- `POST /api/account/list`
- `POST /api/audit/candidates/append`
- `POST /api/audit/conditions/append`
- `POST /api/audit/conditions/list`
- `POST /api/audit/price-scans/append`
- `POST /api/state/export`
- `POST /api/state/save`
- `POST /api/state/load`
- `POST /api/state/reset`
- `POST /api/state/status`
- `POST /api/notifications/prepare`
- `POST /api/notifications/dispatch`
- `POST /api/notifications/history`
- `POST /api/notifications/status`
- `POST /api/photo-detections`
- `POST /api/photo-detections/status`
- `POST /api/barcode/resolve`
- `POST /api/barcode/status`

By default, saved JSON files are written under `.server-state/`. Set `HOME_STACK_STATE_STORE_DIR` to use another local directory. Set `HOME_STACK_STATE_STORE_KIND=postgres` plus `HOME_STACK_POSTGRES_URL`, `POSTGRES_URL`, or `DATABASE_URL` to store account state, audit events, and notification history in Postgres JSONB tables. GitHub Pages remains static and does not run these API routes.
`POST /api/state/status` reports the active state repository kind, file store directory or Postgres table prefix, write readiness, and normalized account ID without returning database URLs.
Account resolution creates stable account IDs and email hashes for email-link/OAuth handoff without storing raw email addresses in sync payloads.
`POST /api/account/session` resolves production account sessions from trusted upstream auth headers without returning or storing raw email addresses. By default it reads `x-home-stack-user-email`, `x-home-stack-user-sub`, `x-home-stack-auth-provider`, `x-home-stack-display-name`, and `x-home-stack-email-verified`; each header can be overridden with the matching `HOME_STACK_TRUSTED_*_HEADER` environment variable.
Account listing reads the server-side account index that is updated whenever account state is saved or reset.
The Post-MVP panel can call these routes from a Next.js server build to resolve an account profile, save, load, delete, and refresh account state; the GitHub Pages build keeps the controls visible but reports that API persistence is unavailable.
Saved account summaries can be selected from the Post-MVP panel to load that account state directly, including the latest saved timestamp and payload counts.
Set `HOME_STACK_ACCOUNT_AUTH_REQUIRED=true` on a server deployment to require trusted account identity headers on account-scoped APIs. The default account ID header is `x-home-stack-account-id`; override it with `HOME_STACK_TRUSTED_ACCOUNT_HEADER` when an upstream auth proxy or identity provider emits a different header.
Condition audit routes append and list effective-price condition events so ranking decisions can be inspected later, including product-search candidate quotes and direct URL scan quotes.
The Post-MVP panel can save the current condition audit payload and load stored audit events for the active account when the app is running on a Next.js server.
Notification preparation builds queued or blocked jobs, status reports configured providers, dispatch can dry-run provider handoff, and notification history stores prepare/dispatch events per account. With `dryRun: false`, configured LINE jobs call the LINE Messaging API push endpoint, configured email jobs send through SMTP, and configured Web Push jobs send encrypted payloads to a PushSubscription JSON destination.
Set `HOME_STACK_LINE_CHANNEL_ACCESS_TOKEN`, `HOME_STACK_EMAIL_FROM` plus `HOME_STACK_EMAIL_TRANSPORT`, or the Web Push VAPID env values to move a channel from dry-run-only to adapter-ready.
The Post-MVP panel can check provider status, prepare jobs, run a dry-run dispatch, and load notification history when the app is running on a Next.js server.
Barcode resolution validates JAN check digits, suggests corrected candidates, and returns search candidates without needing a production barcode master yet.
Set `HOME_STACK_BARCODE_MASTER_URL` to hand valid JAN codes to an external HTTP master endpoint; otherwise the demo catalog remains the fallback. External master responses can use common product, item, data, items, or results wrappers, and product names are used as the follow-up search query when available.
Photo detection returns demo candidates by default. Set `HOME_STACK_IMAGE_RECOGNITION_URL` and optional `HOME_STACK_IMAGE_RECOGNITION_TOKEN` to send image data to an external recognition endpoint and normalize returned products into inventory candidates.

## Important Data Notes

- Demo state is stored in the browser under `home-stack-state-v7`.
- Photo upload does not send images to a server in the MVP.
- Price candidates are for validation and can differ from live checkout totals.
- Conditional prices must always expose the conditions that make the effective price true.
- Product search candidates include effective-price quotes when shipping, point, coupon, purchase-condition, or campaign-window assumptions are available, including inferred values from marketplace HTML and normalized values from official API results.
- Product URL scans also return effective-price quotes when JSON-LD, meta tags, embedded JSON, data attributes, Amazon spans, or page text expose shipping, point, coupon, purchase-condition, or pack-total signals. The static Pages build shows demo URL-scan proof cards so the condition-detail flow can be QA'd before a server API is connected.
- Post-MVP panels now show price fetch plans, saved condition audit logs, notification drafts, and account/server-save contracts.
