# Home Stack API Plan

The current MVP is a client-side Next.js + TypeScript application. State is stored in `localStorage` so the product flow can be validated without a backend service.

The next backend milestone is to introduce real API routes under `/api` while preserving the same resource model used by the UI: inventory, household rules, effective-price offers, condition details, replenishment queue decisions, and metrics.

## Response Shape

Future API handlers should return a consistent envelope:

```json
{
  "ok": true,
  "status": 200,
  "data": {},
  "error": null
}
```

Errors should return `ok: false`, an HTTP-aligned `status`, and `error.message` plus optional `error.details`.

Current MVP routes still return a lightweight shape so the client can stay simple:

```json
{
  "ok": true,
  "results": []
}
```

## Current API Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/account/resolve` | Resolve demo, email-link, or OAuth-style account metadata without storing raw email addresses. |
| `POST` | `/api/account/list` | List saved account summaries from the configured server state store. |
| `POST` | `/api/audit/candidates/append` | Convert product search candidates with effective-price quotes into stored condition-price audit events. |
| `POST` | `/api/audit/conditions/append` | Append condition-price audit events from a sync payload or explicit event list. |
| `POST` | `/api/audit/conditions/list` | List stored condition-price audit events for an account. |
| `POST` | `/api/audit/price-scans/append` | Convert direct product URL scan results with effective-price quotes into stored condition-price audit events. |
| `POST` | `/api/barcode/resolve` | Normalize JAN/barcode input, validate check digits, suggest correction candidates, and return static search candidates. |
| `POST` | `/api/barcode/status` | Report whether barcode lookup uses the demo catalog or an external JAN master endpoint. |
| `POST` | `/api/product-search` | Search marketplace sources for a product query and return normalized price candidates. Uses official API credentials when configured, otherwise tries public search-result HTML extraction. |
| `POST` | `/api/price-scan` | Fetch specific product page URLs and extract price candidates plus effective-price quotes from JSON-LD, meta tags, embedded JSON, data attributes, or HTML text. |
| `POST` | `/api/state/export` | Build a server-sync payload from demo or posted account state, including condition audit logs and notification drafts. |
| `POST` | `/api/state/save` | Save a server-sync payload for an account in the configured server state store. |
| `POST` | `/api/state/load` | Load saved account state from the configured server state store. |
| `POST` | `/api/state/reset` | Delete saved account state from the configured server state store. |
| `POST` | `/api/state/status` | Report the configured server state repository kind, normalized account ID, and write readiness. |
| `POST` | `/api/notifications/prepare` | Convert notification drafts into queued or blocked delivery jobs without sending real notifications. |
| `POST` | `/api/notifications/dispatch` | Dry-run notification delivery through the adapter boundary and report skipped/failed jobs without sending real messages. |
| `POST` | `/api/notifications/history` | List stored notification prepare and dispatch events for an account. |
| `POST` | `/api/notifications/status` | Report LINE, email, and Web Push provider readiness from environment configuration. |

### `POST /api/product-search`

Request:

```json
{
  "query": "猫砂 5L"
}
```

Response includes the normalized query, searched sources, candidate titles, prices, effective-price quotes, links, match scores, source labels, and evidence notes. HTML fallback and official API candidates normalize known shipping, point, and coupon signals into `effectivePriceQuote` when those values are present. Optional environment variables:

- `RAKUTEN_APPLICATION_ID`
- `YAHOO_SHOPPING_APP_ID`

Without credentials, the route still attempts public search-page extraction, but results can be blocked or change when marketplace HTML changes.

### `POST /api/barcode/resolve`

Request:

```json
{
  "barcode": "4900000000016"
}
```

Response includes normalized digits, JAN-13/JAN-8 validation, correction candidates, the matched product when available, and barcode master provider metadata. Optional environment variable:

- `HOME_STACK_BARCODE_MASTER_URL`

When configured, the server calls the endpoint with both `?janCode=` and `barcode=` and accepts product-shaped JSON, `{ "product": { ... } }`, `{ "item": { ... } }`, array roots, `{ "items": [{ ... }] }`, `{ "results": [{ ... }] }`, or nested `{ "data": ... }` variants. Without it, the route uses the demo JAN catalog and keeps returning static search candidates. If a master product name is available, the response uses that name as the product-search query before falling back to the JAN code.

### `POST /api/price-scan`

Request:

```json
{
  "urls": ["https://example.com/product"]
}
```

Response includes per-URL extraction status, price, effective-price quote, title, source type, and fetch timestamp. JSON-LD, meta tags, embedded app-state JSON, data attributes, and HTML text around the detected price are inspected for shipping, point, and coupon signals when present, with evidence strings preserved on the effective-price quote.

## Offer Resource Direction

The UI no longer treats offers as `lowest` versus `sponsored`. Backend offer data should instead model price ranking directly:

```json
{
  "id": "cat-litter-petplus-coupon",
  "title": "固まる猫砂 5L x 4袋",
  "retailer": "PetPlus公式",
  "listPrice": 2480,
  "effectivePrice": 2260,
  "unitPrice": "565円 / 袋",
  "shipping": "送料無料",
  "points": "初回10%OFFクーポン込み",
  "conditions": [
    {
      "label": "条件あり",
      "detail": "初回購入クーポンの適用が必要です。"
    }
  ],
  "comparisonBasis": ["5L x 4袋", "送料込み", "クーポン・ポイント込みの実質価格"]
}
```

Ranking should sort by `effectivePrice`, then by `listPrice`. If `conditions` is non-empty, the client displays a `条件あり` banner and links to condition details.

## Planned Resources

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/inventory` | Return household inventory. |
| `POST` | `/api/inventory` | Create an inventory item. |
| `PATCH` | `/api/inventory/:id` | Update stock, auto-replenish, category, or usage rate. |
| `DELETE` | `/api/inventory/:id` | Delete an inventory item and related queue decisions. |
| `PUT` | `/api/settings/household` | Replace household settings, including conditional-price visibility. |
| `PUT` | `/api/settings/autopilot` | Replace auto-purchase simulation rules. |
| `POST` | `/api/photo-detections` | Store or process photo detection results. |
| `POST` | `/api/replenishment-plan/refresh` | Recalculate replenishment candidates. |
| `GET` | `/api/offers` | Return effective-price ranked offers with condition details. |
| `POST` | `/api/offers/:id/click` | Record offer clicks and whether the clicked price had conditions. |
| `PATCH` | `/api/queue/:itemId` | Approve, auto-reserve, snooze, or cancel a queue item. |

## Implementation Notes

- Keep `src/lib/replenishment.ts` as pure domain logic so it can be reused by API routes and tests.
- `src/lib/server-state-store.ts` is the repository boundary for account state. It writes JSON files and an account index to `.server-state/` by default, or `HOME_STACK_STATE_STORE_DIR` when configured. Set `HOME_STACK_STATE_STORE_KIND=postgres` with `HOME_STACK_POSTGRES_URL`, `POSTGRES_URL`, or `DATABASE_URL` to use Postgres JSONB tables instead.
- `/api/state/status` exposes the active repository kind and write readiness for deployment checks. It reports whether a database URL is configured, but it must not return the URL value.
- The Postgres repository creates account-state, audit-event, and notification-event tables with the `HOME_STACK_STATE_TABLE_PREFIX` prefix, defaulting to `home_stack`.
- Replace the demo account-resolution handoff with a real authenticated identity provider before multi-user production launch.
- Account profiles should use stable account IDs and email hashes. Do not place raw email addresses inside saved sync payloads.
- Update the account index when account state is saved or reset so `/api/account/list` can drive account switching and operations checks.
- The Post-MVP UI connects account profile resolution, save, load, delete, list-refresh, and saved-account selection controls to these routes when running as a Next.js server. Static GitHub Pages exports keep the same panel visible with API-unavailable status messaging.
- Preserve explicit condition details for coupons, point returns, shipping thresholds, account eligibility, and campaign windows.
- Append condition-price audit events before replacing or clearing account state so ranking and click decisions remain inspectable.
- Append candidate audit events after product search when effective-price quotes should be kept with source query, match score, source label, and price evidence.
- Append direct price-scan audit events when URL scans return effective-price quotes that should remain inspectable.
- The Post-MVP UI can append the current condition audit payload and load stored condition audit events for the active account on a Next.js server build. Static GitHub Pages builds keep the panel visible but report API persistence as unavailable.
- Never rank a conditional effective price without exposing the conditions that make that price true.
- Product search candidates should carry an `effectivePriceQuote` so sorting can use normalized price rather than raw extracted price.
- Product search extraction should preserve evidence for inferred shipping fees, point value, and coupon value so condition banners can explain why an effective price changed.
- Product URL scans should also return `effectivePriceQuote` so direct product pages and marketplace search candidates can share the same ranking and audit contract. Prefer structured JSON-LD/meta condition evidence, then embedded app-state JSON or data attributes, before falling back to nearby page text.
- JAN/barcode input should preserve the raw input, normalized digits, validation result, and suggested check-digit correction before searching marketplaces.
- JAN/barcode lookup should expose the active master provider and be able to hand off valid codes to an external HTTP JAN master through `HOME_STACK_BARCODE_MASTER_URL`. Normalize common response key variants such as `jan_code`, `product_name`, `itemName`, `category_name`, and `capacity`.
- Notification preparation must keep delivery as a separate adapter step. Missing LINE/email/Web Push destinations should produce blocked jobs, not silent drops.
- Notification status should expose provider readiness without leaking secret values. Required env keys are `HOME_STACK_LINE_CHANNEL_ACCESS_TOKEN`, `HOME_STACK_EMAIL_FROM` plus `HOME_STACK_EMAIL_TRANSPORT`, and `HOME_STACK_WEB_PUSH_PUBLIC_KEY` plus `HOME_STACK_WEB_PUSH_PRIVATE_KEY` plus `HOME_STACK_WEB_PUSH_SUBJECT`.
- Notification dispatch should run as dry-run by default. With `dryRun: false`, unconfigured providers fail with `provider-not-configured`; adapter-ready providers can be marked `sent` at the boundary until real LINE/email/Web Push senders are wired in.
- Notification prepare and dispatch routes should append account-scoped history events so real delivery rollout has an audit trail before external providers are enabled.
- The Post-MVP UI should let operators enter a destination, check provider status, prepare notification jobs, dry-run dispatch, and load notification history before enabling real delivery.
- Store click events and queue decisions as append-only events once the backend exists.
