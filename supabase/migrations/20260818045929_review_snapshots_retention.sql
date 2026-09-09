-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md). A real schema
-- change: purges review_snapshots rows older than 30 days, on a daily
-- pg_cron schedule.
create or replace function purge_old_review_snapshots()
returns void
language sql
as $$
  delete from review_snapshots
  where captured_on < (current_date - interval '30 days');
$$;

select cron.schedule(
  'purge-old-review-snapshots',
  '41 8 * * *',
  $$ select purge_old_review_snapshots(); $$
);
