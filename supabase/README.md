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
