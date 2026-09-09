-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md). Cleanup for the
-- smoke test above.
delete from businesses where name = 'SMOKE TEST Blue Bottle Coffee';
