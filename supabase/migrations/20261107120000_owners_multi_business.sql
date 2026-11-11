-- ============================================================================
-- owners — a single point of contact that can own MANY businesses.
--
-- Until now the model was "one master record per business" and a `contact`
-- was a child of exactly one business (contacts.business_id). That can't
-- represent one owner who has several businesses (e.g. four storefronts, four
-- cards, four dashboards). This adds an entity that sits ABOVE businesses:
--
--     owners (1) ---- (many) businesses
--
-- A business belongs to at most one owner (businesses.owner_id, nullable —
-- most businesses have no owner grouping and stay exactly as they are).
--
-- Purely ADDITIVE: a new table + a new nullable column. No existing row is
-- touched, nothing is dropped. Safe to run against production.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists owners (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  phone      text,
  notes      text,
  created_at timestamptz not null default now()
);

-- Deleting an owner must never delete their businesses — just unlink them.
alter table businesses
  add column if not exists owner_id uuid references owners(id) on delete set null;

create index if not exists idx_businesses_owner on businesses(owner_id);

-- ----------------------------------------------------------------------------
-- RLS — same pattern as dashboard_read_policies.sql: the customer dashboard
-- queries Supabase directly with the publishable/anon key and needs SELECT on
-- owners (to resolve ?owner=<uuid> and render the business switcher). All
-- writes stay behind the service-role admin-api Edge Function.
-- ----------------------------------------------------------------------------
alter table owners enable row level security;

create policy "public read owners" on owners for select to anon, authenticated using (true);

grant select on owners to anon, authenticated;
