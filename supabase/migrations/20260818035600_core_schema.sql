-- ============================================================================
-- Tap2Review — database schema
-- Compliance note: there is NO star-rating gate anywhere in this schema.
-- A card points either to Google (everyone) or to the neutral hub (everyone).
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists businesses (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  google_place_id       text,
  review_url            text,
  feedback_url          text,
  current_review_count  int,
  current_rating        numeric(2,1),
  reviews_synced_at     timestamptz,
  created_at            timestamptz not null default now()
);

create table if not exists cards (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  slug         text not null unique,
  label        text,
  card_type    text default 'stand',
  destination  text not null default 'google'
                 check (destination in ('google','hub')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists idx_cards_business on cards(business_id);

create table if not exists taps (
  id           bigint generated always as identity primary key,
  card_id      uuid not null references cards(id) on delete cascade,
  business_id  uuid not null references businesses(id) on delete cascade,
  created_at   timestamptz not null default now(),
  device_type  text,
  os           text,
  country      text,
  referer      text,
  is_repeat    boolean default false
);

create index if not exists idx_taps_business_time on taps(business_id, created_at);
create index if not exists idx_taps_card_time     on taps(card_id, created_at);

create table if not exists review_snapshots (
  id            bigint generated always as identity primary key,
  business_id   uuid not null references businesses(id) on delete cascade,
  captured_on   date not null default (now() at time zone 'utc')::date,
  review_count  int,
  rating        numeric(2,1),
  created_at    timestamptz not null default now(),
  unique (business_id, captured_on)
);

create index if not exists idx_snapshots_business on review_snapshots(business_id, captured_on);

create table if not exists contacts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text,
  title        text,
  email        text,
  phone        text,
  role         text,
  is_primary   boolean default false,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_contacts_business on contacts(business_id);

create or replace view daily_taps as
select
  business_id,
  (created_at at time zone 'utc')::date as day,
  count(*)                              as taps
from taps
group by business_id, (created_at at time zone 'utc')::date;

create or replace view taps_by_card as
select
  c.business_id,
  c.id     as card_id,
  c.label,
  c.card_type,
  count(t.id) as taps
from cards c
left join taps t on t.card_id = c.id
group by c.business_id, c.id, c.label, c.card_type;

alter table businesses       enable row level security;
alter table cards            enable row level security;
alter table taps             enable row level security;
alter table review_snapshots enable row level security;
alter table contacts         enable row level security;
