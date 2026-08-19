# Tap2Review — repo review & branch plan

Snapshot of what's in the repo, the decisions made to resolve conflicts between
the existing specs, and the branch breakdown that follows from them. Written
before any of the branches below started, so each one can be picked up
independently with full context.

## What's already here

**Console (Admin + Analytics + Link Maker)** — mostly built:
- `admin.html`, `linkmaker.html` — working single-file mobile PWAs hitting the
  `admin-api` Edge Function.
- `tap2review-backend.zip` → Supabase Edge Functions: `redirect` (tap → 302,
  no star-rating gate), `hub` (neutral landing page), `sync-reviews` (daily
  Places snapshot), `admin-api` (create business/cards, search place, add
  competitor).
- Core schema: `businesses`, `cards`, `taps`, `review_snapshots`, `contacts`,
  `competitors`, `competitor_snapshots`. RLS-enabled.
- `tap2review-dashboard.jsx` — polished React analytics dashboard, currently
  running on **hardcoded sample data**, not wired to Supabase.

**CRM + Lead Engine** — fully spec'd, ~no code built:
- `crm-spec.md` — pipeline layer: stage enum, `activities`/`deals`/
  `scheduled_messages`, kanban board, one-tap outcome logging, SMS
  consent/A2P 10DLC notes.
- `lead-engine-spec.md` — scoring/tiering model, the "pre-call block"
  workflow, and a Google-ToS-driven durable/ephemeral data split.
- `scrape_prospects.py` — already-working scraper, currently targets a
  separate `prospects`/`places_cache`/`rating_observations` schema
  (root `schema.sql` — misleadingly named; this is the *lead-engine* schema,
  distinct from the backend zip's own `schema.sql`, the *core product* schema).

## Conflicts found, and how they were resolved

1. **Two incompatible lead data models.** `lead-engine-spec.md` (and the
   scraper) used a standalone `prospects` table keyed by Google `place_id`.
   `crm-spec.md` said not to build a parallel leads system and to extend
   `businesses` instead. Both also defined a `contacts` table with different
   columns.
   → **Resolved: one master record per business.** `businesses` gets the
   `stage` enum from `crm-spec.md`. The standalone `prospects` table is
   retired — a scraped lead becomes a `businesses` row with `stage='scraped'`
   from day one. `contacts` is a single schema (business_id-based, with the
   lead-engine's `dm_days`/`dm_window`/`source` fields folded in).

2. **Google Maps Platform ToS and indefinite storage.** Only `place_id` (and
   lat/lng for 30 days) may be cached indefinitely — name, rating, review
   count, phone must be requested live, not warehoused
   ([terms](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522)).
   The already-built `competitor_snapshots` table (in `schema-competitors.sql`)
   stores rating/review_count with no purge — exactly the pattern the
   lead-engine spec flagged as risky. The practical stake isn't legal action;
   it's that a ToS flag suspends the *Google Cloud project*, which also runs
   the paying-customer-facing `redirect`/`sync-reviews` functions.
   → **Resolved, retention policy:**
   - **Own-business data**: migrate to the **Google Business Profile API**
     (owner-authorized — their data, different terms). Storable indefinitely.
     Dashboard shows 7/30/60-day views from this.
   - **Competitor data**: stays **live-fetched for the point-in-time gap**
     ("you have 37, they have 214") plus a **rolling-window velocity**
     (recomputed each cycle, old observations purged) — never a permanent
     historical archive.
   - Any lead-scoring use of Places data (rating, review count, etc.) for
     scraped-but-unsold businesses follows the same rolling-window rule.

## Branches

Suggested merge order: `console-live-data` can land independently at any
point. `gbp-own-business-tracking` and `competitor-rolling-tracking` both
touch the dashboard's data layer, so land after `console-live-data`.
`crm-data-model` must land before `crm-pipeline-board` (the board is built on
top of the schema it defines).

| Branch | Scope | Depends on |
|---|---|---|
| `feature/console-live-data` | Deploy Supabase, run core schema + edge functions, wire `tap2review-dashboard.jsx` off sample data onto real queries | — |
| `feature/gbp-own-business-tracking` | Google Business Profile OAuth per business, sync job, 7/30/60-day dashboard views | `console-live-data` |
| `feature/competitor-rolling-tracking` | Retrofit `competitor_snapshots` to a rolling window + live gap/velocity, drop permanent history | `console-live-data` |
| `feature/crm-data-model` | The schema merge described above: `businesses.stage`, unified `contacts`, `activities`/`deals`/`scheduled_messages`, retire `prospects`, rewrite `scrape_prospects.py` to target `businesses` | — |
| `feature/crm-pipeline-board` | Kanban board, business detail drawer, one-tap outcome buttons, voice-note field, pre-call call-list UI | `crm-data-model` |

Each branch carries its own `BRANCH_BRIEF.md` at the repo root with the
detailed scope, key files, and an acceptance checklist.

## Recommended build order

Work one branch per Claude session — `git checkout <branch>`, then start
Claude fresh in that terminal. Keeps each branch's context clean instead of
carrying the last branch's decisions into the next one.

1. `feature/console-live-data` — foundation, no dependencies. Per the table
   above it can land independently at any point, so do it first.
2. `feature/crm-data-model` — also no dependencies. Independent of (1); if
   running two sessions in parallel, pair it with `console-live-data`.
   Otherwise do it second.
3. `feature/gbp-own-business-tracking` — start only after `console-live-data`
   is merged.
4. `feature/competitor-rolling-tracking` — start only after
   `console-live-data` is merged. Independent of (3); can run alongside it.
5. `feature/crm-pipeline-board` — start only after `crm-data-model` is
   merged. Do this last — it's built directly on that schema.

This satisfies both dependency chains (`console-live-data` →
`{gbp-own-business-tracking, competitor-rolling-tracking}` and
`crm-data-model` → `crm-pipeline-board`) while keeping to one branch, one
session, at a time.
