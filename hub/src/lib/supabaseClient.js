import { createClient } from "@supabase/supabase-js";

// Anon-key client — reads only, shared by the CRM and Clients tabs. RLS
// grants SELECT on:
//  - businesses/contacts/activities/deals/scheduled_messages/
//    places_lookup_cache (20260821180000_crm_read_policies.sql) — CRM tab
//  - businesses/cards/taps/review_snapshots/competitors/
//    competitor_snapshots (20260818035800_dashboard_read_policies.sql) —
//    Clients tab
// Every write goes through admin-api instead (see adminApi.js) — never
// call .insert/.update/.delete on this client. Same pattern as
// board/src/lib/supabaseClient.js and dashboard-app/src/Dashboard.jsx.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
