-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md). Opens read
-- access to the lead-scoring views/table for the dashboard's anon key,
-- and redefines the views with security_invoker so RLS applies.
alter view v_velocity     set (security_invoker = true);
alter view v_local_median set (security_invoker = true);
alter view v_chain_flag   set (security_invoker = true);
grant select on v_velocity, v_local_median, v_chain_flag to anon, authenticated;

create policy "public read places_rating_observations" on places_rating_observations
  for select to anon, authenticated using (true);
grant select on places_rating_observations to anon, authenticated;

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

alter view v_scored set (security_invoker = true);


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

alter view v_prospects_ranked set (security_invoker = true);


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
         r.user_rating_count, r.top_reviews_nearby) as pitch_hook,
  r.business_id,
  r.google_place_id
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

alter view v_call_list set (security_invoker = true);

grant select on v_scored, v_prospects_ranked, v_call_list to anon, authenticated;
