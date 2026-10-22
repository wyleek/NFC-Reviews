-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md). Manual
-- invocation to verify the purge function during the smoke test above.
select purge_old_review_snapshots();
