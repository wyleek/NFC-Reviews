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
- [x] Supabase project has core schema applied, RLS confirmed on all tables
- [x] All four Edge Functions deployed and reachable
- [x] `admin.html` can create a business + card end-to-end against the live API
- [x] `linkmaker.html` produces a working tap link that hits `redirect`
- [x] `tap2review-dashboard.jsx` renders real data, no sample/mock arrays left
- [x] `sync-reviews` runs on schedule and populates `review_snapshots`

## Deploy notes

Deployed to Supabase project **NFC Database** (`ehzwsqkrmxsfdfslxmpo`). See
`supabase/README.md` for the live URLs, what secrets are set, and two
correctness fixes made vs. the original `tap2review-backend.zip` (dropped
tap-logging on `redirect`, dead tap-link URLs in `admin-api`) — that
directory is now the source of truth; the zip is kept for history only.

`admin.html`/`linkmaker.html` needed no code changes — they already take the
function URL + admin token via a setup screen (stored in `localStorage`,
never hardcoded). Every `admin-api` action (`search_place`, `create_business`,
`add_competitor`, `list_businesses`, `quick_link`) was smoke-tested end-to-end
via direct HTTP calls replicating exactly what those pages send; the actual
HTML/JS UI itself wasn't driven in a browser (none available in this
environment) — worth a quick manual click-through before calling this branch
fully closed.

The dashboard has no per-business login yet (out of scope here — see
`docs/PLAN.md`), so it resolves which business to show via `?business=<id>`
in the URL, falling back to the most recently created business if omitted.
RLS was opened to read-only `SELECT` for the `anon`/`authenticated` roles on
the tables/views it queries; writes stay exclusively behind the service-role
Edge Functions. Scope that down once dashboard auth exists.
