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
| `POST` | `/api/barcode/resolve` | Normalize JAN/barcode input, validate check digits, suggest correction candidates, and return static search candidates. |
| `POST` | `/api/product-search` | Search marketplace sources for a product query and return normalized price candidates. Uses official API credentials when configured, otherwise tries public search-result HTML extraction. |
| `POST` | `/api/price-scan` | Fetch specific product page URLs and extract price candidates from JSON-LD, meta tags, or HTML text. |
| `POST` | `/api/state/export` | Build a server-sync payload from demo or posted account state, including condition audit logs and notification drafts. |
| `POST` | `/api/state/save` | Save a server-sync payload for an account in the configured server state store. |
| `POST` | `/api/state/load` | Load saved account state from the configured server state store. |
| `POST` | `/api/state/reset` | Delete saved account state from the configured server state store. |
| `POST` | `/api/notifications/prepare` | Convert notification drafts into queued or blocked delivery jobs without sending real notifications. |

### `POST /api/product-search`

Request:

```json
{
  "query": "猫砂 5L"
}
```

Response includes the normalized query, searched sources, candidate titles, prices, links, match scores, source labels, and evidence notes. Optional environment variables:

- `RAKUTEN_APPLICATION_ID`
- `YAHOO_SHOPPING_APP_ID`

Without credentials, the route still attempts public search-page extraction, but results can be blocked or change when marketplace HTML changes.

### `POST /api/price-scan`

Request:

```json
{
  "urls": ["https://example.com/product"]
}
```

Response includes per-URL extraction status, price, title, source type, and fetch timestamp.

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
- `src/lib/server-state-store.ts` is the repository boundary for account state. It writes JSON files to `.server-state/` by default, or `HOME_STACK_STATE_STORE_DIR` when configured.
- Replace the file-backed repository with PostgreSQL, Supabase, or another durable store before multi-user production launch.
- Account profiles should use stable account IDs and email hashes. Do not place raw email addresses inside saved sync payloads.
- Preserve explicit condition details for coupons, point returns, shipping thresholds, account eligibility, and campaign windows.
- Never rank a conditional effective price without exposing the conditions that make that price true.
- JAN/barcode input should preserve the raw input, normalized digits, validation result, and suggested check-digit correction before searching marketplaces.
- Notification preparation must keep delivery as a separate adapter step. Missing LINE/email/Web Push destinations should produce blocked jobs, not silent drops.
- Store click events and queue decisions as append-only events once the backend exists.
