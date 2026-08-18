# Tap2Review — deployed Supabase backend

This directory is the deployed source of truth for the `feature/console-live-data`
branch. It supersedes `tap2review-backend.zip` at the repo root (kept for
history) — two fixes were made here that the zip doesn't have, see below.

```
migrations/                         → schema, RLS, dashboard read policies, cron (apply in order)
functions/redirect/                 → logs the tap, 302s onward           (public)
functions/hub/                      → neutral two-button page             (public)
functions/sync-reviews/             → daily review-count snapshot         (secret-guarded)
functions/admin-api/                → admin.html / linkmaker.html backend (secret-guarded)
functions/gbp-connect/               → GBP OAuth connect flow              (public, degrades gracefully — see below)
functions/gbp-sync/                  → daily GBP review-history snapshot   (secret-guarded)
```

## Live project

- Project: **NFC Database** (`ehzwsqkrmxsfdfslxmpo`), region `ca-central-1`
- API URL: `https://ehzwsqkrmxsfdfslxmpo.supabase.co`
- Functions URL: `https://ehzwsqkrmxsfdfslxmpo.functions.supabase.co/<name>/<path>`
- Publishable key (safe for client-side use, e.g. the dashboard):
  `sb_publishable_7aMWl0jH7_zYsN_iwE_Qcg_YxjGsbbw`

Secrets set on the project (`ADMIN_TOKEN`, `CRON_SECRET`, `GOOGLE_PLACES_API_KEY`;
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are injected automatically) — get the
actual values from whoever set them up, they aren't in git.

## Fixes made vs. the original zip

1. **`redirect`'s tap logging now awaits the insert instead of backgrounding
   it via `EdgeRuntime.waitUntil`.** The background version was reproducibly
   dropping inserts on this deployment — the redirect returned instantly but
   the tap row never landed, and no error surfaced anywhere. Since "taps are
   measured exactly" is the product's core promise, correctness beats the
   extra ~200-500ms of an awaited insert. A failed insert is still logged and
   swallowed so a DB hiccup never breaks the redirect itself.
2. **`admin-api`'s tap-link URLs no longer hardcode `tap2review.com/r/<slug>`.**
   That domain isn't pointed at anything yet (see backend README §4 in the
   zip), so every generated link was dead. It now defaults to
   `https://<project-ref>.functions.supabase.co/redirect/<slug>`, which
   actually works today; set the `TAP_BASE_URL` secret to
   `https://<your-domain>/r` once a pretty domain is proxied in front of
   `redirect`.

## Dashboard read access

`migrations/20260818035800_dashboard_read_policies.sql` adds RLS `SELECT`
policies (and `security_invoker` on the helper views) so `tap2review-dashboard.jsx`
can query Supabase directly with the publishable key — there's no per-business
login yet, so this is read-only and project-wide for now. Writes stay
exclusively behind the service-role Edge Functions. Scope this down (e.g. to a
`memberships`-based policy per business) once dashboard auth exists.

## Daily sync cron

`daily-review-sync` runs at 08:17 UTC via pg_cron + pg_net, calling
`sync-reviews`. See `migrations/20260818040000_schedule_daily_review_sync.sql`
(secret redacted there — the live job already has it).

## Places-data retention (30-day rolling window)

`review_snapshots` is populated from the Places API, and per `docs/PLAN.md`'s
ToS reading, rating/review-count "must be requested live, not warehoused" —
`place_id` is the only field cleared for indefinite storage. `daily-review-sync`
(`migrations/20260818040000_schedule_daily_review_sync.sql`) is what actually
does the deleting — `purge-old-review-snapshots`, scheduled daily at 08:41 UTC,
drops any `review_snapshots` row older than 30 days. Verified live: seeded rows
at -45/-31/-29/0 days, ran the purge function directly, confirmed only the
-29/0 rows survived. This is the fallback source for the dashboard's 7/30/60-day
view until a business connects Google Business Profile (below) — GBP data is
owner-authorized under different terms and isn't subject to this purge.
`competitor_snapshots` retention is `feature/competitor-rolling-tracking`'s
scope, not touched here.

## Google Business Profile integration (feature/gbp-own-business-tracking)

**Blocked on Google approval — nothing here has been tested against a real
GBP account.** Unlike Places, the Business Profile API requires requesting
access from Google (no self-serve key) plus registering an OAuth client. Until
that's done:

- `gbp-connect` (`/start`, `/callback`) and `gbp-sync` are deployed and live,
  but every route that needs real credentials returns a clear "not configured"
  response instead of crashing — confirmed live (`/start` → 501, `/gbp-sync`
  with 0 connections → clean no-op `{ok:0,failed:0,connections:0}`).
- `admin.html`'s post-creation screen has a "Connect GBP" link per business;
  clicking it today just shows the "not set up yet" page.
- Schema is ready: `gbp_connections` (OAuth tokens, service-role-only — no
  RLS read policy, confirmed anon gets `[]` back) and `gbp_review_history`
  (durable, anon-readable like the other dashboard tables, confirmed live).
- `tap2review-dashboard.jsx` already prefers `gbp_review_history` over
  `review_snapshots` whenever a business has any rows there, with a footer
  note naming the actual data source. No dashboard changes needed once real
  data starts landing.

**To finish this once access exists:**
1. Request Business Profile API access from Google (console.cloud.google.com
   → APIs & Services → the API isn't self-serve like Places; follow Google's
   current application flow).
2. Register an OAuth 2.0 client, add the `gbp-connect/callback` function URL
   as an authorized redirect URI.
3. `supabase secrets set GBP_CLIENT_ID=... GBP_CLIENT_SECRET=... GBP_REDIRECT_URI=https://ehzwsqkrmxsfdfslxmpo.functions.supabase.co/gbp-connect/callback`
4. Connect a real test business, then verify against Google's current docs:
   - `gbp-connect/index.ts`'s account/location discovery calls
     (`mybusinessaccountmanagement`/`mybusinessbusinessinformation` v1) —
     confirm these are still the right endpoints and response shapes.
   - `gbp-sync/index.ts`'s `fetchReviewStats` — confirm the reviews-list
     endpoint (`mybusiness.googleapis.com/v4/.../reviews`) and the
     `averageRating`/`totalReviewCount` fields it reads are still current;
     Google has reorganized this API surface more than once.
5. Schedule `gbp-sync` the same way as `sync-reviews` (see migration above),
   guarded by the same `CRON_SECRET`.
6. `gbp-connect`'s callback takes the first GBP account/location it finds —
   fine for a single-location owner, wrong for a multi-location one. Worth a
   picker UI once this can actually be tested against a multi-location
   account.
