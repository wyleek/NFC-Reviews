-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md). Smoke-test seed
-- data for the retention purge above, not a real schema change.
insert into businesses (id, name) values ('00000000-0000-0000-0000-0000000000aa', 'RETENTION SMOKE TEST');
insert into review_snapshots (business_id, captured_on, review_count, rating) values
  ('00000000-0000-0000-0000-0000000000aa', current_date - 45, 10, 4.0),  -- should be purged
  ('00000000-0000-0000-0000-0000000000aa', current_date - 31, 11, 4.0),  -- should be purged
  ('00000000-0000-0000-0000-0000000000aa', current_date - 29, 12, 4.1),  -- should survive
  ('00000000-0000-0000-0000-0000000000aa', current_date, 15, 4.2);       -- should survive
