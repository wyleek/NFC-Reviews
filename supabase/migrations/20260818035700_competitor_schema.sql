-- ============================================================================
-- Tap2Review — schema additions: competitor tracking + review velocity
-- ============================================================================

create table if not exists competitors (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid references businesses(id) on delete cascade,
  google_place_id  text not null,
  name             text,
  created_at       timestamptz not null default now(),
  unique (business_id, google_place_id)
);

create index if not exists idx_competitors_business on competitors(business_id);

create table if not exists competitor_snapshots (
  id               bigint generated always as identity primary key,
  competitor_id    uuid not null references competitors(id) on delete cascade,
  captured_on      date not null default (now() at time zone 'utc')::date,
  review_count     int,
  rating           numeric(2,1),
  created_at       timestamptz not null default now(),
  unique (competitor_id, captured_on)
);

alter table competitors          enable row level security;
alter table competitor_snapshots enable row level security;

create or replace view review_velocity as
with bounds as (
  select
    business_id,
    min(captured_on)                                        as first_day,
    max(captured_on)                                        as last_day,
    min(review_count)  filter (where captured_on = (select min(captured_on)
                               from review_snapshots s2 where s2.business_id = s.business_id)) as first_count,
    max(review_count)  filter (where captured_on = (select max(captured_on)
                               from review_snapshots s3 where s3.business_id = s.business_id)) as last_count
  from review_snapshots s
  group by business_id
)
select
  business_id,
  first_day, last_day, first_count, last_count,
  (last_count - first_count)                                       as reviews_gained,
  greatest(1, (last_day - first_day))                              as days_tracked,
  round(((last_count - first_count)::numeric
        / greatest(1, (last_day - first_day))) * 30, 1)            as reviews_per_month
from bounds;

create or replace view competitor_velocity as
with bounds as (
  select
    competitor_id,
    min(captured_on) as first_day,
    max(captured_on) as last_day,
    min(review_count) as first_count,
    max(review_count) as last_count
  from competitor_snapshots
  group by competitor_id
)
select
  c.id as competitor_id, c.business_id, c.name,
  b.last_count as review_count,
  (b.last_count - b.first_count) as reviews_gained,
  greatest(1, (b.last_day - b.first_day)) as days_tracked,
  round(((b.last_count - b.first_count)::numeric
        / greatest(1, (b.last_day - b.first_day))) * 30, 1) as reviews_per_month
from bounds b
join competitors c on c.id = b.competitor_id;
