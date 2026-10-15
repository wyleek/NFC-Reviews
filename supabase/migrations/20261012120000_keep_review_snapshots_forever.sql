-- Keep full review-count history so the dashboard can show all-time data
-- (purge-old-review-snapshots deleted anything older than 30 days daily).
-- purge_old_review_snapshots() itself is left in place, unscheduled, in
-- case a retention window is wanted again later.
select cron.unschedule('purge-old-review-snapshots');
