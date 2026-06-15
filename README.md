# Home Stack

Home Stack is a mobile-first MVP for managing household consumables and finding replenishment candidates before items run out.

The MVP focuses on local validation of the product flow:

- Register demo inventory from a photo upload simulation.
- Add and adjust household inventory manually.
- Estimate days left from stock, usage, household size, children, and pets.
- Compare replenishment offers by effective price, including coupon, point, and shipping conditions.
- Show `条件あり` banners when an effective price depends on specific conditions.
- Build an approval-based replenishment queue.
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
- Real LINE, email, or Web Push delivery.
- Server-side user accounts or persistence.
- Production image recognition.
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

## GitHub Pages

The repository includes a GitHub Pages deployment workflow at `.github/workflows/pages.yml`.

- CI builds the normal Next.js app.
- Pages builds with `NEXT_OUTPUT_EXPORT=true` and publishes the static `out/` directory.
- The Pages build uses `/Home-stack` as the base path.
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
- `POST /api/notifications/status`
- `POST /api/barcode/resolve`
- `POST /api/barcode/status`

By default, saved JSON files are written under `.server-state/`. Set `HOME_STACK_STATE_STORE_DIR` to use another local directory. GitHub Pages remains static and does not run these API routes.
`POST /api/state/status` reports the active state repository kind, configured store directory, write readiness, and normalized account ID.
Account resolution creates stable account IDs and email hashes for email-link/OAuth handoff without storing raw email addresses in sync payloads.
Account listing reads the server-side account index that is updated whenever account state is saved or reset.
The Post-MVP panel can call these routes from a Next.js server build to save, load, delete, and refresh account state; the GitHub Pages build keeps the controls visible but reports that API persistence is unavailable.
Condition audit routes append and list effective-price condition events so ranking decisions can be inspected later, including product-search candidate quotes and direct URL scan quotes.
Notification preparation builds queued or blocked jobs, status reports configured providers, and dispatch can dry-run provider handoff or mark adapter-ready providers as sent without calling external services yet.
Set `HOME_STACK_LINE_CHANNEL_ACCESS_TOKEN`, `HOME_STACK_EMAIL_FROM` plus `HOME_STACK_EMAIL_TRANSPORT`, or the Web Push VAPID env values to move a channel from dry-run-only to adapter-ready.
The Post-MVP panel can check provider status, prepare jobs, and run a dry-run dispatch when the app is running on a Next.js server.
Barcode resolution validates JAN check digits, suggests corrected candidates, and returns search candidates without needing a production barcode master yet.
Set `HOME_STACK_BARCODE_MASTER_URL` to hand valid JAN codes to an external HTTP master endpoint; otherwise the demo catalog remains the fallback.

## Important Data Notes

- Demo state is stored in the browser under `home-stack-state-v7`.
- Photo upload does not send images to a server in the MVP.
- Price candidates are for validation and can differ from live checkout totals.
- Conditional prices must always expose the conditions that make the effective price true.
- Product search candidates include effective-price quotes when shipping, point, or coupon assumptions are available, including inferred values from marketplace HTML/API results.
- Product URL scans also return effective-price quotes when JSON-LD, meta tags, or page text expose shipping, point, or coupon signals.
- Post-MVP panels now show price fetch plans, condition audit logs, notification drafts, and account/server-save contracts.
