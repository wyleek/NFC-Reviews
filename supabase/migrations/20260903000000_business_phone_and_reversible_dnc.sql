-- Adds businesses.phone: the business's own general/front-line number,
-- auto-collected from Google Places by admin-api's add_lead. Kept
-- deliberately separate from contacts.phone, which is a specific person's
-- (owner/manager) direct line, entered manually — conflating the two meant
-- add_lead's auto-pulled number was overwriting whatever a field rep had
-- entered as "who to call" on the same contacts row. See admin-api's
-- add_lead/set_business_phone.
--
-- do_not_contact (20260817120000_crm_data_model.sql) already exists and is
-- exactly the flag the Call List's "Remove" button and the drawer's
-- reversible toggle need — no schema change required for that, only new
-- admin-api actions (set_do_not_contact, reset_call_schedule) that read/
-- write columns already in place.

alter table businesses
  add column if not exists phone text;

comment on column businesses.phone is
  'The business''s general/front-line number, auto-collected from Google Places (admin-api add_lead). Separate from contacts.phone, which is a specific owner/manager''s direct line — see set_business_phone.';

-- One-time backfill: every contacts row add_lead has ever written is
-- source='google_places' with a phone and nothing else identifying (no
-- name/title/email) — a pure phone-number placeholder, not a real person.
-- Move that number up to businesses.phone where it belongs and clear it off
-- the contact row, but ONLY for rows still in that pure placeholder shape —
-- a row a rep has since attached a name to (e.g. logged a pre-call and
-- learned who answers, "Maria") is no longer just a Google Places stub, so
-- its phone is left alone rather than guessed apart.
update businesses b
set phone = c.phone
from contacts c
where c.business_id = b.id
  and c.source = 'google_places'
  and c.phone is not null
  and c.name is null and c.title is null and c.email is null
  and b.phone is null;

update contacts c
set phone = null
where c.source = 'google_places'
  and c.name is null and c.title is null and c.email is null
  and exists (
    select 1 from businesses b where b.id = c.business_id and b.phone is not distinct from c.phone
  );
