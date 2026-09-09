import { createClient } from "@supabase/supabase-js";

// Real Supabase Auth client (unlike hub/dashboard-app, which only ever read
// with the anon key — this is the first app in the repo with logged-in
// users). Every table this app touches is RLS-scoped by org via
// current_org_ids() (see supabase/migrations/20260908120100_foundation_rls.sql),
// so the anon key + a real session is enough; there's no separate
// admin-api-style write path here.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Same guard as hub/src/lib/supabaseClient.js — createClient() throws
// synchronously if either env var is missing, which would otherwise blank
// the whole app before React renders anything.
export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured ? createClient(url, key) : null;
