# Foundation — `branch: foundation` (as-built)

See `docs/PLAN-customer-dashboard.md` for the master plan this is Phase 0 of. This doc is the **as-built** reference — the original session spec assumed a greenfield database; this repo already had a working single-tenant CRM/ops system (`hub/`, `admin-api`, `businesses`/`review_snapshots`/`sync-reviews`/etc.), and a couple of the spec's literal names collided with it. Read this before starting any module branch (A–I) — several of them read tables named here.

## Scope

**In:** tenancy + auth model, the reusable RLS pattern, GBP OAuth + location picker, the review-sync heartbeat, and the empty tabbed app shell (`client-dashboard/`).
**Out (deferred to their own branches):** `ai_reply_drafts`, `brand_voice`, `themes`, `cards`, `tap_events`, `performance_metrics`, `review_requests`, `reports`.

## Deviations from the original spec (read this first)

1. **`place_review_snapshots`, not `review_snapshots`.** A `review_snapshots` table already existed (`business_id, captured_on date, review_count, rating`), populated daily by the pre-existing `functions/sync-reviews` for the internal CRM and read by the `review_velocity` view / `admin-api`. It's live and untouched. The new org/place-scoped snapshot table (place_id + location_id + snapshot_at + source scrape|gbp) is `place_review_snapshots` instead. **Module E reads this table, not `review_snapshots`.**
2. **`gbp-review-sync`, `gbp-oauth-start`, `gbp-oauth-callback`, `gbp-locations-connect`** — not `sync-reviews`/`oauth-start`/`oauth-callback`. The `sync-reviews` name is already a live, unrelated function (Places-API aggregate count for CRM `businesses`); the `gbp-` prefix keeps this pipeline unambiguous from it. `gbp-locations-connect` is the picker's function (GET = fetch staged list, POST = commit selection) — not named in the original spec, which described the picker only as a page.
3. **`oauth_staging` table**, not in the original spec's table list. The OAuth callback is a server-side redirect target Google hits directly (no user session on that request); the staged location list needs somewhere to live between the callback and the picker page loading in-browser. Short-lived (15 min), service-role only, deleted once the picker's POST consumes it.
4. **`locations.business_id`** is a real `references businesses(id) on delete set null` — `locations` is the new client-tenant entity; `businesses` stays the CRM's internal, staff-only "physical business" record. The link is best-effort (matched on `google_place_id = place_id` when a location is connected) and often null — nothing depends on it being set.
5. **`google_sub`** is the GBP `accounts.list` account name (`accounts/{accountId}`), not an OIDC subject — the requested scope (`business.manage`) carries no identity claim, and the account id is already exactly what's needed to key `oauth_tokens` uniquely per connected Google account per org.
6. **Org provisioning is self-serve**, not staff-only: a `security definer` trigger on `auth.users` (`20260908120200_foundation_org_autoprovision.sql`) creates one `organizations` + one owner `memberships` row on first sign-in if none exists yet. **Staff-led onboarding note:** if staff invite a client ahead of time meaning to attach them to a specific/pre-known org, the trigger still fires and creates a default org first (it can't know the intended one at insert time) — the follow-up step is to reassign the new membership's `org_id` to the intended org and delete the orphaned auto-created one. Manual today; worth a staff tool later if it comes up often.
7. **Migration filenames** use this repo's real convention (`YYYYMMDDHHMMSS_description.sql`), not `0001_foundation.sql`.
8. **`client-dashboard/`** is a new top-level app (Vite + React 19 + Tailwind v4 — matching `dashboard-app/`'s existing choice, not `hub/`'s plain-CSS convention), not built on `dashboard-app/` (confirmed to have no auth/tenant/nav scaffolding — it's a single-business, query-param, no-login analytics view).

## What shipped

**Migrations** (`supabase/migrations/`):
- `20260908120000_foundation_tenancy.sql` — `organizations`, `memberships`, `locations`, `oauth_tokens`, `oauth_staging`, `notification_preferences`, `reviews`, `place_review_snapshots`.
- `20260908120100_foundation_rls.sql` — `current_org_ids()` (first tenant-scoping RLS helper in this repo), RLS + policies on all 8 tables above.
- `20260908120200_foundation_org_autoprovision.sql` — the self-serve org-creation trigger (see deviation 6).
- `20260908120300_foundation_cron.sql` — `pg_cron` job calling `gbp-review-sync` every 4 hours, guarded by `GBP_SYNC_CRON_SECRET`.

**Edge Functions** (`supabase/functions/`):
- `_shared/gbp.ts` — signed `state` (HMAC, no extra table needed for OAuth CSRF), Google token exchange/refresh, GBP account/location/review API calls.
- `gbp-oauth-start` — returns `{ url }` (the Google consent URL) as JSON for the caller to navigate to; doesn't redirect itself, since a browser navigation can't carry the `Authorization` header this needs.
- `gbp-oauth-callback` — Google's redirect target (`--no-verify-jwt`); exchanges the code, stores `oauth_tokens`, stages the account's locations into `oauth_staging`, redirects to `/connect/picker?staging_id=...`.
- `gbp-locations-connect` — GET fetches the staged list (org-checked), POST commits the owner's selection into `locations` and kicks off the first `gbp-review-sync` call.
- `gbp-review-sync` — full history on first sync (pages until exhausted), incremental + early-stop after; upserts `reviews`, writes a `place_review_snapshots` row per run.

**Required secrets** (set on the Supabase project, alongside the existing `ADMIN_TOKEN`/`CRON_SECRET`/`GOOGLE_PLACES_API_KEY`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GBP_OAUTH_REDIRECT_URI` (the deployed `gbp-oauth-callback` URL), `OAUTH_STATE_SECRET` (any random string, used only to HMAC-sign `state`), `CLIENT_APP_URL` (the deployed `client-dashboard` URL), `GBP_SYNC_CRON_SECRET`, `SUPABASE_FUNCTIONS_URL`.

**App** (`client-dashboard/`): Supabase Auth (Google + email magic link) → `memberships`/`organizations` tenant context → if the org has zero `locations`, a "Connect Google Business Profile" screen (`/connect` → `gbp-oauth-start` → Google → `/connect/picker` → `gbp-locations-connect`) instead of the tab shell → five-tab bottom nav (Home · Reviews · Insights · Reports · Settings), four empty slots + a live Settings tab (`notification_preferences` read/write).

## Not done in this session (needs live credentials this session doesn't have)

- Applying the migrations to the real Supabase project (`supabase db push`) — verified locally instead (`supabase start` / `db reset`) where the CLI + Docker were available.
- Deploying the Edge Functions (`supabase functions deploy`) and setting the secrets above.
- Real GBP OAuth: needs a Google Cloud OAuth client (`business.manage` is a sensitive scope) and the connecting Google account to actually be a manager on the target GBP location — same requirement the spec calls out ("the Google account used here must be the same email added as a GBP manager and the same one on the API application").
- Deploying `client-dashboard/` as its own Vercel project (matching `hub`/`dashboard-app`'s pattern) and pointing its env vars at the deployed functions.

## Done when (from the original spec — verify once live)
- [ ] Migrations apply cleanly (`db push`); RLS on every table.
- [ ] A test user signs up, gets an org + membership, and cannot read another org's rows (RLS verified).
- [ ] OAuth connects a real GBP account, stages locations, and the picker (or single-location guard) writes one `locations` row.
- [ ] `gbp-review-sync` pulls full history into `reviews` and writes a `place_review_snapshots` row; `sync_status = 'ok'`.
- [ ] Settings tab reads/writes `notification_preferences` (text/dashboard/both).
- [ ] Service-role (internal) access can read across orgs; anon/authed cannot.
- [ ] Shell renders 5 tabs with empty slots; no module logic present beyond Settings.

## Non-goals (guard against scope creep)
No AI replies, no theme extraction, no velocity math/charts, no tap capture, no Performance API, no reports, no customer outreach. Those are branches B–I.
