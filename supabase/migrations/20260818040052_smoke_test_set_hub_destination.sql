-- Backfilled from supabase_migrations.schema_migrations (this was applied
-- directly to the live project without ever being committed to git — see
-- docs/BRANCH_BRIEF-foundation.md's "diverged from git" note). Recorded
-- here verbatim so git matches what's actually live; not something to
-- re-run. This was a manual click-through smoke test, not a real schema
-- change.
update cards set destination = 'hub' where slug = 'smoke-test-blue-bottle-coffe-table-4-bqz0';
