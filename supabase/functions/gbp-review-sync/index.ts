// ============================================================================
// gbp-review-sync — the review-sync heartbeat every warm module reads.
// For each connected `locations` row, refreshes the GBP access token if
// needed, pulls reviews (full history on first sync, incremental after),
// upserts them into `reviews`, and writes a `place_review_snapshots` row.
//
// Distinct from the existing functions/sync-reviews, which does a daily
// Places-API aggregate count/rating snapshot for the internal CRM's
// `businesses` table — unrelated pipeline, left untouched.
//
// Triggered two ways, same shared-secret guard as the existing sync-reviews:
//   - pg_cron every few hours, body {} → syncs every pending/ok location
//   - gbp-locations-connect right after a new location is connected, body
//     { location_ids: [...] } → syncs just the new one(s) immediately
//
// Deploy: supabase functions deploy gbp-review-sync --no-verify-jwt
// (the x-cron-secret check below is what actually guards it)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { fetchReviewsPage, refreshAccessToken, starRatingToInt } from "../_shared/gbp.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const GBP_SYNC_CRON_SECRET = Deno.env.get("GBP_SYNC_CRON_SECRET")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh if expiry is within 5 min

interface LocationRow {
  id: string;
  org_id: string;
  gbp_location_name: string;
  place_id: string | null;
  first_synced_at: string | null;
}

async function getValidAccessToken(orgId: string): Promise<string | null> {
  const { data: token } = await admin
    .from("oauth_tokens")
    .select("access_token, refresh_token, expiry")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!token) return null;

  const expiry = token.expiry ? new Date(token.expiry).getTime() : 0;
  if (expiry - Date.now() > REFRESH_MARGIN_MS) return token.access_token;

  try {
    const refreshed = await refreshAccessToken(token.refresh_token, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await admin
      .from("oauth_tokens")
      .update({ access_token: refreshed.access_token, expiry: newExpiry, updated_at: new Date().toISOString() })
      .eq("org_id", orgId);
    return refreshed.access_token;
  } catch (e) {
    console.error("token refresh failed for org", orgId, e);
    return null;
  }
}

async function syncLocation(location: LocationRow): Promise<{ ok: boolean; reason?: string }> {
  const accessToken = await getValidAccessToken(location.org_id);
  if (!accessToken) return { ok: false, reason: "no_valid_token" };

  await admin.from("locations").update({ sync_status: "syncing" }).eq("id", location.id);

  const isFirstSync = !location.first_synced_at;
  let pageToken: string | undefined;
  let totalCount = 0;
  let ratingSum = 0;
  let sawExistingId = false;

  try {
    do {
      const { reviews, nextPageToken } = await fetchReviewsPage(accessToken, location.gbp_location_name, pageToken);
      if (reviews.length === 0) break;

      const ids = reviews.map((r) => r.reviewId);
      const { data: existingRows } = await admin
        .from("reviews")
        .select("gbp_review_id")
        .in("gbp_review_id", ids);
      const existingIds = new Set((existingRows ?? []).map((r) => r.gbp_review_id));

      const rows = reviews.map((r) => ({
        org_id: location.org_id,
        location_id: location.id,
        gbp_review_id: r.reviewId,
        author_name: r.reviewer?.displayName ?? null,
        author_photo_url: r.reviewer?.profilePhotoUrl ?? null,
        star_rating: starRatingToInt(r.starRating),
        comment: r.comment ?? null,
        create_time: r.createTime ?? null,
        update_time: r.updateTime ?? null,
        reply_comment: r.reviewReply?.comment ?? null,
        reply_update_time: r.reviewReply?.updateTime ?? null,
        synced_at: new Date().toISOString(),
        raw: r,
      }));

      const { error: upsertErr } = await admin.from("reviews").upsert(rows, { onConflict: "gbp_review_id" });
      if (upsertErr) throw upsertErr;

      totalCount += reviews.length;
      for (const r of reviews) {
        const stars = starRatingToInt(r.starRating);
        if (stars) ratingSum += stars;
      }

      // Incremental syncs (not the first one) can stop early once a page
      // is entirely reviews we've already stored — full history on the
      // first sync always runs to exhaustion regardless.
      if (!isFirstSync && ids.every((id) => existingIds.has(id))) {
        sawExistingId = true;
        break;
      }

      pageToken = nextPageToken;
    } while (pageToken);

    if (totalCount > 0) {
      await admin.from("place_review_snapshots").insert({
        place_id: location.place_id ?? location.gbp_location_name,
        location_id: location.id,
        total_count: totalCount,
        avg_rating: totalCount ? Math.round((ratingSum / totalCount) * 10) / 10 : null,
        source: "gbp",
      });
    }

    await admin
      .from("locations")
      .update({
        sync_status: "ok",
        first_synced_at: location.first_synced_at ?? new Date().toISOString(),
      })
      .eq("id", location.id);

    return { ok: true };
  } catch (e) {
    console.error("sync failed for location", location.id, sawExistingId ? "(stopped early)" : "", e);
    await admin.from("locations").update({ sync_status: "error" }).eq("id", location.id);
    return { ok: false, reason: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== GBP_SYNC_CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let locationIds: string[] | undefined;
  try {
    const body = await req.json();
    locationIds = body?.location_ids;
  } catch {
    // empty body (cron call) is fine — falls through to "all pending/ok"
  }

  let query = admin
    .from("locations")
    .select("id, org_id, gbp_location_name, place_id, first_synced_at")
    .in("sync_status", ["pending", "ok"]);
  if (locationIds?.length) query = query.in("id", locationIds);

  const { data: locations, error } = await query;
  if (error) return new Response(JSON.stringify({ error }), { status: 500 });

  let ok = 0, failed = 0;
  for (const location of locations ?? []) {
    const result = await syncLocation(location as LocationRow);
    if (result.ok) ok++; else failed++;
  }

  return new Response(JSON.stringify({ synced: (locations ?? []).length, ok, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
