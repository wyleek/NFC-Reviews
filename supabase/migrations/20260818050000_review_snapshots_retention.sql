-- ============================================================================
-- 30-day retention for Places-API-derived review snapshots.
--
-- Per docs/PLAN.md's ToS resolution: under Google's Maps Platform Terms,
-- only place_id may be cached indefinitely (lat/lng gets a 30-day allowance);
-- rating, review_count, name, and phone "must be requested live, not
-- warehoused". `review_snapshots` is populated by sync-reviews from the
-- Places API and is exactly that — a warehoused history of rating/
-- review_count. It's the interim source for the dashboard's 7/30/60-day
-- views until feature/gbp-own-business-tracking's GBP-sourced
-- `gbp_review_history` (owner-authorized, different terms, no purge needed)
-- is live for a given business.
--
-- This keeps review_snapshots itself within the ToS-safe rolling window in
-- the meantime: nothing older than 30 days survives. It does NOT touch
-- competitor_snapshots — that table's retention is feature/competitor-
-- rolling-tracking's scope, not this branch's.
-- ============================================================================

create or replace function purge_old_review_snapshots()
returns void
language sql
as $$
  delete from review_snapshots
  where captured_on < (current_date - interval '30 days');
$$;

select cron.schedule(
  'purge-old-review-snapshots',
  '41 8 * * *',  -- daily, shortly after the 08:17 UTC sync-reviews run
  $$ select purge_old_review_snapshots(); $$
);
