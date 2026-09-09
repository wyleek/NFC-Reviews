-- ============================================================================
-- Foundation spine: multi-tenant data model for the new customer-facing
-- dashboard app (separate from the internal CRM/ops hub, same Supabase
-- project). See docs/BRANCH_BRIEF-foundation.md for the full spec and the
-- deviations from the original session doc noted below.
--
-- Deviations from the original foundation spec (see BRANCH_BRIEF for why):
--   - `review_snapshots` already exists (business-scoped daily CRM snapshot,
--     populated by functions/sync-reviews). The new org/place-scoped
--     snapshot table here is named `place_review_snapshots` instead.
--   - `locations.business_id` is a real FK to the existing `businesses`
--     table (the CRM's internal "physical business" record) — `locations`
--     is the new client-tenant entity, `businesses` stays staff-only.
--   - `oauth_staging` is new, not in the original spec: a short-lived,
--     service-role-only handoff between the OAuth callback (a server
--     redirect target with no user session) and the picker page the owner
--     sees in-browser, so the callback can "stage" locations instead of
--     silently writing locations[0].
-- ============================================================================

-- Tenants
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Who belongs to which tenant (client-side users only; internal staff use
-- the service role / ADMIN_TOKEN, same as the rest of this repo).
create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- A connected GBP location. `business_id` optionally links back to the
-- CRM's existing `businesses` row for the same physical business (staff
-- side); nothing here requires that link to exist.
create table locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_id uuid references businesses(id) on delete set null,
  gbp_account_name text,                  -- accounts/{accountId}
  gbp_location_name text unique,          -- accounts/{accountId}/locations/{locationId}
  place_id text,
  display_name text,
  connected_at timestamptz,
  first_synced_at timestamptz,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'syncing', 'ok', 'error')),
  created_at timestamptz not null default now()
);

-- GBP OAuth, per connected Google account (per org). Never exposed to the
-- client — service role only, see 20260908120100_foundation_rls.sql.
create table oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  google_sub text not null,               -- GBP accounts.list account id (no OIDC scope requested)
  access_token text,
  refresh_token text not null,
  scope text not null,
  expiry timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, google_sub)
);

-- Short-lived handoff between gbp-oauth-callback (a Google redirect target,
-- no user session) and the picker page the owner sees in-browser. Rows are
-- deleted by gbp-locations-connect once consumed, and are meaningless after
-- `expires_at` regardless. Service role only.
create table oauth_staging (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  payload jsonb not null,                 -- staged { accountName, locations: [...] }
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

-- Owner's review-update channel choice. Live in this branch (Settings tab).
create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  review_updates_channel text not null default 'dashboard'
    check (review_updates_channel in ('text', 'dashboard', 'both')),
  phone_e164 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Synced reviews (full history) — the heartbeat every warm module reads.
-- Distinct from the CRM's `review_snapshots` (aggregate count only); this
-- is individual review rows sourced from the GBP API.
create table reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  gbp_review_id text not null unique,
  author_name text,
  author_photo_url text,
  star_rating int check (star_rating between 1 and 5),
  comment text,
  create_time timestamptz,
  update_time timestamptz,
  reply_comment text,
  reply_update_time timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);
create index on reviews (location_id, create_time desc);

-- Review-count snapshots (client, competitors, cold prospects) keyed by
-- Google place id — powers velocity (Module E). Named `place_review_snapshots`
-- to avoid colliding with the existing CRM `review_snapshots` table (see
-- header note). Not tenant data → service-role only, no client policy.
create table place_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  place_id text not null,
  location_id uuid references locations(id) on delete set null,
  snapshot_at timestamptz not null default now(),
  total_count int,
  avg_rating numeric(2, 1),
  source text not null default 'scrape' check (source in ('scrape', 'gbp'))
);
create index on place_review_snapshots (place_id, snapshot_at desc);
