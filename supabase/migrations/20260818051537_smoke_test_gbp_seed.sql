-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md). Smoke-test seed
-- data for gbp_review_history above, not a real schema change.
insert into businesses (id, name) values ('00000000-0000-0000-0000-0000000000bb', 'GBP SMOKE TEST');
insert into gbp_review_history (business_id, captured_on, review_count, rating) values
  ('00000000-0000-0000-0000-0000000000bb', current_date - 1, 40, 4.5),
  ('00000000-0000-0000-0000-0000000000bb', current_date, 41, 4.5);
