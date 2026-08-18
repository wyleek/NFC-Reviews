-- =============================================================
-- Hardening follow-up to 20260817120000_crm_data_model.sql, per the
-- Supabase security advisor run right after that migration landed.
-- =============================================================
--
--   * upsert_scraped_businesses / purge_expired_places_cache — pin
--     search_path so neither function can be hijacked by a role that
--     creates a same-named object earlier in an unpinned search path.
--
--   * spatial_ref_sys (auto-created by `create extension postgis`)
--     was also flagged: it came up with RLS off, exposing it (a
--     read-only EPSG reference table, not application data) to
--     anon/authenticated via the API. NOT fixed here — it's owned by
--     the extension, not by the migration role:
--       ERROR: 42501: must be owner of table spatial_ref_sys
--     Fixing it requires a superuser/dashboard-level action, not a
--     regular migration. Low real risk (reference data, no write
--     policy would exist even if RLS were enabled) — left as a known,
--     accepted exception rather than worked around.
-- =============================================================

alter function public.upsert_scraped_businesses(jsonb) set search_path = public, pg_temp;
alter function public.purge_expired_places_cache() set search_path = public, pg_temp;
