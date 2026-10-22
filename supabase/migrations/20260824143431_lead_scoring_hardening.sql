-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md). Pins
-- search_path on the lead-scoring functions (same hardening pattern as
-- 20260818050000_crm_data_model_hardening.sql).
alter function refresh_tiers() set search_path = public, pg_temp;
alter function field_list(float8, float8, float8) set search_path = public, pg_temp;
alter function purge_expired_places_rating_observations() set search_path = public, pg_temp;
