-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md). Cleanup for the
-- GBP smoke test above.
delete from businesses where id = '00000000-0000-0000-0000-0000000000bb';
