# Home Stack Requirements

## 1. Concept

Home Stack is a mobile web assistant for household consumables. Users register household stock from a phone, track estimated days left, and receive replenishment suggestions before items run out.

Long term, the product can support permission-based auto-purchase reservations with cancellation windows. The MVP stops at approval-based queueing and purchase-link clicks.

## 2. Business Direction

- Do not rely on user subscription revenue in the first MVP.
- Monetize through affiliate links, retailer referrals, coupons, and clearly labeled sponsored alternatives.
- Preserve trust by always showing the true lowest eligible offer before sponsored placements.
- Sponsored offers must show why they are displayed, such as lower price, same category, same capacity, or a campaign benefit.

## 3. MVP Scope

- Build as a Next.js + TypeScript mobile web app.
- Store MVP state in `localStorage`.
- Support photo-upload simulation, manual inventory entry, stock adjustment, replenishment suggestions, offer filtering, KPI counters, household settings, and auto-purchase simulation rules.
- Do not process real payments.
- Do not send real notifications yet; render LINE/email/Web Push preview text.
- Do not upload images to a server in the MVP.

## 4. User Features

### Inventory

- Upload or capture a photo and generate demo inventory candidates.
- Manually add inventory with name, category, stock percentage, and daily usage.
- Adjust stock by `-10%` and `+10%`.
- Toggle auto-replenish eligibility per item.
- Delete inventory items.

### Household Settings

- Save adult, child, and pet counts.
- Choose notification channel: LINE, email, or Web Push.
- Toggle sponsored-offer visibility.
- Toggle the privacy assumption that photos are deleted after analysis.

### Replenishment Prediction

- Estimate days left from stock, daily usage, household size, children, and pets.
- Treat items under 14 days as replenishment candidates.
- Sort inventory by replenishment urgency.

### Offers

- Show price, retailer, unit price, shipping, points, reason, and label.
- Label offers as either `実質最安` or `キャンペーン / 広告`.
- Filter offers by all, lowest, or sponsored.
- Count offer clicks and estimated referral revenue.

### Queue

- Show urgent items in an approval-based replenishment queue.
- Support approve, auto-reserve simulation, snooze, and cancel decisions.
- Count approvals and auto-reservation simulations.
- Snooze should temporarily increase stock to represent delayed action.

### Auto-Purchase Roadmap

- Save enabled/disabled state.
- Save per-purchase maximum amount.
- Save cancellation window.
- Save brand-change policy.
- Save delivery-speed policy.
- Require approval for sponsored products by default.
- Only allow auto-reserve when item-level auto-replenish is enabled, the price is within the limit, and policy checks pass.

### Privacy and Operations

- Export current demo state to clipboard.
- Reset local demo state.
- Make it clear that the MVP uses local browser storage.

## 5. Technical Requirements

- Use Next.js App Router under `src/app`.
- Use React client state for the interactive MVP surface.
- Keep reusable domain logic in pure TypeScript modules under `src/lib`.
- Keep static assets in `public`.
- Use Biome for formatting/linting.
- Use TypeScript strict mode.
- Use Docker Compose as an optional local production runtime.

## 6. Future Roadmap

1. Connect real image recognition.
2. Add product master data, JAN/barcode support, and category dictionaries.
3. Integrate retailer pricing, shipping, and point calculations.
4. Send real LINE/email notifications.
5. Persist inventory, households, queue decisions, clicks, and consent records server-side.
6. Add API routes under `/api`.
7. Add ranking policy logs for sponsored-offer auditability.
8. Add purchase intent and cancellation-window flows for safe auto-purchase.
