# Home Stack

Home Stack is a mobile-first MVP for managing household consumables and finding replenishment candidates before items run out.

The MVP focuses on local validation of the product flow:

- Register demo inventory from a photo upload simulation.
- Add and adjust household inventory manually.
- Estimate days left from stock, usage, household size, children, and pets.
- Compare replenishment offers by effective price, including coupon, point, and shipping conditions.
- Show `条件あり` banners when an effective price depends on specific conditions.
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
- Server-side user accounts or persistence.
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
```

`check` runs:

- TypeScript typecheck
- Biome lint
- Vitest tests

Remove generated build, preview, log, dependency, and local server-state artifacts with:

```powershell
pnpm.cmd run clean:generated
```

## GitHub Pages

The repository includes a GitHub Pages deployment workflow at `.github/workflows/pages.yml`.

- CI builds the normal Next.js app.
- Pages runs `pnpm run check`, builds with `NEXT_OUTPUT_EXPORT=true`, and publishes the static `out/` directory.
- The Pages build uses `/Home-stack` as the base path.
- The workflow adds `out/.nojekyll` so GitHub Pages serves the Next.js `_next/` assets.
- Because GitHub Pages is static hosting, product search and URL price scan fall back to local demo candidates, JAN lookup, and external marketplace search links until a server API is connected.

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
Account listing reads the server-side account index that is updated whenever account state is saved or reset.
The Post-MVP panel can call these routes from a Next.js server build to resolve an account profile, save, load, delete, and refresh account state; the GitHub Pages build keeps the controls visible but reports that API persistence is unavailable.
Saved account summaries can be selected from the Post-MVP panel to load that account state directly, including the latest saved timestamp and payload counts.
Set `HOME_STACK_ACCOUNT_AUTH_REQUIRED=true` on a server deployment to require the trusted account header on account-scoped APIs. The default trusted header is `x-home-stack-account-id`; override it with `HOME_STACK_TRUSTED_ACCOUNT_HEADER` when an upstream auth proxy or identity provider emits a different header.
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
- Product search candidates include effective-price quotes when shipping, point, coupon, or campaign window assumptions are available, including inferred values from marketplace HTML and normalized values from official API results.
- Product URL scans also return effective-price quotes when JSON-LD, meta tags, embedded JSON, data attributes, or page text expose shipping, point, or coupon signals.
- Post-MVP panels now show price fetch plans, saved condition audit logs, notification drafts, and account/server-save contracts.
