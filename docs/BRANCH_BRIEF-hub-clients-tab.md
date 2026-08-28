# Branch: feature/hub-clients-tab

## Scope
New work: `hub/src/components/ClientsTab.jsx` — every paying customer,
a quick reviews-gained snapshot, and a red/yellow/green health flag, so a
slipping account is visible without opening its full dashboard. Read
`docs/PLAN-hub.md` first for the overall context.

## Background
Nothing like this exists yet. Confirmed by exploration (2026-08-27): the
CRM board's `BusinessDrawer.jsx` has zero review-performance data (only
contacts/deals/activity), and neither `crm-spec.md` nor
`lead-engine-spec.md` define a post-sale health/churn concept — the only
tiering that exists (`lead-engine-spec.md` §3.3, Tier A–D) is pre-sale
lead routing by star rating/velocity, not applicable here. This tab is
being designed fresh, but the *math* it needs already exists and is
tested: `dashboard-app/src/Dashboard.jsx`'s `snapshotAsOf()` (and the
surrounding date-bucketing helpers) diff `review_snapshots` rows into a
gained-reviews-over-a-period number for one business. Reuse that approach
rather than inventing new diffing logic.

## Work
- Query `businesses` where `stage = 'customer'` (direct Supabase read,
  anon key — same RLS-gated pattern `board/` already uses via
  `supabaseClient.js`, see `feature/hub-crm-tab`'s brief for the config
  wiring), joined with each business's recent `review_snapshots`.
- Compute, per business: current review count/rating (already on
  `businesses`), and reviews gained over a period — port the
  `snapshotAsOf()`-based diffing from `dashboard-app/src/Dashboard.jsx`.
- Health flag — starting thresholds (tune once real data is visible, not
  worth blocking on the exact numbers):
  - 🟢 green: gained ≥1 review in the last 14 days
  - 🟡 yellow: 0 in the last 14 days, but ≥1 in the last 30
  - 🔴 red: 0 reviews in the last 30+ days
  Use the `.health-dot` classes already in `hub/src/theme.css`
  (`.green`/`.yellow`/`.red` modifiers).
- Each client tile: name, star rating, reviews-gained badge, health dot,
  and a "View full dashboard ↗" link — build it with
  `dashboardUrl(business.id)` from `hub/src/lib/config.js` (already
  built, points at the deployed `dashboard-app`) rather than
  reimplementing any of its charts.
- Sort worst-health-first (red, then yellow, then green) so problems
  surface immediately instead of requiring a scan.
- Wire `ClientsTab.jsx` in place of the current placeholder.

## Key files
- `dashboard-app/src/Dashboard.jsx` — reuse its snapshot-diffing approach
  (`snapshotAsOf()` and nearby date-bucketing helpers)
- `hub/src/lib/config.js` — shared config + `dashboardUrl()` helper
  (already built, `feature/operator-hub`)
- `hub/src/theme.css` — `.health-dot` classes already stubbed in
- `hub/src/components/ClientsTab.jsx` — placeholder to replace
- `board/src/lib/supabaseClient.js` — reference for the anon-key direct
  read pattern (this tab reads the same way)

## Acceptance checklist
- [ ] Lists every `stage = 'customer'` business with rating, reviews
      gained, and a health dot
- [ ] Health thresholds computed from `review_snapshots`, not hardcoded
      per business
- [ ] Sorted worst-health-first
- [ ] "View full dashboard" opens the real client dashboard for the
      right business (`?business=<id>`)
- [ ] `npm run build` in `hub/` succeeds
