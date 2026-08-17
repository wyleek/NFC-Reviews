# Branch: feature/gbp-own-business-tracking

## Scope
Track each managed business's own rating/review history via the Google
Business Profile API instead of the risky Places-API warehousing pattern.
Depends on `feature/console-live-data` (needs the live schema + dashboard
data layer to land on).

## Background
Per `docs/PLAN.md`'s ToS resolution: Places data (rating, review count, name,
phone) may not be stored indefinitely — only `place_id` and lat/lng (30
days). Own-business data is different: it's owner-authorized via GBP OAuth,
under GBP's own terms, and storable indefinitely. This branch is what lets
the dashboard show real 7/30/60-day trend views for a business's own
listing without the ToS risk `competitor_snapshots` currently carries.

## Work
- Add Google Business Profile OAuth flow, per business (owner connects their
  own listing from the admin console).
- Store the resulting GBP credentials/tokens securely (respect RLS; scope to
  the owning business).
- Build a sync job (cron or Edge Function, following the `sync-reviews`
  pattern) that pulls rating/review-count history from GBP and writes it to
  a durable table — this data is fine to keep indefinitely, unlike
  Places-sourced data.
- Add 7/30/60-day dashboard views in `tap2review-dashboard.jsx` backed by
  this table.

## Key files
- `tap2review-backend.zip` — `sync-reviews` function as the pattern to follow
- `tap2review-dashboard.jsx` — where the new trend views render
- Core schema (`businesses`, `review_snapshots`) as the base to extend

## Acceptance checklist
- [ ] Business owner can connect their GBP listing via OAuth from the admin console
- [ ] GBP tokens stored securely, RLS-scoped to the owning business
- [ ] Sync job pulls rating/review-count on a schedule and persists durably
- [ ] Dashboard renders 7/30/60-day views from GBP-sourced data
- [ ] No Places API data is stored beyond the ToS-allowed fields in this flow
