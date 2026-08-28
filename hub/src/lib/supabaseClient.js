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
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// createClient() throws synchronously if either is missing — and since
// this module is imported at the top of CrmTab.jsx/ClientsTab.jsx, that
// throw happens at *page load*, before React even renders, taking down
// the entire app (Settings gate included, and the Admin tab, which
// doesn't touch Supabase at all) with a blank white screen and no
// message. Caught live: merging the CRM and Clients tabs together
// without a hub/.env.local present reproduced exactly this. Guard it
// instead — every caller checks `supabaseConfigured` before querying.
export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured ? createClient(url, key) : null;
