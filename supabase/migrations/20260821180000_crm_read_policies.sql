-- ============================================================================
-- Read access for the CRM pipeline board, for the same reason and in the
-- same shape as 20260818035800_dashboard_read_policies.sql: the board
-- queries Supabase directly with the publishable/anon key (no per-business
-- login exists yet — deferred, see docs/PLAN.md). Writes stay exclusively
-- behind the service-role admin-api Edge Function, same as businesses/cards
-- already do — RLS here grants SELECT only.
--
-- These 5 tables (contacts, activities, deals, scheduled_messages,
-- places_lookup_cache) were created with RLS enabled but no policies by
-- 20260817120000_crm_data_model.sql — this was flagged there and in
-- BRANCH_BRIEF.md as the gap to close before the board could query them.
-- ============================================================================

create policy "public read contacts"           on contacts           for select to anon, authenticated using (true);
create policy "public read activities"         on activities         for select to anon, authenticated using (true);
create policy "public read deals"              on deals              for select to anon, authenticated using (true);
create policy "public read scheduled_messages" on scheduled_messages for select to anon, authenticated using (true);
create policy "public read places_lookup_cache" on places_lookup_cache for select to anon, authenticated using (true);

grant select on contacts, activities, deals, scheduled_messages, places_lookup_cache
  to anon, authenticated;
