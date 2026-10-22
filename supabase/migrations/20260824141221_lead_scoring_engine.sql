-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md).
-- =============================================================
-- Lead scoring engine (lead-engine-spec.md §3) — rebuilt against the
-- unified schema.
--
-- The original working implementation (v_scored, v_prospects_ranked,
-- v_call_list, field_list()) lived in the root schema.sql against the
-- old prospects/places_cache/rating_observations tables, and was
-- explicitly dropped — not reimplemented — by
-- 20260817120000_crm_data_model.sql §7, whose own header comment
-- calls rebuilding it against the unified schema "out of scope
-- here." This migration is that rebuild. Logic and thresholds are
-- unchanged from the original; only the tables/columns underneath
-- moved.
-- =============================================================

create table if not exists places_rating_observations (
  id                bigint generated always as identity primary key,
  google_place_id   text not null references places_lookup_cache(google_place_id) on delete cascade,
  observed_at       timestamptz not null default now(),
  rating            numeric(2,1),
  user_rating_count int,
  unique (google_place_id, observed_at)
);

create index if not exists idx_places_rating_observations_place
  on places_rating_observations(google_place_id, observed_at desc);

alter table places_rating_observations enable row level security;

create or replace function purge_expired_places_rating_observations()
returns void language sql as $$
  delete from places_rating_observations where observed_at < now() - interval '30 days';
$$;

-- =============================================================
-- Derived metrics
-- =============================================================

create or replace view v_velocity as
with paired as (
  select
    o.google_place_id,
    o.user_rating_count                                    as new_count,
    o.observed_at                                          as new_at,
    lag(o.user_rating_count) over w                        as old_count,
    lag(o.observed_at)       over w                        as old_at,
    row_number()             over (partition by o.google_place_id
                                   order by o.observed_at desc) as rn
  from places_rating_observations o
  window w as (partition by o.google_place_id order by o.observed_at)
)
select
  google_place_id,
  case
    when old_at is null then null
    when extract(epoch from (new_at - old_at)) < 604800 then null
    else round(
      (new_count - old_count)::numeric
      / (extract(epoch from (new_at - old_at)) / 86400.0)
      * 30.0, 2)
  end as reviews_per_30d
from paired
where rn = 1;

create or replace view v_local_median as
select
  p.google_place_id,
  percentile_cont(0.5) within group (order by n.user_rating_count)
    filter (where n.google_place_id <> p.google_place_id)          as median_reviews_nearby,
  max(n.user_rating_count)
    filter (where n.google_place_id <> p.google_place_id)          as top_reviews_nearby,
  count(*) filter (where n.google_place_id <> p.google_place_id
                     and ST_DWithin(p.location, n.location, 150)) as walk_density
from places_lookup_cache p
join places_lookup_cache n
  on n.primary_type = p.primary_type
 and ST_DWithin(p.location, n.location, 1609)
group by p.google_place_id;

create or replace view v_chain_flag as
select google_place_id,
       display_name,
       count(*) over (partition by lower(trim(display_name))) >= 3 as is_chain
from places_lookup_cache;

-- =============================================================
-- Scoring + tiering (lead-engine-spec.md §3.2, §3.3)
-- =============================================================

create or replace view v_scored as
select
  b.id                     as business_id,
  b.google_place_id,
  c.display_name,
  c.formatted_address,
  c.primary_type,
  c.rating,
  c.user_rating_count,
  c.national_phone,
  c.website_uri,
  c.photo_count,
  c.opening_hours,
  ST_Y(c.location::geometry) as lat,
  ST_X(c.location::geometry) as lng,
  v.reviews_per_30d,
  m.median_reviews_nearby,
  m.top_reviews_nearby,
  m.walk_density,
  ch.is_chain,
  b.corridor,
  b.stage,
  b.do_not_contact,

  least(coalesce(v.reviews_per_30d,0) / 10.0, 1.0)                as s_volume,
  least(greatest(coalesce(m.median_reviews_nearby,0)
                 - c.user_rating_count, 0) / 150.0, 1.0)          as s_gap,
  case
    when c.primary_type in ('barber_shop','nail_salon','hair_salon',
                            'cafe','coffee_shop','restaurant',
                            'car_repair','spa')                   then 1.00
    when c.primary_type in ('bakery','bar','massage','pet_store',
                            'cell_phone_store','tattoo_parlor')   then 0.75
    when c.primary_type in ('laundry','car_wash','ice_cream_shop',
                            'florist','chiropractor','dentist',
                            'veterinary_care')                    then 0.50
    else 0.25
  end                                                             as s_category,
  case
    when c.rating >= 4.6 then 1.00
    when c.rating >= 4.3 then 0.85
    when c.rating >= 4.0 then 0.60
    else 0.0
  end                                                             as s_rating,
  case
    when c.user_rating_count between 20 and 150 then 1.00
    when c.user_rating_count between 8  and 19  then 0.70
    when c.user_rating_count between 151 and 400 then 0.55
    when c.user_rating_count > 400 then 0.25
    else 0.10
  end                                                             as s_headroom,
  least(coalesce(m.walk_density,0) / 8.0, 1.0)                    as s_density,
  (case when c.website_uri is null then 0.4 else 0.0 end
   + case when coalesce(c.photo_count,0) < 10 then 0.4 else 0.0 end
   + case when c.opening_hours is null then 0.2 else 0.0 end)     as s_profile_gap

from businesses b
join places_lookup_cache c on c.google_place_id = b.google_place_id
left join v_velocity     v  on v.google_place_id  = c.google_place_id
left join v_local_median m  on m.google_place_id  = c.google_place_id
left join v_chain_flag   ch on ch.google_place_id = c.google_place_id
where c.business_status = 'OPERATIONAL'
  and b.do_not_contact = false;

create or replace view v_prospects_ranked as
select
  *,
  round(
      25 * s_volume
    + 20 * s_gap
    + 15 * s_category
    + 15 * s_rating
    + 10 * s_headroom
    +  8 * s_density
    +  7 * s_profile_gap
  )::int as score,

  case
    when rating is null or rating < 3.5
      or is_chain
      or s_category <= 0.25                                    then 'D'
    when rating >= 4.2 and user_rating_count > 150             then 'B'
    when rating >= 4.0
     and user_rating_count between 20 and 150
     and coalesce(reviews_per_30d, 2) >= 1.5                   then 'A'
    when rating >= 3.5                                         then 'C'
    else 'D'
  end as tier
from v_scored;

create or replace function refresh_tiers()
returns void language sql as $$
  update businesses b
     set tier          = r.tier,
         rank_score    = r.score,
         traffic_score = r.reviews_per_30d
    from v_prospects_ranked r
   where r.google_place_id = b.google_place_id;
$$;

-- =============================================================
-- The call list (lead-engine-spec.md §6)
-- =============================================================

create or replace view v_call_list as
select
  r.display_name,
  r.national_phone,
  r.formatted_address,
  r.primary_type,
  r.tier,
  r.score,
  r.rating,
  r.user_rating_count,
  r.median_reviews_nearby   as local_median,
  r.top_reviews_nearby      as local_leader,
  r.reviews_per_30d,
  ct.name                   as contact_name,
  r.corridor,
  r.lat, r.lng,
  format('%s reviews vs %s nearby leader',
         r.user_rating_count, r.top_reviews_nearby) as pitch_hook
from v_prospects_ranked r
join businesses b on b.id = r.business_id
left join lateral (
  select name from contacts c
   where c.business_id = r.business_id and c.name is not null
   order by verified_at desc nulls last limit 1
) ct on true
where r.tier in ('A','B')
  and r.national_phone is not null
  and b.stage in ('scraped', 'qualified')
  and b.do_not_contact = false
  and not exists (
    select 1 from activities a
     where a.business_id = r.business_id
       and a.type        = 'pre_call'
       and a.created_at  > now() - interval '14 days'
  )
order by r.corridor, r.score desc;

create or replace function field_list(lng float8, lat float8, radius float8 default 1600)
returns table (
  name text, addr text, tier char(1), score int,
  rating numeric, reviews int, contact_name text,
  dm_days text[], dm_window text, meters int
) language sql as $$
  select
    r.display_name,
    r.formatted_address,
    r.tier,
    r.score,
    r.rating,
    r.user_rating_count,
    ct.name,
    ct.dm_days,
    ct.dm_window,
    ST_Distance(
      ST_MakePoint(r.lng, r.lat)::geography,
      ST_MakePoint(lng, lat)::geography
    )::int
  from v_prospects_ranked r
  join businesses b on b.id = r.business_id
  left join lateral (
    select name, dm_days, dm_window
      from contacts c
     where c.business_id = r.business_id
     order by verified_at desc nulls last limit 1
  ) ct on true
  where r.tier in ('A','B')
    and b.stage in ('scraped', 'qualified', 'pre_called')
    and b.do_not_contact = false
    and (b.claimed_by is null or b.claimed_until < now())
    and ST_DWithin(
          ST_MakePoint(r.lng, r.lat)::geography,
          ST_MakePoint(lng, lat)::geography,
          radius)
  order by 10 asc;
$$;
