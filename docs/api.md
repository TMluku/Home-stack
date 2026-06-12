# Home Stack API Plan

The current MVP is a client-side Next.js + TypeScript application. State is stored in `localStorage` so the product flow can be validated without a backend service.

The next backend milestone is to introduce real API routes under `/api` while preserving the same resource model used by the UI.

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

## Planned Resources

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/inventory` | Return household inventory. |
| `POST` | `/api/inventory` | Create an inventory item. |
| `PATCH` | `/api/inventory/:id` | Update stock, auto-replenish, category, or usage rate. |
| `DELETE` | `/api/inventory/:id` | Delete an inventory item and related queue decisions. |
| `PUT` | `/api/settings/household` | Replace household settings. |
| `PUT` | `/api/settings/autopilot` | Replace auto-purchase simulation rules. |
| `POST` | `/api/photo-detections` | Store or process photo detection results. |
| `POST` | `/api/replenishment-plan/refresh` | Recalculate replenishment candidates. |
| `POST` | `/api/offers/:id/click` | Record purchase or sponsored-offer clicks. |
| `PATCH` | `/api/queue/:itemId` | Approve, auto-reserve, snooze, or cancel a queue item. |
| `GET` | `/api/state/export` | Export demo or account state. |
| `POST` | `/api/state/reset` | Reset demo state. |

## Implementation Notes

- Keep `src/lib/replenishment.ts` as pure domain logic so it can be reused by API routes and tests.
- Add a repository boundary before connecting PostgreSQL, Supabase, or another persistent store.
- Preserve explicit sponsored-offer labeling and never let ad ranking hide the true lowest eligible offer.
- Store click events and queue decisions as append-only events once the backend exists.
