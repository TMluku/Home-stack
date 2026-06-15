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

- [x] Add GitHub Pages deployment workflow for the static front end.
- [x] Add JAN/barcode input and known-code lookup for demo product search.
- [x] Add JAN/barcode check-digit correction candidates and `/api/barcode/resolve`.
- [x] Add external JAN master provider boundary and `/api/barcode/status`.
- [x] Normalize common external JAN master response wrappers and product field aliases.
- [x] Add external image recognition provider boundary and `/api/photo-detections`.
- [x] Add price fetch planning for official marketplace APIs, product-page JSON-LD/meta extraction, and HTML fallback.
- [x] Add effective-price normalization for shipping fees, point value, and coupon value.
- [x] Add effective-price quotes to product search candidates and sort by normalized effective price.
- [x] Infer shipping, point, and coupon values from marketplace search candidates when present.
- [x] Add effective-price quotes to direct product URL scans.
- [x] Infer direct product page shipping, point, and coupon evidence from JSON-LD and meta tags before text fallback.
- [x] Infer direct product page prices and conditions from embedded app-state JSON and data attributes.
- [x] Add condition audit rows for effective-price ranking decisions.
- [x] Add API-ready condition audit log entries with evidence and ranking basis.
- [x] Add append/list APIs for server-side condition-price audit events.
- [x] Connect Post-MVP condition audit panel to saved audit append/list routes.
- [x] Add product-search candidate quote audit append API.
- [x] Add direct URL price-scan quote audit append API.
- [x] Add notification adapter readiness panel.
- [x] Add notification draft payloads for LINE/email/Web Push handoff.
- [x] Add notification job preparation that queues configured destinations and blocks missing destinations.
- [x] Add dry-run notification dispatch API behind a provider adapter boundary.
- [x] Add notification provider readiness API and non-dry-run adapter-ready dispatch contract.
- [x] Connect Post-MVP notification panel to provider status, job preparation, and dry-run dispatch routes.
- [x] Store and load account-scoped notification prepare/dispatch history.
- [x] Add real LINE push delivery for configured server dispatch.
- [x] Add real SMTP email delivery for configured server dispatch.
- [x] Add real Web Push delivery for configured server dispatch.
- [x] Add account/server-save migration contract panel.
- [x] Add account profile resolution for email-link/OAuth handoff without storing raw email addresses.
- [x] Connect Post-MVP account panel to account profile resolution.
- [x] Add `/api/state/export` sync payload for server-side account persistence handoff.
- [x] Add POST-only server save/load/reset endpoints backed by a replaceable JSON repository.
- [x] Add server state repository status API for deployment readiness checks.
- [x] Add server-side saved account index and account list API.
- [x] Connect Post-MVP account panel to save, load, delete, and account-list refresh routes.
- [x] Load saved server-side account state directly from the Post-MVP account list.
- [x] Add Postgres-backed server state repository for production persistence handoff.
- [x] Add trusted account header guard for account-scoped server APIs.
- [ ] Add production server-side persistence and user accounts.
- [x] Add production image recognition and barcode/JAN master data.
- [x] Add official retailer API integrations with normalized shipping, point, and coupon windows.
- [x] Add real notification delivery.
- [x] Add purchase intent confirmation and cancellation-window flows.
- [x] Add server-side audit logs for effective-price conditions and ranking decisions.
