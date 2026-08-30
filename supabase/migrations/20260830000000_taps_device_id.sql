-- First-party device identity for tap dedup. Set from a `t2r_did` session
-- cookie the redirect function issues (or echoes back) on every tap — the
-- same mechanism GA/Plausible use. Lets the dashboard count unique visitors
-- per business per day without inflating a repeat-scanner's own stats.
-- `is_repeat` (already on the table, previously unused) is set alongside it.
alter table taps add column device_id text;

comment on column taps.device_id is
  'Value of the t2r_did first-party cookie set by the redirect function. Same device/browser => same value across taps until the cookie expires (1yr) or is cleared. Not a durable/cross-device identity.';
