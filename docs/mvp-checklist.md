# MVP Completion Checklist

This checklist defines the current acceptance target for the Home Stack MVP.

## Product Flow

- [x] User can add inventory manually.
- [x] User can add demo inventory from a photo upload simulation.
- [x] User can adjust stock levels.
- [x] User can delete inventory.
- [x] User can toggle item-level auto-replenish eligibility.
- [x] System estimates days left from inventory and household settings.
- [x] System identifies urgent items at 14 days or less.
- [x] System displays replenishment candidates in a queue.
- [x] User can approve, snooze, cancel, or simulate auto-reservation.
- [x] User can copy a shopping memo from actionable queue items.

## Price Comparison

- [x] Offers are ranked by effective price.
- [x] Conditional prices show a `条件あり` banner.
- [x] Conditional price details are visible in the comparison section.
- [x] User can filter all, no-condition, and conditional offers.
- [x] Offer clicks update local metrics.
- [x] Comparison-card outbound links update local metrics.
- [x] Comparison candidates include outbound retailer/search links.
- [x] Product search can query marketplace sources through `/api/product-search`.
- [x] Product URL scanning can extract prices through `/api/price-scan`.

## Settings and Safety

- [x] User can save household settings.
- [x] User can choose LINE, email, or Web Push notification preview mode.
- [x] User can include or exclude conditional prices.
- [x] User can save auto-purchase simulation settings.
- [x] Conditional prices can require approval before auto-reservation.
- [x] MVP does not process real payments.
- [x] MVP does not send real notifications.
- [x] MVP does not upload images to a server.

## Operations

- [x] User can export local demo state to the clipboard.
- [x] User can reset local demo state.
- [x] Clipboard copy actions report failure when browser clipboard access is unavailable.
- [x] App metadata and manifest are Japanese and product-specific.
- [x] README documents setup, verification, and MVP boundaries.
- [x] Requirements and API plan reflect effective-price ranking rather than sponsored classification.

## Verification Gates

- [x] `pnpm.cmd run check`
- [x] `pnpm.cmd run build`
- [x] Browser check: main sections render in Japanese.
- [x] Browser check: shopping memo summary is visible.
- [x] Browser check: no obvious mojibake characters are visible.
- [x] Browser check: desktop and mobile widths have no horizontal overflow.

## Known Follow-Up After MVP

- [ ] Add server-side persistence and user accounts.
- [ ] Add real image recognition and barcode/JAN support.
- [ ] Add official retailer API integrations with normalized shipping, point, and coupon windows.
- [ ] Add real notification delivery.
- [ ] Add purchase intent confirmation and cancellation-window flows.
- [ ] Add audit logs for effective-price conditions and ranking decisions.
