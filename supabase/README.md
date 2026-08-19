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

## Places-data retention (30-day rolling window) — risk *reduction*, not compliance

`review_snapshots` is populated from the Places API. **Read the actual terms
carefully before treating this as settled**: Google's [Maps Platform Service
Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
grant a 30-day caching allowance for **lat/lng only**. `place_id` may be
cached indefinitely. Rating, review count, name, and phone aren't covered by
any caching allowance at all — the terms say those must be requested live,
full stop, no time window attached.

So the 30-day purge here (`purge-old-review-snapshots`, scheduled daily at
08:41 UTC via `migrations/20260818040000_schedule_daily_review_sync.sql`,
verified live against seeded -45/-31/-29/0-day rows — only -29/0 survived)
is **not** "the compliant version" of storing this data. It's a deliberate
bridge: it avoids the specific pattern Google's enforcement actually seems to
target (a permanent, ever-growing warehouse of scraped place data), but it's
still, technically, daily-snapshotting fields the terms say shouldn't be
stored. The practical risk isn't legal action — it's automated abuse
detection suspending the whole Cloud project, which also runs the paying-
customer-facing `redirect`/`sync-reviews` functions.

This is a business-risk call, not a solved problem — treat it as a temporary
bridge while GBP access (below) is in flight, not the permanent architecture,
especially once this runs at scale across many businesses rather than one.
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

### How to request access

1. **Prerequisites**: an active Google Business Profile listing (yours or a
   client's) verified 60+ days, a website linked from that listing, and an
   email address that's an owner/manager on it — you have to apply from that
   email. The 60+-day profile can belong to any one client you manage; it's a
   one-time bona fides check, not a per-client requirement (see "Scaling to
   many businesses" below).
2. Create/select a project in [Cloud Console](https://console.developers.google.com/project),
   find its **Project Number** on the Dashboard.
3. Submit the **[GBP API contact form](https://support.google.com/business/contact/api_default)**,
   selecting **"Application for Basic API Access."** A draft of what to put in
   the free-text fields is in `supabase/gbp-api-application-draft.md`. There's
   no instant approval — Google emails a decision. Check approval status via
   the API's quota in Cloud Console: 0 QPM = not yet, 300 QPM = approved.
4. Once approved, enable all eight Business Profile APIs in
   [Cloud Console → API Library](https://console.cloud.google.com/apis/library):
   Google My Business API, My Business Account Management API, My Business
   Business Information API, My Business Notifications API, My Business
   Verifications API, My Business Q&A API, My Business Place Actions API, My
   Business Lodging API.
5. Create an OAuth 2.0 client
   ([Cloud Console → Credentials](https://console.developers.google.com/apis/credentials) →
   Create credentials → OAuth client ID → Web application), with authorized
   redirect URI `https://ehzwsqkrmxsfdfslxmpo.functions.supabase.co/gbp-connect/callback`.
   Grab the Client ID and Client Secret.
6. **OAuth consent screen verification** — separate from API access, and
   easy to miss: `business.manage` is a Google-classified restricted scope.
   Until your consent screen passes Google's verification (needs a privacy
   policy + homepage, ~3-5 business days,
   [details](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)),
   every business owner sees an "unverified app" warning before they can
   approve the connection. Not blocking, but the opposite of hands-off —
   either get this done before rolling `gbp-connect` out broadly, or be ready
   to walk early business owners through clicking past the warning.

### Scaling to many businesses ("agency" shape)

One API access approval + one Cloud project covers **unlimited** connected
businesses — there's no per-client application. The GBP API access request
(step 1 above) is a one-time, project-level approval; after that, each
business connects independently via the OAuth flow already built in
`gbp-connect` (owner clicks a link, logs into their own Google account on
Google's own consent screen, approves — never sees a password, never touches
anything you host). Google does have a separate GBP-native "organization
account" / "location groups" feature for agencies bulk-managing locations
through Google's own dashboard UI, but it's unrelated to this OAuth-based
integration — safe to ignore.

### Finish this once access exists

1. `supabase secrets set GBP_CLIENT_ID=... GBP_CLIENT_SECRET=... GBP_REDIRECT_URI=https://ehzwsqkrmxsfdfslxmpo.functions.supabase.co/gbp-connect/callback`
2. Connect a real test business, then verify against Google's current docs:
   - `gbp-connect/index.ts`'s account/location discovery calls
     (`mybusinessaccountmanagement`/`mybusinessbusinessinformation` v1) —
     confirm these are still the right endpoints and response shapes.
   - `gbp-sync/index.ts`'s `fetchReviewStats` — confirm the reviews-list
     endpoint (`mybusiness.googleapis.com/v4/.../reviews`) and the
     `averageRating`/`totalReviewCount` fields it reads are still current;
     Google has reorganized this API surface more than once.
3. Schedule `gbp-sync` the same way as `sync-reviews` (see migration above),
   guarded by the same `CRON_SECRET`.
4. `gbp-connect`'s callback takes the first GBP account/location it finds —
   fine for a single-location owner, wrong for a multi-location one. Worth a
   picker UI once this can actually be tested against a multi-location
   account.
