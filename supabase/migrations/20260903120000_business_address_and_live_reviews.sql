-- Adds structured address fields to businesses, and fixes a gap where
-- newly-added businesses showed reviews/rating in the Admin search-hit
-- list (live from Google at search time) but then showed nothing once
-- picked — add_lead was creating the row with no review data at all,
-- leaving current_review_count/current_rating null until the next daily
-- sync-reviews cron run (up to 24h later). admin-api's add_lead now
-- captures rating/review count AND address/city/zip in the same Place
-- Details call it already makes for the phone number — no extra billed
-- request.
--
-- city/zip exist specifically to tell apart same-named locations of a
-- chain (e.g. multiple "Ledo Pizza" rows) once they're saved — Google's
-- search results already show a full address at pick time, but nothing
-- persisted it, so two saved rows with the same name were indistinguishable
-- everywhere else in the hub (Call List, Kanban, Clients).

alter table businesses
  add column if not exists address text,
  add column if not exists city    text,
  add column if not exists zip     text;

comment on column businesses.address is
  'Full formatted address from Google Places (admin-api add_lead), or entered manually via set_business_address.';
comment on column businesses.city is
  'Parsed from Google Places addressComponents (locality) — the main disambiguator for same-named locations of a chain.';
comment on column businesses.zip is
  'Parsed from Google Places addressComponents (postal_code).';

create index if not exists idx_businesses_city on businesses(city);
