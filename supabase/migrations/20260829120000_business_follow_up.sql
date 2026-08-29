-- Structured follow-up date/time for a business — distinct from the free-text
-- best_callback_window ("mornings before 10") and from the "rescheduled"
-- stage (which only says the business needs a callback, not when). Set from
-- BusinessDrawer, surfaced on CallList so a specific commitment ("call back
-- Thursday 2pm") doesn't get lost in the general call-list ordering.
alter table businesses add column follow_up_at timestamptz;

comment on column businesses.follow_up_at is
  'When to call this business back next, set manually from the CRM drawer. Null = no follow-up scheduled.';
