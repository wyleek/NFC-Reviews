-- ============================================================================
-- Daily review sync cron job (pg_cron + pg_net).
--
-- SECURITY: replace <CRON_SECRET> below with the real value (matches the
-- CRON_SECRET Edge Function secret) before applying — never commit the real
-- secret to this file. This migration documents what's already live on the
-- project; re-running it is only needed if the job is recreated from scratch.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daily-review-sync',
  '17 8 * * *',                       -- 08:17 UTC daily; pick an off-peak minute
  $$
  select net.http_post(
    url     := 'https://ehzwsqkrmxsfdfslxmpo.functions.supabase.co/sync-reviews',
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-cron-secret', '<CRON_SECRET>'
               ),
    body    := '{}'::jsonb
  );
  $$
);
