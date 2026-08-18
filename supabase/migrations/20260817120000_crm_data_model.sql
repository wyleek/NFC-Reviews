-- =============================================================
-- Tap2Review — CRM data model migration
-- Branch: feature/crm-data-model
-- =============================================================
-- Reconciles crm-spec.md and lead-engine-spec.md, per docs/PLAN.md's
-- conflict resolution: ONE MASTER RECORD PER BUSINESS.
--
--   * businesses gains a pipeline `stage` enum (crm-spec.md) plus the
--     durable fields that used to live on the standalone `prospects`
--     table (lead-engine-spec.md) — a scraped lead is now a
--     `businesses` row with stage='scraped' from day one.
--   * contacts becomes a single business_id-keyed schema, folding in
--     dm_days/dm_window/source from the lead-engine's contacts design.
--   * activities / deals / scheduled_messages are added per
--     crm-spec.md TASK 1.
--   * prospects / places_cache / rating_observations (root
--     schema.sql) are retired. Their durable columns are folded into
--     businesses/contacts; their Google-Places-sourced fields move to
--     a new, narrowly-scoped `places_lookup_cache` — still a 30-day
--     TTL, per the ToS split lead-engine-spec.md §0 lays out. Rating /
--     review-count for scraped-but-unsold businesses stay in that
--     ephemeral cache, never on the permanent `businesses` row.
--   * `visits` (the lead-engine's own touch log) folds into
--     `activities`, since crm-spec's activities table is the same
--     concept, unified — not called out by name in BRANCH_BRIEF.md,
--     but left in place it would dangle on a dropped `prospects` FK.
--
-- ASSUMES the core schema (businesses, cards, taps, review_snapshots,
-- contacts, competitors, competitor_snapshots — from
-- tap2review-backend.zip's schema.sql) is already applied.
-- schema-competitors.sql is untouched — separate branch.
--
-- The scoring/tiering views (v_scored, v_prospects_ranked,
-- v_call_list, field_list()) are NOT ported forward. Rebuilding lead
-- scoring against the unified schema is out of scope here.
--
-- DESTRUCTIVE: this drops prospects/places_cache/rating_observations/
-- visits after migrating their data (guarded — no-ops if this
-- database never had the old lead-engine schema applied). Back up
-- (pg_dump) before running against a database with real scraped data.
-- =============================================================

create extension if not exists "pgcrypto";
create extension if not exists postgis;
create extension if not exists pg_cron;


-- =============================================================
-- 1. businesses — stage enum + pipeline/durable columns
-- =============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'business_stage') then
    create type business_stage as enum (
      'scraped', 'qualified', 'pre_called', 'visit_planned', 'rescheduled',
      'sale_hardware', 'trial_active', 'won', 'lost', 'customer', 'churned'
    );
  end if;
end $$;

alter table businesses
  add column if not exists stage               business_stage not null default 'scraped',
  add column if not exists stage_updated_at     timestamptz not null default now(),
  add column if not exists best_callback_window text,
  add column if not exists sms_consent          boolean not null default false,
  add column if not exists sms_consent_at       timestamptz,
  add column if not exists rank_score           numeric,
  add column if not exists traffic_score        numeric,
  -- folded in from the retired `prospects` durable layer (lead-engine-spec.md §0):
  add column if not exists category_group       text,      -- 's' | 'a' | 'b' | 'c' | 'skip'
  add column if not exists tier                 char(1),   -- routing tier A-D, lead-engine-spec.md §3.3
  add column if not exists do_not_contact       boolean not null default false,
  add column if not exists corridor             text,
  add column if not exists claimed_by           uuid,
  add column if not exists claimed_until        timestamptz,
  add column if not exists first_scraped_at     timestamptz,
  add column if not exists last_scraped_at      timestamptz;

-- lets scrape_prospects.py upsert on google_place_id. Partial (nulls
-- allowed) since manually-created businesses may have no place_id.
create unique index if not exists ux_businesses_google_place_id
  on businesses (google_place_id) where google_place_id is not null;

create index if not exists idx_businesses_stage    on businesses(stage);
create index if not exists idx_businesses_corridor on businesses(corridor);

-- Backfill for pre-migration rows. The only path into `businesses`
-- before this migration was admin-api's "create business" flow, so
-- anything with a card is a real onboarded customer, not a lead.
-- Bare rows with no card yet are left at the column default
-- ('scraped') rather than presumed to be customers.
update businesses
   set stage = 'customer',
       stage_updated_at = now()
 where stage = 'scraped'
   and id in (select distinct business_id from cards);


-- =============================================================
-- 2. contacts — unify the two conflicting designs into one
--    business_id-keyed schema
-- =============================================================

do $$
declare
  has_place_id boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'contacts'
       and column_name = 'place_id'
  ) into has_place_id;

  if has_place_id then
    -- What's here is the OLD lead-engine `contacts` (place_id-keyed),
    -- not the core one. Move it aside; its rows are migrated into the
    -- unified table in §6 below, then it's dropped in §7.
    execute 'alter table contacts rename to contacts_legacy_place_id';
  end if;
end $$;

-- Core-shaped contacts (tap2review-backend.zip's schema.sql), created
-- here in case this database doesn't have it yet.
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

-- Fold in dm_days / dm_window / source from the lead-engine's design.
-- verified_at rides along with dm_days/dm_window — without it there's
-- no way to tell a fresh pre-call answer from a stale one.
alter table contacts
  add column if not exists dm_days     text[],
  add column if not exists dm_window   text,
  add column if not exists verified_at timestamptz,
  add column if not exists source      text;

update contacts set source = 'sale' where source is null;
alter table contacts alter column source set default 'sale';
alter table contacts alter column source set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_source_check') then
    alter table contacts add constraint contacts_source_check
      check (source in ('sale', 'phone_call', 'website', 'sdat', 'walk_in'));
  end if;
end $$;


-- =============================================================
-- 3. activities / deals / scheduled_messages (crm-spec.md TASK 1)
-- =============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_type') then
    create type activity_type as enum (
      'pre_call', 'visit', 'outcome', 'text_sent', 'review_milestone', 'note'
    );
  end if;
end $$;

-- append-only touch log — bigint identity, matching the house style
-- for event-log tables (taps, review_snapshots), not entity tables.
create table if not exists activities (
  id          bigint generated always as identity primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  type        activity_type not null,
  body        text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_activities_business_created
  on activities(business_id, created_at desc);

alter table activities enable row level security;


do $$
begin
  if not exists (select 1 from pg_type where typname = 'deal_status') then
    create type deal_status as enum ('open', 'won', 'lost');
  end if;
end $$;

create table if not exists deals (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_sku text,
  amount      numeric,
  is_trial    boolean not null default false,
  trial_start date,
  trial_end   date,
  status      deal_status not null default 'open',
  created_at  timestamptz not null default now()
);

create index if not exists idx_deals_business on deals(business_id);

alter table deals enable row level security;


do $$
begin
  if not exists (select 1 from pg_type where typname = 'message_status') then
    create type message_status as enum ('pending', 'sent', 'failed', 'stopped');
  end if;
end $$;

create table if not exists scheduled_messages (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  body         text not null,
  send_at      timestamptz not null,
  status       message_status not null default 'pending',
  provider_sid text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create index if not exists idx_scheduled_messages_status_send
  on scheduled_messages(status, send_at);
create index if not exists idx_scheduled_messages_business
  on scheduled_messages(business_id);

alter table scheduled_messages enable row level security;


-- =============================================================
-- 4. places_lookup_cache — ephemeral, Places-sourced fields ONLY.
--    30-day TTL per Google Maps Platform ToS (lead-engine-spec.md §0).
--    Nothing in here is ever joined into a permanent report/export
--    that outlives the TTL.
-- =============================================================

create table if not exists places_lookup_cache (
  google_place_id   text primary key,
  fetched_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 days'),

  display_name      text,
  formatted_address text,
  lat               double precision,
  lng               double precision,
  -- derived from lat/lng so callers insert plain floats, never WKT.
  -- if your PostGIS build rejects this cast in a generated column,
  -- drop the GENERATED clause and set `location` via a BEFORE trigger
  -- instead (see root schema.sql's old fallback comment for the shape).
  location          geography(point, 4326)
                       generated always as (
                         ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
                       ) stored,
  primary_type      text,
  types             text[],
  rating            numeric(2,1),
  user_rating_count int,
  price_level       text,
  business_status   text,
  national_phone    text,
  website_uri       text,
  photo_count       int,
  opening_hours     jsonb
);

create index if not exists idx_places_lookup_cache_expires on places_lookup_cache(expires_at);
create index if not exists idx_places_lookup_cache_loc     on places_lookup_cache using gist(location);

alter table places_lookup_cache enable row level security;

create or replace function purge_expired_places_cache()
returns void language sql as $$
  delete from places_lookup_cache where expires_at < now();
$$;

-- schedule (Supabase: pg_cron):
-- select cron.schedule('purge-places-cache', '0 3 * * *',
--                      $$select purge_expired_places_cache()$$);


-- =============================================================
-- 5. RPC helper for scrape_prospects.py
--
-- Batch upsert into businesses, keyed on google_place_id. Never
-- regresses `stage` past 'scraped' and never overwrites a name a
-- human has since edited — a re-scrape only refreshes bookkeeping
-- (last_scraped_at/category_group/corridor), it can't undo pipeline
-- progress.
-- =============================================================

create or replace function upsert_scraped_businesses(rows jsonb)
returns setof uuid
language plpgsql
as $$
begin
  return query
  insert into businesses (
    google_place_id, name, stage, category_group, corridor,
    first_scraped_at, last_scraped_at
  )
  select
    r ->> 'google_place_id',
    coalesce(r ->> 'name', r ->> 'google_place_id'),
    'scraped'::business_stage,
    r ->> 'category_group',
    r ->> 'corridor',
    now(),
    now()
  from jsonb_array_elements(rows) as r
  on conflict (google_place_id) where google_place_id is not null do update
    set last_scraped_at = now(),
        category_group  = excluded.category_group,
        corridor        = excluded.corridor,
        name            = case when businesses.name is null or businesses.name = ''
                                then excluded.name else businesses.name end
  returning id;
end;
$$;


-- =============================================================
-- 6. Migrate legacy lead-engine data, if the old root schema.sql was
--    ever applied to this database. Fully guarded — a no-op if
--    prospects/places_cache/rating_observations/visits/the legacy
--    place_id-keyed contacts table were never created here.
-- =============================================================

do $$
begin
  if to_regclass('public.prospects') is not null then

    -- 6a. prospects -> businesses (stage='scraped', durable fields folded in)
    insert into businesses (
      google_place_id, name, stage, category_group, tier, do_not_contact,
      corridor, claimed_by, claimed_until, rank_score,
      first_scraped_at, last_scraped_at
    )
    select
      p.place_id,
      coalesce(pc.display_name, p.place_id),
      'scraped'::business_stage,
      p.category_group,
      p.tier,
      p.do_not_contact,
      p.corridor,
      p.claimed_by,
      p.claimed_until,
      p.score,
      p.first_seen,
      p.last_seen
    from prospects p
    left join places_cache pc on pc.place_id = p.place_id
    where not exists (
      select 1 from businesses b where b.google_place_id = p.place_id
    );

    -- 6b. legacy place_id-keyed contacts -> unified contacts
    if to_regclass('public.contacts_legacy_place_id') is not null then
      insert into contacts (
        business_id, name, phone, email, source, dm_days, dm_window,
        verified_at, notes, created_at
      )
      select
        b.id,
        cl.owner_name,
        cl.phone,
        cl.email,
        coalesce(cl.source, 'sale'),
        cl.dm_days,
        cl.dm_window,
        cl.verified_at,
        nullif(trim(both E' \n' from
          coalesce(cl.notes, '')
          || case when cl.owner_title is not null
                  then E'\ntitle: ' || cl.owner_title else '' end
          || case when cl.business_name is not null
                  then E'\nrecorded as: ' || cl.business_name else '' end
        ), ''),
        coalesce(cl.verified_at, now())
      from contacts_legacy_place_id cl
      join businesses b on b.google_place_id = cl.place_id;
    end if;

    -- 6c. visits -> activities. Best-effort type mapping; nothing is
    --     lost — the original channel/outcome/objection/next_action
    --     are preserved verbatim in `metadata`.
    if to_regclass('public.visits') is not null then
      insert into activities (business_id, type, body, metadata, created_at)
      select
        b.id,
        (case v.channel
           when 'precall' then 'pre_call'
           when 'phone'   then 'pre_call'
           when 'walk_in' then 'visit'
           when 'text'    then 'text_sent'
           else 'note'
         end)::activity_type,
        nullif(trim(both E' \n' from
          coalesce(v.outcome, '') || case when v.notes is not null
                                           then E'\n' || v.notes else '' end
        ), ''),
        jsonb_build_object(
          'legacy_channel', v.channel,
          'legacy_outcome', v.outcome,
          'objection', v.objection,
          'next_action', v.next_action,
          'next_action_at', v.next_action_at,
          'rep_id', v.rep_id
        ),
        v.occurred_at
      from visits v
      join businesses b on b.google_place_id = v.place_id;
    end if;

  end if;
end $$;


-- =============================================================
-- 7. Retire the old lead-engine schema (root schema.sql). Views and
--    functions first (dependencies), then tables, in FK order.
-- =============================================================

drop view if exists v_call_list;
drop function if exists field_list(float8, float8, float8);
drop view if exists v_prospects_ranked;
drop view if exists v_scored;
drop view if exists v_chain_flag;
drop view if exists v_local_median;
drop view if exists v_velocity;
drop function if exists refresh_tiers();
drop function if exists purge_expired_google_data();

drop table if exists rating_observations;
drop table if exists places_cache;
drop table if exists visits;
drop table if exists contacts_legacy_place_id;
drop table if exists prospects;


-- =============================================================
-- 8. RLS — match the existing pattern (enabled, no public policies;
--    Edge Functions use the service role key and bypass RLS).
-- =============================================================

alter table businesses enable row level security;
alter table contacts   enable row level security;
