-- ============================================================================
-- Google Business Profile integration — schema.
--
-- gbp_connections: OAuth tokens, one per business. Service-role only — no
-- RLS read policy for anon/authenticated, unlike the rest of this project's
-- read-open tables. Tokens must never reach the client.
--
-- gbp_review_history: durable rating/review-count history sourced from GBP
-- (owner-authorized, under GBP's own terms — not Places API ToS), so unlike
-- review_snapshots this is NOT subject to the 30-day purge in
-- 20260818050000_review_snapshots_retention.sql. Read-open like the other
-- dashboard-facing tables.
-- ============================================================================

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
-- Intentionally no policies: service role (which bypasses RLS) is the only
-- reader/writer. admin.html/dashboard never see tokens directly.

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
