// ============================================================================
// gbp-sync — run daily, after gbp-connect has linked at least one business.
// For each connected business, refreshes its GBP access token if needed and
// snapshots review_count/rating into gbp_review_history — durable, unlike
// the Places-sourced review_snapshots (see the 30-day purge migration),
// because this data is owner-authorized under GBP's own terms.
//
// UNTESTED — no GBP API access yet, see gbp-connect's module header. The
// token-refresh logic is standard OAuth2 and should be right; the review-
// fetching call (which endpoint, which fields) needs verification against
// current Business Profile API docs once access exists. Until then this
// function simply has nothing to do (0 connections) and no-ops cleanly.
//
// Protected by the same CRON_SECRET as sync-reviews.
// Deploy: supabase functions deploy gbp-sync --no-verify-jwt
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const CLIENT_ID = Deno.env.get("GBP_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("GBP_CLIENT_SECRET");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function ensureFreshToken(conn: any): Promise<string | null> {
  const expiresInMs = new Date(conn.token_expires_at).getTime() - Date.now();
  if (expiresInMs > 5 * 60 * 1000) return conn.access_token; // still good for 5+ min

  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("token refresh failed for", conn.business_id, await res.text());
    return null;
  }
  const tokens = await res.json();
  const token_expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await admin.from("gbp_connections")
    .update({ access_token: tokens.access_token, token_expires_at })
    .eq("business_id", conn.business_id);
  return tokens.access_token;
}

// NOTE: unverified endpoint — the "reviews.list" surface (v4 mybusiness.googleapis.com)
// is what historically exposed averageRating/totalReviewCount per location; Google
// has reorganized this API more than once. Confirm before relying on it.
async function fetchReviewStats(accessToken: string, accountId: string, locationId: string) {
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${accountId}/${locationId}/reviews?pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    console.error("GBP reviews fetch failed", accountId, locationId, res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return { count: data.totalReviewCount ?? null, rating: data.averageRating ?? null };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const { data: connections, error } = await admin.from("gbp_connections").select("*");
  if (error) return new Response(JSON.stringify({ error }), { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  let ok = 0, failed = 0;

  for (const conn of connections ?? []) {
    try {
      const token = await ensureFreshToken(conn);
      if (!token) { failed++; continue; }

      const stats = await fetchReviewStats(token, conn.gbp_account_id, conn.gbp_location_id);
      if (!stats || stats.count === null) { failed++; continue; }

      await admin.from("gbp_review_history").upsert(
        { business_id: conn.business_id, captured_on: today, review_count: stats.count, rating: stats.rating },
        { onConflict: "business_id,captured_on" },
      );
      ok++;
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      console.error("gbp sync failed for", conn.business_id, e);
      failed++;
    }
  }

  return new Response(JSON.stringify({ date: today, ok, failed, connections: connections?.length ?? 0 }), {
    headers: { "Content-Type": "application/json" },
  });
});
