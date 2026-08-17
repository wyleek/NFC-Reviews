-- =============================================================
-- Tap2Review — Lead Engine Schema
-- =============================================================
-- ARCHITECTURE NOTE
-- Two layers, deliberately separated:
--
--   DURABLE  : place_id + data you created or sourced yourself.
--              Kept forever. Not Google Maps Content.
--   EPHEMERAL: everything sourced from the Places API.
--              30-day TTL, auto-purged. Refetched on refresh.
--
-- Never join ephemeral data into a permanent report or export
-- that outlives the TTL. Derived scores live with the ephemeral
-- layer and are recomputed on each refresh.
-- =============================================================

create extension if not exists postgis;
create extension if not exists pg_cron;

-- =============================================================
-- 1. DURABLE LAYER
-- =============================================================

create table if not exists prospects (
  place_id          text primary key,              -- storable indefinitely
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),

  -- your own classification (recomputed, but yours)
  category_group    text,                          -- 's','a','b','c','skip'
  tier              char(1),                       -- A / B / C / D
  score             int,

  -- pipeline state
  status            text not null default 'unvisited',
    -- unvisited | called | visited | dm_absent | trial_placed
    -- | customer | not_interested | dead
  do_not_contact    boolean not null default false,

  -- territory locking (multi-rep)
  claimed_by        uuid,
  claimed_until     timestamptz,

  -- corridor / route grouping (your own label, not Google's)
  corridor          text
);

create index if not exists prospects_status_idx   on prospects(status);
create index if not exists prospects_tier_idx     on prospects(tier);
create index if not exists prospects_corridor_idx on prospects(corridor);


-- Contact info YOU collected: phone calls, walk-ins, the business's
-- own website, state registry. Not Google Content -> keep forever.
create table if not exists contacts (
  id             bigserial primary key,
  place_id       text not null references prospects(place_id) on delete cascade,
  business_name  text,          -- as you recorded it, from your own notes
  owner_name     text,
  owner_title    text,
  phone          text,
  email          text,
  source         text not null, -- 'phone_call' | 'website' | 'sdat' | 'walk_in'
  dm_days        text[],        -- e.g. '{tue,wed,thu}'
  dm_window      text,          -- e.g. '10:00-14:00'
  verified_at    timestamptz default now(),
  notes          text
);

create index if not exists contacts_place_idx on contacts(place_id);


-- Every touch. Your data, forever.
create table if not exists visits (
  id            bigserial primary key,
  place_id      text not null references prospects(place_id) on delete cascade,
  rep_id        uuid,
  occurred_at   timestamptz not null default now(),
  channel       text not null,   -- 'precall' | 'walk_in' | 'phone' | 'text' | 'email'
  outcome       text not null,
    -- dm_absent | pitched_no | pitched_maybe | trial_placed
    -- | sold | disqualified | dnc
  objection     text,
  next_action   text,
  next_action_at timestamptz,
  notes         text
);

create index if not exists visits_place_idx on visits(place_id, occurred_at desc);


-- =============================================================
-- 2. EPHEMERAL LAYER  (Google Places content — 30 day TTL)
-- =============================================================

create table if not exists places_cache (
  place_id            text primary key references prospects(place_id) on delete cascade,
  fetched_at          timestamptz not null default now(),
  expires_at          timestamptz not null
                        generated always as (fetched_at + interval '30 days') stored,

  display_name        text,
  formatted_address   text,
  lat                 double precision,
  lng                 double precision,
  -- derived from lat/lng so the client inserts plain floats, never WKT.
  -- if your PostGIS build rejects this cast in a generated column,
  -- drop the GENERATED clause and use the trigger at the bottom of §2.
  location            geography(point, 4326)
                        generated always as (
                          ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
                        ) stored,
  primary_type        text,
  types               text[],
  rating              numeric(2,1),
  user_rating_count   int,
  price_level         text,
  business_status     text,
  national_phone      text,
  website_uri         text,
  photo_count         int,
  opening_hours       jsonb
);

create index if not exists places_cache_loc_idx     on places_cache using gist(location);
create index if not exists places_cache_expires_idx on places_cache(expires_at);
create index if not exists places_cache_rating_idx  on places_cache(rating, user_rating_count);

-- FALLBACK ONLY — if the generated `location` column above errors on
-- your PostGIS version, remove the GENERATED clause (make it plain
-- `location geography(point,4326)`) and use this trigger instead:
--
-- create or replace function set_location() returns trigger
-- language plpgsql as $$
-- begin
--   new.location := ST_SetSRID(ST_MakePoint(new.lng, new.lat),4326)::geography;
--   return new;
-- end $$;
-- create trigger trg_set_location before insert or update on places_cache
--   for each row execute function set_location();


-- Velocity needs two observations. Also ephemeral: purge on the
-- same 30-day clock, recompute each refresh cycle.
create table if not exists rating_observations (
  id                bigserial primary key,
  place_id          text not null references prospects(place_id) on delete cascade,
  observed_at       timestamptz not null default now(),
  rating            numeric(2,1),
  user_rating_count int,
  unique (place_id, observed_at)
);

create index if not exists rating_obs_idx on rating_observations(place_id, observed_at desc);


-- =============================================================
-- 3. TTL PURGE  — run nightly. This is the compliance mechanism.
-- =============================================================

create or replace function purge_expired_google_data()
returns void language plpgsql as $$
begin
  delete from places_cache        where expires_at < now();
  delete from rating_observations where observed_at < now() - interval '30 days';
end;
$$;

-- schedule (Supabase: pg_cron)
-- select cron.schedule('purge-google-cache','0 3 * * *',
--                      $$select purge_expired_google_data()$$);


-- =============================================================
-- 4. DERIVED METRICS
-- =============================================================

-- Review velocity: reviews gained per 30 days, from the two most
-- recent observations at least 7 days apart.
create or replace view v_velocity as
with paired as (
  select
    o.place_id,
    o.user_rating_count                                    as new_count,
    o.observed_at                                          as new_at,
    lag(o.user_rating_count) over w                        as old_count,
    lag(o.observed_at)       over w                        as old_at,
    row_number()             over (partition by o.place_id
                                   order by o.observed_at desc) as rn
  from rating_observations o
  window w as (partition by o.place_id order by o.observed_at)
)
select
  place_id,
  case
    when old_at is null then null
    when extract(epoch from (new_at - old_at)) < 604800 then null  -- <7 days
    else round(
      (new_count - old_count)::numeric
      / (extract(epoch from (new_at - old_at)) / 86400.0)
      * 30.0, 2)
  end as reviews_per_30d
from paired
where rn = 1;


-- Local category median: the number behind your opening pitch line.
create or replace view v_local_median as
select
  p.place_id,
  percentile_cont(0.5) within group (order by n.user_rating_count)
    filter (where n.place_id <> p.place_id)          as median_reviews_nearby,
  max(n.user_rating_count)
    filter (where n.place_id <> p.place_id)          as top_reviews_nearby,
  count(*) filter (where n.place_id <> p.place_id
                     and ST_DWithin(p.location, n.location, 150)) as walk_density
from places_cache p
join places_cache n
  on n.primary_type = p.primary_type
 and ST_DWithin(p.location, n.location, 1609)        -- 1 mile
group by p.place_id;


-- Chain detection: same name 3+ times in the working set.
create or replace view v_chain_flag as
select place_id,
       display_name,
       count(*) over (partition by lower(trim(display_name))) >= 3 as is_chain
from places_cache;


-- =============================================================
-- 5. SCORING + TIERING
-- =============================================================

create or replace view v_scored as
select
  c.place_id,
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
  pr.corridor,
  pr.status,
  pr.do_not_contact,

  -- ---- component scores, 0..1 ----
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
  -- non-monotonic: peaks 20-150 reviews (where the TRIAL works)
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

from places_cache c
join prospects   pr on pr.place_id = c.place_id
left join v_velocity     v  on v.place_id  = c.place_id
left join v_local_median m  on m.place_id  = c.place_id
left join v_chain_flag   ch on ch.place_id = c.place_id
where c.business_status = 'OPERATIONAL'
  and pr.do_not_contact = false;


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


-- Write tier/score back to the durable layer so pipeline history
-- survives the cache purge.
create or replace function refresh_tiers()
returns void language sql as $$
  update prospects p
     set tier  = r.tier,
         score = r.score,
         last_seen = now()
    from v_prospects_ranked r
   where r.place_id = p.place_id;
$$;


-- =============================================================
-- 6. THE CALL LIST  — tomorrow's pre-call block
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
  ct.owner_name,
  r.corridor,
  r.lat, r.lng,
  -- the pitch line, precomputed
  format('%s reviews vs %s nearby leader',
         r.user_rating_count, r.top_reviews_nearby) as pitch_hook
from v_prospects_ranked r
join prospects pr on pr.place_id = r.place_id
left join lateral (
  select owner_name from contacts c
   where c.place_id = r.place_id and owner_name is not null
   order by verified_at desc limit 1
) ct on true
where r.tier in ('A','B')
  and r.national_phone is not null
  and pr.status in ('unvisited','dm_absent')
  and pr.do_not_contact = false
  and not exists (
    select 1 from visits v
     where v.place_id = r.place_id
       and v.channel  = 'precall'
       and v.occurred_at > now() - interval '14 days'
  )
order by r.corridor, r.score desc;


-- Field list: walk order, nearest-first from where you're standing.
-- Params: $1 = lng, $2 = lat, $3 = radius meters
create or replace function field_list(lng float8, lat float8, radius float8 default 1600)
returns table (
  name text, addr text, tier char(1), score int,
  rating numeric, reviews int, owner text,
  dm_days text[], dm_window text, meters int
) language sql as $$
  select
    r.display_name,
    r.formatted_address,
    r.tier,
    r.score,
    r.rating,
    r.user_rating_count,
    ct.owner_name,
    ct.dm_days,
    ct.dm_window,
    ST_Distance(
      ST_MakePoint(r.lng, r.lat)::geography,
      ST_MakePoint(lng, lat)::geography
    )::int
  from v_prospects_ranked r
  join prospects pr on pr.place_id = r.place_id
  left join lateral (
    select owner_name, dm_days, dm_window
      from contacts c
     where c.place_id = r.place_id
     order by verified_at desc limit 1
  ) ct on true
  where r.tier in ('A','B')
    and pr.status in ('unvisited','called','dm_absent')
    and pr.do_not_contact = false
    and (pr.claimed_by is null or pr.claimed_until < now())
    and ST_DWithin(
          ST_MakePoint(r.lng, r.lat)::geography,
          ST_MakePoint(lng, lat)::geography,
          radius)
  order by 10 asc;
$$;
