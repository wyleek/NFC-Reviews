-- ============================================================================
-- Foundation RLS pattern — the first tenant-scoping RLS in this repo.
-- Every existing table in this project uses a "public read to anon,
-- authenticated" policy (see 20260818035800_dashboard_read_policies.sql /
-- 20260821180000_crm_read_policies.sql) because there was no login yet.
-- These new tables are the first to be scoped per-user via `auth.uid()`.
-- Every later feature-module table should reuse this same `tenant_rw`/
-- `tenant_read` shape against `current_org_ids()`.
-- ============================================================================

-- Org ids the current user belongs to.
create or replace function public.current_org_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.memberships where user_id = auth.uid()
$$;

alter table organizations            enable row level security;
alter table memberships              enable row level security;
alter table locations                enable row level security;
alter table oauth_tokens             enable row level security;
alter table oauth_staging            enable row level security;
alter table notification_preferences enable row level security;
alter table reviews                  enable row level security;
alter table place_review_snapshots   enable row level security;

-- Reusable tenant policy (apply the same shape to every future org-scoped
-- table added by a feature-module branch).
create policy tenant_rw on locations for all
  using (org_id in (select public.current_org_ids()))
  with check (org_id in (select public.current_org_ids()));

create policy tenant_rw on notification_preferences for all
  using (org_id in (select public.current_org_ids()))
  with check (org_id in (select public.current_org_ids()));

create policy tenant_read on reviews for select
  using (org_id in (select public.current_org_ids()));

create policy org_read on organizations for select
  using (id in (select public.current_org_ids()));

create policy own_memberships on memberships for select
  using (user_id = auth.uid());

-- oauth_tokens, oauth_staging, place_review_snapshots: RLS enabled, NO
-- client policy → service role only. Same "enabled but no policy" pattern
-- this repo already uses for internal-only tables.

grant select, insert, update, delete on locations, notification_preferences to authenticated;
grant select on reviews, organizations, memberships to authenticated;
