-- Call List manual add + scheduling (feat/call-list-manual-add-scheduling).
--
-- 1. contacts.dm_window / dm_days let the pre-call block log "who's in and
--    roughly when" but dm_window is free text ("mornings before 10") with
--    no way to sort on it. Add a structured start/end time so the Call
--    List can sort earliest-to-latest within a day. dm_window stays as-is
--    — an optional free-text extra note going forward, no longer the
--    primary sort key.
alter table contacts
  add column if not exists dm_window_start time,
  add column if not exists dm_window_end   time;

comment on column contacts.dm_window_start is
  'Required start of the DM''s available window, e.g. 11:00. Primary sort key for the Call List (crm-spec.md / call-list-manual-add-scheduling).';
comment on column contacts.dm_window_end is
  'Optional end of the DM''s available window. Null means open-ended.';

-- 2. The new add_lead admin-api action creates a primary contact straight
--    from a Google Places quick-add (no phone call has happened yet), so
--    the existing contacts_source_check constraint (sale/phone_call/
--    website/sdat/walk_in) needs a matching value. Additive — widens the
--    allowed set, doesn't touch existing rows or values.
alter table contacts drop constraint if exists contacts_source_check;
alter table contacts add constraint contacts_source_check
  check (source in ('sale', 'phone_call', 'website', 'sdat', 'walk_in', 'google_places'));
