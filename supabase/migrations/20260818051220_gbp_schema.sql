-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md). This is the
-- staff-only, business_id-scoped GBP OAuth prototype (empty, 0 rows as of
-- this backfill) — distinct from the foundation branch's org_id-scoped
-- oauth_tokens/reviews, which serve the client-facing app. See the
-- BRANCH_BRIEF for the recommendation to leave both in place for now.
create table if not exists gbp_connections (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null unique references businesses(id) on delete cascade,
  gbp_account_id    text not null,
  gbp_location_id   text not null,
  access_token      text not null,
  refresh_token     text not null,
  token_expires_at  timestamptz not null,
  connected_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

alter table gbp_connections enable row level security;

create table if not exists gbp_review_history (
  id            bigint generated always as identity primary key,
  business_id   uuid not null references businesses(id) on delete cascade,
  captured_on   date not null default (now() at time zone 'utc')::date,
  review_count  int,
  rating        numeric(2,1),
  created_at    timestamptz not null default now(),
  unique (business_id, captured_on)
);

create index if not exists idx_gbp_review_history_business on gbp_review_history(business_id, captured_on);

alter table gbp_review_history enable row level security;

create policy "public read gbp_review_history" on gbp_review_history
  for select to anon, authenticated using (true);

grant select on gbp_review_history to anon, authenticated;
