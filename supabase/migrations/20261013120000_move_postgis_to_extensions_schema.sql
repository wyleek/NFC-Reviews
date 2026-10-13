-- Moves PostGIS out of `public` and into Supabase's `extensions` schema.
--
-- Why: `create extension postgis` (20260817120000_crm_data_model.sql) put
-- the extension's `spatial_ref_sys` table in `public`, where PostgREST
-- exposes it. It has no RLS and can't get any — the table is owned by
-- supabase_admin, so `alter table ... enable row level security` and
-- `revoke` both fail/no-op for us. anon/authenticated could insert, update
-- or delete coordinate-system rows and break every ST_* distance calc.
-- Supabase's documented fix is to reinstall PostGIS into `extensions`.
--
-- PostGIS can't be relocated with `alter extension ... set schema`, so this
-- drops and recreates it. Everything outside the extension that depends on
-- it (checked against pg_depend on the live DB, 2026-10-13):
--   * places_lookup_cache.location  — generated column + gist index
--   * v_local_median, v_scored      — call st_dwithin / st_x / st_y
--   * v_prospects_ranked, v_call_list — built on v_scored
--   * field_list()                  — calls ST_* with search_path pinned
--                                     to public, so it must add extensions
-- Views are recreated verbatim from pg_get_viewdef on the live DB (main's
-- schema.sql copies are stale). No CASCADE anywhere: if something else
-- turns out to depend on PostGIS, the migration fails and rolls back rather
-- than silently dropping it.
--
-- places_lookup_cache.location is regenerated from lat/lng, so no data is
-- lost. The column moves to the end of the table; nothing inserts into this
-- table positionally.

-- 1. Drop dependents, top of the view stack first.
drop view if exists public.v_call_list;
drop view if exists public.v_prospects_ranked;
drop view if exists public.v_scored;
drop view if exists public.v_local_median;

alter table public.places_lookup_cache drop column location;  -- also drops idx_places_lookup_cache_loc

-- 2. Reinstall PostGIS in `extensions`.
drop extension postgis;
create extension postgis with schema extensions;

-- 3. Restore the column and its index.
alter table public.places_lookup_cache
  add column location extensions.geography(point, 4326)
  generated always as (
    extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
  ) stored;

create index if not exists idx_places_lookup_cache_loc
  on public.places_lookup_cache using gist (location);

-- 4. Recreate the views exactly as they were (security_invoker kept).
create view public.v_local_median with (security_invoker = true) as
 SELECT p.google_place_id,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (n.user_rating_count::double precision)) FILTER (WHERE n.google_place_id <> p.google_place_id) AS median_reviews_nearby,
    max(n.user_rating_count) FILTER (WHERE n.google_place_id <> p.google_place_id) AS top_reviews_nearby,
    count(*) FILTER (WHERE n.google_place_id <> p.google_place_id AND extensions.st_dwithin(p.location, n.location, 150::double precision)) AS walk_density
   FROM places_lookup_cache p
     JOIN places_lookup_cache n ON n.primary_type = p.primary_type AND extensions.st_dwithin(p.location, n.location, 1609::double precision)
  GROUP BY p.google_place_id;

create view public.v_scored with (security_invoker = true) as
 SELECT b.id AS business_id,
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
    extensions.st_y(c.location::extensions.geometry) AS lat,
    extensions.st_x(c.location::extensions.geometry) AS lng,
    v.reviews_per_30d,
    m.median_reviews_nearby,
    m.top_reviews_nearby,
    m.walk_density,
    ch.is_chain,
    b.corridor,
    b.stage,
    b.do_not_contact,
    LEAST(COALESCE(v.reviews_per_30d, 0::numeric) / 10.0, 1.0) AS s_volume,
    LEAST(GREATEST(COALESCE(m.median_reviews_nearby, 0::double precision) - c.user_rating_count::double precision, 0::double precision) / 150.0::double precision, 1.0::double precision) AS s_gap,
        CASE
            WHEN c.primary_type = ANY (ARRAY['barber_shop'::text, 'nail_salon'::text, 'hair_salon'::text, 'cafe'::text, 'coffee_shop'::text, 'restaurant'::text, 'car_repair'::text, 'spa'::text]) THEN 1.00
            WHEN c.primary_type = ANY (ARRAY['bakery'::text, 'bar'::text, 'massage'::text, 'pet_store'::text, 'cell_phone_store'::text, 'tattoo_parlor'::text]) THEN 0.75
            WHEN c.primary_type = ANY (ARRAY['laundry'::text, 'car_wash'::text, 'ice_cream_shop'::text, 'florist'::text, 'chiropractor'::text, 'dentist'::text, 'veterinary_care'::text]) THEN 0.50
            ELSE 0.25
        END AS s_category,
        CASE
            WHEN c.rating >= 4.6 THEN 1.00
            WHEN c.rating >= 4.3 THEN 0.85
            WHEN c.rating >= 4.0 THEN 0.60
            ELSE 0.0
        END AS s_rating,
        CASE
            WHEN c.user_rating_count >= 20 AND c.user_rating_count <= 150 THEN 1.00
            WHEN c.user_rating_count >= 8 AND c.user_rating_count <= 19 THEN 0.70
            WHEN c.user_rating_count >= 151 AND c.user_rating_count <= 400 THEN 0.55
            WHEN c.user_rating_count > 400 THEN 0.25
            ELSE 0.10
        END AS s_headroom,
    LEAST(COALESCE(m.walk_density, 0::bigint)::numeric / 8.0, 1.0) AS s_density,
        CASE
            WHEN c.website_uri IS NULL THEN 0.4
            ELSE 0.0
        END +
        CASE
            WHEN COALESCE(c.photo_count, 0) < 10 THEN 0.4
            ELSE 0.0
        END +
        CASE
            WHEN c.opening_hours IS NULL THEN 0.2
            ELSE 0.0
        END AS s_profile_gap
   FROM businesses b
     JOIN places_lookup_cache c ON c.google_place_id = b.google_place_id
     LEFT JOIN v_velocity v ON v.google_place_id = c.google_place_id
     LEFT JOIN v_local_median m ON m.google_place_id = c.google_place_id
     LEFT JOIN v_chain_flag ch ON ch.google_place_id = c.google_place_id
  WHERE c.business_status = 'OPERATIONAL'::text AND b.do_not_contact = false;

create view public.v_prospects_ranked with (security_invoker = true) as
 SELECT business_id,
    google_place_id,
    display_name,
    formatted_address,
    primary_type,
    rating,
    user_rating_count,
    national_phone,
    website_uri,
    photo_count,
    opening_hours,
    lat,
    lng,
    reviews_per_30d,
    median_reviews_nearby,
    top_reviews_nearby,
    walk_density,
    is_chain,
    corridor,
    stage,
    do_not_contact,
    s_volume,
    s_gap,
    s_category,
    s_rating,
    s_headroom,
    s_density,
    s_profile_gap,
    round((25::numeric * s_volume)::double precision + 20::double precision * s_gap + (15::numeric * s_category)::double precision + (15::numeric * s_rating)::double precision + (10::numeric * s_headroom)::double precision + (8::numeric * s_density)::double precision + (7::numeric * s_profile_gap)::double precision)::integer AS score,
        CASE
            WHEN rating IS NULL OR rating < 3.5 OR is_chain OR s_category <= 0.25 THEN 'D'::text
            WHEN rating >= 4.2 AND user_rating_count > 150 THEN 'B'::text
            WHEN rating >= 4.0 AND user_rating_count >= 20 AND user_rating_count <= 150 AND COALESCE(reviews_per_30d, 2::numeric) >= 1.5 THEN 'A'::text
            WHEN rating >= 3.5 THEN 'C'::text
            ELSE 'D'::text
        END AS tier
   FROM v_scored;

create view public.v_call_list with (security_invoker = true) as
 SELECT r.display_name,
    r.national_phone,
    r.formatted_address,
    r.primary_type,
    r.tier,
    r.score,
    r.rating,
    r.user_rating_count,
    r.median_reviews_nearby AS local_median,
    r.top_reviews_nearby AS local_leader,
    r.reviews_per_30d,
    ct.name AS contact_name,
    r.corridor,
    r.lat,
    r.lng,
    format('%s reviews vs %s nearby leader'::text, r.user_rating_count, r.top_reviews_nearby) AS pitch_hook,
    r.business_id,
    r.google_place_id
   FROM v_prospects_ranked r
     JOIN businesses b ON b.id = r.business_id
     LEFT JOIN LATERAL ( SELECT c.name
           FROM contacts c
          WHERE c.business_id = r.business_id AND c.name IS NOT NULL
          ORDER BY c.verified_at DESC NULLS LAST
         LIMIT 1) ct ON true
  WHERE (r.tier = ANY (ARRAY['A'::text, 'B'::text])) AND r.national_phone IS NOT NULL AND (b.stage = ANY (ARRAY['scraped'::business_stage, 'qualified'::business_stage])) AND b.do_not_contact = false AND NOT (EXISTS ( SELECT 1
           FROM activities a
          WHERE a.business_id = r.business_id AND a.type = 'pre_call'::activity_type AND a.created_at > (now() - '14 days'::interval)))
  ORDER BY r.corridor, r.score DESC;

-- Same grants the views had before (Supabase defaults).
grant all on public.v_local_median, public.v_scored, public.v_prospects_ranked, public.v_call_list
  to anon, authenticated, service_role;

-- 5. field_list() pins search_path to public; let it find ST_* in extensions.
alter function public.field_list(double precision, double precision, double precision)
  set search_path = public, extensions, pg_temp;
