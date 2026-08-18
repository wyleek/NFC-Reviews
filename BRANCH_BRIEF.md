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
- [~] Business owner can connect their GBP listing via OAuth from the admin console —
      wired end-to-end (admin.html link → gbp-connect/start → callback → token storage),
      but **blocked on Google approving Business Profile API access**; nothing here has
      run against a real GBP account. Degrades gracefully in the meantime (confirmed:
      /start returns a clear 501 "not configured" instead of crashing).
- [x] GBP tokens stored securely, RLS-scoped to the owning business — `gbp_connections`
      has RLS enabled with zero policies, so only the service role can read/write it;
      confirmed live that the anon key gets `[]` back, never tokens.
- [~] Sync job pulls rating/review-count on a schedule and persists durably — `gbp-sync`
      is deployed and no-ops cleanly with 0 connections (confirmed live), but isn't
      scheduled yet (no connections to sync until OAuth is unblocked) and its actual
      Google API call is unverified — see supabase/README.md's finish-this-later steps.
- [x] Dashboard renders 7/30/60-day views from GBP-sourced data — `tap2review-dashboard.jsx`
      already prefers `gbp_review_history` over the Places-sourced `review_snapshots`
      whenever a business has any rows there; confirmed live with seeded data. Falls
      back to the (now 30-day-purged) Places data until a business connects GBP.
- [x] No Places API data is stored beyond the ToS-allowed fields in this flow —
      added a daily purge (`purge-old-review-snapshots`) that drops `review_snapshots`
      rows older than 30 days; verified live against seeded -45/-31/-29/0-day rows.

## What's actually blocked

Everything code-shaped is done and deployed. What's left needs a human with
Google Cloud Console access: request Business Profile API approval, register
an OAuth client, set three secrets. See supabase/README.md's "Google Business
Profile integration" section for the exact steps and what to re-verify (API
endpoint shapes) once access exists — Google has reorganized this API surface
more than once, so the account/location-discovery and review-fetching calls
here are educated-guess-correct, not tested-correct.
