// ============================================================================
// sync-reviews — run daily. For each business with a google_place_id, pull the
// live review total + rating from the Places API (New) and snapshot it, so the
// dashboard can chart taps vs. review growth over time. Also backfills
// businesses.phone (the general/front-line number — see admin-api's add_lead)
// for any business that still doesn't have one on file — this is the sweep
// that catches businesses added before that field existed, or by a path that
// never fetched one (quick_link/linkmaker). Never overwrites a phone already
// on file, same rule as add_lead/set_business_phone: Google can be missing or
// stale, a manual correction should stick.
//
// Uses field mask "rating,userRatingCount,nationalPhoneNumber,
// internationalPhoneNumber" — one Place Details call per business, still well
// within Google's $200/mo free credit at daily frequency for hundreds of
// businesses.
//
// Protected by a shared secret header so only your scheduler can trigger it.
// Deploy:  supabase functions deploy sync-reviews --no-verify-jwt
// (the CRON_SECRET check below is what actually guards it)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLACES_KEY   = Deno.env.get("GOOGLE_PLACES_API_KEY")!;
const CRON_SECRET  = Deno.env.get("CRON_SECRET")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

async function fetchPlace(
  placeId: string,
): Promise<{ count: number | null; rating: number | null; phone: string | null }> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": PLACES_KEY,
      "X-Goog-FieldMask": "rating,userRatingCount,nationalPhoneNumber,internationalPhoneNumber",
    },
  });
  if (!res.ok) {
    console.error("Places API error", placeId, res.status, await res.text());
    return { count: null, rating: null, phone: null };
  }
  const data = await res.json();
  return {
    count: data.userRatingCount ?? null,
    rating: data.rating ?? null,
    phone: data.nationalPhoneNumber ?? data.internationalPhoneNumber ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const { data: businesses, error } = await admin
    .from("businesses")
    .select("id, google_place_id, phone")
    .not("google_place_id", "is", null);

  if (error) return new Response(JSON.stringify({ error }), { status: 500 });

  const today = new Date().toISOString().slice(0, 10); // UTC yyyy-mm-dd
  let ok = 0, failed = 0, phonesFilled = 0;

  for (const b of businesses ?? []) {
    try {
      const { count, rating, phone } = await fetchPlace(b.google_place_id as string);
      if (count === null) { failed++; continue; }

      // Idempotent daily snapshot
      await admin.from("review_snapshots").upsert(
        { business_id: b.id, captured_on: today, review_count: count, rating },
        { onConflict: "business_id,captured_on" },
      );
      // Keep the denormalized "current" fields fresh for the dashboard
      // header, and fill in a missing phone number — but never overwrite
      // one already on file.
      const fields: Record<string, unknown> = {
        current_review_count: count,
        current_rating: rating,
        reviews_synced_at: new Date().toISOString(),
      };
      if (phone && !b.phone) {
        fields.phone = phone;
        phonesFilled++;
      }
      await admin.from("businesses").update(fields).eq("id", b.id);

      ok++;
      await new Promise((r) => setTimeout(r, 120)); // gentle pacing
    } catch (e) {
      console.error("sync failed for", b.id, e);
      failed++;
    }
  }

  return new Response(JSON.stringify({ date: today, ok, failed, phonesFilled }), {
    headers: { "Content-Type": "application/json" },
  });
});
