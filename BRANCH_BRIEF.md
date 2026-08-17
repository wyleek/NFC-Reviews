# Branch: feature/console-live-data

## Scope
Deploy the Supabase backend and wire the analytics dashboard off sample data
onto real queries. This is the foundation branch — no dependencies — and can
land independently at any point per `docs/PLAN.md`.

## Work
- Deploy Supabase project (or point at existing one).
- Run the core schema (from `tap2review-backend.zip`): `businesses`, `cards`,
  `taps`, `review_snapshots`, `contacts`, `competitors`,
  `competitor_snapshots`. Confirm RLS policies are enabled and correct.
- Deploy the Edge Functions from `tap2review-backend.zip`: `redirect`, `hub`,
  `sync-reviews`, `admin-api`.
- Smoke-test `admin.html` and `linkmaker.html` against the deployed
  `admin-api` function (create business/card, search place, add competitor).
- Rewrite `tap2review-dashboard.jsx` to drop its hardcoded sample data and
  query Supabase directly (taps, review snapshots, competitor snapshots) for
  the views it currently renders.

## Key files
- `tap2review-backend.zip` (schema + edge functions — unzip to inspect)
- `tap2review-dashboard.jsx`
- `admin.html`, `linkmaker.html`

## Acceptance checklist
- [ ] Supabase project has core schema applied, RLS confirmed on all tables
- [ ] All four Edge Functions deployed and reachable
- [ ] `admin.html` can create a business + card end-to-end against the live API
- [ ] `linkmaker.html` produces a working tap link that hits `redirect`
- [ ] `tap2review-dashboard.jsx` renders real data, no sample/mock arrays left
- [ ] `sync-reviews` runs on schedule and populates `review_snapshots`
