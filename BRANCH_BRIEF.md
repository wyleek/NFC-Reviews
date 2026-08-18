# Branch: feature/crm-data-model

## Scope
The schema merge that reconciles `crm-spec.md` and `lead-engine-spec.md`
into one data model. No dependencies — this is foundational for the CRM
side, and `feature/crm-pipeline-board` builds on top of it.

## Background
Per `docs/PLAN.md`'s conflict resolution: `lead-engine-spec.md` (and
`scrape_prospects.py`) used a standalone `prospects` table keyed by Google
`place_id`; `crm-spec.md` said not to build a parallel leads system and to
extend `businesses` instead. Both specs also defined a `contacts` table with
different columns. Resolved: **one master record per business** —
`businesses` gains the `stage` enum from `crm-spec.md`; `prospects` is
retired (a scraped lead becomes a `businesses` row with `stage='scraped'`
from day one); `contacts` becomes a single `business_id`-based schema with
the lead-engine's `dm_days`/`dm_window`/`source` fields folded in.

## Work
- Add `stage` enum to `businesses` per `crm-spec.md`.
- Retire the standalone `prospects` table (root `schema.sql`'s
  `prospects`/`places_cache`/`rating_observations`); migrate any existing
  rows into `businesses` with `stage='scraped'`.
- Unify `contacts` into a single business_id-based schema, folding in
  `dm_days`, `dm_window`, and `source` from the lead-engine spec.
- Add `activities`, `deals`, `scheduled_messages` tables per `crm-spec.md`.
- Rewrite `scrape_prospects.py` to write into `businesses`/`contacts`
  instead of the retired `prospects` schema.
- Carry forward the rolling-window retention rule from `docs/PLAN.md` for
  any Places-derived lead-scoring fields (rating, review count) on
  scraped-but-unsold businesses.

## Key files
- `crm-spec.md`
- `lead-engine-spec.md`
- `schema.sql` (root — the lead-engine schema, to be retired/migrated)
- `scrape_prospects.py`

## Acceptance checklist
- [x] `businesses.stage` enum added and populated for existing rows
- [x] `prospects`/`places_cache`/`rating_observations` retired, data migrated
- [x] Single unified `contacts` schema (business_id-based), old dual schemas removed
- [x] `activities`, `deals`, `scheduled_messages` tables created per crm-spec.md
- [x] `scrape_prospects.py` writes to `businesses`/`contacts`, not `prospects`
- [x] Places-derived scoring fields for scraped businesses follow the rolling-window rule

All done in `supabase/migrations/20260817120000_crm_data_model.sql` +
the `scrape_prospects.py` rewrite. Not yet run against a live database
(no local Postgres available to test-execute) — see that migration
file's header for the two judgment calls it makes beyond this brief's
literal wording (`visits` folded into `activities`; `businesses` also
absorbs `prospects`' non-crm-spec durable columns).
