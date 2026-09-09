-- Backfilled from supabase_migrations.schema_migrations (applied live,
-- never committed — see docs/BRANCH_BRIEF-foundation.md).
-- Cleanup for the console-live-data linkmaker.html browser click-through
-- smoke test (real search_place + quick_link round trip against a real
-- Google Place, "Space Needle" / slug space-needle-stand-van0). Not a real
-- customer — remove before this looks like production data.
delete from taps where card_id in (select id from cards where slug = 'space-needle-stand-van0');
delete from cards where slug = 'space-needle-stand-van0';
delete from businesses where name = 'Space Needle' and google_place_id = 'ChIJ-bfVTh8VkFQRDZLQnmioK9s';
