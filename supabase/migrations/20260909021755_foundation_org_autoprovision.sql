-- ============================================================================
-- Self-serve org provisioning: the first time a person signs in (Google or
-- email, via Supabase Auth in the new client-dashboard app) with no existing
-- membership, create one organization + one owner membership for them.
--
-- Staff-led onboarding note: if staff invite a client ahead of time (e.g.
-- via the Supabase Admin API) intending to attach them to a specific,
-- already-known org (linked to an existing CRM `businesses` row), this
-- trigger still fires and creates a default org first — it has no way to
-- know the intended org at insert time. The follow-up step is: reassign
-- the new membership's org_id to the intended org, then delete the
-- orphaned auto-created organization row. This is a manual step today;
-- a later module can add a staff tool for it if it comes up often.
-- ============================================================================

create or replace function public.handle_new_user_org()
returns trigger
language plpgsql
security definer set search_path = public as $$
declare
  new_org_id uuid;
  org_name text;
begin
  -- Defensive: skip if a membership already exists for this user (e.g. a
  -- staff-run backfill inserted it directly before this trigger could).
  if exists (select 1 from public.memberships where user_id = new.id) then
    return new;
  end if;

  org_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'business_name'), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.organizations (name)
  values (org_name)
  returning id into new_org_id;

  insert into public.memberships (org_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created_provision_org
  after insert on auth.users
  for each row execute function public.handle_new_user_org();
