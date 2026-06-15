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
- `POST /api/state/export`
- `POST /api/state/save`
- `POST /api/state/load`
- `POST /api/state/reset`
- `POST /api/notifications/prepare`
- `POST /api/barcode/resolve`

By default, saved JSON files are written under `.server-state/`. Set `HOME_STACK_STATE_STORE_DIR` to use another local directory. GitHub Pages remains static and does not run these API routes.
Account resolution creates stable account IDs and email hashes for email-link/OAuth handoff without storing raw email addresses in sync payloads.
Notification preparation builds queued or blocked jobs, but it does not send real LINE, email, or Web Push messages yet.
Barcode resolution validates JAN check digits, suggests corrected candidates, and returns search candidates without needing a production barcode master yet.

## Important Data Notes

- Demo state is stored in the browser under `home-stack-state-v7`.
- Photo upload does not send images to a server in the MVP.
- Price candidates are for validation and can differ from live checkout totals.
- Conditional prices must always expose the conditions that make the effective price true.
- Post-MVP panels now show price fetch plans, condition audit logs, notification drafts, and account/server-save contracts.
