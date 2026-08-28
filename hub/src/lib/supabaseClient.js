import { createClient } from "@supabase/supabase-js";

// Anon-key client — reads only. RLS (20260818035800_dashboard_read_policies.sql)
// grants SELECT on businesses/cards/taps/review_snapshots/competitors/
// competitor_snapshots to anon/authenticated. Every write goes through
// admin-api instead (see admin.html/AdminTab) — never call
// .insert/.update/.delete on this client. Same pattern as
// board/src/lib/supabaseClient.js.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
