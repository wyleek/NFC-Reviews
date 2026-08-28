import { createClient } from "@supabase/supabase-js";

// Anon-key client — reads only. RLS (20260821180000_crm_read_policies.sql)
// grants SELECT on businesses/contacts/activities/deals/scheduled_messages/
// places_lookup_cache to anon/authenticated. Every write goes through
// admin-api instead (see adminApi.js) — never call .insert/.update/.delete
// on this client.
//
// Ported from board/src/lib/supabaseClient.js (feature/hub-crm-tab) — same
// Supabase project, so the same VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY
// values from board/.env.example apply here, just under hub/'s own
// .env.local (didn't exist yet before this branch).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
