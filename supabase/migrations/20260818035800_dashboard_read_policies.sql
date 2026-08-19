-- ============================================================================
-- Read-only access for the analytics dashboard, which queries Supabase
-- directly with the publishable/anon key (no per-business login exists yet —
-- see docs/PLAN.md, this is deferred to a future auth/memberships pass).
-- Writes remain exclusively behind the service-role Edge Functions
-- (admin-api, redirect, sync-reviews) — RLS grants SELECT only.
-- ============================================================================

create policy "public read businesses"           on businesses           for select to anon, authenticated using (true);
create policy "public read cards"                on cards                for select to anon, authenticated using (true);
create policy "public read taps"                 on taps                 for select to anon, authenticated using (true);
create policy "public read review_snapshots"     on review_snapshots     for select to anon, authenticated using (true);
create policy "public read competitors"          on competitors          for select to anon, authenticated using (true);
create policy "public read competitor_snapshots" on competitor_snapshots for select to anon, authenticated using (true);

grant select on businesses, cards, taps, review_snapshots, competitors, competitor_snapshots
  to anon, authenticated;
grant select on daily_taps, taps_by_card, review_velocity, competitor_velocity
  to anon, authenticated;

-- Views must opt into the querying role's RLS (Postgres 15+), otherwise they
-- run with the view owner's (postgres) privileges and bypass RLS entirely.
alter view daily_taps          set (security_invoker = true);
alter view taps_by_card        set (security_invoker = true);
alter view review_velocity     set (security_invoker = true);
alter view competitor_velocity set (security_invoker = true);
