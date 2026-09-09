-- ============================================================================
-- GBP review-sync cron job (pg_cron + pg_net). Mirrors the shape of the
-- existing 20260818040000_schedule_daily_review_sync.sql, but calls the new
-- gbp-review-sync function (individual review history via GBP OAuth) and
-- uses its own secret (GBP_SYNC_CRON_SECRET) — independent of the existing
-- daily-review-sync job's CRON_SECRET, since these are unrelated pipelines
-- (Places-API aggregate snapshot for CRM `businesses` vs. GBP-OAuth full
-- review history for tenant `locations`).
--
-- SECURITY: replace <GBP_SYNC_CRON_SECRET> below with the real value
-- (matches the GBP_SYNC_CRON_SECRET Edge Function secret) before applying —
-- never commit the real secret to this file.
-- ============================================================================

-- pg_cron / pg_net already enabled by 20260818040000_schedule_daily_review_sync.sql;
-- `create extension if not exists` is a no-op if so, and safe standalone.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'gbp-review-sync',
  '0 */4 * * *',                       -- every 4 hours, per spec ("every few hours")
  $$
  select net.http_post(
    url     := 'https://ehzwsqkrmxsfdfslxmpo.functions.supabase.co/gbp-review-sync',
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-cron-secret', '<GBP_SYNC_CRON_SECRET>'
               ),
    body    := '{}'::jsonb
  );
  $$
);
